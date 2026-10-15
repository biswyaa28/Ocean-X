"""A fresh clone must run on the committed demo subset, and must say so.

Two rules are pinned here:

1. With no production HYCOM files installed, the app must fall back to the
   committed demo subset under ``backend/data/demo`` — and the response must
   say the data is a coarsened real subset, not full data and not synthetic.
2. With production files installed, they win and the scope is "FULL".
"""

import pytest

from app.core.config import Settings


SURFACE_RELATIVE = "processed/ocean/incois_hycom_bob_surface.nc"
RUN_RELATIVE = "raw/ocean/currents/RSMC_hycom_20261005_bob_subset.nc"


def _data_dir(tmp_path, with_full: bool):
    """A data directory that holds either nothing, demo files, or full files."""
    if with_full:
        (tmp_path / SURFACE_RELATIVE).parent.mkdir(parents=True, exist_ok=True)
        (tmp_path / SURFACE_RELATIVE).write_bytes(b"")
        (tmp_path / RUN_RELATIVE).parent.mkdir(parents=True, exist_ok=True)
        (tmp_path / RUN_RELATIVE).write_bytes(b"")
    else:
        (tmp_path / "demo" / SURFACE_RELATIVE).parent.mkdir(parents=True, exist_ok=True)
        (tmp_path / "demo" / SURFACE_RELATIVE).write_bytes(b"")
        (tmp_path / "demo" / RUN_RELATIVE).parent.mkdir(parents=True, exist_ok=True)
        (tmp_path / "demo" / RUN_RELATIVE).write_bytes(b"")
    return tmp_path


def _settings(tmp_path, monkeypatch, with_full: bool) -> Settings:
    for var in ("OCEANX_RAW_HYCOM_FILE", "OCEANX_PROCESSED_OCEAN_FILE"):
        monkeypatch.delenv(var, raising=False)
    monkeypatch.setenv("OCEANX_DATA_DIR", str(_data_dir(tmp_path, with_full)))
    return Settings()


class TestSurfaceFileFallback:
    def test_demo_subset_is_used_when_no_production_file_exists(self, tmp_path, monkeypatch):
        cfg = _settings(tmp_path, monkeypatch, with_full=False)
        assert cfg.PROCESSED_OCEAN_FILE.exists()
        assert "demo" in cfg.PROCESSED_OCEAN_FILE.parts

    def test_production_file_wins_when_installed(self, tmp_path, monkeypatch):
        cfg = _settings(tmp_path, monkeypatch, with_full=True)
        assert cfg.PROCESSED_OCEAN_FILE.exists()
        assert "demo" not in cfg.PROCESSED_OCEAN_FILE.parts

    def test_explicit_env_override_still_wins_over_the_demo_subset(self, tmp_path, monkeypatch):
        cfg = _settings(tmp_path, monkeypatch, with_full=False)
        override = tmp_path / "custom_surface.nc"
        override.write_bytes(b"")
        monkeypatch.setenv("OCEANX_PROCESSED_OCEAN_FILE", str(override))
        assert Settings().PROCESSED_OCEAN_FILE == override.resolve()


class TestDepthRunFallback:
    def test_demo_run_is_used_when_no_production_run_exists(self, tmp_path, monkeypatch):
        cfg = _settings(tmp_path, monkeypatch, with_full=False)
        candidates = cfg.HYCOM_RAW_CANDIDATES
        assert len(candidates) == 1
        assert candidates[0].exists()
        assert "demo" in candidates[0].parts

    def test_production_runs_win_when_installed(self, tmp_path, monkeypatch):
        cfg = _settings(tmp_path, monkeypatch, with_full=True)
        assert all("demo" not in c.parts for c in cfg.HYCOM_RAW_CANDIDATES)

    def test_fixture_mode_never_falls_back_to_the_demo_subset(self, tmp_path, monkeypatch):
        monkeypatch.setenv("OCEANX_DATA_MODE", "FIXTURE")
        cfg = _settings(tmp_path, monkeypatch, with_full=False)
        assert "demo" not in str(cfg.RAW_HYCOM_FILE)
        assert cfg.RAW_HYCOM_FILE.parent == cfg.FIXTURES_DIR

    def test_nothing_installed_anywhere_reports_absent_not_raised(self, tmp_path, monkeypatch):
        cfg = _settings(tmp_path, monkeypatch, with_full=False)
        (tmp_path / "demo" / SURFACE_RELATIVE).unlink()
        (tmp_path / "demo" / RUN_RELATIVE).unlink()
        assert cfg.HYCOM_RAW_CANDIDATES == []
        assert not cfg.RAW_HYCOM_FILE.exists()


class TestDataScope:
    def test_demo_subset_scope(self, tmp_path, monkeypatch):
        cfg = _settings(tmp_path, monkeypatch, with_full=False)
        assert cfg.DATA_SCOPE == "DEMO SUBSET (real HYCOM, coarsened)"
        assert cfg.DATA_SCOPE_IS_FULL is False

    def test_full_scope_when_production_files_are_installed(self, tmp_path, monkeypatch):
        cfg = _settings(tmp_path, monkeypatch, with_full=True)
        assert cfg.DATA_SCOPE == "FULL"
        assert cfg.DATA_SCOPE_IS_FULL is True

    def test_full_scope_when_only_the_surface_file_is_installed(self, tmp_path, monkeypatch):
        cfg = _settings(tmp_path, monkeypatch, with_full=False)
        (tmp_path / SURFACE_RELATIVE).parent.mkdir(parents=True, exist_ok=True)
        (tmp_path / SURFACE_RELATIVE).write_bytes(b"")
        assert Settings().DATA_SCOPE == "FULL"


@pytest.mark.parametrize(
    "endpoint", ["/api/status", "/api/layers", "/api/datasets"]
)
def test_endpoints_report_the_data_scope(endpoint):
    """Every endpoint that talks about the dataset must state its scope."""
    from fastapi.testclient import TestClient

    from app.main import app

    body = TestClient(app).get(endpoint).json()
    entries = body if isinstance(body, list) else [body]
    for entry in entries:
        if isinstance(entry, dict):
            assert "dataScope" in entry, f"{endpoint} does not report dataScope"
            assert entry["dataScope"] in {"FULL", "DEMO SUBSET (real HYCOM, coarsened)"}


def test_demo_subset_is_never_reported_as_synthetic():
    """A coarsened REAL subset is REAL data. Calling it SIMULATED would make
    the app hide real HYCOM it is perfectly able to show."""
    from app.core.config import settings
    from app.providers.incois_provider import _hycom_data_status

    assert settings.DATA_MODE == "REAL"
    assert _hycom_data_status() == "REAL"