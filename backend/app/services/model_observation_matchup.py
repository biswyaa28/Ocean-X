"""Argo observation vs INCOIS RSMC HYCOM model matchup.

The matcher is deliberately explicit about the three sub-samplings it applies
before a residual can be computed:

* SPATIAL - the float is not on a grid node. ``spatialMode="bilinear"``
  (default) blends the four surrounding cells; ``spatialMode="nearest"``
  reproduces the original nearest-cell-only behaviour.
* TEMPORAL - the observation is rarely on a model time step. When two model
  slices bracket the observation time their fields are blended linearly;
  otherwise the nearest slice is used.
* VERTICAL - the model depth axis is far coarser than the float's. With
  ``matchMode="interpolated"`` (default) the model profile is interpolated
  onto each float depth; ``matchMode="native"`` reproduces the original
  nearest-native-level-within-tolerance behaviour.

No sub-sampling ever extrapolates: a float level outside the model's valid
depth range (which includes below the seabed, because model levels there are
masked), a position outside the grid, or a level that would require bridging a
masked cell or time slice is reported as unmatched rather than guessed.

Depth basis: the float's depth is derived from Argo pressure with
``gsw.z_from_p`` at the float's latitude (see ``argo_levels``). The residual
sign convention is unchanged: residual = HYCOM - Argo.
"""

import math
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd
import xarray as xr

from app.core.config import settings
from app.providers.argo_provider import argo_provider
from app.services.argo_levels import QC_FLAGS_USED, build_matchup_levels
from app.services.matchup_diagnostics import build_matchup_diagnostics
from app.services.matchup_interpolation import (
    bilinear_stencil,
    float_bracket_max_gap_m,
    interpolate_float_at_depth,
    interpolate_model_profile,
    nearest_cell_index,
    nearest_time_index,
    time_bracket_weights,
    time_seconds,
    weighted_cells,
    weighted_time_slices,
)
from app.services.matchup_statistics import calculate_matchup_statistics

MATCHING_DEPTH_TOLERANCE_M = 15.0

# Vertical comparison modes.
#
#   model_levels  (default) compare the model AT its own depth levels; the float
#                 is interpolated onto each of them. Pairs are independent and
#                 the residual is not contaminated by model resampling.
#   float_levels  legacy: interpolate the model onto every float depth. Includes
#                 model interpolation error across sparse levels.
#   native        legacy: nearest native model level within the tolerance.
MATCH_MODES = ("model_levels", "float_levels", "native")
# Accepted for backward compatibility with clients written against the earlier
# "interpolated" naming, which is the float_levels behaviour.
MATCH_MODE_ALIASES = {"interpolated": "float_levels"}
SPATIAL_MODES = ("bilinear", "nearest")

DEFAULT_MATCH_MODE = "model_levels"
DEFAULT_SPATIAL_MODE = "bilinear"

MODEL_DEPTH_SELECTION = "nearest native HYCOM model depth (no interpolation)"
MODEL_DEPTH_SELECTION_FLOAT_LEVELS = (
    "linear interpolation between native HYCOM model depths (includes model "
    "interpolation error across sparse levels)"
)
MODEL_DEPTH_SELECTION_MODEL_LEVELS = (
    "model values at native HYCOM depth levels; float interpolated onto them"
)


def normalize_match_mode(value: Optional[str]) -> str:
    """Validate the requested vertical matching mode; default to model_levels."""
    if value is None:
        return DEFAULT_MATCH_MODE
    normalized = str(value).strip().lower()
    normalized = MATCH_MODE_ALIASES.get(normalized, normalized)
    return normalized if normalized in MATCH_MODES else DEFAULT_MATCH_MODE


def normalize_spatial_mode(value: Optional[str]) -> str:
    """Validate the requested horizontal matching mode; default to bilinear."""
    if value is None:
        return DEFAULT_SPATIAL_MODE
    normalized = str(value).strip().lower()
    return normalized if normalized in SPATIAL_MODES else DEFAULT_SPATIAL_MODE


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2.0)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2.0)**2
    return round(2.0 * R * math.asin(math.sqrt(a)), 2)


def _model_depth_selection(match_mode: str) -> str:
    if match_mode == "native":
        return MODEL_DEPTH_SELECTION
    if match_mode == "float_levels":
        return MODEL_DEPTH_SELECTION_FLOAT_LEVELS
    return MODEL_DEPTH_SELECTION_MODEL_LEVELS


def _argo_data_mode(profile: Dict[str, Any]) -> Optional[str]:
    """Argo data mode (R/A/D) advertised by the profile, if any.

    The committed processed JSON predates delayed-mode ingestion and carries no
    mode field, so this returns None and the raw/adjusted basis is auto-detected
    from whether the adjusted arrays hold data.
    """
    for key in ("data_mode", "argo_data_mode", "dataMode"):
        if profile.get(key):
            return profile[key]
    return None


def _run_time_gap_hours(dataset: xr.Dataset, argo_dt: Any) -> Tuple[float, float]:
    """Score a candidate run against an observation time.

    Returns ``(window_gap_hours, lead_hours)``:

    * ``window_gap_hours`` is 0 when the observation falls inside the run's
      time window, otherwise the distance to the nearer edge. This is the
      primary criterion: a run that brackets the observation always beats one
      that merely ends near it.
    * ``lead_hours`` is how far the observation sits after the run's first
      valid time - i.e. the forecast lead time. It is only a tie-break, and it
      matters because several consecutive daily runs usually all cover the same
      observation while differing by days of lead time. The shortest lead time
      is the freshest forecast and therefore the one least contaminated by
      forecast error.
    """
    if "TIME" not in dataset.coords:
        return float("inf"), float("inf")
    times = np.atleast_1d(dataset["TIME"].values)
    seconds = np.array(
        [value for value in (time_seconds(t) for t in times) if value is not None],
        dtype=float,
    )
    if seconds.size == 0:
        return float("inf"), float("inf")

    target = time_seconds(argo_dt)
    if target is None:
        return float("inf"), float("inf")

    window_gap = (
        0.0
        if seconds.min() <= target <= seconds.max()
        else min(abs(target - seconds.min()), abs(target - seconds.max())) / 3600.0
    )
    lead = abs(target - seconds.min()) / 3600.0
    return round(window_gap, 2), round(lead, 2)


def classify_time_gap(time_difference_hours: Optional[float]) -> Tuple[str, Optional[str]]:
    """Classify an observation-model time gap and state the consequence.

    Returns ``(status, reason)``. ``reason`` is None while residuals are valid
    and carries an explicit explanation when they must be suppressed.
    """
    if time_difference_hours is None or not math.isfinite(time_difference_hours):
        return "too_large", (
            "The observation-model time separation is unknown, so the two samples "
            "cannot be treated as a valid comparison."
        )
    gap = abs(time_difference_hours)
    if gap <= settings.MATCHUP_TIME_GAP_GOOD_H:
        return "good", None
    if gap <= settings.MATCHUP_TIME_GAP_MAX_H:
        return "marginal", None
    return "too_large", (
        f"Time gap too large for a valid comparison: the observation and the "
        f"nearest model time differ by {gap:.2f} h, beyond the "
        f"{settings.MATCHUP_TIME_GAP_MAX_H:g} h limit. Both profiles are shown, but "
        f"residual statistics are not computed because a residual at this "
        f"separation measures the difference between different ocean states, "
        f"not model error."
    )


def _unavailable_matchup(
    profile_id: str,
    profile: Dict[str, Any],
    observation_count: int,
    argo_time_str: Any,
    argo_lat: float,
    argo_lon: float,
    model_data_status: str,
    status_message: str,
    depth_source: str = "unavailable",
    qc_flags_used: Optional[Dict[str, Any]] = None,
    variable_basis: str = "raw",
    argo_data_mode: str = "auto",
    missing_qc_level_count: int = 0,
    model_run_name: Optional[str] = None,
    available_runs: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """Honest zero-match response: no fabricated levels, depths or statistics."""
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
        "timeInterpolationApplied": False,
        "timeGapStatus": "too_large",
        "timeGapReason": (
            "No model profile was available, so there is no valid "
            "observation-model comparison for this profile."
        ),
        "statisticsSuppressed": True,
        "modelRun": model_run_name,
        "availableModelRuns": available_runs or [],
        "distanceKm": 0.0,
        "spatialMode": DEFAULT_SPATIAL_MODE,
        "matchedDepths": [],
        "matchedPointCount": 0,
        "matchingToleranceM": MATCHING_DEPTH_TOLERANCE_M,
        "matchMode": DEFAULT_MATCH_MODE,
        "modelDepthSelection": MODEL_DEPTH_SELECTION_MODEL_LEVELS,
        "excludedModelLevels": [],
        "floatBracketMaxGapM": settings.FLOAT_BRACKET_MAX_GAP_M,
        "floatBracketMaxGapDeepM": settings.FLOAT_BRACKET_MAX_GAP_DEEP_M,
        "floatBracketDeepBreakpointM": settings.FLOAT_BRACKET_DEEP_BREAKPOINT_M,
        "depthSource": depth_source,
        "variableBasis": variable_basis,
        "argoDataMode": argo_data_mode,
        "missingQcLevelCount": missing_qc_level_count,
        "qcFlagsUsed": qc_flags_used or QC_FLAGS_USED,
        "comparisons": [],
        # No model profile -> no residual statistics, ever.
        "statistics": {
            "temperature": calculate_matchup_statistics([], "temperature"),
            "salinity": calculate_matchup_statistics([], "salinity"),
        },
        "diagnostics": build_matchup_diagnostics(observation_count, [], missing_qc_level_count),
        "dataStatus": profile.get("data_status", "REAL SOURCE — INGESTION PENDING"),
        "source": "Argo Global Data (GDAC) + INCOIS RSMC HYCOM",
        "residualConvention": "ΔT = HYCOM - Argo, ΔS = HYCOM - Argo",
        "statusMessage": status_message,
    }


def _read_cell_profile(
    dataset: xr.Dataset,
    time_index: int,
    stencil: List[Tuple[int, int, float]],
    depths: np.ndarray,
) -> Dict[str, np.ndarray]:
    """Horizontally resolve one model time slice into per-depth TEMP/SALN."""
    collected: Dict[str, List[np.ndarray]] = {"temp": [], "saln": []}
    for lat_index, lon_index, _weight in stencil:
        cell = dataset.isel(TIME=time_index, LAT=lat_index, LON=lon_index)
        for key, name in (("temp", "TEMP"), ("saln", "SALN")):
            if name in cell:
                collected[key].append(np.atleast_1d(cell[name].values).astype(float))

    profile: Dict[str, np.ndarray] = {}
    for key in ("temp", "saln"):
        if not collected[key]:
            profile[key] = np.full(depths.shape, np.nan)
            continue
        # Masked land / below-seabed cells drop out of the weighted mean
        # instead of pulling it toward zero; fewer than two valid cells in a
        # genuine multi-cell stencil means no match at all.
        blended = weighted_cells(collected[key], stencil, min_valid_cells=2)
        profile[key] = np.full(depths.shape, np.nan) if blended is None else blended
    return profile


def _extract_model_profiles(
    dataset: xr.Dataset,
    argo_lat: float,
    argo_lon: float,
    argo_dt: Any,
    spatial_mode: str,
) -> Optional[Dict[str, Any]]:
    """Build the model temperature and salinity profiles at one float position.

    Returns None when the position or time lies outside the dataset. The
    returned profiles are arrays aligned with the native DEPTH coordinate,
    already resolved through the horizontal and temporal sub-sampling; the
    vertical sub-sampling happens later, per float level.
    """
    for coordinate in ("LAT", "LON", "TIME"):
        if coordinate not in dataset.coords:
            return None

    lats = np.atleast_1d(dataset["LAT"].values)
    lons = np.atleast_1d(dataset["LON"].values)
    times = np.atleast_1d(dataset["TIME"].values)

    nearest_lat_index = nearest_cell_index(lats, argo_lat)
    nearest_lon_index = nearest_cell_index(lons, argo_lon)
    if nearest_lat_index is None or nearest_lon_index is None:
        return None

    if spatial_mode == "nearest":
        stencil: List[Tuple[int, int, float]] = [(nearest_lat_index, nearest_lon_index, 1.0)]
    else:
        stencil = bilinear_stencil(lats, lons, argo_lat, argo_lon) or []
        if not stencil:
            return None

    brackets = time_bracket_weights(times, argo_dt)
    if not brackets:
        return None

    depths = np.atleast_1d(dataset["DEPTH"].values) if "DEPTH" in dataset.coords else np.array([0.0])
    depths = np.atleast_1d(depths).astype(float)

    slices = [_read_cell_profile(dataset, index, stencil, depths) for index, _weight in brackets]
    weights = [weight for _index, weight in brackets]

    profiles: Dict[str, np.ndarray] = {}
    for key in ("temp", "saln"):
        fields = [entry[key] for entry in slices]
        blended = weighted_time_slices(fields, weights)
        profiles[key] = np.full(depths.shape, np.nan) if blended is None else blended

    # timeDifferenceHours always reports the distance to the NEAREST model time
    # slice, in both temporal modes: it is meaningful whether or not the two
    # bracketing slices were blended.
    nearest_time_position = nearest_time_index(times, argo_dt)
    if nearest_time_position is None:
        return None
    nearest_time = times[nearest_time_position]
    observation_seconds = time_seconds(argo_dt)
    nearest_seconds = time_seconds(nearest_time)
    time_difference_hours = (
        round(abs(nearest_seconds - observation_seconds) / 3600.0, 2)
        if observation_seconds is not None and nearest_seconds is not None
        else 0.0
    )

    return {
        "depths": depths,
        "temp": profiles["temp"],
        "saln": profiles["saln"],
        "matchedModelLat": float(lats[nearest_lat_index]),
        "matchedModelLon": float(lons[nearest_lon_index]),
        "modelTimestamp": str(nearest_time),
        "timeDifferenceHours": time_difference_hours,
        "timeInterpolationApplied": len(brackets) == 2,
    }


def _nearest_native_level(depths: np.ndarray, target_depth_m: float) -> Optional[float]:
    """Nearest native model level within the fixed matching tolerance.

    This is the original (pre-interpolation) vertical matching rule, kept as
    the ``matchMode="native"`` option.
    """
    closest = None
    smallest = float("inf")
    for depth in depths:
        value = float(depth)
        difference = abs(value - target_depth_m)
        if difference < smallest and difference <= MATCHING_DEPTH_TOLERANCE_M:
            smallest = difference
            closest = value
    return closest


def _build_model_level_comparisons(
    levels: List[Dict[str, Any]],
    model_depths: np.ndarray,
    model_temp: np.ndarray,
    model_saln: np.ndarray,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """Compare the model AT ITS OWN DEPTH LEVELS (the default mode).

    Physics: the model carries only a handful of depth levels (0, 17.5, 52.5,
    125, 275, 500 m for RSMC HYCOM) while a float profiles the column every
    ~1-10 m. Interpolating the model onto every float depth compares a
    three-segment straight line against a real thermocline, so the residual is
    dominated by the interpolation of the model rather than by model error, and
    the matched-pair count is inflated by neighbouring float levels that are not
    independent observations.

    Comparing at the model's own levels inverts that: the model value is used
    exactly as published (no vertical model interpolation at all), and the FLOAT
    is interpolated onto each of the few model depths. The resulting pairs are
    independent of one another - at most one per model level, so at most 6 per
    profile - and the RMSE measures model error rather than resampling error.

    The float side is still an interpolation, so it is bounded by two rules:
    never extrapolate past the float's sampled range, and reject any bracket
    wider than the sampling-gap limit for that depth (see ``config``).
    """
    comparisons: List[Dict[str, Any]] = []
    excluded: List[Dict[str, Any]] = []

    float_depths = [level["depth_m"] for level in levels]
    float_temp = [level.get("temperature_c") for level in levels]
    float_saln = [level.get("salinity_psu") for level in levels]

    for index, model_depth in enumerate(model_depths):
        depth_m = float(model_depth)
        model_t = float(model_temp[index]) if np.isfinite(model_temp[index]) else None
        model_s = float(model_saln[index]) if np.isfinite(model_saln[index]) else None
        if model_t is None and model_s is None:
            excluded.append({"modelDepthM": depth_m, "reason": "model_level_masked"})
            continue

        limit = float_bracket_max_gap_m(
            depth_m,
            settings.FLOAT_BRACKET_MAX_GAP_M,
            settings.FLOAT_BRACKET_MAX_GAP_DEEP_M,
            settings.FLOAT_BRACKET_DEEP_BREAKPOINT_M,
        )

        temp_value, temp_method, temp_bracket, temp_reject = interpolate_float_at_depth(
            float_depths, float_temp, depth_m, limit
        )
        saln_value, saln_method, saln_bracket, saln_reject = interpolate_float_at_depth(
            float_depths, float_saln, depth_m, limit
        )

        if temp_value is None and saln_value is None:
            excluded.append({
                "modelDepthM": depth_m,
                # Report the most informative reason: a coarse bracket is the
                # only one that could have been rescued by denser sampling.
                "reason": temp_reject or saln_reject or "unmatched",
            })
            continue

        # A model level is only reported as paired when at least one variable
        # produced a value; the other may legitimately be missing.
        method = "float_interpolated" if "float_interpolated" in (
            temp_method, saln_method
        ) else "float_native"
        bracket = temp_bracket or saln_bracket

        temperature_residual = (
            round(round(model_t, 2) - round(temp_value, 2), 2)
            if (model_t is not None and temp_value is not None)
            else None
        )
        salinity_residual = (
            round(round(model_s, 2) - round(saln_value, 2), 2)
            if (model_s is not None and saln_value is not None)
            else None
        )

        comparisons.append({
            # The row IS a model level: depthM is the model's own depth, which
            # is what the comparison chart already plots both series against.
            "depthM": round(depth_m, 2),
            "depthSource": "model_level",
            "modelDepthM": round(depth_m, 2),
            "method": method,
            "matchedModelDepthM": round(depth_m, 2),
            "argoTemperatureC": round(temp_value, 2) if temp_value is not None else None,
            "argoSalinityPSU": round(saln_value, 2) if saln_value is not None else None,
            "modelTemperatureC": round(model_t, 2) if model_t is not None else None,
            "modelSalinityPSU": round(model_s, 2) if model_s is not None else None,
            "temperatureResidualC": temperature_residual,
            "salinityResidualPSU": salinity_residual,
            # The float levels actually used, so a reader can judge the
            # interpolation instead of trusting it.
            "floatBracketTopM": round(bracket[0], 2) if bracket else None,
            "floatBracketBottomM": round(bracket[1], 2) if bracket else None,
            "floatBracketGapM": round(bracket[1] - bracket[0], 2) if bracket else None,
            "floatBracketMaxGapM": limit,
            "floatTemperatureMethod": temp_method,
            "floatSalinityMethod": saln_method,
            "floatTemperatureRejected": temp_reject,
            "floatSalinityRejected": saln_reject,
            "argoVariableSource": level_result_variable_source(levels),
            "_temperatureResidualRaw": (
                model_t - temp_value
                if (model_t is not None and temp_value is not None)
                else None
            ),
            "_salinityResidualRaw": (
                model_s - saln_value
                if (model_s is not None and saln_value is not None)
                else None
            ),
        })

    return comparisons, excluded


def level_result_variable_source(levels: List[Dict[str, Any]]) -> Optional[str]:
    """Raw or adjusted: the basis is a per-profile decision (see argo_levels)."""
    for level in levels:
        if level.get("temperature_source"):
            return level["temperature_source"]
    for level in levels:
        if level.get("salinity_source"):
            return level["salinity_source"]
    return None


def _build_comparisons(
    levels: List[Dict[str, Any]],
    model_depths: np.ndarray,
    model_temp: np.ndarray,
    model_saln: np.ndarray,
    match_mode: str,
) -> Tuple[List[Dict[str, Any]], List[float]]:
    """Match every float level to a model value and build the comparison rows."""
    comparisons: List[Dict[str, Any]] = []
    matched_depths: List[float] = []

    for level in levels:
        depth_m = level["depth_m"]
        argo_t = level.get("temperature_c")
        argo_s = level.get("salinity_psu")

        if match_mode == "native":
            native_depth = _nearest_native_level(model_depths, depth_m)
            if native_depth is None:
                continue
            index = int(np.argmin(np.abs(model_depths - native_depth)))
            model_t = float(model_temp[index]) if np.isfinite(model_temp[index]) else None
            model_s = float(model_saln[index]) if np.isfinite(model_saln[index]) else None
            # "native" here means the value came straight from one model depth
            # level; it says nothing about that level holding a valid value.
            method = "native"
            # The model value genuinely belongs to this native level, so the
            # response reports it unchanged from the pre-interpolation contract.
            matched_model_depth = native_depth
        else:
            model_t, temp_method = interpolate_model_profile(model_depths, model_temp, depth_m)
            model_s, saln_method = interpolate_model_profile(model_depths, model_saln, depth_m)
            if temp_method is None and saln_method is None:
                # Outside the model's valid depth range (or below the seabed):
                # never extrapolated, reported as unmatched.
                continue
            method = "interpolated" if "interpolated" in (temp_method, saln_method) else "native"
            # An interpolated value is defined AT the float depth, so the model
            # depth it belongs to is that same depth.
            matched_model_depth = depth_m

        # Residual sign convention: residual = HYCOM - Argo (unchanged).
        #
        # The DISPLAYED residual is computed from the displayed (2-decimal)
        # operands so that the table reconciles with itself: a reader who
        # subtracts the two printed columns gets exactly the printed residual.
        # The unrounded residual is carried separately for the statistics, so
        # 2-decimal presentation never accumulates inside the reported RMSE.
        temperature_residual = (
            round(round(model_t, 2) - round(argo_t, 2), 2)
            if (model_t is not None and argo_t is not None)
            else None
        )
        salinity_residual = (
            round(round(model_s, 2) - round(argo_s, 2), 2)
            if (model_s is not None and argo_s is not None)
            else None
        )

        matched_depths.append(depth_m)
        comparisons.append({
            "depthM": round(depth_m, 2),
            "depthSource": level["depth_source"],
            "method": method,
            "argoTemperatureC": round(argo_t, 2) if argo_t is not None else None,
            "argoSalinityPSU": round(argo_s, 2) if argo_s is not None else None,
            "argoVariableSource": level.get("temperature_source") or level.get("salinity_source"),
            "modelTemperatureC": round(model_t, 2) if model_t is not None else None,
            "modelSalinityPSU": round(model_s, 2) if model_s is not None else None,
            "temperatureResidualC": temperature_residual,
            "salinityResidualPSU": salinity_residual,
            "matchedModelDepthM": round(matched_model_depth, 2) if matched_model_depth is not None else None,
            # Unrounded residuals feed the statistics.
            "_temperatureResidualRaw": (model_t - argo_t) if (model_t is not None and argo_t is not None) else None,
            "_salinityResidualRaw": (model_s - argo_s) if (model_s is not None and argo_s is not None) else None,
        })

    return comparisons, matched_depths


def match_argo_with_hycom(
    profile_id: str,
    nc_file: Optional[Path] = None,
    match_mode: Optional[str] = None,
    spatial_mode: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """Match an Argo profile with HYCOM model fields.

    Args:
        profile_id: Argo profile identifier.
        nc_file: Optional explicit HYCOM NetCDF path. When omitted, the
            production paths from settings are used (raw file preferred,
            processed surface file as fallback). Integration tests pass the
            real production file explicitly; the default behavior is unchanged.
        match_mode: "interpolated" (default) or "native" vertical matching.
        spatial_mode: "bilinear" (default) or "nearest" horizontal matching.
    """
    match_mode = normalize_match_mode(match_mode)
    spatial_mode = normalize_spatial_mode(spatial_mode)

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

    # Depth basis (GSW pressure -> depth), the raw/adjusted variable basis and
    # QC filtering are resolved once per profile, before the dataset is opened,
    # so a profile with no usable depth never touches the multi-GB file.
    level_result = build_matchup_levels(argo_obs, argo_lat, data_mode=_argo_data_mode(profile))
    levels = level_result["levels"]
    depth_source = level_result["depthSource"]
    qc_flags_used = level_result["qcFlagsUsed"]
    variable_basis = level_result["variableBasis"]
    argo_data_mode = level_result["argoDataMode"]
    missing_qc_level_count = level_result["missingQcLevelCount"]
    level_meta = {
        "depth_source": depth_source,
        "qc_flags_used": qc_flags_used,
        "variable_basis": variable_basis,
        "argo_data_mode": argo_data_mode,
        "missing_qc_level_count": missing_qc_level_count,
    }

    # Parse Argo timestamp as timezone-naive for NetCDF comparison
    try:
        argo_dt = pd.to_datetime(argo_time_str, errors="raise").tz_localize(None)
        if pd.isna(argo_dt):
            raise ValueError("invalid Argo timestamp")
    except (TypeError, ValueError):
        return _unavailable_matchup(
            profile_id, profile, len(argo_obs), argo_time_str, argo_lat, argo_lon,
            "UNAVAILABLE",
            "INVALID ARGO OBSERVATION TIMESTAMP — MODEL MATCH UNAVAILABLE",
            **level_meta,
        )

    # 2. Choose the model run whose time window is closest to the observation.
    #
    # INCOIS publishes several overlapping runs and deletes older ones, so more
    # than one may be installed. Rather than trusting whichever file sorts
    # first, every candidate run is opened once (metadata only), scored by the
    # distance between the observation time and the run's own time window, and
    # the closest is used. An observation inside a run's window scores zero,
    # which is what makes a freshly ingested profile land on its own run.
    model_data_status = "UNAVAILABLE"
    model_profile: Optional[Dict[str, Any]] = None
    model_run_file: Optional[Path] = None
    model_run_name: Optional[str] = None
    available_runs: List[Dict[str, Any]] = []

    if nc_file is not None:
        run_candidates = [nc_file] if nc_file.exists() else []
    else:
        run_candidates = list(settings.HYCOM_RAW_CANDIDATES)
        processed_hycom_file = settings.PROCESSED_OCEAN_FILE
        if not run_candidates and processed_hycom_file.exists():
            # Last resort: the processed surface file is depth-less, so it can
            # only serve a surface-only match.
            run_candidates = [processed_hycom_file]

    best_score: Optional[Tuple[float, float]] = None
    for candidate in run_candidates:
        dataset = None
        try:
            # chunks={} keeps the multi-GB production file lazily read: only the
            # handful of matched cells are ever materialised.
            dataset = xr.open_dataset(candidate, engine="netcdf4", chunks={})
            status = "SIMULATED" if dataset.attrs.get("synthetic") == "true" else "REAL"
            gap_hours, lead_hours = _run_time_gap_hours(dataset, argo_dt)
            score = (gap_hours, lead_hours)
            available_runs.append({
                "run": candidate.name,
                "timeGapHours": gap_hours,
                "leadHours": lead_hours,
                "dataStatus": status,
            })
            # Lower window gap wins; on a tie the shorter forecast lead wins.
            if best_score is None or score < best_score:
                best_score = score
                model_data_status = status
                model_run_file = candidate
                model_run_name = candidate.name
                model_profile = _extract_model_profiles(dataset, argo_lat, argo_lon, argo_dt, spatial_mode)
        except Exception as e:
            print(f"Error querying HYCOM NetCDF dataset ({candidate.name}): {e}")
        finally:
            if dataset is not None:
                dataset.close()

    # Strict check: no usable model profile -> clean "NO REAL MODEL MATCH
    # AVAILABLE" status, with nothing fabricated.
    if not model_profile:
        return _unavailable_matchup(
            profile_id, profile, len(argo_obs), argo_time_str, argo_lat, argo_lon,
            model_data_status, "NO REAL MODEL MATCH AVAILABLE",
            model_run_name=model_run_name, available_runs=available_runs,
            **level_meta,
        )

    if match_mode == "model_levels":
        comparisons, excluded_model_levels = _build_model_level_comparisons(
            levels,
            model_profile["depths"],
            model_profile["temp"],
            model_profile["saln"],
        )
        # Matched depths are now model levels, not float levels.
        matched_depths = [row["depthM"] for row in comparisons]
    else:
        comparisons, matched_depths = _build_comparisons(
            levels,
            model_profile["depths"],
            model_profile["temp"],
            model_profile["saln"],
            match_mode,
        )
        excluded_model_levels = []

    # Time-gap guard. Profiles and per-level comparisons are still returned when
    # the gap is too large - they are real data and useful to look at - but the
    # residual statistics are withheld because a residual taken across a long
    # separation describes two different ocean states rather than model error.
    time_gap_status, time_gap_reason = classify_time_gap(model_profile["timeDifferenceHours"])
    statistics_suppressed = time_gap_status == "too_large"

    return {
        "argoProfileId": profile_id,
        "floatId": profile["float_id"],
        "observationTimestamp": argo_time_str,
        "observationLat": argo_lat,
        "observationLon": argo_lon,
        "modelDataset": "INCOIS HYCOM",
        "modelDataStatus": model_data_status,
        "modelTimestamp": model_profile["modelTimestamp"],
        "matchedModelLat": model_profile["matchedModelLat"],
        "matchedModelLon": model_profile["matchedModelLon"],
        "timeDifferenceHours": model_profile["timeDifferenceHours"],
        "timeInterpolationApplied": model_profile["timeInterpolationApplied"],
        "timeGapStatus": time_gap_status,
        "timeGapReason": time_gap_reason,
        "statisticsSuppressed": statistics_suppressed,
        "modelRun": model_run_name,
        "availableModelRuns": available_runs,
        "distanceKm": haversine_km(argo_lat, argo_lon, model_profile["matchedModelLat"], model_profile["matchedModelLon"]),
        "spatialMode": spatial_mode,
        "matchedDepths": matched_depths,
        "matchedPointCount": len(comparisons),
        "matchingToleranceM": MATCHING_DEPTH_TOLERANCE_M,
        "matchMode": match_mode,
        "modelDepthSelection": _model_depth_selection(match_mode),
        "excludedModelLevels": excluded_model_levels,
        "floatBracketMaxGapM": settings.FLOAT_BRACKET_MAX_GAP_M,
        "floatBracketMaxGapDeepM": settings.FLOAT_BRACKET_MAX_GAP_DEEP_M,
        "floatBracketDeepBreakpointM": settings.FLOAT_BRACKET_DEEP_BREAKPOINT_M,
        "depthSource": depth_source,
        "variableBasis": variable_basis,
        "argoDataMode": argo_data_mode,
        "missingQcLevelCount": missing_qc_level_count,
        "qcFlagsUsed": qc_flags_used,
        "comparisons": comparisons,
        "dataStatus": profile.get("data_status", "REAL SOURCE — INGESTION PENDING"),
        "source": "Argo Global Data (GDAC) + INCOIS RSMC HYCOM",
        "residualConvention": "ΔT = HYCOM - Argo, ΔS = HYCOM - Argo",
        "statusMessage": None,
        "statistics": {
            "temperature": calculate_matchup_statistics(
                [] if statistics_suppressed else comparisons, "temperature"
            ),
            "salinity": calculate_matchup_statistics(
                [] if statistics_suppressed else comparisons, "salinity"
            ),
        },
        "diagnostics": build_matchup_diagnostics(
            len(argo_obs), comparisons, missing_qc_level_count,
            model_profile["timeDifferenceHours"], time_gap_status,
        ),
    }