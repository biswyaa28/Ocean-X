import math
from datetime import datetime
from pathlib import Path
from typing import Dict, Any, List, Optional
import numpy as np
import pandas as pd
import xarray as xr

from app.core.config import settings
from app.providers.argo_provider import argo_provider
from app.providers.incois_provider import incois_provider
from app.services.matchup_diagnostics import build_matchup_diagnostics
from app.services.matchup_statistics import calculate_matchup_statistics

MATCHING_DEPTH_TOLERANCE_M = 15.0
MODEL_DEPTH_SELECTION = "nearest native HYCOM model depth (no interpolation)"


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2.0)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2.0)**2
    return round(2.0 * R * math.asin(math.sqrt(a)), 2)


def match_argo_with_hycom(profile_id: str, nc_file: Optional[Path] = None) -> Optional[Dict[str, Any]]:
    """Match an Argo profile with HYCOM model fields.

    Args:
        profile_id: Argo profile identifier.
        nc_file: Optional explicit HYCOM NetCDF path. When omitted, the
            production paths from settings are used (raw file preferred,
            processed surface file as fallback). Integration tests pass the
            real production file explicitly; the default behavior is unchanged.
    """
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
        argo_dt = pd.to_datetime(argo_time_str, errors="raise").tz_localize(None)
        if pd.isna(argo_dt):
            raise ValueError("invalid Argo timestamp")
    except (TypeError, ValueError):
        return {
            "argoProfileId": profile_id,
            "floatId": profile["float_id"],
            "observationTimestamp": argo_time_str,
            "observationLat": argo_lat,
            "observationLon": argo_lon,
            "modelDataset": "INCOIS HYCOM",
            "modelDataStatus": "UNAVAILABLE",
            "modelTimestamp": argo_time_str,
            "matchedModelLat": argo_lat,
            "matchedModelLon": argo_lon,
            "timeDifferenceHours": 0.0,
            "distanceKm": 0.0,
            "matchedDepths": [],
            "matchedPointCount": 0,
            "matchingToleranceM": MATCHING_DEPTH_TOLERANCE_M,
            "modelDepthSelection": MODEL_DEPTH_SELECTION,
            "comparisons": [],
            "statistics": {
                "temperature": calculate_matchup_statistics([], "temperature"),
                "salinity": calculate_matchup_statistics([], "salinity"),
            },
            "diagnostics": build_matchup_diagnostics(len(argo_obs), []),
            "dataStatus": profile.get("data_status", "REAL SOURCE — INGESTION PENDING"),
            "source": "Argo Global Data (GDAC) + INCOIS RSMC HYCOM",
            "statusMessage": "INVALID ARGO OBSERVATION TIMESTAMP — MODEL MATCH UNAVAILABLE"
        }

    # 2. Query HYCOM dataset directly from NetCDF without hardcoded fallbacks
    matched_hycom_lat = argo_lat
    matched_hycom_lon = argo_lon
    matched_hycom_time_str = argo_time_str
    time_diff_hours = 0.0
    distance_km = 0.0

    model_values_by_depth: Dict[float, Dict[str, Optional[float]]] = {}
    model_data_status = "UNAVAILABLE"
    raw_hycom_file = settings.RAW_HYCOM_FILE
    processed_hycom_file = settings.PROCESSED_OCEAN_FILE
    if nc_file is not None:
        target_nc_file = nc_file if nc_file.exists() else None
    else:
        target_nc_file = raw_hycom_file if raw_hycom_file.exists() else (processed_hycom_file if processed_hycom_file.exists() else None)

    if target_nc_file and target_nc_file.exists():
        try:
            ds_raw = xr.open_dataset(target_nc_file, engine="netcdf4", chunks={})
            model_data_status = "SIMULATED" if ds_raw.attrs.get("synthetic") == "true" else "REAL"

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

                    t_clean = round(t_val, 2) if (t_val is not None and np.isfinite(t_val)) else None
                    s_clean = round(s_val, 2) if (s_val is not None and np.isfinite(s_val)) else None

                    model_values_by_depth[d] = {
                        "temp": t_clean,
                        "saln": s_clean,
                        "temp_raw": t_val if (t_val is not None and np.isfinite(t_val)) else None,
                        "saln_raw": s_val if (s_val is not None and np.isfinite(s_val)) else None,
                    }
                except Exception:
                    pass

            ds_raw.close()
        except Exception as e:
            print(f"Error querying HYCOM NetCDF dataset: {e}")
            model_values_by_depth = {}
            model_data_status = "UNAVAILABLE"

    # Strict check: If no model values extracted, return clean "NO REAL MODEL MATCH AVAILABLE" status
    if not model_values_by_depth:
        return {
            "argoProfileId": profile_id,
            "floatId": profile["float_id"],
            "observationTimestamp": argo_time_str,
            "observationLat": argo_lat,
            "observationLon": argo_lon,
            "modelDataset": "INCOIS HYCOM",
            "modelDataStatus": model_data_status,
            "modelTimestamp": argo_time_str,
            "matchedModelLat": argo_lat,
            "matchedModelLon": argo_lon,
            "timeDifferenceHours": 0.0,
            "distanceKm": 0.0,
            "matchedDepths": [],
            "matchedPointCount": 0,
            "matchingToleranceM": MATCHING_DEPTH_TOLERANCE_M,
            "modelDepthSelection": MODEL_DEPTH_SELECTION,
            "comparisons": [],
            "statistics": {
                "temperature": calculate_matchup_statistics([], "temperature"),
                "salinity": calculate_matchup_statistics([], "salinity"),
            },
            "diagnostics": build_matchup_diagnostics(len(argo_obs), []),
            "dataStatus": profile.get("data_status", "REAL SOURCE — INGESTION PENDING"),
            "source": "Argo Global Data (GDAC) + INCOIS RSMC HYCOM",
            "statusMessage": "NO REAL MODEL MATCH AVAILABLE"
        }

    # 3. Match each observation to the nearest native HYCOM level within the
    # documented tolerance. No interpolation is performed.
    comparisons = []
    matched_depths = []

    for obs in argo_obs:
        depth_m = obs["depth_m"]
        argo_t = obs.get("temperature_c")
        argo_s = obs.get("salinity_psu")
        argo_t = argo_t if argo_t is not None and np.isfinite(argo_t) else None
        argo_s = argo_s if argo_s is not None and np.isfinite(argo_s) else None

        closest_hycom_depth = None
        min_depth_diff = float('inf')
        for h_depth in model_values_by_depth.keys():
            diff = abs(h_depth - depth_m)
            if diff < min_depth_diff and diff <= MATCHING_DEPTH_TOLERANCE_M:
                min_depth_diff = diff
                closest_hycom_depth = h_depth

        if closest_hycom_depth is not None:
            hycom_data = model_values_by_depth[closest_hycom_depth]
            model_t = hycom_data.get("temp")
            model_s = hycom_data.get("saln")
            model_t_raw = hycom_data.get("temp_raw")
            model_s_raw = hycom_data.get("saln_raw")

            # Residual Sign Convention: ΔT = HYCOM - Argo, ΔS = HYCOM - Argo
            temp_residual = round(model_t - argo_t, 2) if (model_t is not None and argo_t is not None) else None
            saln_residual = round(model_s - argo_s, 2) if (model_s is not None and argo_s is not None) else None
            temp_residual_raw = (
                model_t_raw - argo_t
                if (model_t_raw is not None and argo_t is not None)
                else None
            )
            saln_residual_raw = (
                model_s_raw - argo_s
                if (model_s_raw is not None and argo_s is not None)
                else None
            )

            matched_depths.append(depth_m)
            comparisons.append({
                "depthM": depth_m,
                "argoTemperatureC": argo_t,
                "modelTemperatureC": model_t,
                "temperatureResidualC": temp_residual,
                "argoSalinityPSU": argo_s,
                "modelSalinityPSU": model_s,
                "salinityResidualPSU": saln_residual,
                "matchedModelDepthM": closest_hycom_depth,
                "_temperatureResidualRaw": temp_residual_raw,
                "_salinityResidualRaw": saln_residual_raw,
            })

    return {
        "argoProfileId": profile_id,
        "floatId": profile["float_id"],
        "observationTimestamp": argo_time_str,
        "observationLat": argo_lat,
        "observationLon": argo_lon,
        "modelDataset": "INCOIS HYCOM",
        "modelDataStatus": model_data_status,
        "modelTimestamp": matched_hycom_time_str,
        "matchedModelLat": matched_hycom_lat,
        "matchedModelLon": matched_hycom_lon,
        "timeDifferenceHours": time_diff_hours,
        "distanceKm": distance_km,
        "matchedDepths": matched_depths,
        "matchedPointCount": len(comparisons),
        "matchingToleranceM": MATCHING_DEPTH_TOLERANCE_M,
        "modelDepthSelection": MODEL_DEPTH_SELECTION,
        "comparisons": comparisons,
        "dataStatus": profile.get("data_status", "REAL SOURCE — INGESTION PENDING"),
        "source": "Argo Global Data (GDAC) + INCOIS RSMC HYCOM",
        "residualConvention": "ΔT = HYCOM - Argo, ΔS = HYCOM - Argo",
        "statusMessage": None,
        "statistics": {
            "temperature": calculate_matchup_statistics(comparisons, "temperature"),
            "salinity": calculate_matchup_statistics(comparisons, "salinity"),
        },
        "diagnostics": build_matchup_diagnostics(len(argo_obs), comparisons),
    }
