import os
from pathlib import Path

class Settings:
    PROJECT_NAME: str = "OceanLens API"
    VERSION: str = "1.0.0"
    API_V1_STR: str = "/api"
    
    # Path configuration
    BASE_DIR: Path = Path(__file__).resolve().parents[2]
    DATA_DIR: Path = BASE_DIR / "data"
    PROCESSED_OCEAN_FILE: Path = DATA_DIR / "processed" / "ocean" / "incois_hycom_bob_surface.nc"
    PROCESSED_OCEAN_META: Path = DATA_DIR / "processed" / "ocean" / "incois_hycom_bob_metadata.json"
    RAW_IBTRACS_CSV: Path = DATA_DIR / "raw" / "cyclones" / "ibtracs" / "ibtracs.NI.list.v04r01.csv"

    # CORS configuration
    CORS_ORIGINS: list[str] = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:8000",
        "*"
    ]

settings = Settings()
