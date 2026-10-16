"""HYCOM model depth-slice tests (Phase 1A).

These tests validate the depth-aware HYCOM access layer:
- provider-level nearest-native-depth selection (no interpolation)
- the /api/model/depth-slice endpoint contract
- error behavior (variable / timestamp / depth / dataset)
- dataset reuse (the raw NetCDF is opened once, not per request)
- missing-value (NaN) handling

They run against the REAL raw HYCOM file when installed; otherwise
tests/conftest.py binds the HYCOM paths to committed SYNTHETIC
schema-compatible fixtures (announced in the test banner). Assertions are
mode-agnostic: they never assert fixture-specific scientific values, only
code paths, contract shape and error semantics. Real-data behaviour is
covered by test_integration_hycom.py.
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
    DepthSliceDepthError,
    DepthSliceTimestampError,
    DepthSliceVariableError,
    IncoisProvider,
    incois_provider,
)

client = TestClient(app)


# ------------------------------------------------------------
# Helpers (mode-agnostic: read structure from the active dataset)
# ------------------------------------------------------------

def _depths() -> list:
    depths = incois_provider.get_available_depths()
    assert depths, "no depths available (depth dataset missing?)"
    return depths


def _timestamps() -> list:
    ts = incois_provider.get_available_depth_timestamps()
    assert ts, "no timestamps available (depth dataset missing?)"
    return ts


# ------------------------------------------------------------
# Provider: valid requests and metadata
# ------------------------------------------------------------

def test_depth_slice_valid_request_metadata():
    depths = _depths()
    ts = _timestamps()
    res = incois_provider.get_depth_slice("temp", ts[0], depths[0])

    assert res.status in ("REAL", "SIMULATED"), f"status must be REAL or SIMULATED (data-mode-aware), got {res.status!r}"
    assert "INCOIS" in res.source
    assert res.dataset_file.endswith(".nc")
    assert res.variable == "temp"
    assert res.units == "°C"
    assert res.timestamp  # matched timestamp is reported
    assert res.requested_timestamp == ts[0]
    assert res.requested_depth_m == depths[0]
    assert res.matched_depth_m == depths[0]
    assert res.available_depths_m == depths
    assert "nearest" in res.depth_selection.lower()
    assert "interpolat" in res.depth_selection.lower()

    assert res.grid.latitudes and res.grid.longitudes
    assert res.grid.values is not None
    assert res.provenance.data_status in ("REAL", "SIMULATED")
    assert res.provenance.provider == "INCOIS"
    assert res.provenance.dataset.endswith(".nc")
    assert res.provenance.requested_depth_m == depths[0]
    assert res.provenance.matched_depth_m == depths[0]
    assert len(res.grid.values) == len(res.grid.latitudes)
    assert len(res.grid.values[0]) == len(res.grid.longitudes)
    assert any(v is not None for row in res.grid.values for v in row)

    assert res.bounds["minLat"] == pytest.approx(min(res.grid.latitudes))
    assert res.bounds["maxLat"] == pytest.approx(max(res.grid.latitudes))
    assert res.bounds["minLon"] == pytest.approx(min(res.grid.longitudes))
    assert res.bounds["maxLon"] == pytest.approx(max(res.grid.longitudes))


def test_depth_slice_currents_returns_vector_pair():
    depths = _depths()
    res = incois_provider.get_depth_slice("currents", None, depths[1])

    assert res.units == "m/s"
    assert res.grid.u is not None and res.grid.v is not None
    assert res.grid.values is None
    assert res.requested_depth_m == depths[1]


def test_depth_slice_default_timestamp_uses_first_available():
    ts = _timestamps()
    res = incois_provider.get_depth_slice("salinity", None, _depths()[0])
    assert res.timestamp == ts[0]
    assert res.requested_timestamp is None
    assert res.units == "PSU"


# ------------------------------------------------------------
# Provider: nearest native depth matching (no interpolation)
# ------------------------------------------------------------

def test_depth_slice_nearest_native_depth():
    depths = _depths()
    assert len(depths) >= 3
    d1, d2 = depths[1], depths[2]
    requested = d1 + 0.75 * (d2 - d1)  # closer to d2

    res = incois_provider.get_depth_slice("temp", None, requested)
    assert res.requested_depth_m == requested
    assert res.matched_depth_m == d2
    assert res.matched_depth_m in depths


def test_depth_slice_exact_native_depth_is_identity():
    depths = _depths()
    res = incois_provider.get_depth_slice("temp", None, depths[-1])
    assert res.matched_depth_m == depths[-1]


# ------------------------------------------------------------
# Provider: validation errors
# ------------------------------------------------------------

def test_depth_slice_invalid_variable():
    with pytest.raises(DepthSliceVariableError) as excinfo:
        incois_provider.get_depth_slice("chlorophyll", None, 10.0)
    assert "chlorophyll" in str(excinfo.value)
    assert excinfo.value.detail.get("supportedVariables")


def test_depth_slice_timestamp_out_of_range():
    with pytest.raises(DepthSliceTimestampError):
        incois_provider.get_depth_slice("temp", "1990-01-01T00:00:00", 10.0)


def test_depth_slice_timestamp_unparseable():
    with pytest.raises(DepthSliceTimestampError):
        incois_provider.get_depth_slice("temp", "not-a-timestamp", 10.0)


def test_depth_slice_depth_out_of_range():
    depths = _depths()
    with pytest.raises(DepthSliceDepthError) as excinfo:
        incois_provider.get_depth_slice("temp", None, max(depths) + 1000.0)
    assert excinfo.value.detail.get("availableDepthsM") == depths


def test_depth_slice_negative_depth_rejected():
    with pytest.raises(DepthSliceDepthError):
        incois_provider.get_depth_slice("temp", None, -10.0)


def test_depth_slice_nan_depth_rejected():
    with pytest.raises(DepthSliceDepthError):
        incois_provider.get_depth_slice("temp", None, float("nan"))


# ------------------------------------------------------------
# Provider: missing-value handling (NaN -> null, counted)
# ------------------------------------------------------------

def test_depth_slice_missing_values_preserved_as_null(tmp_path):
    nc = tmp_path / "nan_raw_fixture.nc"
    times = pd.date_range("2026-09-07T06:00:00", periods=2, freq="6h")
    depths = np.array([0.0, 50.0])
    lats = np.arange(5.0, 10.0, 1.0)
    lons = np.arange(80.0, 85.0, 1.0)
    temp = np.full((2, 2, 5, 5), 20.0, dtype="float32")
    temp[:, :, 0, 0] = np.nan  # one missing cell per time/depth slice

    ds = xr.Dataset(
        {"TEMP": (["TIME", "DEPTH", "LAT", "LON"], temp)},
        coords={"TIME": times, "DEPTH": depths, "LAT": lats, "LON": lons},
    )
    ds.to_netcdf(nc, engine="netcdf4")

    provider = IncoisProvider(depth_nc_path=nc)
    res = provider.get_depth_slice("temp", None, 0.0, stride=1)

    assert res.grid.values[0][0] is None  # NaN preserved as null, not 0.0
    assert res.grid.values[1][1] == pytest.approx(20.0)
    assert res.missing_values == 1


# ------------------------------------------------------------
# Provider: dataset reuse / caching
# ------------------------------------------------------------

def test_depth_dataset_opened_once_across_requests(monkeypatch):
    open_calls = []
    real_open = xr.open_dataset

    def counting_open(*args, **kwargs):
        open_calls.append(args[0] if args else kwargs.get("filename_or_obj"))
        return real_open(*args, **kwargs)

    monkeypatch.setattr(incois_provider_module.xr, "open_dataset", counting_open)

    provider = IncoisProvider()
    depths = provider.get_available_depths()
    provider.get_depth_slice("temp", None, depths[0])
    provider.get_depth_slice("salinity", None, depths[1])
    provider.get_depth_slice("currents", None, depths[0])

    assert len(open_calls) == 1  # the raw NetCDF is NOT reopened per request


# ------------------------------------------------------------
# Endpoint: /api/model/depth-slice
# ------------------------------------------------------------

def test_endpoint_valid_depth_slice():
    depths = _depths()
    ts = _timestamps()
    r = client.get(
        "/api/model/depth-slice",
        params={"variable": "temp", "timestamp": ts[0], "depth": depths[0]},
    )
    assert r.status_code == 200
    data = r.json()
    assert data["status"] in ("REAL", "SIMULATED"), f"status must be REAL or SIMULATED (data-mode-aware), got {data["status"]!r}"
    assert data["variable"] == "temp"
    assert data["units"] == "°C"
    assert data["requested_depth_m"] == depths[0]
    assert data["matched_depth_m"] == depths[0]
    assert data["available_depths_m"] == depths
    assert data["grid"]["values"] is not None
    assert data["provenance"]["data_status"] in ("REAL", "SIMULATED"), f"provenance.data_status must be REAL or SIMULATED (data-mode-aware)"
    assert data["provenance"]["requested_depth_m"] == depths[0]
    assert data["provenance"]["matched_depth_m"] == depths[0]
    assert len(data["grid"]["values"]) == len(data["grid"]["latitudes"])


def test_endpoint_nearest_depth_matching():
    depths = _depths()
    requested = depths[1] + 0.75 * (depths[2] - depths[1])
    r = client.get(
        "/api/model/depth-slice",
        params={"variable": "temp", "depth": requested},
    )
    assert r.status_code == 200
    data = r.json()
    assert data["requested_depth_m"] == requested
    assert data["matched_depth_m"] == depths[2]


def test_endpoint_missing_required_params_is_422():
    r = client.get("/api/model/depth-slice")
    assert r.status_code == 422

    r = client.get("/api/model/depth-slice", params={"variable": "temp"})
    assert r.status_code == 422  # depth is required


def test_endpoint_unsupported_variable_is_404():
    r = client.get(
        "/api/model/depth-slice",
        params={"variable": "chlorophyll", "depth": 10.0},
    )
    assert r.status_code == 404
    detail = r.json()["detail"]
    assert "chlorophyll" in str(detail)
    assert "temperature" in detail["supportedVariables"]  # lists supported variables


def test_endpoint_timestamp_out_of_range_is_404():
    r = client.get(
        "/api/model/depth-slice",
        params={"variable": "temp", "timestamp": "1990-01-01T00:00:00", "depth": 10.0},
    )
    assert r.status_code == 404
    detail = r.json()["detail"]
    assert "availableStart" in str(detail) or "availableStart" in detail


def test_endpoint_malformed_timestamp_is_400():
    r = client.get(
        "/api/model/depth-slice",
        params={"variable": "temp", "timestamp": "not-a-timestamp", "depth": 10.0},
    )
    assert r.status_code == 400


def test_endpoint_depth_out_of_range_is_400():
    depths = _depths()
    r = client.get(
        "/api/model/depth-slice",
        params={"variable": "temp", "depth": max(depths) + 1000.0},
    )
    assert r.status_code == 400
    assert max(depths) in r.json()["detail"]["availableDepthsM"]  # available depths reported


def test_endpoint_negative_depth_is_400():
    r = client.get(
        "/api/model/depth-slice",
        params={"variable": "temp", "depth": -10.0},
    )
    assert r.status_code == 400


def test_endpoint_dataset_unavailable_is_503(monkeypatch):
    monkeypatch.setattr(incois_provider, "_depth_nc_path", Path("/nonexistent/RSMC_hycom.nc"))
    monkeypatch.setattr(incois_provider, "_depth_dataset", None)
    r = client.get(
        "/api/model/depth-slice",
        params={"variable": "temp", "depth": 10.0},
    )
    assert r.status_code == 503
    assert "detail" in r.json()


def test_endpoint_surface_layer_endpoint_unchanged():
    # The pre-existing surface endpoint must keep working alongside the new one.
    r = client.get("/api/layers/sst")
    assert r.status_code == 200
    data = r.json()
    assert data["status"] in ("REAL", "SIMULATED"), f"status must be REAL or SIMULATED (data-mode-aware), got {data["status"]!r}"
    assert data["units"] == "°C"
    assert data["grid"]["values"] is not None
