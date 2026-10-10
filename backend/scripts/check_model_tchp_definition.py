#!/usr/bin/env python
"""Is the model's TCHP field consistent with its OWN 6-level TEMP profile?

Task 2 compared float-derived TCHP with the model's TCHP field and found the
model 37.5% higher. That comparison cannot be interpreted until we know whether
the model's TCHP field is even computed the way this script computes it. If
INCOIS derived TCHP from the same 6 levels using the same 26 C isotherm and the
same constant rho/cp, then integrating the model's own TEMP column should
reproduce the TCHP field closely. If it does not, the difference tells us the
definition differs, and any float-vs-model TCHP residual is confounded.

This script computes, per profile, at the matched location and time:

  * ``coarse TCHP`` - TCHP integrated from the model's OWN 6-level TEMP column,
    using the same ``ocean_heat_metrics.compute_ocean_heat_metrics`` used for
    the float, so the only difference between the two numbers is WHICH profile
    was integrated, not how it was integrated.
  * ``model TCHP``  - the value of the model's 2D TCHP field.

and reports the difference, RMSE, correlation, and the count above/below.

One deliberate deviation from the float-side rules, stated up front
------------------------------------------------------------------
``compute_ocean_heat_metrics`` refuses to integrate across a sampling gap wider
than ``METRICS_MAX_GAP_M`` (25 m). The model's column is spaced 17.5, 35, 72.5,
150 and 225 m, so EVERY model profile would be refused and the comparison would
be empty. The coarse TCHP therefore passes ``max_gap_m`` explicitly, set to
unbounded, because the point of this diagnostic is to ask what the model's own
sparse column integrates to - refusing it would answer nothing.

The consequence must be kept in mind when reading the result: the coarse TCHP
is a trapezoid through a straight-line approximation of the thermocline, so it
is a deliberately coarse quantity. A disagreement with the TCHP field may
reflect either a different formula OR the coarse integration, and this script
does not attempt to separate the two. It reports the size of the gap and lets
the reader judge.

Usage
-----
    cd backend && python scripts/check_model_tchp_definition.py
"""

from __future__ import annotations

import math
import statistics
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd
import xarray as xr

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import settings  # noqa: E402
from app.providers.argo_provider import argo_provider  # noqa: E402
from app.services.matchup_interpolation import (  # noqa: E402
    bilinear_stencil,
    time_bracket_weights,
    weighted_cells,
    weighted_time_slices,
)
from app.services.model_observation_matchup import (  # noqa: E402
    _extract_model_profiles,
    match_argo_with_hycom,
)
from app.services.ocean_heat_metrics import (  # noqa: E402
    compute_ocean_heat_metrics,
)

# Unbounded gap for the model's own sparse column - see the module docstring.
COARSE_MAX_GAP_M = 10_000.0


def _candidate_runs() -> List[Path]:
    override = Path(settings.HYCOM_RAW_CANDIDATES[0]) if settings.HYCOM_RAW_CANDIDATES else None
    if override is not None and override.is_file():
        return [p for p in settings.HYCOM_RAW_CANDIDATES if p.is_file()]
    return []


def _model_temp_column(
    dataset: xr.Dataset,
    profile: Dict[str, Any],
    spatial_mode: str = "bilinear",
) -> Optional[List[Dict[str, Any]]]:
    """The model's own TEMP column as ``[{depth_m, temperature_c}, ...]``."""
    when = pd.to_datetime(profile["observation_time"], errors="raise").tz_localize(None)
    extracted = _extract_model_profiles(
        dataset, profile["latitude"], profile["longitude"], when, spatial_mode
    )
    if extracted is None:
        return None
    depths = np.atleast_1d(extracted["depths"]).astype(float)
    temps = np.atleast_1d(extracted["temp"]).astype(float)
    column = []
    for depth, temperature in zip(depths, temps):
        # The model's TEMP carries no units attribute upstream, but it is a
        # temperature in degrees Celsius (long_name "TEMP", and the values match
        # the float's range). Only finite cells enter the integral.
        if np.isfinite(temperature):
            column.append({"depth_m": float(depth), "temperature_c": float(temperature)})
    return column or None


def _model_tchp_value(dataset: xr.Dataset, profile: Dict[str, Any]) -> Optional[float]:
    """The model's 2D TCHP field at the matched location and time."""
    when = pd.to_datetime(profile["observation_time"], errors="raise").tz_localize(None)
    lats = np.atleast_1d(dataset["LAT"].values)
    lons = np.atleast_1d(dataset["LON"].values)
    stencil = bilinear_stencil(lats, lons, profile["latitude"], profile["longitude"])
    brackets = time_bracket_weights(np.atleast_1d(dataset["TIME"].values), when)
    if not stencil or not brackets:
        return None

    per_bracket: List[List[np.ndarray]] = []
    for time_index, _weight in brackets:
        per_stencil: List[np.ndarray] = []
        for lat_index, lon_index, _cell_weight in stencil:
            cell = dataset.isel(TIME=time_index, LAT=lat_index, LON=lon_index)
            if "TCHP" not in cell:
                return None
            per_stencil.append(np.atleast_1d(cell["TCHP"].values).astype(float))
        per_bracket.append(per_stencil)

    cell_blends = [
        weighted_cells(per_stencil, stencil, min_valid_cells=2) for per_stencil in per_bracket
    ]
    if any(entry is None for entry in cell_blends):
        return None
    weights = [1.0] if len(brackets) == 1 else [w for _i, w in brackets]
    blended = weighted_time_slices(
        [e for e in cell_blends if e is not None], weights
    )
    if blended is None:
        return None
    array = np.atleast_1d(blended)
    return float(array[0]) if array.size and np.isfinite(array[0]) else None


def main() -> int:
    profiles = argo_provider.get_profiles()
    runs = _candidate_runs()
    if not profiles or not runs:
        print("need both ingested Argo profiles and an installed model run")
        return 1

    print("=" * 100)
    print("MODEL TCHP FIELD vs TCHP INTEGRATED FROM THE MODEL'S OWN 6-LEVEL TEMP COLUMN")
    print("=" * 100)
    print("  both numbers use the same ocean_heat_metrics code and the same 26 C isotherm;")
    print("  only the input profile differs. Units kJ/cm2.\n")

    rows: List[Dict[str, Any]] = []
    skipped: List[str] = []

    for profile in profiles:
        matchup = match_argo_with_hycom(profile["profile_id"])
        if matchup is None or matchup.get("statusMessage"):
            continue
        if matchup.get("timeGapStatus") != "good":
            continue
        run_name = matchup.get("modelRun")
        path = next((p for p in runs if p.name == run_name), None)
        if path is None:
            continue

        dataset = xr.open_dataset(path, engine="netcdf4", chunks={})
        try:
            column = _model_temp_column(dataset, profile)
            model_tchp = _model_tchp_value(dataset, profile)
        finally:
            dataset.close()

        if column is None or model_tchp is None:
            skipped.append(f"{profile['float_id']}: no model column or no TCHP value")
            continue

        coarse = compute_ocean_heat_metrics(column, max_gap_m=COARSE_MAX_GAP_M)
        # The float side, from the same matchup, so the like-for-like comparison
        # below runs ONE algorithm over two temperature profiles.
        float_tchp = matchup.get("tchpFloatKjCm2")
        residual_125 = next(
            (
                row.get("_temperatureResidualRaw")
                for row in matchup.get("comparisons") or []
                if abs((row.get("modelDepthM") or -999.0) - 125.0) < 1e-9
            ),
            None,
        )
        rows.append({
            "floatId": profile["float_id"],
            "floatTchpKjCm2": float_tchp,
            "residual125C": residual_125,
            "profileId": profile["profile_id"],
            "lat": round(profile["latitude"], 3),
            "lon": round(profile["longitude"], 3),
            "run": run_name,
            "modelLevelsM": [level["depth_m"] for level in column],
            "coarseTchpKjCm2": coarse["tchpKjCm2"],
            "coarseD26M": coarse["d26M"],
            "coarseStatus": coarse["status"],
            "modelTchpKjCm2": round(model_tchp, 4),
            "differenceKjCm2": (
                round(model_tchp - coarse["tchpKjCm2"], 4)
                if coarse["tchpKjCm2"] is not None else None
            ),
        })

    if not rows:
        print("  no profile produced both a coarse TCHP and a model TCHP value")
        return 0

    widths = [9, 8, 8, 9, 10, 10, 11, 9]
    print(_row(["float", "lat", "lon", "coarseD26", "coarseTCHP", "modelTCHP", "difference", "%diff"], widths))
    print("  " + "-" * (sum(widths) + 2))
    for row in sorted(rows, key=lambda r: -(r["differenceKjCm2"] or 0)):
        coarse = row["coarseTchpKjCm2"]
        diff = row["differenceKjCm2"]
        pct = (
            f"{diff / coarse * 100:+.1f}%"
            if (coarse not in (None, 0) and diff is not None) else "n/a"
        )
        print(_row([
            row["floatId"], f"{row['lat']:.3f}", f"{row['lon']:.3f}",
            f"{row['coarseD26M']:.1f}" if row["coarseD26M"] is not None else "-",
            f"{coarse:.1f}" if coarse is not None else "none",
            f"{row['modelTchpKjCm2']:.1f}",
            f"{diff:+.1f}" if diff is not None else "none",
            pct,
        ], widths))

    usable = [r for r in rows if r["coarseTchpKjCm2"] is not None
              and r["differenceKjCm2"] is not None]
    print()
    print(f"  profiles compared: {len(usable)} of {len(rows)}"
          + (f"  ({len(rows) - len(usable)} refused by the coarse integral)"
             if len(rows) != len(usable) else ""))
    for note in skipped:
        print(f"    skipped {note}")
    if not usable:
        print("  every coarse integral was refused; nothing to compare")
        return 0

    coarse_values = [r["coarseTchpKjCm2"] for r in usable]
    field_values = [r["modelTchpKjCm2"] for r in usable]
    diffs = [r["differenceKjCm2"] for r in usable]

    n = len(diffs)
    mean_coarse = statistics.fmean(coarse_values)
    mean_field = statistics.fmean(field_values)
    mean_diff = statistics.fmean(diffs)
    rmse = math.sqrt(sum(d * d for d in diffs) / n)
    mae = statistics.fmean([abs(d) for d in diffs])
    above = sum(1 for d in diffs if d > 0)
    below = sum(1 for d in diffs if d < 0)

    sxx = sum((v - mean_coarse) ** 2 for v in coarse_values)
    syy = sum((v - mean_field) ** 2 for v in field_values)
    sxy = sum((coarse_values[i] - mean_coarse) * (field_values[i] - mean_field)
              for i in range(n))
    correlation = sxy / math.sqrt(sxx * syy) if sxx > 0 and syy > 0 else float("nan")

    print()
    print("=" * 100)
    print("SUMMARY")
    print("=" * 100)
    print(f"  mean coarse TCHP (from model TEMP) : {mean_coarse:>10.2f} kJ/cm2")
    print(f"  mean model TCHP field              : {mean_field:>10.2f} kJ/cm2")
    print(f"  mean difference (field - coarse)   : {mean_diff:>+10.2f} kJ/cm2 "
          f"({mean_diff / mean_coarse * 100:+.1f}% of the coarse mean)")
    print(f"  median difference                  : {statistics.median(diffs):>+10.2f} kJ/cm2")
    print(f"  MAE / RMSE                         : {mae:.2f} / {rmse:.2f} kJ/cm2")
    print(f"  correlation coarse vs field        : r = {correlation:.4f}")
    print(f"  field ABOVE the coarse integral    : {above}/{n}")
    print(f"  field BELOW the coarse integral    : {below}/{n}")
    print(f"  min / max difference               : {min(diffs):+.2f} / {max(diffs):+.2f} kJ/cm2")

    # --- decomposition ------------------------------------------------------
    # The gap between the model's TCHP FIELD and the float is the number a
    # reader cares about, but it mixes two different things: the TCHP field not
    # being reproducible from the model's own column, and the model's column
    # genuinely holding more heat than the float measured. Splitting them is the
    # point of this diagnostic.
    like_for_like = [
        row for row in rows
        if row["coarseTchpKjCm2"] is not None
        and row["floatTchpKjCm2"] is not None
    ]
    if like_for_like:
        coarse_minus_float = [r["coarseTchpKjCm2"] - r["floatTchpKjCm2"] for r in like_for_like]
        field_minus_float = [r["modelTchpKjCm2"] - r["floatTchpKjCm2"] for r in like_for_like]
        count = len(like_for_like)
        print()
        print("=" * 100)
        print("DECOMPOSITION OF THE MODEL-vs-FLOAT HEAT GAP (kJ/cm2)")
        print("=" * 100)
        print(f"{'':22} {'mean':>9} {'median':>9} {'RMSE':>9} {'model higher':>14}")
        print(f"  {'field - float':20} {statistics.fmean(field_minus_float):>+9.2f} "
              f"{statistics.median(field_minus_float):>+9.2f} "
              f"{math.sqrt(sum(v * v for v in field_minus_float) / count):>9.2f} "
              f"{sum(1 for v in field_minus_float if v > 0):>9}/{count}")
        print(f"  {'field - coarse':20} {mean_diff:>+9.2f} "
              f"{statistics.median(diffs):>+9.2f} {rmse:>9.2f} {above:>9}/{n}")
        print(f"  {'coarse - float':20} {statistics.fmean(coarse_minus_float):>+9.2f} "
              f"{statistics.median(coarse_minus_float):>+9.2f} "
              f"{math.sqrt(sum(v * v for v in coarse_minus_float) / count):>9.2f} "
              f"{sum(1 for v in coarse_minus_float if v > 0):>9}/{count}")
        print()
        print("  field - float is the headline number, and it is the SUM of the other two.")
        print("  The middle row is NOT model error: it is the TCHP field disagreeing with the")
        print("  model's own temperature column under the identical algorithm.")
        pairs_125 = [
            (r["residual125C"], r["coarseTchpKjCm2"] - r["floatTchpKjCm2"])
            for r in like_for_like if r["residual125C"] is not None
        ]
        if len(pairs_125) > 2:
            a = [x for x, _ in pairs_125]
            b = [y for _, y in pairs_125]
            ma, mb = statistics.fmean(a), statistics.fmean(b)
            num = sum((a[i] - ma) * (b[i] - mb) for i in range(len(a)))
            den = math.sqrt(sum(v * v for v in a) * sum(v * v for v in b))
            print(f"  correlation(125 m residual, coarse - float) = r = {num / den:+.4f} (n={len(a)})")
    return 0


def _row(cells: List[str], widths: List[int]) -> str:
    return "  " + "".join(str(c).ljust(w) for c, w in zip(cells, widths))


if __name__ == "__main__":
    raise SystemExit(main())