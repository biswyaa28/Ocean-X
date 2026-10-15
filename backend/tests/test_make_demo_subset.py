"""The demo subset must be real data, thinned — never a re-interpretation.

``make_demo_subset.py`` exists so a fresh clone can run the app on real INCOIS
HYCOM output. The one thing it must never do is change a value: every grid cell,
depth level and time step it keeps has to be bit-for-bit the value the
publisher wrote. These tests pin that, plus the provenance attributes and the
size budget that make the subset committable.
"""

import sys
from pathlib import Path

import numpy as np
import pytest
import xarray as xr

BACKEND_ROOT = Path(__file__).resolve().parents[1]
SCRIPTS_DIR = BACKEND_ROOT / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import make_demo_subset as subset


def _source_dataset(ntime=6, ndepth=3, nlat=10, nlon=9) -> xr.Dataset:
    """A tiny stand-in with the real file's shape and variable set."""
    time = np.array(
        [np.datetime64("2026-10-03T06:00") + np.timedelta64(6 * i, "h") for i in range(ntime)]
    )
    depth = np.array([0.0, 17.5, 52.5][:ndepth])
    lat = np.linspace(5.0, 24.0, nlat)
    lon = np.linspace(80.0, 98.0, nlon)
    shape = (ntime, ndepth, nlat, nlon)
    rng = np.arange(np.prod(shape), dtype=np.float32).reshape(shape)
    ds = xr.Dataset(
        {
            "TEMP": (("TIME", "DEPTH", "LAT", "LON"), rng.copy()),
            "SALN": (("TIME", "DEPTH", "LAT", "LON"), rng.copy() + 0.5),
            "UVEL": (("TIME", "DEPTH", "LAT", "LON"), rng.copy() + 1.0),
            "VVEL": (("TIME", "DEPTH", "LAT", "LON"), rng.copy() + 2.0),
            "SSH": (("TIME", "DEPTH", "LAT", "LON"), rng.copy() + 3.0),
            "MLD": (("TIME", "DEPTH", "LAT", "LON"), rng.copy() + 4.0),
            "TCHP": (("TIME", "DEPTH", "LAT", "LON"), rng.copy() + 5.0),
        },
        coords={"TIME": time, "DEPTH": depth, "LAT": lat, "LON": lon},
        attrs={"history": "PyFerret V7.63", "Conventions": "CF-1.6"},
    )
    return ds


class TestSelectTimeIndices:
    def test_keeps_every_nth_time(self):
        assert subset.select_time_indices(7, time_step=3) == [0, 3, 6]

    def test_always_keeps_the_last_time(self):
        """The newest model state is what Live mode shows; dropping it would
        make the demo show an older day than the file actually holds."""
        assert subset.select_time_indices(7, time_step=4) == [0, 4, 6]

    def test_step_of_one_keeps_everything(self):
        assert subset.select_time_indices(4, time_step=1) == [0, 1, 2, 3]

    def test_empty_input_keeps_nothing(self):
        assert subset.select_time_indices(0, time_step=4) == []

    def test_step_larger_than_the_run_keeps_both_ends(self):
        assert subset.select_time_indices(5, time_step=99) == [0, 4]


class TestCoarsen:
    def test_keeps_every_nth_grid_point_and_nothing_else(self):
        ds = _source_dataset()
        thin = subset.coarsen(ds, lat_stride=2, lon_stride=3, time_indices=[0, 2, 5])

        assert thin.sizes["TIME"] == 3
        assert thin.sizes["DEPTH"] == ds.sizes["DEPTH"]  # depth levels are never thinned
        assert thin.sizes["LAT"] == len(range(0, 10, 2))
        assert thin.sizes["LON"] == len(range(0, 9, 3))

        # Every kept cell must be the source value at that exact index.
        for ti, source_t in enumerate([0, 2, 5]):
            for di in range(ds.sizes["DEPTH"]):
                for yi, source_y in enumerate(range(0, 10, 2)):
                    for xi, source_x in enumerate(range(0, 9, 3)):
                        assert thin["TEMP"].values[ti, di, yi, xi] == (
                            ds["TEMP"].values[source_t, di, source_y, source_x]
                        )

    def test_coordinates_follow_the_kept_points(self):
        ds = _source_dataset()
        thin = subset.coarsen(ds, lat_stride=2, lon_stride=2, time_indices=[0])
        assert thin["LAT"].values.tolist() == ds["LAT"].values[::2].tolist()
        assert thin["LON"].values.tolist() == ds["LON"].values[::2].tolist()
        assert thin["DEPTH"].values.tolist() == ds["DEPTH"].values.tolist()

    def test_never_adds_a_grid_point_the_source_did_not_have(self):
        """No interpolation, no resampling, no edge padding."""
        ds = _source_dataset()
        for lat_stride, lon_stride in [(1, 1), (2, 3), (4, 4)]:
            thin = subset.coarsen(ds, lat_stride, lon_stride, time_indices=[0])
            assert thin.sizes["LAT"] == -(-ds.sizes["LAT"] // lat_stride)
            assert thin.sizes["LON"] == -(-ds.sizes["LON"] // lon_stride)

    def test_keeps_every_variable_the_app_reads(self):
        ds = _source_dataset()
        thin = subset.coarsen(ds, lat_stride=2, lon_stride=2, time_indices=[0])
        for variable in ("TEMP", "SALN", "UVEL", "VVEL", "SSH", "MLD", "TCHP"):
            assert variable in thin.data_vars


class TestProvenanceAttributes:
    def test_preserves_the_source_attributes_and_adds_the_subset_record(self):
        attrs = subset.demo_attrs(
            {"history": "PyFerret V7.63", "Conventions": "CF-1.6"},
            source_filename="RSMC_hycom_20261004_bob_subset.nc",
            lat_stride=4,
            lon_stride=4,
            time_indices=[0, 4, 6],
            source_times=6,
        )
        assert attrs["history"] == "PyFerret V7.63"
        assert attrs["Conventions"] == "CF-1.6"
        assert attrs["subset_of"] == "RSMC_hycom_20261004_bob_subset.nc"
        assert "coarsened" in attrs["subset_method"].lower()
        assert "4" in attrs["subset_method"]

    def test_records_the_time_steps_kept_and_dropped(self):
        attrs = subset.demo_attrs(
            {},
            source_filename="x.nc",
            lat_stride=2,
            lon_stride=2,
            time_indices=[0, 2, 5],
            source_times=6,
        )
        assert attrs["time_steps_kept"] == 3
        assert attrs["time_steps_source"] == 6

    def test_the_subset_is_never_marked_synthetic(self):
        """The single most damaging lie available here: labelling real HYCOM
        output as synthetic would make the app hide it."""
        attrs = subset.demo_attrs({}, "x.nc", 2, 2, [0], 1)
        assert attrs.get("synthetic") != "true"
        assert attrs["data_status"] == "REAL"

    def test_state_that_values_are_unaltered(self):
        attrs = subset.demo_attrs({}, "x.nc", 3, 3, [0], 1)
        assert "subsample" in attrs["subset_method"].lower() or "unaltered" in attrs["subset_method"].lower()


class TestSizeBudget:
    def test_rejects_an_output_over_the_hard_limit(self, tmp_path):
        big = tmp_path / "big.nc"
        big.write_bytes(b"0" * (61 * 1024 * 1024))
        with pytest.raises(subset.SubsetTooLarge):
            subset.enforce_budget([big], target_mb=40, hard_mb=60)

    def test_accepts_an_output_under_the_target(self, tmp_path):
        small = tmp_path / "small.nc"
        small.write_bytes(b"0" * 1024)
        subset.enforce_budget([small], target_mb=40, hard_mb=60)

    def test_warns_when_over_the_target_but_under_the_hard_limit(self, tmp_path):
        over_target = tmp_path / "over_target.nc"
        over_target.write_bytes(b"0" * (41 * 1024 * 1024))
        summary = subset.enforce_budget([over_target], target_mb=40, hard_mb=60)
        assert summary["total_mb"] > 40
        assert summary["over_target"] is True
        assert summary["within_hard_limit"] is True


class TestOutputEncoding:
    def test_writes_zlib_compressed_float32(self, tmp_path):
        out = tmp_path / "out.nc"
        subset.write_demo_dataset(_source_dataset(), out, {"source_filename": "src.nc"})
        with xr.open_dataset(out, engine="netcdf4") as written:
            assert written["TEMP"].dtype == np.float32
            import netCDF4

            assert netCDF4.Dataset(out).variables["TEMP"].filters()["zlib"] is True

    def test_round_trip_preserves_values_exactly(self, tmp_path):
        ds = _source_dataset()
        out = tmp_path / "out.nc"
        subset.write_demo_dataset(ds, out, {"source_filename": "src.nc"})
        with xr.open_dataset(out, engine="netcdf4") as written:
            assert np.array_equal(written["TEMP"].values, ds["TEMP"].values.astype(np.float32))