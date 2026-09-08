"""Deterministic scientific fixtures for OCEAN-X backend foundation.

This module provides deterministic synthetic fixtures mimicking the *structure*
of GLORYS12V1 and Argo observations across the Indian Ocean demonstration domain
(40°E–100°E, 30°S–30°N).

SCIENTIFIC INTEGRITY NOTICE (STEP 3B §25)
-----------------------------------------
Every value produced by this module is SYNTHETIC. These are analytic functions,
not measurements. They exercise the architecture and the algorithms; they are not
GLORYS12V1 output and they are not real Argo observations. All objects built from
this module carry ``is_fixture=True``, which propagates into API provenance as
``data_tier="local_deterministic_fixture"``.
"""
import math
from datetime import datetime, timezone

FIXTURE_NOTICE = (
    "SYNTHETIC development fixture — deterministic analytic field, not real "
    "GLORYS12V1 output and not a real Argo observation"
)

# 13 vertical depth levels (meters). These are simultaneously the fixture model
# source's NATIVE vertical coordinate and the demonstration standard levels
# exposed by /api/model/depths. The pipeline does not rely on that coincidence:
# profile 2903388 below is sampled at off-grid pressures precisely so the model
# vertical interpolation path is exercised end-to-end (§15).
FIXTURE_DEPTHS = [0.0, 10.0, 20.0, 30.0, 50.0, 75.0, 100.0, 150.0, 200.0, 300.0, 500.0, 750.0, 1000.0]

# 7 daily time steps (July 2023) at 00:00 UTC
FIXTURE_TIMES = [
    datetime(2023, 7, 1 + i, 0, 0, 0, tzinfo=timezone.utc)
    for i in range(7)
]

# Grid parameters for the fixture horizontal grid. 1° spacing over the
# demonstration domain: coarse enough to stay lightweight, fine enough that
# nearest-grid-cell co-location distances are representative (<~80 km).
GRID_LON0 = 40.0
GRID_LAT0 = -30.0
GRID_DLON = 1.0
GRID_DLAT = 1.0
GRID_NLONS = 61  # 40 to 100 inclusive, step 1
GRID_NLATS = 61  # -30 to 30 inclusive, step 1

FIXTURE_LONGITUDES = [GRID_LON0 + i * GRID_DLON for i in range(GRID_NLONS)]
FIXTURE_LATITUDES = [GRID_LAT0 + j * GRID_DLAT for j in range(GRID_NLATS)]

# Variable names deliberately mirror the CMEMS/GLORYS12V1 naming convention so
# the variable-discovery layer (§5) resolves the same logical names against the
# fixture and against a real product.
FIXTURE_VARIABLE_NAMES = {"temperature": "thetao", "salinity": "so"}
FIXTURE_VARIABLE_UNITS = {"thetao": "degC", "so": "psu"}
FIXTURE_VARIABLE_LONG_NAMES = {
    "thetao": "Synthetic sea water potential temperature (fixture)",
    "so": "Synthetic sea water salinity (fixture)",
}


def gaussian(x: float, y: float, cx: float, cy: float, sx: float, sy: float) -> float:
    return math.exp(-(((x - cx) ** 2) / (2 * sx * sx) + ((y - cy) ** 2) / (2 * sy * sy)))


def mock_sst(lon: float, lat: float, day: int) -> float:
    v = 27.6
    v += 2.3 * gaussian(lon, lat, 88.0, -6.0, 15.0, 9.0)
    v -= 1.9 * gaussian(lon, lat, 52.0, -19.0, 9.0, 7.0)
    v -= 2.7 * ((abs(lat) / 30.0) ** 2.1)
    v += 0.15 * math.sin(day * 1.1 + 1.2 + lon * 0.13 + lat * 0.07)
    return round(v, 3)


def mock_temp(lon: float, lat: float, z: float, day: int) -> float:
    ts = mock_sst(lon, lat, day)
    td = 4.1 + 1.7 * math.exp(-z / 500.0)
    zc = 130.0 + 20.0 * math.exp(-((lat / 10.0) ** 2))
    sig = 1.0 / (1.0 + math.exp((z - zc) / 30.0))
    v = td + (ts - td) * sig
    v += 0.4 * math.exp(-(((z - (zc + 40.0)) / 140.0) ** 2)) * math.sin(z / 55.0 + lon * 0.9 + lat * 0.6)
    return round(v, 3)


def mock_sal(lon: float, lat: float, z: float, day: int) -> float:
    ss = 34.55 + 1.35 * gaussian(lon, lat, 58.0, 22.0, 8.0, 5.5) - 1.9 * gaussian(lon, lat, 88.0, 15.0, 7.0, 5.0)
    s = ss + 0.65 / (1.0 + math.exp(-(z - 170.0) / 70.0)) - 0.5 / (1.0 + math.exp(-(z - 650.0) / 160.0))
    return round(s, 3)


# ----------------------------------------------------------------------------
# Synthetic Argo profile specifications for the Indian Ocean domain.
#
# Each spec declares the levels in terms of *pressure* (dbar), matching the real
# Argo PRES variable, because pressure — not depth — is what a float measures.
# The pipeline converts pressure to depth with TEOS-10 (§10).
#
# ``nominal_depths_m`` (profiles 2902641 and 1901452): pressures are synthesised
# from these nominal depths via gsw.p_from_z at the profile latitude, so the
# TEOS-10 forward conversion returns the nominal depths to ~1e-13 m. This keeps
# the demonstration levels on round numbers; it is a fixture construction choice,
# not a physical claim.
#
# ``pressure_dbar`` (profile 2903388): irregular pressures typical of a real
# ascent, deliberately off the model's native depth grid so the vertical
# interpolation stage is genuinely exercised end to end.
# ----------------------------------------------------------------------------
FIXTURE_ARGO_PROFILES = [
    {
        "id": "2902641",
        "platform": "ARVOR-I",
        "cycle": 114,
        "time": "2023-07-02T14:30:00Z",
        "latitude": 8.45,
        "longitude": 68.20,
        "mode": "D",
        "data_mode": "Delayed Mode (D)",
        "qc_summary": "all levels QC=1 (good)",
        "qc_detail": "all levels QC=1 (good) — passed regional Indian Ocean range & spike checks",
        "qc_flag": "GOOD",
        "nominal_depths_m": list(FIXTURE_DEPTHS),
        # Per-level synthetic departure of the observation from the analytic field.
        "temp_offsets": [0.12, 0.10, 0.08, 0.0, -0.15, 0.0, -0.42, 0.0, 0.28, 0.0, 0.05, 0.0, -0.02],
        "temp_qc": [1] * 13,
        "psal_qc": [1] * 13,
        "pres_qc": [1] * 13,
        "has_adjusted": True,
        # Synthetic delayed-mode calibration offsets applied to build
        # TEMP_ADJUSTED / PSAL_ADJUSTED from the raw fields.
        "temp_adjustment": -0.012,
        "psal_adjustment": -0.004,
        "temp_adjusted_error": 0.002,
        "psal_adjusted_error": 0.01,
    },
    {
        "id": "2903388",
        "platform": "PROVOR-II",
        "cycle": 62,
        "time": "2023-07-04T08:15:00Z",
        "latitude": -12.10,
        "longitude": 75.40,
        "mode": "A",
        "data_mode": "Real-Time Adjusted (A)",
        "qc_summary": "all levels QC=1 (good)",
        "qc_detail": "all levels QC=1 (good) — adjusted salinity drift correction applied",
        "qc_flag": "GOOD",
        # Irregular ascent pressures: off the model native depth grid on purpose.
        "pressure_dbar": [
            3.8, 12.5, 24.1, 47.4, 68.7, 97.1, 144.2, 209.3, 313.6, 496.2, 744.5, 988.9
        ],
        "temp_offsets": [
            -0.22, -0.18, -0.05, 0.35, 0.42, 0.60, 0.20, -0.15, -0.10, -0.08, -0.03, 0.01
        ],
        "temp_qc": [1] * 12,
        "psal_qc": [1] * 12,
        "pres_qc": [1] * 12,
        "has_adjusted": True,
        "temp_adjustment": 0.006,
        "psal_adjustment": -0.018,
        "temp_adjusted_error": 0.01,
        "psal_adjusted_error": 0.02,
    },
    {
        "id": "1901452",
        "platform": "APEX",
        "cycle": 189,
        "time": "2023-07-06T20:45:00Z",
        "latitude": 15.30,
        "longitude": 89.15,
        "mode": "D",
        "data_mode": "Delayed Mode (D)",
        "qc_summary": "1 level(s) QC=3 (probably bad) — excluded from statistics",
        "qc_detail": "level at 75m flagged QC=3 (temperature gradient spike)",
        "qc_flag": "MIXED",
        "nominal_depths_m": list(FIXTURE_DEPTHS),
        # The +4.80 spike at 75 m is the value the QC=3 flag refers to. It must be
        # excluded by QC; if it ever reaches the statistics the QC stage is broken.
        "temp_offsets": [0.05, 0.04, 0.02, 0.0, -0.10, 4.80, -0.25, 0.0, 0.10, 0.0, -0.04, 0.0, 0.00],
        "temp_qc": [1, 1, 1, 1, 1, 3, 1, 1, 1, 1, 1, 1, 1],
        "psal_qc": [1] * 13,
        "pres_qc": [1] * 13,
        "has_adjusted": True,
        "temp_adjustment": -0.009,
        "psal_adjustment": -0.002,
        "temp_adjusted_error": 0.002,
        "psal_adjusted_error": 0.01,
    },
]

