import math
from datetime import datetime
from typing import Dict, Any, List, Optional
import numpy as np
import pandas as pd
import xarray as xr
from pathlib import Path

from app.providers.argo_provider import argo_provider
from app.providers.incois_provider import incois_provider

ROOT_DIR = Path(__file__).resolve().parents[2]
RAW_HYCOM_FILE = ROOT_DIR / "data" / "raw" / "ocean" / "currents" / "RSMC_hycom_20260908.nc"
PROCESSED_HYCOM_FILE = ROOT_DIR / "data" / "processed" / "ocean" / "incois_hycom_bob_surface.nc"


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2.0)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2.0)**2
    return round(2.0 * R * math.asin(math.sqrt(a)), 2)


def match_argo_with_hycom(profile_id: str) -> Optional[Dict[str, Any]]:
    # 1. Fetch Argo Profile
    profile = argo_provider.get_profile(profile_id)
    if not profile:
        return None

    argo_lat = profile["latitude"]
    argo_lon = profile["longitude"]
    argo_time_str = profile["observation_time"]
    argo_obs = profile.get("observations", [])

    if not argo_obs:
        return None

    # Parse Argo timestamp as timezone-naive for NetCDF comparison
    try:
        argo_dt = pd.to_datetime(argo_time_str).tz_localize(None)
    except Exception:
        argo_dt = pd.to_datetime("now").tz_localize(None)

    # 2. Query HYCOM dataset directly from NetCDF without hardcoded fallbacks
    matched_hycom_lat = argo_lat
    matched_hycom_lon = argo_lon
    matched_hycom_time_str = argo_time_str
    time_diff_hours = 0.0
    distance_km = 0.0

    model_values_by_depth: Dict[float, Dict[str, Optional[float]]] = {}
    target_nc_file = RAW_HYCOM_FILE if RAW_HYCOM_FILE.exists() else (PROCESSED_HYCOM_FILE if PROCESSED_HYCOM_FILE.exists() else None)

    if target_nc_file and target_nc_file.exists():
        try:
            ds_raw = xr.open_dataset(target_nc_file, engine="netcdf4", chunks={})

            # Match nearest spatial point
            nearest_spatial = ds_raw.sel(LAT=argo_lat, LON=argo_lon, method="nearest")
            
            # Match nearest time using timezone-naive datetime object
            nearest_ts = nearest_spatial.sel(TIME=argo_dt, method="nearest")
            matched_hycom_lat = float(nearest_ts["LAT"].values)
            matched_hycom_lon = float(nearest_ts["LON"].values)
            matched_hycom_time_str = str(nearest_ts["TIME"].values)
            
            distance_km = haversine_km(argo_lat, argo_lon, matched_hycom_lat, matched_hycom_lon)

            try:
                model_dt = pd.to_datetime(matched_hycom_time_str).tz_localize(None)
                time_diff_hours = round(abs((model_dt - argo_dt).total_seconds()) / 3600.0, 2)
            except Exception:
                time_diff_hours = 0.0

            # Extract temperature and salinity at matched HYCOM depths
            hycom_depths = [float(d) for d in ds_raw["DEPTH"].values] if "DEPTH" in ds_raw.coords else [0.0]

            for d in hycom_depths:
                try:
                    slice_d = nearest_ts.sel(DEPTH=d, method="nearest") if "DEPTH" in ds_raw.coords else nearest_ts
                    t_val = float(slice_d["TEMP"].values) if "TEMP" in slice_d else None
                    s_val = float(slice_d["SALN"].values) if "SALN" in slice_d else None

                    t_clean = round(t_val, 2) if (t_val is not None and not np.isnan(t_val)) else None
                    s_clean = round(s_val, 2) if (s_val is not None and not np.isnan(s_val)) else None

                    model_values_by_depth[d] = {"temp": t_clean, "saln": s_clean}
                except Exception:
                    pass

            ds_raw.close()
        except Exception as e:
            print(f"Error querying HYCOM NetCDF dataset: {e}")
            model_values_by_depth = {}

    # Strict check: If no model values extracted, return clean "NO REAL MODEL MATCH AVAILABLE" status
    if not model_values_by_depth:
        return {
            "argoProfileId": profile_id,
            "floatId": profile["float_id"],
            "observationTimestamp": argo_time_str,
            "observationLat": argo_lat,
            "observationLon": argo_lon,
            "modelDataset": "INCOIS HYCOM",
            "modelTimestamp": argo_time_str,
            "matchedModelLat": argo_lat,
            "matchedModelLon": argo_lon,
            "timeDifferenceHours": 0.0,
            "distanceKm": 0.0,
            "matchedDepths": [],
            "comparisons": [],
            "dataStatus": profile.get("data_status", "REAL SOURCE — INGESTION PENDING"),
            "source": "Argo Global Data (GDAC) + INCOIS RSMC HYCOM",
            "statusMessage": "NO REAL MODEL MATCH AVAILABLE"
        }

    # 3. Match Available Argo Depth Levels with HYCOM Levels (0, 10, 50, 100, 250, 500 m)
    comparisons = []
    matched_depths = []

    for obs in argo_obs:
        depth_m = obs["depth_m"]
        argo_t = obs.get("temperature_c")
        argo_s = obs.get("salinity_psu")

        closest_hycom_depth = None
        min_depth_diff = float('inf')
        for h_depth in model_values_by_depth.keys():
            diff = abs(h_depth - depth_m)
            if diff < min_depth_diff and diff <= 15.0:
                min_depth_diff = diff
                closest_hycom_depth = h_depth

        if closest_hycom_depth is not None:
            hycom_data = model_values_by_depth[closest_hycom_depth]
            model_t = hycom_data.get("temp")
            model_s = hycom_data.get("saln")

            # Residual Sign Convention: ΔT = HYCOM - Argo, ΔS = HYCOM - Argo
            temp_residual = round(model_t - argo_t, 2) if (model_t is not None and argo_t is not None) else None
            saln_residual = round(model_s - argo_s, 2) if (model_s is not None and argo_s is not None) else None

            matched_depths.append(depth_m)
            comparisons.append({
                "depthM": depth_m,
                "argoTemperatureC": argo_t,
                "modelTemperatureC": model_t,
                "temperatureResidualC": temp_residual,
                "argoSalinityPSU": argo_s,
                "modelSalinityPSU": model_s,
                "salinityResidualPSU": saln_residual,
                "matchedModelDepthM": closest_hycom_depth
            })

    return {
        "argoProfileId": profile_id,
        "floatId": profile["float_id"],
        "observationTimestamp": argo_time_str,
        "observationLat": argo_lat,
        "observationLon": argo_lon,
        "modelDataset": "INCOIS HYCOM",
        "modelTimestamp": matched_hycom_time_str,
        "matchedModelLat": matched_hycom_lat,
        "matchedModelLon": matched_hycom_lon,
        "timeDifferenceHours": time_diff_hours,
        "distanceKm": distance_km,
        "matchedDepths": matched_depths,
        "comparisons": comparisons,
        "dataStatus": profile.get("data_status", "REAL SOURCE — INGESTION PENDING"),
        "source": "Argo Global Data (GDAC) + INCOIS RSMC HYCOM",
        "residualConvention": "ΔT = HYCOM - Argo, ΔS = HYCOM - Argo",
        "statusMessage": None
    }
