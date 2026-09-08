"""OCEAN-X Backend Core Configuration.

Scientific policy configuration lives here rather than being scattered as magic
numbers through the processing code (STEP 3B requirement §7).
"""
from typing import Dict, List, Tuple
from pydantic import BaseModel, Field


class Settings(BaseModel):
    PROJECT_NAME: str = "OCEAN-X Backend"
    VERSION: str = "0.3.1-dev"
    ENVIRONMENT: str = "development"
    DATA_MODE: str = "deterministic_fixture"

    # ------------------------------------------------------------------
    # Target dataset information (documentation / metadata headers)
    # ------------------------------------------------------------------
    TARGET_DATASET_ID: str = "GLOBAL_MULTIYEAR_PHY_001_030"
    TARGET_DATASET_NAME: str = "Copernicus Marine GLORYS12V1"
    TARGET_MODEL_VERSION: str = "GLORYS12V1_v202211"
    TARGET_MODEL_NAME: str = "GLORYS12V1"

    # ------------------------------------------------------------------
    # Regional demonstration bounding box
    # ------------------------------------------------------------------
    REGION_NAME: str = "Indian Ocean"
    LON_MIN: float = 40.0
    LON_MAX: float = 100.0
    LAT_MIN: float = -30.0
    LAT_MAX: float = 30.0

    # ------------------------------------------------------------------
    # Model data source selection
    #   "fixture" -> deterministic offline fixture (default; no network, no files)
    #   "netcdf"  -> real NetCDF/xarray dataset at MODEL_NETCDF_PATH
    # Switching sources must not change any API contract.
    # ------------------------------------------------------------------
    MODEL_SOURCE: str = "fixture"
    MODEL_NETCDF_PATH: str | None = None
    # Passed to xarray.open_dataset(chunks=...) when a chunk manager (dask) is
    # available. Ignored gracefully when dask is not installed.
    MODEL_NETCDF_CHUNKS: Dict[str, int] = Field(
        default_factory=lambda: {"time": 1}
    )

    # ------------------------------------------------------------------
    # NetCDF variable discovery (§5)
    # Candidate names are tried in order. The *actual* resolved name is always
    # reported in provenance; a missing required variable is a hard failure.
    # ------------------------------------------------------------------
    VARIABLE_CANDIDATES: Dict[str, List[str]] = Field(
        default_factory=lambda: {
            # GLORYS12V1 / CMEMS uses thetao (potential temperature) and so.
            "temperature": ["thetao", "temperature", "temp", "to", "water_temp"],
            "salinity": ["so", "salinity", "psal", "sal", "salt"],
        }
    )
    COORD_CANDIDATES: Dict[str, List[str]] = Field(
        default_factory=lambda: {
            "time": ["time", "time_counter", "t"],
            "depth": ["depth", "deptht", "lev", "z", "elevation"],
            "latitude": ["latitude", "lat", "nav_lat", "y"],
            "longitude": ["longitude", "lon", "nav_lon", "x"],
        }
    )

    # ------------------------------------------------------------------
    # Argo quality control policy (§7)
    # Argo reference table 2: 1=good, 2=probably good, 3=probably bad,
    # 4=bad, 5=changed, 8=interpolated, 9=missing.
    # ACCEPTABLE_QC_FLAGS is the single source of truth for QC acceptance.
    # ------------------------------------------------------------------
    ACCEPTABLE_QC_FLAGS: Tuple[int, ...] = (1, 2)
    QC_POLICY_NAME: str = "argo_reference_table_2"
    QC_POLICY_DESCRIPTION: str = (
        "Retain observations whose PRES/TEMP/PSAL QC flags are in {1,2} "
        "(good / probably good) per Argo reference table 2; exclude all others. "
        "Missing values are never treated as zero."
    )

    # ------------------------------------------------------------------
    # Argo DATA_MODE policy (§9)
    # R = real-time, A = real-time adjusted, D = delayed mode.
    # ------------------------------------------------------------------
    ACCEPTED_DATA_MODES: Tuple[str, ...] = ("R", "A", "D")
    PREFER_ADJUSTED_FOR_MODES: Tuple[str, ...] = ("A", "D")

    # ------------------------------------------------------------------
    # Co-location tolerances (§12)
    # ------------------------------------------------------------------
    TEMPORAL_TOLERANCE_HOURS: float = 12.0
    # Optional spatial guard. None disables the check (nearest cell always used).
    SPATIAL_TOLERANCE_KM: float | None = None

    # ------------------------------------------------------------------
    # Vertical alignment (§14)
    # ------------------------------------------------------------------
    VERTICAL_ALIGNMENT_METHOD: str = "linear_interpolation"
    ALLOW_VERTICAL_EXTRAPOLATION: bool = False
    DEPTH_REFERENCE: str = "meters"

    # ------------------------------------------------------------------
    # Units (§19)
    # ------------------------------------------------------------------
    EXPECTED_UNITS: Dict[str, str] = Field(
        default_factory=lambda: {"temperature": "degC", "salinity": "psu"}
    )
    # Recognised unit spellings that require no conversion. Covers the CF and
    # UDUNITS spellings used by CMEMS/GLORYS and common NetCDF products. Any
    # spelling absent from this table resolves to "unknown" rather than being
    # assumed (§19) — extend the table rather than guessing at the call site.
    UNIT_ALIASES: Dict[str, List[str]] = Field(
        default_factory=lambda: {
            "degC": [
                "degc", "deg_c", "deg c", "degree_c", "degrees_c",
                "degree_celsius", "degrees_celsius", "degree_Celsius",
                "celsius", "c", "°c", "degreec", "degreesc",
            ],
            "psu": [
                "psu", "1e-3", "0.001", "psal", "practical_salinity",
                "pss-78", "pss78", "practical salinity unit", "1",
            ],
            "K": ["k", "kelvin", "degk", "deg_k", "degrees_k"],
        }
    )

    @property
    def REGION_BBOX(self) -> Tuple[float, float, float, float]:
        """(lon_min, lat_min, lon_max, lat_max) for the demonstration domain."""
        return (self.LON_MIN, self.LAT_MIN, self.LON_MAX, self.LAT_MAX)


settings = Settings()
