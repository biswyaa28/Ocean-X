import os
from pathlib import Path
from typing import List, Literal

# INCOIS rotates the RSMC HYCOM product and deletes older runs, so nothing here
# may hardcode a dated filename; installed runs are discovered by glob.
HYCOM_CURRENTS_DIR = "raw/ocean/currents"
HYCOM_SUBSET_GLOB = "RSMC_hycom_*_bob_subset.nc"
HYCOM_FULL_GLOB = "RSMC_hycom_*.nc"


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
    def HYCOM_RUNS_DIR(self) -> Path:
        return self.DATA_DIR / HYCOM_CURRENTS_DIR

    @property
    def HYCOM_RAW_CANDIDATES(self) -> List[Path]:
        """Installed real HYCOM files, best candidate first.

        Discovery is by GLOB, never by a dated hardcoded filename: INCOIS
        rotates this product and deletes older runs, so any literal date in the
        code goes stale. The order is:

        1. an explicit ``OCEANX_RAW_HYCOM_FILE`` override (tests, experiments);
        2. the full global download, if present;
        3. every archived Bay-of-Bengal subset, newest run first.

        The matchup walks this list and keeps the run whose time window is
        closest to the observation, so several archived runs can be used at
        once - see ``settings.HYCOM_RUNS_DIR`` and the matchup service.
        """
        env = os.environ.get("OCEANX_RAW_HYCOM_FILE")
        if env:
            return [Path(env).resolve()]
        directory = self.HYCOM_RUNS_DIR
        if not directory.exists():
            return []
        # Newest first: a subset/run filename embeds YYYYMMDD.
        candidates = sorted(
            (p for p in directory.glob(HYCOM_SUBSET_GLOB) if p.is_file()),
            key=lambda p: p.name,
            reverse=True,
        )
        full = [
            p for p in directory.glob(HYCOM_FULL_GLOB)
            if p.is_file() and not p.name.endswith("_bob_subset.nc")
        ]
        return sorted(full, key=lambda p: p.name, reverse=True) + candidates

    @property
    def RAW_HYCOM_FILE(self) -> Path:
        # In FIXTURE mode: always use the committed raw fixture.
        if self.DATA_MODE == "FIXTURE":
            return self.FIXTURES_DIR / "hycom_raw_fixture.nc"
        candidates = self.HYCOM_RAW_CANDIDATES
        if candidates:
            return candidates[0]
        # Nothing installed: return the documented conventional path so callers
        # that only test .exists() report "absent" instead of raising.
        return self.HYCOM_RUNS_DIR / "RSMC_hycom.nc"

    # -----------------------------------------------------------------------
    # Matchup time-gap policy (hours)
    # -----------------------------------------------------------------------
    # A model-vs-observation residual is only meaningful when the two samples
    # are close in time. These two thresholds classify the observation-model
    # separation reported by the matchup:
    #   <= MATCHUP_TIME_GAP_GOOD_H   -> "good"     (a routine matchup)
    #   <= MATCHUP_TIME_GAP_MAX_H    -> "marginal" (usable, but disclose it)
    #   >  MATCHUP_TIME_GAP_MAX_H    -> "too_large": profiles are still shown,
    #                                    but NO residual statistic is computed.
    # The values are in hours and configurable by environment variable.
    MATCHUP_TIME_GAP_GOOD_H = float(os.environ.get("OCEANX_MATCHUP_TIME_GAP_GOOD_H", "24"))
    MATCHUP_TIME_GAP_MAX_H = float(os.environ.get("OCEANX_MATCHUP_TIME_GAP_MAX_H", "72"))

    # -----------------------------------------------------------------------
    # Float sampling-gap rule (metres)
    # -----------------------------------------------------------------------
    # In "model_levels" comparison the MODEL's depth levels are the targets, and
    # the float value at each one is interpolated between the two nearest
    # QC-accepted float levels that bracket it. That bracket must not be wide:
    # between 0 and ~150 m the thermocline is steep, so a wide bracket would
    # smear a real gradient across tens of metres and the "residual" would be
    # dominated by the straight line rather than by model error. Deeper than
    # the breakpoint the profile is flatter and a wider bracket is acceptable.
    FLOAT_BRACKET_MAX_GAP_M = float(os.environ.get("OCEANX_FLOAT_BRACKET_MAX_GAP_M", "50"))
    FLOAT_BRACKET_MAX_GAP_DEEP_M = float(os.environ.get("OCEANX_FLOAT_BRACKET_MAX_GAP_DEEP_M", "100"))
    FLOAT_BRACKET_DEEP_BREAKPOINT_M = float(
        os.environ.get("OCEANX_FLOAT_BRACKET_DEEP_BREAKPOINT_M", "150")
    )

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
