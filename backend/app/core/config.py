import os
from pathlib import Path
from typing import Literal


class Settings:
    PROJECT_NAME: str = "OceanLens API"
    VERSION: str = "1.0.0"
    API_V1_STR: str = "/api"

    # Path configuration
    # All data paths are project-relative by default and can be overridden
    # via environment variables (see backend/.env.example) so that no
    # machine-specific absolute paths are required anywhere in the code.
    BASE_DIR: Path = Path(__file__).resolve().parents[2]

    # ---------------------------------------------------------------------------
    # Data mode
    # ---------------------------------------------------------------------------
    # OCEANX_DATA_MODE=REAL   (default) — uses production HYCOM datasets.
    # OCEANX_DATA_MODE=FIXTURE          — uses committed schema-compatible
    #                                     synthetic fixtures from tests/fixtures/.
    #                                     Intended for development, demos and CI
    #                                     without multi-GB production data.
    #                                     Must be explicitly selected; never
    #                                     activated silently.
    # ---------------------------------------------------------------------------
    @property
    def DATA_MODE(self) -> Literal["REAL", "FIXTURE"]:
        raw = os.environ.get("OCEANX_DATA_MODE", "REAL").strip().upper()
        if raw == "FIXTURE":
            return "FIXTURE"
        return "REAL"

    @property
    def FIXTURES_DIR(self) -> Path:
        """Committed synthetic schema-compatible HYCOM test fixtures directory."""
        return self.BASE_DIR / "tests" / "fixtures"

    # ---------------------------------------------------------------------------
    # Data paths
    # ---------------------------------------------------------------------------
    @property
    def DATA_DIR(self) -> Path:
        env = os.environ.get("OCEANX_DATA_DIR")
        return Path(env).resolve() if env else self.BASE_DIR / "data"

    @property
    def PROCESSED_OCEAN_FILE(self) -> Path:
        # In FIXTURE mode: always use the committed surface fixture.
        if self.DATA_MODE == "FIXTURE":
            return self.FIXTURES_DIR / "hycom_surface_fixture.nc"
        env = os.environ.get("OCEANX_PROCESSED_OCEAN_FILE")
        return Path(env).resolve() if env else self.DATA_DIR / "processed" / "ocean" / "incois_hycom_bob_surface.nc"

    @property
    def PROCESSED_OCEAN_META(self) -> Path:
        env = os.environ.get("OCEANX_PROCESSED_OCEAN_META")
        return Path(env).resolve() if env else self.DATA_DIR / "processed" / "ocean" / "incois_hycom_bob_metadata.json"

    @property
    def RAW_HYCOM_FILE(self) -> Path:
        # In FIXTURE mode: always use the committed raw fixture.
        if self.DATA_MODE == "FIXTURE":
            return self.FIXTURES_DIR / "hycom_raw_fixture.nc"
        env = os.environ.get("OCEANX_RAW_HYCOM_FILE")
        return Path(env).resolve() if env else self.DATA_DIR / "raw" / "ocean" / "currents" / "RSMC_hycom_20260908.nc"

    @property
    def RAW_IBTRACS_CSV(self) -> Path:
        env = os.environ.get("OCEANX_RAW_IBTRACS_CSV")
        return Path(env).resolve() if env else self.DATA_DIR / "raw" / "cyclones" / "ibtracs" / "ibtracs.NI.list.v04r01.csv"

    @property
    def PROCESSED_ARGO_FILE(self) -> Path:
        env = os.environ.get("OCEANX_PROCESSED_ARGO_FILE")
        return Path(env).resolve() if env else self.DATA_DIR / "processed" / "ocean" / "argo" / "argo_bob_processed.json"

    @property
    def PROCESSED_ARGO_META(self) -> Path:
        env = os.environ.get("OCEANX_PROCESSED_ARGO_META")
        return Path(env).resolve() if env else self.DATA_DIR / "processed" / "ocean" / "argo" / "argo_bob_metadata.json"

    # CORS configuration
    CORS_ORIGINS: list[str] = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:8000",
        "*"
    ]


settings = Settings()
