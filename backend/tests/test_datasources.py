"""Model data source tests: variable discovery, units, fixture and NetCDF
pathways (STEP 3B §4, §5, §19, §23, §26).

All NetCDF tests build their own temporary file. No network access, no external
data, no credentials (§24).
"""
import numpy as np
import pytest
import xarray as xr

from app.core.config import settings
from app.datasources import get_model_data_source, reset_model_data_source
from app.datasources.base import ModelDataSource, VariableNotFoundError
from app.datasources.fixture_source import FixtureModelDataSource
from app.datasources.netcdf_source import NetCDFModelDataSource
from app.datasources.variables import (
    canonical_units,
    normalise_values,
    resolve_name,
)

# The development environment may lack netCDF4/h5netcdf; the scipy backend
# writes NetCDF3 and is always available with scipy installed.
NC_ENGINE = "scipy"


def _write_dataset(
    tmp_path,
    *,
    temp_name="thetao",
    sal_name="so",
    temp_units="degrees_C",
    depth_name="depth",
    lat_name="latitude",
    lon_name="longitude",
    time_name="time",
    depths=(0.494, 10.0, 50.0, 100.0, 500.0),
    negative_depth=False,
    filename="model.nc",
):
    """Write a small GLORYS-like NetCDF file and return its path."""
    depth_values = np.asarray(depths, dtype="float64")
    if negative_depth:
        depth_values = -depth_values
    lats = np.arange(-4.0, 4.5, 1.0)
    lons = np.arange(60.0, 68.5, 1.0)
    times = np.array(
        ["2023-07-01T12:00", "2023-07-02T12:00", "2023-07-03T12:00"], dtype="datetime64[ns]"
    )
    shape = (times.size, depth_values.size, lats.size, lons.size)
    profile = np.linspace(28.0, 5.0, depth_values.size)
    temp = np.broadcast_to(profile[None, :, None, None], shape).astype("float32").copy()
    temp[:, :, 0, 0] = np.nan  # masked land cell
    sal = np.full(shape, 35.0, dtype="float32")

    ds = xr.Dataset(
        {
            temp_name: (
                (time_name, depth_name, lat_name, lon_name),
                temp,
                {"units": temp_units, "long_name": "Temperature", "standard_name": "sea_water_potential_temperature"},
            ),
            sal_name: (
                (time_name, depth_name, lat_name, lon_name),
                sal,
                {"units": "1e-3", "long_name": "Salinity"},
            ),
        },
        coords={time_name: times, depth_name: depth_values, lat_name: lats, lon_name: lons},
        attrs={"title": "Synthetic test file", "product_version": "testv1", "id": "TEST_ID"},
    )
    path = tmp_path / filename
    ds.to_netcdf(path, engine=NC_ENGINE)
    ds.close()
    return str(path)


# ================================================ variable discovery (§5)


def test_glorys_names_resolve_for_both_variables():
    assert resolve_name("temperature", ["thetao", "so"])[0] == "thetao"
    assert resolve_name("salinity", ["thetao", "so"])[0] == "so"


@pytest.mark.parametrize("name", ["thetao", "temperature", "temp", "to", "water_temp"])
def test_alternative_temperature_names_all_resolve(name):
    assert resolve_name("temperature", [name])[0] == name


@pytest.mark.parametrize("name", ["so", "salinity", "psal", "sal", "salt"])
def test_alternative_salinity_names_all_resolve(name):
    assert resolve_name("salinity", [name])[0] == name


def test_candidate_order_decides_when_several_are_present():
    actual, tried = resolve_name("temperature", ["temp", "thetao"])
    assert actual == "thetao"
    assert tried.index("thetao") < tried.index("temp")


def test_resolution_is_case_insensitive_as_a_fallback():
    assert resolve_name("temperature", ["THETAO"])[0] == "THETAO"


def test_missing_variable_fails_clearly_and_lists_what_was_tried():
    with pytest.raises(VariableNotFoundError) as exc:
        resolve_name("temperature", ["salinity_only", "mlotst"])
    message = str(exc.value)
    assert "temperature" in message
    assert "thetao" in message
    assert "mlotst" in message


def test_no_silent_wrong_mapping_when_only_the_other_variable_exists():
    """Requesting temperature from a salinity-only dataset must raise, not return 'so'."""
    with pytest.raises(VariableNotFoundError):
        resolve_name("temperature", ["so"])


# ================================================ units (§19)


@pytest.mark.parametrize(
    "raw", ["degC", "degrees_C", "degree_Celsius", "Celsius", "°C", "deg_C"]
)
def test_celsius_spellings_are_recognised(raw):
    assert canonical_units(raw) == "degC"


@pytest.mark.parametrize("raw", ["psu", "1e-3", "PSS-78"])
def test_salinity_unit_spellings_are_recognised(raw):
    assert canonical_units(raw) == "psu"


def test_unknown_units_are_reported_as_unknown_not_assumed_celsius():
    assert canonical_units("furlongs") == "unknown"
    assert canonical_units(None) == "unknown"
    assert canonical_units("") == "unknown"


def test_absent_units_pass_values_through_and_say_no_assumption_was_made():
    values, units, note = normalise_values(np.array([20.0]), "temperature", None)
    assert units == "unknown"
    assert values[0] == 20.0
    assert "no unit was assumed" in note


def test_kelvin_is_converted_to_celsius_and_the_conversion_is_recorded():
    values, units, note = normalise_values(np.array([293.15]), "temperature", "kelvin")
    assert units == "degC"
    assert values[0] == pytest.approx(20.0)
    assert "273.15" in note


def test_matching_units_need_no_conversion():
    values, units, note = normalise_values(np.array([20.0]), "temperature", "degC")
    assert units == "degC" and note is None and values[0] == 20.0


# ================================================ fixture source (§23)


def test_fixture_source_implements_the_abstraction():
    src = FixtureModelDataSource().open()
    assert isinstance(src, ModelDataSource)
    src.close()


def test_fixture_source_declares_itself_a_fixture():
    with FixtureModelDataSource() as src:
        grid = src.grid_info()
        assert grid.is_fixture is True
        assert grid.data_tier == "local_deterministic_fixture"
        assert "no GLORYS data" in grid.source or "not real" in (grid.notes or "")


def test_fixture_source_resolves_glorys_style_names():
    with FixtureModelDataSource() as src:
        assert src.resolve_variable("temperature").actual_name == "thetao"
        assert src.resolve_variable("salinity").actual_name == "so"


def test_fixture_grid_covers_the_demonstration_region():
    with FixtureModelDataSource() as src:
        grid = src.grid_info()
        assert grid.longitudes.min() == settings.LON_MIN
        assert grid.longitudes.max() == settings.LON_MAX
        assert grid.latitudes.min() == settings.LAT_MIN
        assert grid.latitudes.max() == settings.LAT_MAX


def test_fixture_profile_reports_the_requested_time_and_cell():
    with FixtureModelDataSource() as src:
        p = src.profile_at("temperature", time_index=2, lat_index=38, lon_index=28)
        assert p.time_index == 2
        assert p.lat_index == 38 and p.lon_index == 28
        assert p.is_fixture is True
        assert p.depths_m.size == p.values.size


def test_fixture_source_rejects_out_of_range_indices():
    with FixtureModelDataSource() as src:
        with pytest.raises(IndexError):
            src.profile_at("temperature", 999, 0, 0)
        with pytest.raises(IndexError):
            src.profile_at("temperature", 0, 999, 0)


def test_fixture_region_slice_honours_the_bbox():
    with FixtureModelDataSource() as src:
        sl = src.region_slice("temperature", 0, 0, bbox=(60.0, -5.0, 65.0, 5.0))
        assert sl.latitudes.min() >= -5.0 and sl.latitudes.max() <= 5.0
        assert sl.longitudes.min() >= 60.0 and sl.longitudes.max() <= 65.0
        assert sl.values.shape == (sl.latitudes.size, sl.longitudes.size)


# ================================================ NetCDF source (§4)


def test_netcdf_source_opens_and_reports_metadata(tmp_path):
    path = _write_dataset(tmp_path)
    with NetCDFModelDataSource(path, engine=NC_ENGINE) as src:
        grid = src.grid_info()
        assert grid.is_fixture is False
        assert grid.data_tier == "netcdf_dataset"
        assert grid.dataset_id == "TEST_ID"
        assert grid.model_version == "testv1"
        assert len(grid.times) == 3
        assert grid.depths_m.size == 5


def test_netcdf_source_discovers_variables_from_the_file(tmp_path):
    path = _write_dataset(tmp_path)
    with NetCDFModelDataSource(path, engine=NC_ENGINE) as src:
        assert src.resolve_variable("temperature").actual_name == "thetao"
        assert src.resolve_variable("salinity").actual_name == "so"


def test_netcdf_source_handles_alternative_variable_names(tmp_path):
    path = _write_dataset(tmp_path, temp_name="temp", sal_name="psal")
    with NetCDFModelDataSource(path, engine=NC_ENGINE) as src:
        assert src.resolve_variable("temperature").actual_name == "temp"
        assert src.resolve_variable("salinity").actual_name == "psal"


def test_netcdf_source_handles_alternative_coordinate_names(tmp_path):
    path = _write_dataset(tmp_path, depth_name="lev", lat_name="lat", lon_name="lon")
    with NetCDFModelDataSource(path, engine=NC_ENGINE) as src:
        assert src.depth_coordinates().size == 5
        assert src.grid_info().latitudes.size == 9


def test_netcdf_source_fails_clearly_when_a_variable_is_absent(tmp_path):
    path = _write_dataset(tmp_path, temp_name="mlotst")
    with NetCDFModelDataSource(path, engine=NC_ENGINE) as src:
        with pytest.raises(VariableNotFoundError, match="temperature"):
            src.resolve_variable("temperature")


def test_netcdf_times_are_timezone_aware_utc(tmp_path):
    path = _write_dataset(tmp_path)
    with NetCDFModelDataSource(path, engine=NC_ENGINE) as src:
        for t in src.available_times():
            assert t.tzinfo is not None
            assert t.utcoffset().total_seconds() == 0


def test_netcdf_profile_is_read_at_the_requested_indices(tmp_path):
    path = _write_dataset(tmp_path)
    with NetCDFModelDataSource(path, engine=NC_ENGINE) as src:
        p = src.profile_at("temperature", time_index=1, lat_index=4, lon_index=3)
        assert p.time_index == 1
        assert p.time == src.available_times()[1]
        assert p.latitude == 0.0 and p.longitude == 63.0
        assert p.depths_m.size == p.values.size == 5
        assert p.values[0] == pytest.approx(28.0, abs=1e-4)
        assert p.is_fixture is False


def test_netcdf_masked_cell_stays_nan_and_is_never_zero_filled(tmp_path):
    path = _write_dataset(tmp_path)
    with NetCDFModelDataSource(path, engine=NC_ENGINE) as src:
        p = src.profile_at("temperature", 0, 0, 0)
        assert np.all(np.isnan(p.values))
        assert not np.any(p.values == 0.0)


def test_netcdf_units_are_normalised_and_reported(tmp_path):
    path = _write_dataset(tmp_path, temp_units="degrees_C")
    with NetCDFModelDataSource(path, engine=NC_ENGINE) as src:
        assert src.profile_at("temperature", 0, 4, 3).units == "degC"


def test_netcdf_kelvin_file_is_converted_and_noted(tmp_path):
    path = _write_dataset(tmp_path, temp_units="kelvin")
    with NetCDFModelDataSource(path, engine=NC_ENGINE) as src:
        p = src.profile_at("temperature", 0, 4, 3)
        assert p.units == "degC"
        assert p.values[0] == pytest.approx(28.0 - 273.15, abs=1e-3)
        assert any("273.15" in n for n in p.notes)


def test_netcdf_unknown_units_are_not_assumed_celsius(tmp_path):
    path = _write_dataset(tmp_path, temp_units="widgets")
    with NetCDFModelDataSource(path, engine=NC_ENGINE) as src:
        p = src.profile_at("temperature", 0, 4, 3)
        assert p.units == "unknown"
        assert any("no unit was assumed" in n for n in p.notes)


def test_netcdf_negative_elevation_axis_is_converted_to_positive_depth(tmp_path):
    path = _write_dataset(tmp_path, negative_depth=True)
    with NetCDFModelDataSource(path, engine=NC_ENGINE) as src:
        depths = src.depth_coordinates()
        assert np.all(depths >= 0.0)
        assert depths[-1] == pytest.approx(500.0)
        assert "negated" in src.grid_info().notes


def test_netcdf_region_slice_subsets_before_reading(tmp_path):
    path = _write_dataset(tmp_path)
    with NetCDFModelDataSource(path, engine=NC_ENGINE) as src:
        sl = src.region_slice("temperature", 0, 1, bbox=(62.0, -2.0, 64.0, 2.0))
        assert sl.values.shape == (5, 3)
        assert sl.latitudes.min() == -2.0 and sl.latitudes.max() == 2.0


def test_netcdf_bbox_selecting_nothing_is_an_error_not_an_empty_slice(tmp_path):
    path = _write_dataset(tmp_path)
    with NetCDFModelDataSource(path, engine=NC_ENGINE) as src:
        with pytest.raises(ValueError, match="no grid points"):
            src.region_slice("temperature", 0, 0, bbox=(200.0, 80.0, 210.0, 85.0))


def test_netcdf_close_releases_the_dataset(tmp_path):
    path = _write_dataset(tmp_path)
    src = NetCDFModelDataSource(path, engine=NC_ENGINE).open()
    src.close()
    with pytest.raises(RuntimeError, match="not open"):
        src.dataset


def test_netcdf_open_is_idempotent(tmp_path):
    path = _write_dataset(tmp_path)
    src = NetCDFModelDataSource(path, engine=NC_ENGINE).open()
    ds_first = src.dataset
    src.open()
    assert src.dataset is ds_first
    src.close()


def test_missing_file_raises_a_clear_error(tmp_path):
    with pytest.raises((FileNotFoundError, OSError)):
        NetCDFModelDataSource(str(tmp_path / "absent.nc"), engine=NC_ENGINE).open()


def test_unconfigured_path_is_rejected():
    with pytest.raises(ValueError, match="MODEL_NETCDF_PATH"):
        NetCDFModelDataSource(None)


# ================================================ source interchangeability (§23)


def test_netcdf_source_satisfies_the_same_interface_as_the_fixture(tmp_path):
    path = _write_dataset(tmp_path)
    with NetCDFModelDataSource(path, engine=NC_ENGINE) as nc, FixtureModelDataSource() as fx:
        for src in (nc, fx):
            grid = src.grid_info()
            assert grid.latitudes.size and grid.longitudes.size
            assert grid.depths_m.size and len(grid.times)
            p = src.profile_at("temperature", 0, 1, 1)
            assert p.depths_m.size == p.values.size


def test_the_pipeline_runs_unchanged_against_a_real_netcdf_source(tmp_path):
    """The scientific pathway must work on real NetCDF with no API/service change."""
    from app.science.pipeline import compare_profile
    from tests.conftest import make_profile, utc

    path = _write_dataset(tmp_path)
    prof = make_profile(
        time=utc(2023, 7, 2, 14),
        latitude=0.0,
        longitude=63.0,
        depths_m=[10.0, 50.0, 100.0],
        temperature=[27.0, 20.0, 14.0],
        temp_qc=[1, 1, 1],
        pres_qc=[1, 1, 1],
    )
    with NetCDFModelDataSource(path, engine=NC_ENGINE) as src:
        r = compare_profile(prof, src, "temperature")
        assert r.is_valid
        assert r.metrics.n == 3
        assert r.provenance["data_tier"] == "netcdf_dataset"
        assert r.provenance["model_variable_name"] == "thetao"
        assert "FIXTURE RUN" not in r.provenance["processing_notes"]
        np.testing.assert_allclose(
            r.residuals.residuals,
            r.residuals.model_values - r.residuals.observation_values,
        )


def test_factory_returns_the_fixture_source_by_default():
    reset_model_data_source()
    src = get_model_data_source()
    assert isinstance(src, FixtureModelDataSource)


def test_factory_rejects_an_unknown_source_kind():
    with pytest.raises(ValueError, match="unknown MODEL_SOURCE"):
        get_model_data_source("carrier_pigeon")


def test_factory_caches_the_source_instance():
    reset_model_data_source()
    assert get_model_data_source() is get_model_data_source()


def test_netcdf_pathway_is_configurable_via_settings(tmp_path, monkeypatch):
    """§29.6: the real NetCDF pathway is reachable by configuration alone."""
    path = _write_dataset(tmp_path)
    reset_model_data_source()
    monkeypatch.setattr(settings, "MODEL_SOURCE", "netcdf")
    monkeypatch.setattr(settings, "MODEL_NETCDF_PATH", path)
    try:
        src = get_model_data_source()
        assert isinstance(src, NetCDFModelDataSource)
        assert src.grid_info().is_fixture is False
    finally:
        reset_model_data_source()
