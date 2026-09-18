"""HYCOM current-flow (UVEL/VVEL) tests (Phase 1E).

These tests validate the pipeline that feeds the particle flow renderer:
- the depth-aware UVEL/VVEL slice contract used for the current field
  (timestamp correspondence, nearest native depth, NaN -> null, no
  substitution when a component is missing)
- dataset reuse (the NetCDF is opened once, not per request)
- response-shape robustness for the frontend normalizer

They run against the REAL raw HYCOM file when installed; otherwise
tests/conftest.py binds the HYCOM paths to committed SYNTHETIC
schema-compatible fixtures (announced in the test banner). Assertions are
mode-agnostic: they never assert fixture-specific scientific values, only
code paths, contract shape and error semantics. Real-data behaviour is
covered by test_integration_hycom.py (requires_real_hycom tests).
"""

from pathlib import Path

import numpy as np
import pandas as pd
import pytest
import xarray as xr
from fastapi.testclient import TestClient

import app.providers.incois_provider as incois_provider_module
from app.main import app
from app.providers.incois_provider import (
    DepthSliceVariableUnavailableError,
    IncoisProvider,
    incois_provider,
)

client = TestClient(app)


def _depths() -> list:
    depths = incois_provider.get_available_depths()
    assert depths, "no depths available (depth dataset missing?)"
    return depths


def _timestamps() -> list:
    ts = incois_provider.get_available_depth_timestamps()
    assert ts, "no timestamps available (depth dataset missing?)"
    return ts


def _get_currents(timestamp=None, depth=None):
    depth = depth if depth is not None else _depths()[0]
    return incois_provider.get_depth_slice("currents", timestamp, depth)


# ------------------------------------------------------------
# Structure: real UVEL/VVEL vector pair contract
# ------------------------------------------------------------

def test_current_flow_returns_uvel_vvel_pair():
    res = _get_currents()
    assert res.status in ("REAL", "SIMULATED"), f"status must be REAL or SIMULATED (data-mode-aware)"
    assert "INCOIS" in res.source
    assert res.variable == "currents"
    assert res.units == "m/s"
    assert res.grid.u is not None and res.grid.v is not None
    assert res.grid.values is None  # vector payload carries u/v, not scalars
    assert len(res.grid.u) == len(res.grid.latitudes)
    assert len(res.grid.u[0]) == len(res.grid.longitudes)
    assert len(res.grid.v) == len(res.grid.latitudes)
    assert len(res.grid.v[0]) == len(res.grid.longitudes)


def test_current_flow_grid_shape_and_bounds_consistency():
    res = _get_currents()
    nlat, nlon = len(res.grid.latitudes), len(res.grid.longitudes)
    assert all(len(row) == nlon for row in res.grid.u)
    assert all(len(row) == nlon for row in res.grid.v)
    assert res.bounds["minLat"] == pytest.approx(min(res.grid.latitudes))
    assert res.bounds["maxLat"] == pytest.approx(max(res.grid.latitudes))
    assert res.bounds["minLon"] == pytest.approx(min(res.grid.longitudes))
    assert res.bounds["maxLon"] == pytest.approx(max(res.grid.longitudes))


# ------------------------------------------------------------
# Timestamp correspondence
# ------------------------------------------------------------

def test_current_flow_timestamp_correspondence():
    """Each requested model timestamp returns its own UVEL/VVEL field."""
    ts = _timestamps()
    res = _get_currents(timestamp=ts[-1])
    # The matched timestamp reported in the response must correspond to the
    # requested one (nearest selection within the dataset's coverage).
    matched = pd.to_datetime(res.timestamp).tz_localize(None)
    requested = pd.to_datetime(ts[-1]).tz_localize(None)
    tolerance = pd.Timedelta(hours=6)  # one model step apart at most
    assert abs(matched - requested) <= tolerance
    assert res.requested_timestamp == ts[-1]


def test_current_flow_default_timestamp_uses_first_available():
    ts = _timestamps()
    res = _get_currents()
    assert res.timestamp == ts[0]
    assert res.requested_timestamp is None


def test_current_flow_out_of_range_timestamp_rejected():
    with pytest.raises(Exception):
        _get_currents(timestamp="1990-01-01T00:00:00")


def test_current_flow_invalid_timestamp_rejected():
    with pytest.raises(Exception):
        _get_currents(timestamp="not-a-timestamp")


# ------------------------------------------------------------
# Depth correspondence (nearest native level, never interpolated)
# ------------------------------------------------------------

def test_current_flow_nearest_native_depth():
    depths = _depths()
    assert len(depths) >= 3
    d1, d2 = depths[1], depths[2]
    requested = d1 + 0.75 * (d2 - d1)  # closer to d2

    res = _get_currents(depth=requested)
    assert res.requested_depth_m == requested
    assert res.matched_depth_m == d2
    assert res.matched_depth_m in depths
    assert res.available_depths_m == depths
    assert "nearest" in res.depth_selection.lower()
    assert "interpolat" in res.depth_selection.lower()


def test_current_flow_exact_native_depth_identity():
    depths = _depths()
    res = _get_currents(depth=depths[-1])
    assert res.matched_depth_m == depths[-1]
    assert res.requested_depth_m == depths[-1]


def test_current_flow_depth_beyond_deepest_level_rejected():
    depths = _depths()
    with pytest.raises(Exception):
        _get_currents(depth=max(depths) + 1000.0)


# ------------------------------------------------------------
# Missing components: no substitution, honest unavailable
# ------------------------------------------------------------

def _write_currents_dataset(tmp_path: Path, include_uvel: bool, include_vvel: bool) -> Path:
    """Build a schema-compatible dataset with selected components missing."""
    nc = tmp_path / f"hycom_{'u' if include_uvel else ''}{'v' if include_vvel else ''}.nc"
    times = pd.date_range("2026-09-07T06:00:00", periods=2, freq="6h")
    depths = np.array([0.0, 50.0])
    lats = np.arange(5.0, 10.0, 1.0)
    lons = np.arange(80.0, 85.0, 1.0)
    shape = (len(times), len(depths), len(lats), len(lons))

    data_vars = {}
    if include_uvel:
        data_vars["UVEL"] = (["TIME", "DEPTH", "LAT", "LON"], np.full(shape, 0.4, dtype="float32"))
    if include_vvel:
        data_vars["VVEL"] = (["TIME", "DEPTH", "LAT", "LON"], np.full(shape, -0.2, dtype="float32"))

    ds = xr.Dataset(
        data_vars=data_vars,
        coords={"TIME": times, "DEPTH": depths, "LAT": lats, "LON": lons},
    )
    ds.to_netcdf(nc, engine="netcdf4")
    return nc


def test_current_flow_missing_uvel_is_unavailable(tmp_path):
    """VVEL present, UVEL absent: no substitute, honest unavailable error."""
    nc = _write_currents_dataset(tmp_path, include_uvel=False, include_vvel=True)
    provider = IncoisProvider(depth_nc_path=nc)
    with pytest.raises(DepthSliceVariableUnavailableError) as excinfo:
        provider.get_depth_slice("currents", None, 0.0)
    assert "UVEL" in excinfo.value.detail["missingVariables"]
    assert excinfo.value.detail.get("variable") == "currents"


def test_current_flow_missing_vvel_is_unavailable(tmp_path):
    """UVEL present, VVEL absent: no substitute, honest unavailable error."""
    nc = _write_currents_dataset(tmp_path, include_uvel=True, include_vvel=False)
    provider = IncoisProvider(depth_nc_path=nc)
    with pytest.raises(DepthSliceVariableUnavailableError) as excinfo:
        provider.get_depth_slice("currents", None, 0.0)
    assert "VVEL" in excinfo.value.detail["missingVariables"]


def test_current_flow_missing_both_components_is_unavailable(tmp_path):
    nc = _write_currents_dataset(tmp_path, include_uvel=False, include_vvel=False)
    provider = IncoisProvider(depth_nc_path=nc)
    with pytest.raises(DepthSliceVariableUnavailableError):
        provider.get_depth_slice("currents", None, 0.0)


def test_current_flow_missing_component_endpoint_returns_503(tmp_path, monkeypatch):
    nc = _write_currents_dataset(tmp_path, include_uvel=True, include_vvel=False)
    provider = IncoisProvider(depth_nc_path=nc)
    monkeypatch.setattr(incois_provider_module, "incois_provider", provider, raising=False)
    # Patch the module-level provider used by the endpoint via the imported name.
    import app.api.endpoints as endpoints_module
    monkeypatch.setattr(endpoints_module, "incois_provider", provider)

    r = client.get("/api/model/depth-slice", params={"variable": "currents", "depth": 0.0})
    assert r.status_code == 503
    detail = r.json()["detail"]
    assert "VVEL" in detail["missingVariables"]
    assert detail["variable"] == "currents"
    # The error must be explicit about not substituting another variable.
    assert "substitute" in detail["message"].lower()


# ------------------------------------------------------------
# Missing/NaN cell handling (NaN -> null, counted, never 0.0)
# ------------------------------------------------------------

def test_current_flow_nan_cells_preserved_as_null(tmp_path):
    nc = tmp_path / "nan_currents_fixture.nc"
    times = pd.date_range("2026-09-07T06:00:00", periods=2, freq="6h")
    depths = np.array([0.0, 50.0])
    lats = np.arange(5.0, 10.0, 1.0)
    lons = np.arange(80.0, 85.0, 1.0)
    shape = (len(times), len(depths), len(lats), len(lons))
    u = np.full(shape, 0.4, dtype="float32")
    v = np.full(shape, -0.2, dtype="float32")
    u[:, :, 0, 0] = np.nan  # one missing UVEL cell per time/depth slice
    v[:, :, 1, 1] = np.nan  # one missing VVEL cell per time/depth slice

    ds = xr.Dataset(
        {
            "UVEL": (["TIME", "DEPTH", "LAT", "LON"], u),
            "VVEL": (["TIME", "DEPTH", "LAT", "LON"], v),
        },
        coords={"TIME": times, "DEPTH": depths, "LAT": lats, "LON": lons},
    )
    ds.to_netcdf(nc, engine="netcdf4")

    provider = IncoisProvider(depth_nc_path=nc)
    res = provider.get_depth_slice("currents", None, 0.0, stride=1)

    assert res.grid.u[0][0] is None  # NaN preserved as null, never 0.0
    assert res.grid.v[1][1] is None
    assert res.grid.u[1][1] == pytest.approx(0.4)
    assert res.grid.v[0][0] == pytest.approx(-0.2)
    assert res.missing_values == 2  # counted, not hidden


def test_current_flow_all_nan_slice_reports_all_missing(tmp_path):
    """A fully-masked slice must be representable: every cell null, no zeros."""
    nc = tmp_path / "all_nan_currents.nc"
    times = pd.date_range("2026-09-07T06:00:00", periods=1, freq="6h")
    depths = np.array([0.0])
    lats = np.arange(5.0, 8.0, 1.0)
    lons = np.arange(80.0, 83.0, 1.0)
    shape = (1, 1, len(lats), len(lons))
    u = np.full(shape, np.nan, dtype="float32")
    v = np.full(shape, np.nan, dtype="float32")

    ds = xr.Dataset(
        {
            "UVEL": (["TIME", "DEPTH", "LAT", "LON"], u),
            "VVEL": (["TIME", "DEPTH", "LAT", "LON"], v),
        },
        coords={"TIME": times, "DEPTH": depths, "LAT": lats, "LON": lons},
    )
    ds.to_netcdf(nc, engine="netcdf4")

    provider = IncoisProvider(depth_nc_path=nc)
    res = provider.get_depth_slice("currents", None, 0.0, stride=1)

    assert all(cell is None for row in res.grid.u for cell in row)
    assert all(cell is None for row in res.grid.v for cell in row)
    assert res.missing_values == len(lats) * len(lons) * 2


# ------------------------------------------------------------
# Dataset reuse (no NetCDF reopen per request)
# ------------------------------------------------------------

def test_current_flow_dataset_opened_once_across_requests(monkeypatch):
    open_calls = []
    real_open = xr.open_dataset

    def counting_open(*args, **kwargs):
        open_calls.append(args[0] if args else kwargs.get("filename_or_obj"))
        return real_open(*args, **kwargs)

    monkeypatch.setattr(incois_provider_module.xr, "open_dataset", counting_open)

    provider = IncoisProvider()
    depths = provider.get_available_depths()
    ts = provider.get_available_depth_timestamps()
    provider.get_depth_slice("currents", ts[0], depths[0])
    provider.get_depth_slice("currents", ts[-1], depths[-1])
    provider.get_depth_slice("currents", None, depths[len(depths) // 2])

    assert len(open_calls) == 1  # the raw NetCDF is NOT reopened per request


# ------------------------------------------------------------
# Endpoint contract: the wire format the frontend normalizer consumes
# ------------------------------------------------------------

def test_endpoint_current_flow_wire_format():
    depths = _depths()
    ts = _timestamps()
    r = client.get(
        "/api/model/depth-slice",
        params={"variable": "currents", "timestamp": ts[0], "depth": depths[0]},
    )
    assert r.status_code == 200
    data = r.json()
    # snake_case wire format (pydantic default serialization)
    for key in (
        "status", "source", "dataset_file", "variable", "units", "timestamp",
        "requested_timestamp", "requested_depth_m", "matched_depth_m",
        "available_depths_m", "depth_selection", "missing_values", "bounds", "grid",
    ):
        assert key in data, f"missing wire key: {key}"
    for key in ("latitudes", "longitudes", "u", "v"):
        assert key in data["grid"], f"missing grid key: {key}"
    assert data["variable"] == "currents"
    assert data["units"] == "m/s"
    assert data["status"] in ("REAL", "SIMULATED"), f"status must be REAL or SIMULATED (data-mode-aware)"
    # null must round-trip through JSON as null (missing cells stay missing)
    for row in data["grid"]["u"]:
        for cell in row:
            assert cell is None or isinstance(cell, (int, float))


def test_endpoint_current_flow_nearest_depth_reported():
    depths = _depths()
    requested = depths[1] + 0.75 * (depths[2] - depths[1])
    r = client.get(
        "/api/model/depth-slice",
        params={"variable": "currents", "depth": requested},
    )
    assert r.status_code == 200
    data = r.json()
    assert data["requested_depth_m"] == requested
    assert data["matched_depth_m"] == depths[2]
    assert data["matched_depth_m"] != data["requested_depth_m"]


def test_endpoint_current_flow_unsupported_variable_404():
    r = client.get("/api/model/depth-slice", params={"variable": "waves", "depth": 0.0})
    assert r.status_code == 404


def test_endpoint_current_flow_dataset_missing_503(monkeypatch):
    monkeypatch.setattr(incois_provider, "_depth_nc_path", Path("/nonexistent/RSMC_hycom.nc"))
    monkeypatch.setattr(incois_provider, "_depth_dataset", None)
    r = client.get("/api/model/depth-slice", params={"variable": "currents", "depth": 0.0})
    assert r.status_code == 503
    assert "detail" in r.json()


# ------------------------------------------------------------
# Regression: the legacy surface currents endpoint stays intact
# (used by the legend flow; unchanged behavior is asserted in test_api.py)
# ------------------------------------------------------------

def test_surface_currents_endpoint_still_works():
    r = client.get("/layers/currents")
    assert r.status_code == 200
    data = r.json()
    assert data["status"] in ("REAL", "SIMULATED"), f"status must be REAL or SIMULATED (data-mode-aware)"
    assert data["units"] == "m/s"
    assert data["grid"]["u"] is not None
    assert data["grid"]["v"] is not None
