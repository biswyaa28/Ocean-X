"""Phase 3 — Data mode coherence tests.

Verifies that:
  - OCEANX_DATA_MODE=FIXTURE activates fixture mode correctly.
  - REAL mode is the default when OCEANX_DATA_MODE is not set.
  - /api/status always exposes dataMode and datasetSynthetic.
  - /api/layers HYCOM status matches the active data mode.
  - FIXTURE mode never silently activates.
  - Fixture paths resolve to committed files (not production paths).

These tests run in the existing conftest fixture-override context, so
production HYCOM files are not required.
"""

import os
import importlib
import pytest
from unittest.mock import patch
from fastapi.testclient import TestClient


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _fresh_client(extra_env: dict) -> TestClient:
    """Return a TestClient with the app reloaded under extra_env."""
    with patch.dict(os.environ, extra_env, clear=False):
        # Re-import config so DATA_MODE is re-evaluated
        import app.core.config as cfg_mod
        importlib.reload(cfg_mod)
        import app.api.endpoints as ep_mod
        importlib.reload(ep_mod)
        import app.main as main_mod
        importlib.reload(main_mod)
        return TestClient(main_mod.app)


# ---------------------------------------------------------------------------
# DATA_MODE property
# ---------------------------------------------------------------------------

class TestDataModeSetting:
    def test_default_is_real(self):
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("OCEANX_DATA_MODE", None)
            import app.core.config as cfg
            importlib.reload(cfg)
            assert cfg.settings.DATA_MODE == "REAL"

    def test_fixture_mode_activated_by_env(self):
        with patch.dict(os.environ, {"OCEANX_DATA_MODE": "FIXTURE"}):
            import app.core.config as cfg
            importlib.reload(cfg)
            assert cfg.settings.DATA_MODE == "FIXTURE"

    def test_fixture_mode_case_insensitive(self):
        with patch.dict(os.environ, {"OCEANX_DATA_MODE": "fixture"}):
            import app.core.config as cfg
            importlib.reload(cfg)
            assert cfg.settings.DATA_MODE == "FIXTURE"

    def test_unknown_value_falls_back_to_real(self):
        with patch.dict(os.environ, {"OCEANX_DATA_MODE": "DEMO"}):
            import app.core.config as cfg
            importlib.reload(cfg)
            assert cfg.settings.DATA_MODE == "REAL"

    def test_fixture_raw_hycom_path_points_to_committed_fixture(self):
        with patch.dict(os.environ, {"OCEANX_DATA_MODE": "FIXTURE"}):
            import app.core.config as cfg
            importlib.reload(cfg)
            path = cfg.settings.RAW_HYCOM_FILE
            # Must point inside the committed fixtures dir, not to production
            assert "tests/fixtures" in str(path) or "tests\\fixtures" in str(path), \
                f"FIXTURE mode RAW_HYCOM_FILE must point to committed fixture, got: {path}"
            assert path.name == "hycom_raw_fixture.nc"

    def test_fixture_processed_ocean_path_points_to_committed_fixture(self):
        with patch.dict(os.environ, {"OCEANX_DATA_MODE": "FIXTURE"}):
            import app.core.config as cfg
            importlib.reload(cfg)
            path = cfg.settings.PROCESSED_OCEAN_FILE
            assert "tests/fixtures" in str(path) or "tests\\fixtures" in str(path), \
                f"FIXTURE mode PROCESSED_OCEAN_FILE must point to committed fixture, got: {path}"
            assert path.name == "hycom_surface_fixture.nc"


# ---------------------------------------------------------------------------
# /api/status — data mode fields
# ---------------------------------------------------------------------------

class TestStatusEndpointDataMode:
    def test_status_has_data_mode_field(self):
        from fastapi.testclient import TestClient
        from app.main import app
        client = TestClient(app)
        resp = client.get("/status")
        assert resp.status_code == 200
        data = resp.json()
        assert "dataMode" in data, "/api/status must include 'dataMode'"
        assert "datasetSynthetic" in data, "/api/status must include 'datasetSynthetic'"

    def test_status_data_mode_is_real_or_fixture(self):
        from fastapi.testclient import TestClient
        from app.main import app
        client = TestClient(app)
        resp = client.get("/status")
        data = resp.json()
        assert data["dataMode"] in ("REAL", "FIXTURE"), \
            f"dataMode must be 'REAL' or 'FIXTURE', got {data['dataMode']!r}"

    def test_status_fixture_mode_fields(self):
        """When OCEANX_DATA_MODE=FIXTURE, status must report fixture semantics."""
        with patch.dict(os.environ, {"OCEANX_DATA_MODE": "FIXTURE"}):
            import app.core.config as cfg
            importlib.reload(cfg)
            import app.api.endpoints as ep
            importlib.reload(ep)
            import app.main as main_mod
            importlib.reload(main_mod)
            client = TestClient(main_mod.app)
            resp = client.get("/api/status")
            assert resp.status_code == 200
            data = resp.json()
            assert data["dataMode"] == "FIXTURE", \
                f"Expected dataMode=FIXTURE, got {data['dataMode']!r}"
            assert data["datasetSynthetic"] is True, \
                "datasetSynthetic must be True in FIXTURE mode"
            assert data["mode"] == "SIMULATED", \
                f"backward-compat mode must be SIMULATED in FIXTURE mode, got {data['mode']!r}"
            assert data["datasetLoaded"] is True, \
                "datasetLoaded must be True in FIXTURE mode (committed files exist)"

    def test_status_dataset_synthetic_false_in_real_mode(self):
        """datasetSynthetic must be False in REAL mode."""
        from fastapi.testclient import TestClient
        from app.main import app
        client = TestClient(app)
        resp = client.get("/status")
        data = resp.json()
        if data["dataMode"] == "REAL":
            assert data["datasetSynthetic"] is False, \
                "datasetSynthetic must be False when dataMode is REAL"

    def test_status_mode_simulated_when_no_real_data(self):
        """When REAL mode but production files absent, mode should be SIMULATED."""
        with patch.dict(os.environ, {"OCEANX_DATA_MODE": "REAL",
                                     "OCEANX_RAW_HYCOM_FILE": "/nonexistent/path.nc",
                                     "OCEANX_PROCESSED_OCEAN_FILE": "/nonexistent/surface.nc"}):
            import app.core.config as cfg
            importlib.reload(cfg)
            import app.api.endpoints as ep
            importlib.reload(ep)
            import app.main as main_mod
            importlib.reload(main_mod)
            client = TestClient(main_mod.app)
            resp = client.get("/api/status")
            assert resp.status_code == 200
            data = resp.json()
            assert data["dataMode"] == "REAL"
            assert data["datasetSynthetic"] is False
            assert data["mode"] == "SIMULATED"
            assert data["datasetLoaded"] is False


# ---------------------------------------------------------------------------
# /api/layers — status coherence
# ---------------------------------------------------------------------------

HYCOM_LAYERS = ("currents", "sst", "salinity", "tchp")

class TestLayerStatusCoherence:
    def test_fixture_mode_hycom_layers_are_simulated(self):
        """In FIXTURE mode, all HYCOM layers must report SIMULATED, not REAL."""
        with patch.dict(os.environ, {"OCEANX_DATA_MODE": "FIXTURE"}):
            import app.core.config as cfg
            importlib.reload(cfg)
            import app.api.endpoints as ep
            importlib.reload(ep)
            import app.main as main_mod
            importlib.reload(main_mod)
            client = TestClient(main_mod.app)
            resp = client.get("/api/layers")
            assert resp.status_code == 200
            layers = {l["id"]: l for l in resp.json()}
            for layer_id in HYCOM_LAYERS:
                assert layer_id in layers
                status = layers[layer_id]["status"]
                assert status == "SIMULATED", \
                    f"Layer '{layer_id}' must be SIMULATED in FIXTURE mode, got {status!r}"

    def test_fixture_mode_argo_layer_remains_real(self):
        """Argo layer is always REAL (in-situ observations), even in FIXTURE mode."""
        with patch.dict(os.environ, {"OCEANX_DATA_MODE": "FIXTURE"}):
            import app.core.config as cfg
            importlib.reload(cfg)
            import app.api.endpoints as ep
            importlib.reload(ep)
            import app.main as main_mod
            importlib.reload(main_mod)
            client = TestClient(main_mod.app)
            resp = client.get("/api/layers")
            layers = {l["id"]: l for l in resp.json()}
            assert layers["argo"]["status"] == "REAL", \
                "Argo layer must always report REAL status"

    def test_wind_layer_always_simulated(self):
        """Wind is always SIMULATED regardless of data mode."""
        from fastapi.testclient import TestClient
        from app.main import app
        client = TestClient(app)
        resp = client.get("/layers")
        layers = {l["id"]: l for l in resp.json()}
        assert layers["wind"]["status"] == "SIMULATED"

    def test_real_mode_no_data_hycom_layers_not_real(self):
        """REAL mode with missing production files must not report REAL for HYCOM layers."""
        with patch.dict(os.environ, {"OCEANX_DATA_MODE": "REAL",
                                     "OCEANX_RAW_HYCOM_FILE": "/nonexistent/path.nc",
                                     "OCEANX_PROCESSED_OCEAN_FILE": "/nonexistent/surface.nc"}):
            import app.core.config as cfg
            importlib.reload(cfg)
            import app.api.endpoints as ep
            importlib.reload(ep)
            import app.main as main_mod
            importlib.reload(main_mod)
            client = TestClient(main_mod.app)
            resp = client.get("/api/layers")
            assert resp.status_code == 200
            layers = {l["id"]: l for l in resp.json()}
            for layer_id in HYCOM_LAYERS:
                status = layers[layer_id]["status"]
                assert status != "REAL", \
                    f"Layer '{layer_id}' must not report REAL when production data absent, got {status!r}"
