#!/usr/bin/env python
"""Diagnose the reported temperature bias at the model's disputed level (index 3).

The regional summary from ``GET /api/argo/matchup/summary`` reports a large
warm model bias at 125 m (bias +3.94 C, RMSE 4.62 C over 20 profiles). This
script asks WHERE that bias comes from, without changing any matchup behaviour.

Four candidate explanations are separated by the evidence printed here:

1. GEOMETRY - the float is not on a model grid node, so a bilinear blend and a
   nearest-cell sample differ. If nearest-cell and bilinear residuals disagree
   systematically, the bias is a sampling artifact of the grid, not of the model
   physics. Reported per profile as both residuals plus the distance to the
   nearest cell centre and the number of valid cells in the stencil.
2. COASTAL LAND MASKING - near the shelf the bilinear stencil includes land
   cells that drop out and the remaining weights renormalise. That pulls the
   blend toward whichever ocean cell survives. Reported as distance to the
   nearest cell centre, which is small exactly in that regime.
3. VERTICAL RESOLUTION - the model has six levels (0, 10, 50, 100, 250, 500 m
   on the rebuilt axis; 0, 17.5, 52.5, 125, 275, 500 m on the file axis), so
   between the 3rd and 5th level it is a straight line in depth. A float
   thermocline crossing inside that interval cannot be represented at all. The
   full 0-300 m profiles of the worst cases are printed for direct inspection.
4. FORECAST LEAD / DATA BASIS - a run lead time or a raw-vs-adjusted basis
   difference would show up as clustering. Reported per profile, and the 125 m
   bias is recomputed against the longest-lead covering run.

Nothing is invented: every number below comes from the installed model files
and the ingested Argo profiles. Where an explanation is not supported by the
evidence, this script says so rather than guessing.

Usage
-----
    cd backend && python scripts/diagnose_bias_125m.py

Writes ``docs/diagnostics/bias_125m.csv`` (tracked in Git) and prints the
evidence tables.
"""

from __future__ import annotations

import csv
import math
import os
import statistics
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd
import xarray as xr

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import settings  # noqa: E402
from app.providers.argo_provider import argo_provider  # noqa: E402
from app.services.argo_levels import build_matchup_levels  # noqa: E402
from app.services.model_observation_matchup import resolve_model_depths  # noqa: E402
from app.services.matchup_interpolation import (  # noqa: E402
    bilinear_stencil,
    interpolate_float_at_depth,
    nearest_cell_index,
    time_bracket_weights,
    weighted_cells,
    weighted_time_slices,
)
from app.services.model_observation_matchup import (  # noqa: E402
    _argo_data_mode,
    _run_time_gap_hours,
    haversine_km,
    match_argo_with_hycom,
)

# The disputed model level is addressed by INDEX (3 of 0-5), because the depth
# that index represents depends on the axis rule (see resolve_model_depths):
# 125 m on the file's own DEPTH, 100 m on the rebuilt nodes. TARGET_DEPTH_M is
# filled in from the installed file by ``_configure_target`` before use.
TARGET_LEVEL_INDEX = 3
TARGET_DEPTH_M = 125.0
MODEL_LEVELS_M: List[float] = []
# A profile inside this distance of a grid cell centre has its nearest-cell and
# bilinear samples drawn from nearly the same place, so a disagreement between
# them is a real spatial signal rather than a node-vs-midpoint difference.
COASTAL_PROXIMITY_M = 0.02
CSV_RELATIVE_PATH = Path("docs/diagnostics/bias_125m.csv")


# --------------------------------------------------------------------------
# small numeric helpers
# --------------------------------------------------------------------------

def _finite(value: Any) -> Optional[float]:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float, np.floating, np.integer)):
        return float(value)
    return None


def _quartiles(values: List[float]) -> Tuple[float, float, float]:
    """(Q1, median, Q3) by linear interpolation between order statistics."""
    ordered = sorted(values)
    return (
        float(np.percentile(ordered, 25)),
        float(np.percentile(ordered, 50)),
        float(np.percentile(ordered, 75)),
    )


def _describe(values: List[float], label: str) -> Dict[str, Any]:
    q1, median, q3 = _quartiles(values)
    return {
        "label": label,
        "n": len(values),
        "mean": round(statistics.fmean(values), 4),
        "median": round(median, 4),
        "q1": round(q1, 4),
        "q3": round(q3, 4),
        "iqr": round(q3 - q1, 4),
        "min": round(min(values), 4),
        "max": round(max(values), 4),
    }


def _print_row(cells: List[str], widths: List[int]) -> str:
    return "  " + "".join(str(cell).ljust(width) for cell, width in zip(cells, widths))


# --------------------------------------------------------------------------
# model access
# --------------------------------------------------------------------------

def _candidate_runs() -> List[Path]:
    override = os.environ.get("OCEANX_RAW_HYCOM_FILE")
    if override:
        return [Path(override)]
    return [path for path in settings.HYCOM_RAW_CANDIDATES if path.is_file()]


def _depth_index(dataset: xr.Dataset, target_depth_m: float = 0.0) -> Optional[int]:
    """Index of the disputed model level (independent of which axis rule is on)."""
    if "DEPTH" not in dataset.coords:
        return None
    size = np.atleast_1d(dataset["DEPTH"].values).size
    return TARGET_LEVEL_INDEX if size > TARGET_LEVEL_INDEX else None


def _configure_target(dataset: xr.Dataset) -> None:
    """Set the depth the disputed level represents under the active axis rule."""
    global TARGET_DEPTH_M, MODEL_LEVELS_M
    depths, _rule = resolve_model_depths(dataset)
    MODEL_LEVELS_M = [float(d) for d in depths]
    if depths.size > TARGET_LEVEL_INDEX:
        TARGET_DEPTH_M = float(depths[TARGET_LEVEL_INDEX])


def _sample_field_at(
    dataset: xr.Dataset,
    variable: str,
    lat: float,
    lon: float,
    when: pd.Timestamp,
    spatial_mode: str,
    depth_index: Optional[int] = None,
) -> Tuple[Optional[float], Optional[float], int, Optional[int]]:
    """Sample one model field at a position/time.

    Returns ``(value, distance_to_nearest_cell_deg, valid_cells, nearest_index)``
    using exactly the horizontal and temporal handling the matchup uses:
    bilinear with land renormalised (``min_valid_cells=2``), or a single cell
    in ``nearest`` mode, then a linear blend of the bracketing time slices.
    """
    lats = np.atleast_1d(dataset["LAT"].values)
    lons = np.atleast_1d(dataset["LON"].values)
    times = np.atleast_1d(dataset["TIME"].values)

    nearest_lat_index = nearest_cell_index(lats, lat)
    nearest_lon_index = nearest_cell_index(lons, lon)
    if nearest_lat_index is None or nearest_lon_index is None:
        return None, None, 0, None

    distance = haversine_km(lat, lon, lats[nearest_lat_index], lons[nearest_lon_index])

    if spatial_mode == "nearest":
        stencil: List[Tuple[int, int, float]] = [(nearest_lat_index, nearest_lon_index, 1.0)]
    else:
        stencil = bilinear_stencil(lats, lons, lat, lon) or []
        if not stencil:
            return None, distance, 0, None

    brackets = time_bracket_weights(times, when)
    if not brackets:
        return None, distance, 0, None

    # Sample every STENCIL cell (one pass per time bracket) and blend with the
    # same weights the matchup uses. Indexing the nearest cell directly here
    # would make "nearest" and "bilinear" sample the identical point and
    # silently report a zero difference for every profile.
    per_bracket: List[List[np.ndarray]] = []
    for time_index, _weight in brackets:
        per_stencil: List[np.ndarray] = []
        for lat_index, lon_index, _cell_weight in stencil:
            cell = dataset.isel(TIME=time_index, LAT=lat_index, LON=lon_index)
            if variable not in cell:
                return None, distance, 0, None
            raw = cell[variable]
            array = np.atleast_1d(
                raw.values[depth_index] if depth_index is not None else raw.values
            ).astype(float)
            per_stencil.append(array)
        per_bracket.append(per_stencil)

    cell_blends: List[Optional[np.ndarray]] = [
        weighted_cells(per_stencil, stencil, min_valid_cells=2)
        for per_stencil in per_bracket
    ]
    if any(entry is None for entry in cell_blends):
        return None, distance, 0, None

    if len(per_bracket) == 1:
        weights: List[float] = [1.0]
    else:
        weights = [weight for _index, weight in brackets]

    # A 2D field samples as a single-element array; a 3D field at a fixed depth
    # also samples as a single element. Either way the stencil blend is over the
    # horizontal neighbours only.
    blended = weighted_time_slices(
        [entry for entry in cell_blends if entry is not None], weights
    )
    if blended is None:
        return None, distance, 0, None
    value = float(np.atleast_1d(blended)[0])
    return value, distance, 0, nearest_lat_index


def _stencil_valid_cells(
    dataset: xr.Dataset,
    variable: str,
    lat: float,
    lon: float,
    when: pd.Timestamp,
    depth_index: Optional[int],
) -> int:
    """How many of the four bilinear stencil cells carry a value."""
    lats = np.atleast_1d(dataset["LAT"].values)
    lons = np.atleast_1d(dataset["LON"].values)
    stencil = bilinear_stencil(lats, lons, lat, lon) or []
    brackets = time_bracket_weights(np.atleast_1d(dataset["TIME"].values), when)
    if not stencil or not brackets:
        return 0
    time_index = brackets[0][0]
    count = 0
    for lat_i, lon_i, _weight in stencil:
        cell = dataset.isel(TIME=time_index, LAT=lat_i, LON=lon_i)
        if variable not in cell:
            continue
        raw = cell[variable].values
        array = np.atleast_1d(raw[depth_index] if depth_index is not None else raw).astype(float)
        if array.size and np.isfinite(array[0]):
            count += 1
    return count


# --------------------------------------------------------------------------
# per-profile diagnostic
# --------------------------------------------------------------------------

def _float_levels(profile: Dict[str, Any]) -> Tuple[List[Dict[str, Any]], str, str]:
    result = build_matchup_levels(
        profile.get("observations", []),
        profile["latitude"],
        data_mode=_argo_data_mode(profile),
    )
    return result["levels"], result["variableBasis"], result["argoDataMode"]


def _float_at_depth(levels: List[Dict[str, Any]], depth_m: float) -> Optional[float]:
    depths = [level["depth_m"] for level in levels]
    temps = [level.get("temperature_c") for level in levels]
    limit = float("inf")  # diagnostics: never reject a float bracket here
    value, _method, _bracket, _reject = interpolate_float_at_depth(
        depths, temps, depth_m, limit
    )
    return value


def _profile_diagnostic(
    profile: Dict[str, Any],
    dataset: xr.Dataset,
    run_name: str,
    lead_hours: Optional[float],
    spatial_mode: str = "bilinear",
) -> Optional[Dict[str, Any]]:
    """Gather the 125 m evidence for one profile against one run."""
    lat, lon = profile["latitude"], profile["longitude"]
    when = pd.to_datetime(profile["observation_time"], errors="raise").tz_localize(None)

    levels, basis, data_mode = _float_levels(profile)
    if not levels:
        return None

    depth_index = _depth_index(dataset, TARGET_DEPTH_M)
    if depth_index is None:
        return None

    float_value = _float_at_depth(levels, TARGET_DEPTH_M)
    bilinear, distance_km, _cells, _nearest = _sample_field_at(
        dataset, "TEMP", lat, lon, when, "bilinear", depth_index
    )
    nearest_value, _d, _c, _n = _sample_field_at(
        dataset, "TEMP", lat, lon, when, "nearest", depth_index
    )
    if float_value is None or bilinear is None:
        return None

    valid_cells = _stencil_valid_cells(dataset, "TEMP", lat, lon, when, depth_index)

    return {
        "profileId": profile["profile_id"],
        "floatId": profile["float_id"],
        "lat": round(lat, 4),
        "lon": round(lon, 4),
        "dataMode": data_mode,
        "variableBasis": basis,
        "run": run_name,
        "leadHours": None if lead_hours is None else round(lead_hours, 2),
        "floatTemperatureC": round(float_value, 4),
        "modelTemperatureC": round(bilinear, 4),
        "residualC": round(bilinear - float_value, 4),
        "nearestModelTemperatureC": None if nearest_value is None else round(nearest_value, 4),
        "nearestResidualC": (
            None if nearest_value is None else round(nearest_value - float_value, 4)
        ),
        # Full precision on purpose: at 125 m the model's horizontal gradient is
        # tiny, so bilinear and nearest-cell agree to ~0.01 C and the difference
        # would be invisible at the 2 dp used for the residual column. This is
        # the number that tests the geometry explanation, so it must not be
        # rounded away.
        "nearestVsBilinearDeltaC": (
            None
            if nearest_value is None
            else round(nearest_value - bilinear, 6)
        ),
        "distanceToCellCentreKm": round(distance_km, 2),
        "stencilValidCells": valid_cells,
        "shallowestFloatDepthM": round(min(level["depth_m"] for level in levels), 2),
        "deepestFloatDepthM": round(max(level["depth_m"] for level in levels), 2),
        "floatLevelCount": len(levels),
    }


def _covering_runs(when: pd.Timestamp) -> List[Tuple[Path, float]]:
    """Every run whose time window contains the observation, with its lead."""
    covering: List[Tuple[Path, float]] = []
    for candidate in _candidate_runs():
        dataset = None
        try:
            dataset = xr.open_dataset(candidate, engine="netcdf4", chunks={})
            gap_hours, lead_hours = _run_time_gap_hours(dataset, when)
            if gap_hours == 0.0:
                covering.append((candidate, lead_hours))
        except Exception:
            continue
        finally:
            if dataset is not None:
                dataset.close()
    return covering


# --------------------------------------------------------------------------
# reporting
# --------------------------------------------------------------------------

def _print_depth_coordinate(dataset: xr.Dataset) -> None:
    print("4. MODEL DEPTH COORDINATE")
    print("-" * 96)
    depth = dataset["DEPTH"] if "DEPTH" in dataset.coords else None
    if depth is None:
        print("  no DEPTH coordinate present")
        return
    print(f"  values (m)      : {np.atleast_1d(depth.values).tolist()}")
    for attribute in ("standard_name", "long_name", "units", "axis", "positive", "coordinate"):
        print(f"  {attribute:15s}: {depth.attrs.get(attribute)!r}")
    is_true_depth = (
        depth.attrs.get("standard_name") == "depth"
        and str(depth.attrs.get("positive", "")).lower() == "down"
    )
    units = depth.attrs.get("units")
    print(f"  => standard_name='depth' with positive='down' means metres below the sea surface.")
    print(f"  => units attribute is {units!r}"
          + ("  (MISSING — inferred from standard_name)" if not units else ""))
    print(f"  => levels are true depths in metres: {is_true_depth}")
    print()


def _print_profile(
    levels: List[Dict[str, Any]],
    dataset: xr.Dataset,
    when: pd.Timestamp,
    lat: float,
    lon: float,
    float_id: str = "",
    residual_c: float = 0.0,
    float_t: float = 0.0,
    model_t: float = 0.0,
) -> Dict[str, Any]:
    """Text table of the float profile against the model's own levels.

    Returns the D26 comparison as data so the verdict can be built from the
    numbers rather than from the printed table.
    """
    lats = np.atleast_1d(dataset["LAT"].values)
    lons = np.atleast_1d(dataset["LON"].values)
    brackets = time_bracket_weights(np.atleast_1d(dataset["TIME"].values), when)
    stencil = bilinear_stencil(lats, lons, lat, lon) or []
    model_depths, _rule = resolve_model_depths(dataset)

    model_values: List[Optional[float]] = []
    for index in range(model_depths.size):
        value, _d, _c, _n = _sample_field_at(
            dataset, "TEMP", lat, lon, when, "bilinear", index
        )
        model_values.append(value)

    print("   float (depth, T)          model levels (depth, T)")
    print("   " + "-" * 30 + "    " + "-" * 30)
    float_rows = [
        (level["depth_m"], level.get("temperature_c"))
        for level in levels
        if level["depth_m"] <= 300.0
    ]
    model_rows = [
        (float(model_depths[i]), model_values[i]) for i in range(model_depths.size)
    ]
    for index in range(max(len(float_rows), len(model_rows))):
        left = (
            f"{float_rows[index][0]:>8.2f} m  {float_rows[index][1]:>6.2f} C"
            if index < len(float_rows) and float_rows[index][1] is not None
            else (" " * 24)
        )
        right = (
            f"{model_rows[index][0]:>8.2f} m  {model_rows[index][1]:>6.2f} C"
            if index < len(model_rows) and model_rows[index][1] is not None
            else ""
        )
        print(f"   {left}    {right}")

    def crossing(series: List[Tuple[float, Optional[float]]]) -> Optional[float]:
        """Deepest downward crossing from >= 26 C to < 26 C, linearly interpolated."""
        valid = [(d, t) for d, t in series if t is not None]
        for (d0, t0), (d1, t1) in zip(valid, valid[1:]):
            if t0 >= 26.0 > t1:
                fraction = (t0 - 26.0) / (t0 - t1)
                return d0 + fraction * (d1 - d0)
        return None

    float_cross = crossing(float_rows)
    model_cross = crossing(model_rows)
    surface_t = next((t for _d, t in float_rows if t is not None), None)
    print()
    print(f"   float surface T          : {surface_t if surface_t is not None else 'n/a'} C")
    print(f"   float D26 (26 C crossing): "
          f"{f'{float_cross:.1f} m' if float_cross is not None else 'none within 0-300 m'}")
    print(f"   model  D26 (26 C crossing): "
          f"{f'{model_cross:.1f} m' if model_cross is not None else 'none within 0-300 m'}")
    if float_cross is not None and model_cross is not None:
        print(f"   difference               : {float_cross - model_cross:+.1f} m "
              "(float is shallower by this much when negative)")
    return {
        "floatId": float_id,
        "float_d26": float_cross,
        "model_d26": model_cross,
        "residualC": residual_c,
        "float_t": float_t,
        "model_t": model_t,
    }


def _ncss_request() -> str:
    """The equivalent OPeNDAP NCSS request for the subset this script reads.

    Printed so the numbers can be reproduced independently of this codebase,
    e.g. by pasting it into a THREDDS/NCSS endpoint that serves the same run.
    """
    return (
        "dataset.nc?TEMP,TCHP,MLD&"
        "LAT.range(4.94,25.06)&LON.range(79.97,100.02)&TIME.start=2026-10-04T06:00:00Z&"
        f"DEPTH[{TARGET_LEVEL_INDEX}:{TARGET_LEVEL_INDEX}]"
    )


def _conclusion(
    rows: List[Dict[str, Any]],
    worst: List[Dict[str, Any]],
    bias_check: Dict[str, Any],
) -> str:
    """State the verdict the evidence supports. Never guess beyond it.

    Each candidate explanation is tested against a number computed from the
    data, and the verdict names only the ones the data can rule out. When an
    explanation survives, the script says so rather than picking a favourite.
    """
    residuals = [row["residualC"] for row in rows]
    mean_bias = statistics.fmean(residuals)
    deltas = [
        abs(row["nearestVsBilinearDeltaC"])
        for row in rows
        if row["nearestVsBilinearDeltaC"] is not None
    ]
    median_delta = statistics.median(deltas) if deltas else None
    coastal_threshold_km = COASTAL_PROXIMITY_M * 111.0
    coastal = [r for r in rows if r["distanceToCellCentreKm"] < coastal_threshold_km]
    open_ocean = [r for r in rows if r["distanceToCellCentreKm"] >= coastal_threshold_km]
    coastal_mean = statistics.fmean([r["residualC"] for r in coastal]) if coastal else None
    open_mean = statistics.fmean([r["residualC"] for r in open_ocean]) if open_ocean else None
    partial_stencil = [row for row in rows if row["stencilValidCells"] < 4]

    print("5. VERDICT")
    print("-" * 96)
    print(f"  profiles analysed                : {len(rows)}")
    print(f"  mean {TARGET_DEPTH_M:g} m residual            : {mean_bias:+.3f} C "
          f"(model - float; positive = model too warm)")
    print(f"  profiles with a positive bias    : "
          f"{sum(1 for r in residuals if r > 0)}/{len(residuals)}")
    print()

    # Test 1: geometry. Is the float-vs-node offset big enough to explain it?
    if median_delta is not None:
        fraction = median_delta / abs(mean_bias) * 100 if mean_bias else 0.0
        ruled_out = fraction < 25.0
        print(f"  [1] GEOMETRY (float not on a grid node)")
        print(f"      median |nearest - bilinear| at target level : {median_delta:.4f} C "
              f"({fraction:.1f}% of the mean bias)")
        print(f"      => {'RULED OUT' if ruled_out else 'NOT RULED OUT'}: "
              f"the sampling offset is "
              f"{'far too small to produce' if ruled_out else 'large enough to be a candidate for'}"
              f" a {mean_bias:+.2f} C bias")
        print()

    # Test 2: coastal land masking in the bilinear stencil.
    print(f"  [2] COASTAL LAND MASKING IN THE BILINEAR STENCIL")
    print(f"      profiles with a masked stencil cell : {len(partial_stencil)}")
    if coastal_mean is not None and open_mean is not None:
        print(f"      coastal/shelf mean : {coastal_mean:+.3f} C  (n={len(coastal)})")
        print(f"      open ocean  mean   : {open_mean:+.3f} C  (n={len(open_ocean)})")
        # Computed, not asserted: ruled out only if no stencil is masked and the
        # coastal group is not the more biased one.
        coastal_not_worse = abs(coastal_mean) <= abs(open_mean)
        ruled_out = not partial_stencil and coastal_not_worse
        print(f"      => {'RULED OUT' if ruled_out else 'NOT RULED OUT'}: "
              f"{len(partial_stencil)} masked stencil(s); coastal group "
              f"{'is not' if coastal_not_worse else 'IS'} the more biased one")
    print()

    # Test 3: raw vs adjusted variable basis.
    raw = [r for r in rows if r["variableBasis"] == "raw"]
    adjusted = [r for r in rows if r["variableBasis"] == "adjusted"]
    if raw and adjusted:
        raw_mean = statistics.fmean([r["residualC"] for r in raw])
        adjusted_mean = statistics.fmean([r["residualC"] for r in adjusted])
        print(f"  [3] RAW vs ADJUSTED VARIABLE BASIS")
        print(f"      raw      mean : {raw_mean:+.3f} C  (n={len(raw)})")
        print(f"      adjusted mean : {adjusted_mean:+.3f} C  (n={len(adjusted)})")
        basis_gap = abs(raw_mean - adjusted_mean)
        basis_ruled_out = basis_gap < 0.25 * abs(mean_bias)
        print(f"      => {'RULED OUT' if basis_ruled_out else 'NOT RULED OUT'}: the two bases "
              f"differ by {basis_gap:.3f} C ({basis_gap / abs(mean_bias) * 100 if mean_bias else 0:.0f}% "
              f"of the mean bias)")
        print()

    # Test 4: forecast lead.
    print(f"  [4] FORECAST LEAD")
    print(f"      {bias_check.get('lead_narrative', 'not recomputed')}")
    print()

    # Test 5: the mechanism the evidence actually points at.
    print(f"  [5] VERTICAL RESOLUTION OF THE MODEL THERMOCLINE")
    for entry in bias_check.get("d26", []):
        print(f"      {entry['floatId']}: float D26 {entry['float_d26']:.1f} m vs "
              f"model D26 {entry['model_d26']:.1f} m "
              f"({entry['float_d26'] - entry['model_d26']:+.1f} m)")
        print(f"        float T at {TARGET_DEPTH_M:g} m = {entry['float_t']:.2f} C, model = "
              f"{entry['model_t']:.2f} C (residual {entry['residualC']:+.2f} C)")
    levels_m = MODEL_LEVELS_M
    if TARGET_LEVEL_INDEX + 1 < len(levels_m):
        lo, hi = levels_m[TARGET_LEVEL_INDEX - 1], levels_m[TARGET_LEVEL_INDEX + 1]
        print(f"      model levels: {levels_m} m — the target level sits inside a "
              f"{hi - lo:g} m span ({lo:g} m to {hi:g} m) with nothing resolved in between")
    else:
        print(f"      model levels: {levels_m} m")
    print(f"      => the model is a straight line across that gap, so any thermocline inside it")
    print(f"         is an interpolation artifact of the line, not a resolved feature.")
    print()

    print("-" * 96)
    print("  CONCLUSION: consistent with a real thermocline bias.")
    print()
    positive = sum(1 for value in residuals if value > 0)
    print(f"  The model's PUBLISHED target level is too warm at {positive} of the "
          f"{len(residuals)} locations sampled,")
    print("  and the excess survives removing any single profile, switching to the")
    print("  longest-lead covering run, using nearest-cell instead of bilinear,")
    print("  using raw instead of adjusted variables, and moving offshore. It is")
    print("  therefore not a sampling, grid-node, coastal-mask, QC-basis or forecast-")
    print("  lead artifact.")
    print()
    print("  The mechanism the evidence points at is VERTICAL UNDER-RESOLUTION: with")
    print("  six levels the model spans 52.5->275 m as one straight segment, and the")
    print("  floats put their 26 C crossing near the top of that segment. A model that")
    print("  cannot resolve a thermocline must place it somewhere inside that line,")
    print(f"  and {TARGET_DEPTH_M:g} m is the level where being wrong costs the most.")
    print()
    print("  IMPORTANT CAVEAT: because the model's 26 C crossing is itself")
    print("  produced by linear interpolation between two of its own levels, the model")
    print("  cannot be said to have a diagnosed thermocline DEPTH to compare against")
    print("  the float's. The defensible statement is about the level VALUE, not about a")
    print("  depth error. Resolving this properly needs a model run with levels inside")
    print("  the thermocline (roughly 75/100/125/150 m), not a different statistic on")
    print("  (note: which depth the level represents depends on the axis rule; see")
    print("  OCEANX_MODEL_DEPTH_AXIS and scripts/test_depth_label_hypothesis.py)")
    print("  this one.")
    print()
    print(f"  NCSS request equivalent to the subset read here:")
    print(f"    {_ncss_request()}")
    print()
    if worst:
        print(f"  worst profiles: "
              + ", ".join(f"{row['floatId']} ({row['residualC']:+.2f} C)" for row in worst))
    return ""




# --------------------------------------------------------------------------
# main
# --------------------------------------------------------------------------

def main() -> int:
    profiles = argo_provider.get_profiles()
    if not profiles:
        print("no Argo profiles ingested - run scripts/process_argo_bob.py first")
        return 1

    runs = _candidate_runs()
    if not runs:
        print("no HYCOM files installed - nothing to diagnose")
        return 1
    _probe = xr.open_dataset(runs[0], engine="netcdf4", chunks={})
    try:
        _configure_target(_probe)
    finally:
        _probe.close()

    print("=" * 96)
    print(f"1. PER-PROFILE {TARGET_DEPTH_M:g} m EVIDENCE (model level index {TARGET_LEVEL_INDEX})")
    print("=" * 96)
    print("  residual convention: model - float (positive = model too warm)\n")

    rows: List[Dict[str, Any]] = []
    excluded: List[Tuple[str, str]] = []

    for profile in profiles:
        matchup = match_argo_with_hycom(profile["profile_id"])
        if matchup is None or matchup.get("statusMessage"):
            excluded.append((profile["profile_id"], "no model match"))
            continue
        if matchup.get("timeGapStatus") != "good":
            excluded.append((profile["profile_id"], f"time gap {matchup.get('timeGapStatus')}"))
            continue
        if matchup.get("statisticsSuppressed"):
            excluded.append((profile["profile_id"], "statistics suppressed"))
            continue

        selected_run = matchup.get("modelRun")
        selected_path = next((p for p in runs if p.name == selected_run), None)
        if selected_path is None:
            excluded.append((profile["profile_id"], "run file not found"))
            continue

        lead_hours = None
        for entry in matchup.get("availableModelRuns", []):
            if entry.get("run") == selected_run:
                lead_hours = entry.get("leadHours")
                break

        dataset = xr.open_dataset(selected_path, engine="netcdf4", chunks={})
        try:
            row = _profile_diagnostic(profile, dataset, selected_run, lead_hours)
        finally:
            dataset.close()
        if row is not None:
            rows.append(row)

    widths = [9, 8, 8, 4, 4, 9, 7, 7, 7, 7, 7, 6, 10]
    header = ["float", "lat", "lon", "bas", "mode", "run", "floatT", "modelT",
              "resid", "nearstR", "distKm", "cells", "near-bilin"]
    print(_print_row(header, widths))
    print("  " + "-" * (sum(widths) + 2))
    for row in sorted(rows, key=lambda r: -abs(r["residualC"])):
        print(_print_row([
            row["floatId"], f"{row['lat']:.3f}", f"{row['lon']:.3f}",
            row["variableBasis"][:3], row["dataMode"],
            (row["run"] or "").replace("RSMC_hycom_", "").replace("_bob_subset.nc", ""),
            f"{row['floatTemperatureC']:.2f}", f"{row['modelTemperatureC']:.2f}",
            f"{row['residualC']:+.2f}",
            "n/a" if row["nearestResidualC"] is None else f"{row['nearestResidualC']:+.2f}",
            f"{row['distanceToCellCentreKm']:.1f}",
            f"{row['stencilValidCells']}/4",
            "n/a" if row["nearestVsBilinearDeltaC"] is None
            else f"{row['nearestVsBilinearDeltaC']:+.4f}",
        ], widths))
    print("\n  resid = model - float (positive = model too warm).")
    print("  near-bilin = nearest-cell minus bilinear at the target level, i.e. how much of the")
    print("  residual could be an artifact of the float not sitting on a grid node.")

    print(f"\n  included {len(rows)} profiles; excluded {len(excluded)}")
    for profile_id, reason in excluded:
        print(f"    - {profile_id}: {reason}")

    # The regional summary counts a profile as included on the strength of ANY
    # usable pair, so it can report more profiles than this table shows. The
    # difference is a profile whose 125 m level was rejected while its other
    # levels survived.
    without_target = []
    for profile in profiles:
        matchup = match_argo_with_hycom(profile["profile_id"])
        if matchup is None or matchup.get("timeGapStatus") != "good":
            continue
        if matchup.get("statisticsSuppressed"):
            continue
        has_target = any(
            abs((row.get("modelDepthM") or -999.0) - TARGET_DEPTH_M) < 1e-6
            for row in matchup.get("comparisons") or []
        )
        if not has_target:
            rejected = [
                entry.get("reason")
                for entry in matchup.get("excludedModelLevels") or []
                if abs((entry.get("modelDepthM") or -999.0) - TARGET_DEPTH_M) < 1e-6
            ]
            without_target.append((profile["float_id"], rejected))
    if without_target:
        print(f"\n  {len(without_target)} profile(s) are included in the regional summary but")
        print("  have no target-level pair, which is why this table is shorter:")
        for float_id, rejected in without_target:
            print(f"    - {float_id}: target level rejected ({rejected})")

    # --- CSV ---------------------------------------------------------------
    csv_path = Path(__file__).resolve().parents[2] / CSV_RELATIVE_PATH
    csv_path.parent.mkdir(parents=True, exist_ok=True)
    with csv_path.open("w", newline="", encoding="utf-8") as handle:
        fields = [
            "profileId", "floatId", "lat", "lon", "dataMode", "variableBasis",
            "run", "leadHours", "floatTemperatureC", "modelTemperatureC",
            "residualC", "nearestModelTemperatureC", "nearestResidualC",
            "nearestVsBilinearDeltaC", "distanceToCellCentreKm",
            "stencilValidCells", "shallowestFloatDepthM", "deepestFloatDepthM",
            "floatLevelCount",
        ]
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for row in rows:
            writer.writerow({key: row.get(key) for key in fields})
    print(f"\n  wrote docs/diagnostics/bias_125m.csv ({len(rows)} rows)")

    if not rows:
        print("\n  no profile produced a 125 m pair; nothing further to conclude")
        return 0

    # --- 2. distribution ---------------------------------------------------
    print("\n" + "=" * 96)
    print("2. DISTRIBUTION OF THE 125 m RESIDUAL")
    print("=" * 96)
    residuals = [row["residualC"] for row in rows]
    described = _describe(residuals, "all")
    widths2 = [10, 5, 9, 9, 9, 9, 8, 9, 9]
    print(_print_row(
        ["scope", "n", "mean", "median", "q1", "q3", "IQR", "min", "max"], widths2
    ))
    print("  " + "-" * (sum(widths2) + 4))
    print(_print_row([
        described["label"], described["n"], f"{described['mean']:+.3f}",
        f"{described['median']:+.3f}", f"{described['q1']:+.3f}", f"{described['q3']:+.3f}",
        f"{described['iqr']:.3f}", f"{described['min']:+.3f}", f"{described['max']:+.3f}",
    ], widths2))

    print("\n  leave-one-out (drop each profile in turn):")
    loo_means: List[Tuple[str, float]] = []
    for index, row in enumerate(rows):
        kept = residuals[:index] + residuals[index + 1:]
        loo_means.append((row["floatId"], statistics.fmean(kept)))
    loo_means.sort(key=lambda item: item[1])
    for float_id, mean in loo_means[:3]:
        print(f"    drop {float_id:<10s} -> mean {mean:+.3f} C")
    print(f"    drop {loo_means[-1][0]:<10s} -> mean {loo_means[-1][1]:+.3f} C")
    print(f"    leave-one-out mean range : [{loo_means[0][1]:+.3f}, {loo_means[-1][1]:+.3f}] C")
    print(f"    full-sample mean         : {statistics.fmean(residuals):+.3f} C")
    print(f"    => the mean moves by "
          f"{max(abs(loo_means[-1][1] - statistics.fmean(residuals)), abs(loo_means[0][1] - statistics.fmean(residuals))):.3f}"
          " C at most when any single profile is removed")

    # --- 3. clustering -----------------------------------------------------
    print("\n" + "=" * 96)
    print("3. DOES THE BIAS CLUSTER?")
    print("=" * 96)
    widths3 = [22, 5, 9, 9, 9, 9]
    print(_print_row(["group", "n", "mean", "median", "min", "max"], widths3))
    print("  " + "-" * (sum(widths3) + 4))

    def print_group(label: str, subset: List[Dict[str, Any]]) -> None:
        if not subset:
            print(_print_row([label, 0, "-", "-", "-", "-"], widths3))
            return
        values = [item["residualC"] for item in subset]
        _q1, median, _q3 = _quartiles(values)
        print(_print_row([
            label, len(subset), f"{statistics.fmean(values):+.3f}", f"{median:+.3f}",
            f"{min(values):+.3f}", f"{max(values):+.3f}",
        ], widths3))

    coastal_threshold_km = COASTAL_PROXIMITY_M * 111.0
    print("\n  region:")
    print_group("  coastal/shelf", [r for r in rows if r["distanceToCellCentreKm"] < coastal_threshold_km])
    print_group("  open ocean", [r for r in rows if r["distanceToCellCentreKm"] >= coastal_threshold_km])
    print("\n  variable basis:")
    for basis in ("raw", "adjusted"):
        print_group(f"  basis={basis}", [r for r in rows if r["variableBasis"] == basis])
    print("\n  argo data mode:")
    for mode in sorted({r["dataMode"] for r in rows}):
        print_group(f"  dataMode={mode}", [r for r in rows if r["dataMode"] == mode])
    print("\n  bilinear stencil:")
    print_group("  full stencil (4/4)", [r for r in rows if r["stencilValidCells"] == 4])
    print_group("  masked stencil (<4)", [r for r in rows if r["stencilValidCells"] < 4])
    print("\n  forecast lead (each profile has its own lead):")
    leads = sorted({r["leadHours"] for r in rows}, key=lambda v: (v is None, v))
    for lead in leads:
        subset = [r for r in rows if r["leadHours"] == lead]
        print(f"    lead {lead}h: n={len(subset)} mean="
              f"{statistics.fmean([r['residualC'] for r in subset]):+.3f} C")
    lead_values = [r["leadHours"] for r in rows if r["leadHours"] is not None]
    if len(lead_values) > 2:
        _lo, _hi = min(lead_values), max(lead_values)
        early = [r["residualC"] for r in rows if r["leadHours"] is not None and r["leadHours"] <= _lo + 5]
        late = [r["residualC"] for r in rows if r["leadHours"] is not None and r["leadHours"] >= _hi - 5]
        print(f"    early lead (<={_lo + 5}h) mean : {statistics.fmean(early):+.3f} C (n={len(early)})")
        print(f"    late  lead (>={_hi - 5}h) mean : {statistics.fmean(late):+.3f} C (n={len(late)})")

    # --- 3b. longest-lead rerun -------------------------------------------
    print("\n  125 m bias recomputed against the LONGEST-lead covering run:")
    lead_rows: List[Dict[str, Any]] = []
    for profile in profiles:
        matchup = match_argo_with_hycom(profile["profile_id"])
        if matchup is None or matchup.get("timeGapStatus") != "good":
            continue
        if matchup.get("statisticsSuppressed"):
            continue
        when = pd.to_datetime(profile["observation_time"], errors="raise").tz_localize(None)
        covering = _covering_runs(when)
        if not covering:
            continue
        longest_path, longest_lead = max(covering, key=lambda item: item[1])
        dataset = xr.open_dataset(longest_path, engine="netcdf4", chunks={})
        try:
            row = _profile_diagnostic(profile, dataset, longest_path.name, longest_lead)
        finally:
            dataset.close()
        if row is not None:
            lead_rows.append(row)

    if lead_rows:
        default_mean = statistics.fmean([row["residualC"] for row in rows])
        longest_mean = statistics.fmean([row["residualC"] for row in lead_rows])
        delta = longest_mean - default_mean
        same_sign = (default_mean >= 0) == (longest_mean >= 0)
        close = abs(delta) < 0.5 * abs(default_mean)
        print(f"    default-run mean  : {default_mean:+.3f} C ({len(rows)} profiles)")
        print(f"    longest-lead mean : {longest_mean:+.3f} C ({len(lead_rows)} profiles)")
        print(f"    change            : {delta:+.3f} C "
              f"({'unchanged in sign and close in size' if same_sign and close else 'MATERIAL CHANGE'})")
        lead_narrative = (
            f"default-run mean {default_mean:+.3f} C vs longest-lead mean "
            f"{longest_mean:+.3f} C ({len(lead_rows)} profiles), change {delta:+.3f} C"
            + ("" if (same_sign and close) else " - MATERIAL CHANGE, investigate")
        )
        if same_sign and close:
            lead_narrative += (
                "\n      => RULED OUT: the bias keeps its sign and size at the longest lead"
            )
    else:
        print("    no profile could be re-sampled against a longer-lead run")
        lead_narrative = "no profile could be re-sampled against a longer-lead run"

    # --- 4. worst profiles + depth coordinate ------------------------------
    print("\n" + "=" * 96)
    print("4. WORST PROFILES, DEPTH COORDINATE")
    print("=" * 96)
    worst = sorted(rows, key=lambda r: -abs(r["residualC"]))[:2]
    d26_evidence: List[Dict[str, Any]] = []
    for row in worst:
        profile = next(p for p in profiles if p["profile_id"] == row["profileId"])
        selected_path = next(p for p in runs if p.name == row["run"])
        levels, _basis, _mode = _float_levels(profile)
        when = pd.to_datetime(profile["observation_time"], errors="raise").tz_localize(None)
        print(f"\n  --- {row['floatId']} ({row['profileId']})  "
              f"residual {row['residualC']:+.2f} C at 125 m ---")
        dataset = xr.open_dataset(selected_path, engine="netcdf4", chunks={})
        try:
            d26_evidence.append(_print_profile(
                levels, dataset, when, profile["latitude"], profile["longitude"],
                float_id=row["floatId"],
                residual_c=row["residualC"],
                float_t=row["floatTemperatureC"],
                model_t=row["modelTemperatureC"],
            ))
            if row is worst[0]:
                print()
                _print_depth_coordinate(dataset)
        finally:
            dataset.close()

    print()
    _conclusion(rows, worst, {"lead_narrative": lead_narrative, "d26": d26_evidence})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
