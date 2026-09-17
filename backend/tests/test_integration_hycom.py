"""Integration tests requiring the REAL production HYCOM datasets.

These tests are marked ``requires_real_hycom`` and are automatically SKIPPED
with an explicit message when the production NetCDF files are not installed
on the local machine. They never fall back to synthetic fixtures: their
purpose is to validate the real dataset end-to-end.

To enable them, install the data first:
    python scripts/setup-data.py --download   # 9.85 GB raw HYCOM file
    python scripts/setup-data.py              # then regenerate the surface file

The synthetic fixtures under tests/fixtures/ must NEVER be used to satisfy
these tests.
"""

from pathlib import Path

import pytest

TESTS_DIR = Path(__file__).resolve().parent
BACKEND_DIR = TESTS_DIR.parent

# Production dataset locations, computed independently of any environment
# overrides so that availability checks are always against the real files.
REAL_RAW_HYCOM_FILE = BACKEND_DIR / "data" / "raw" / "ocean" / "currents" / "RSMC_hycom_20260908.nc"
REAL_PROCESSED_HYCOM_FILE = BACKEND_DIR / "data" / "processed" / "ocean" / "incois_hycom_bob_surface.nc"

requires_real = pytest.mark.requires_real_hycom


def _skip_if_file_missing(path):
    if not path.exists():
        pytest.skip(
            f"Required production file not installed: {path}\n"
            "See data/README.md for installation instructions."
        )


def test_production_hycom_availability_report():
    """Always-run informational test: reports which production files exist."""
    print(f"\nraw HYCOM present:       {REAL_RAW_HYCOM_FILE.exists()} ({REAL_RAW_HYCOM_FILE})")
    print(f"processed HYCOM present: {REAL_PROCESSED_HYCOM_FILE.exists()} ({REAL_PROCESSED_HYCOM_FILE})")


@requires_real
def test_real_raw_hycom_schema():
    """Open the real 9.85 GB raw HYCOM file lazily and validate its schema."""
    _skip_if_file_missing(REAL_RAW_HYCOM_FILE)
    import xarray as xr

    ds = xr.open_dataset(REAL_RAW_HYCOM_FILE, engine="netcdf4", chunks={})
    try:
        for coord in ("TIME", "DEPTH", "LAT", "LON"):
            assert coord in ds.coords, f"missing coordinate {coord}"
        for var in ("UVEL", "VVEL", "TEMP", "SALN", "SSH", "TCHP", "MLD"):
            assert var in ds.data_vars, f"missing variable {var}"
    finally:
        ds.close()


@requires_real
def test_real_processed_hycom_schema():
    """Open the real processed surface file lazily and validate its schema."""
    _skip_if_file_missing(REAL_PROCESSED_HYCOM_FILE)
    import xarray as xr

    ds = xr.open_dataset(REAL_PROCESSED_HYCOM_FILE, engine="netcdf4", chunks={})
    try:
        for coord in ("TIME", "LAT", "LON"):
            assert coord in ds.coords, f"missing coordinate {coord}"
        for var in ("UVEL", "VVEL", "TEMP", "SALN", "SSH", "TCHP", "MLD"):
            assert var in ds.data_vars, f"missing variable {var}"
    finally:
        ds.close()


@requires_real
def test_real_point_inspection_via_provider():
    """Exercise the production data path through IncoisProvider against the
    real installed dataset (explicit real path, bypassing any env override)."""
    path = REAL_PROCESSED_HYCOM_FILE if REAL_PROCESSED_HYCOM_FILE.exists() else REAL_RAW_HYCOM_FILE
    _skip_if_file_missing(path)

    from app.providers.incois_provider import IncoisProvider

    provider = IncoisProvider(nc_path=path)
    result = provider.inspect_point(lat=15.25, lon=88.42)
    assert result["status"] == "OK", result
    assert result["dataStatus"] == "REAL"
    assert result["tempC"] is not None
    assert "INCOIS" in result["source"]


@requires_real
def test_real_argo_hycom_matchup():
    """Exercise the production matchup path against the real raw HYCOM file.

    This is the real-data integration version of
    test_argo.py::test_model_observation_matchup_calculation: it must produce
    depth-resolved model-observation comparisons from the actual dataset.
    """
    _skip_if_file_missing(REAL_RAW_HYCOM_FILE)

    from app.providers.argo_provider import ArgoProvider
    from app.services.model_observation_matchup import match_argo_with_hycom

    # Use a fresh provider bound to the committed processed Argo data (which
    # is itself required and committed); the HYCOM side is the real file.
    profiles = ArgoProvider().get_profiles()
    assert profiles, "committed Argo profiles missing"
    profile_id = profiles[0]["profile_id"]

    matchup = match_argo_with_hycom(profile_id, nc_file=REAL_RAW_HYCOM_FILE)
    assert matchup is not None
    assert matchup["argoProfileId"] == profile_id
    assert matchup["modelDataset"] == "INCOIS HYCOM"
    assert matchup["statusMessage"] is None, (
        "Expected a real model match from the installed production dataset, got: "
        f"{matchup.get('statusMessage')}"
    )
    assert len(matchup["comparisons"]) >= 1
    for comp in matchup["comparisons"]:
        if comp["modelTemperatureC"] is not None and comp["argoTemperatureC"] is not None:
            expected = round(comp["modelTemperatureC"] - comp["argoTemperatureC"], 2)
            assert comp["temperatureResidualC"] == expected


# ============================================================
# Phase 1A: real-data depth-slice integration tests
# ============================================================

@requires_real
def test_real_raw_hycom_depth_levels():
    """Report and validate the real raw HYCOM depth coordinate structure."""
    _skip_if_file_missing(REAL_RAW_HYCOM_FILE)
    import xarray as xr

    ds = xr.open_dataset(REAL_RAW_HYCOM_FILE, engine="netcdf4", chunks={})
    try:
        assert "DEPTH" in ds.coords, "real raw HYCOM has no DEPTH coordinate"
        depths = [float(d) for d in ds["DEPTH"].values]
        assert len(depths) >= 1
        assert depths == sorted(depths), "DEPTH coordinate is not monotonic"
        assert all(d >= 0 for d in depths), "negative depth in DEPTH coordinate"
        print(f"\nreal HYCOM depth levels (m): {depths}")
    finally:
        ds.close()


@requires_real
def test_real_depth_slice_via_provider():
    """Exercise the depth-slice provider method against the real raw dataset."""
    _skip_if_file_missing(REAL_RAW_HYCOM_FILE)

    from app.providers.incois_provider import IncoisProvider

    provider = IncoisProvider()
    depths = provider.get_available_depths()
    timestamps = provider.get_available_depth_timestamps()
    assert depths, "real dataset exposes no depths"
    assert timestamps, "real dataset exposes no timestamps"

    res = provider.get_depth_slice("temp", timestamps[0], depths[0])
    assert res.status == "REAL"
    assert "INCOIS" in res.source
    assert res.matched_depth_m == depths[0]
    assert res.requested_depth_m == depths[0]
    # Native values must come from the real file, not be fabricated.
    assert res.grid.values is not None
    assert len(res.grid.values) == len(res.grid.latitudes)


@requires_real
def test_real_depth_slice_endpoint_nearest_matching():
    """The /api/model/depth-slice endpoint must select the nearest NATIVE depth
    from the real dataset and report both requested and matched depths."""
    _skip_if_file_missing(REAL_RAW_HYCOM_FILE)
    from fastapi.testclient import TestClient

    from app.main import app
    from app.providers.incois_provider import IncoisProvider

    depths = IncoisProvider().get_available_depths()
    assert len(depths) >= 2
    requested = depths[0] + 0.75 * (depths[1] - depths[0])  # nearer depths[1]

    api = TestClient(app)
    r = api.get(
        "/api/model/depth-slice",
        params={"variable": "temp", "depth": requested},
    )
    assert r.status_code == 200
    data = r.json()
    assert data["status"] == "REAL"
    assert data["requested_depth_m"] == requested
    assert data["matched_depth_m"] == depths[1]
    assert data["matched_depth_m"] != data["requested_depth_m"]


# ============================================================
# Phase 1E: real-data current-flow (UVEL/VVEL) integration tests
# ============================================================

@requires_real
def test_real_current_flow_uvel_vvel_structure():
    """Report the ACTUAL UVEL/VVEL structure of the real raw HYCOM dataset
    and validate the vector-pair slice against it."""
    _skip_if_file_missing(REAL_RAW_HYCOM_FILE)
    import xarray as xr

    ds = xr.open_dataset(REAL_RAW_HYCOM_FILE, engine="netcdf4", chunks={})
    try:
        assert "UVEL" in ds.data_vars, "real raw HYCOM has no UVEL"
        assert "VVEL" in ds.data_vars, "real raw HYCOM has no VVEL"
        assert "DEPTH" in ds["UVEL"].dims, "real UVEL is not depth-aware (surface-only?)"
        assert "DEPTH" in ds["VVEL"].dims, "real VVEL is not depth-aware (surface-only?)"
        print(f"\nreal UVEL dims: {ds['UVEL'].dims} units: {ds['UVEL'].attrs.get('units', 'N/A')}")
        print(f"real VVEL dims: {ds['VVEL'].dims} units: {ds['VVEL'].attrs.get('units', 'N/A')}")
        print(f"real DEPTH levels: {[float(d) for d in ds['DEPTH'].values]}")
        # _FillValue / missing_value representation, if declared
        for v in ("UVEL", "VVEL"):
            for attr in ("_FillValue", "missing_value"):
                if attr in ds[v].encoding:
                    print(f"real {v} {attr}: {ds[v].encoding[attr]}")
    finally:
        ds.close()


@requires_real
def test_real_current_flow_via_provider():
    """Exercise the UVEL/VVEL depth-slice path against the real raw dataset:
    vectors must come from the actual file at the requested native depth."""
    _skip_if_file_missing(REAL_RAW_HYCOM_FILE)

    from app.providers.incois_provider import IncoisProvider

    provider = IncoisProvider()
    depths = provider.get_available_depths()
    timestamps = provider.get_available_depth_timestamps()
    assert depths, "real dataset exposes no depths"
    assert timestamps, "real dataset exposes no timestamps"

    res = provider.get_depth_slice("currents", timestamps[0], depths[0])
    assert res.status == "REAL"
    assert "INCOIS" in res.source
    assert res.units == "m/s"
    assert res.grid.u is not None and res.grid.v is not None
    assert res.matched_depth_m == depths[0]
    # Timestamp correspondence: the matched time equals the requested one
    # (exact native selection within the dataset).
    assert res.timestamp == timestamps[0]

    # At least some real (non-null) vectors must exist at this level.
    valid = [c for row in res.grid.u for c in row if c is not None]
    assert valid, "real UVEL slice is entirely null at the shallowest level"


@requires_real
def test_real_current_flow_endpoint_wire_format():
    """The live /api/model/depth-slice?variable=currents response must carry
    the full provenance contract consumed by the flow renderer."""
    _skip_if_file_missing(REAL_RAW_HYCOM_FILE)
    from fastapi.testclient import TestClient

    from app.main import app
    from app.providers.incois_provider import IncoisProvider

    depths = IncoisProvider().get_available_depths()
    ts = IncoisProvider().get_available_depth_timestamps()

    api = TestClient(app)
    r = api.get(
        "/api/model/depth-slice",
        params={"variable": "currents", "timestamp": ts[0], "depth": depths[0]},
    )
    assert r.status_code == 200
    data = r.json()
    assert data["status"] == "REAL"
    assert data["variable"] == "currents"
    assert data["units"] == "m/s"
    assert data["timestamp"] == ts[0]
    assert data["requested_depth_m"] == depths[0]
    assert data["matched_depth_m"] == depths[0]
    assert data["grid"]["u"] is not None and data["grid"]["v"] is not None
