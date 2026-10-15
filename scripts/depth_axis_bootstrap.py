#!/usr/bin/env python3
"""Paired bootstrap over profiles for the depth-axis sensitivity comparison.

scripts/depth_axis_sensitivity.py reports a single RMSE per axis and leaves the
question "how sure are we?" unanswered: with 19 profiles a 4.07 C gap between
two depth axes looks decisive and is not. This script quantifies the uncertainty
without changing any of it.

What is bootstrapped
--------------------
The unit of resampling is the PROFILE, and the resampling is PAIRED: one draw of
profile indices is applied to both axes at once, so a resampled difference is
always computed from the same set of floats under both definitions. Resampling
the two axes independently would let the difference absorb profile-to-profile
variation (different floats sampled, different thermocline depths) that has
nothing to do with the axis, and would inflate the interval for free.

Levels are paired BY INDEX, not by absolute depth. "native" and "ncss_file"
describe the same six vertical layers with different node labels
(native 100 m == ncss_file 125 m); pairing by metres would compare the 100 m
layer against the 125 m layer and report a disagreement that is not about the
axis at all.

What this does NOT establish
----------------------------
A narrow interval says the two axes are reliably different on THESE 19 profiles
over THESE 6 days. It says nothing about which axis is physically correct. That
is a separate question requiring the producer's metadata, not a resampling of
the same small sample.

Usage:
    python scripts/depth_axis_bootstrap.py
"""

from __future__ import annotations

import csv
import math
import os
import random
import sys
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

# Ensure backend package is on sys.path
REPO_ROOT = Path(__file__).resolve().parents[1]
BACKEND_DIR = REPO_ROOT / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.api.endpoints import get_argo_matchup_summary, match_argo_with_hycom
from app.core.config import settings

OUTPUT_CSV = REPO_ROOT / "results" / "depth_axis_bootstrap.csv"

AXES = ("ncss_file", "native")
VARIABLES = ("temperature", "salinity")
RESIDUAL_FIELDS = {
    "temperature": "_temperatureResidualRaw",
    "salinity": "_salinityResidualRaw",
}

# Fixed so two runs of this script produce byte-identical output.
RESAMPLES = 10_000
SEED = 20261008

HEADER_LINE = (
    "BOOTSTRAP OVER PROFILES. Small n; not evidence of which depth definition is correct."
)


# ---------------------------------------------------------------------------
# Depth-axis switching. Same set/restore contract as
# scripts/depth_axis_sensitivity.run_evaluation_for_axis, so the default axis and
# the environment are left exactly as they were found.
# ---------------------------------------------------------------------------
@contextmanager
def depth_axis(axis_name: str):
    """Temporarily evaluate under one depth axis, restoring the original state."""
    old_axis = settings.MODEL_DEPTH_AXIS
    old_env = os.environ.get("OCEANX_MODEL_DEPTH_AXIS")
    try:
        settings.MODEL_DEPTH_AXIS = axis_name
        os.environ["OCEANX_MODEL_DEPTH_AXIS"] = axis_name
        yield
    finally:
        settings.MODEL_DEPTH_AXIS = old_axis
        if old_env is None:
            os.environ.pop("OCEANX_MODEL_DEPTH_AXIS", None)
        else:
            os.environ["OCEANX_MODEL_DEPTH_AXIS"] = old_env


def _finite(value: Any) -> Optional[float]:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value) if math.isfinite(value) else None
    return None


def included_profile_ids(axis_name: str) -> List[str]:
    """Profiles the real pipeline admits under this axis.

    Taken from the endpoint's own output rather than re-derived, so the
    bootstrap resamples exactly the population the published RMSE was computed
    over and cannot silently drift from the inclusion rules.
    """
    with depth_axis(axis_name):
        summary = get_argo_matchup_summary()
    return [row["profileId"] for row in summary["profiles"]]


def axis_depths(axis_name: str, profile_ids: Sequence[str]) -> List[float]:
    """The axis's own depth labels, taken from the matchup output."""
    with depth_axis(axis_name):
        for profile_id in profile_ids:
            matchup = match_argo_with_hycom(profile_id)
            if matchup:
                depths = matchup.get("modelDepths") or []
                if depths:
                    return [float(d) for d in depths]
    return []


def per_profile_residuals(
    axis_name: str, profile_ids: Sequence[str], variable: str
) -> Dict[str, Dict[int, float]]:
    """{profile_id: {level_index: residual}} for one variable under one axis.

    The pipeline emits one comparison row per (profile, model level), so each
    profile contributes exactly one residual per level and the level's residual
    list is a genuine sample of independent floats.
    """
    field = RESIDUAL_FIELDS[variable]
    out: Dict[str, Dict[int, float]] = {}
    with depth_axis(axis_name):
        for profile_id in profile_ids:
            matchup = match_argo_with_hycom(profile_id)
            if not matchup:
                continue
            depths = [float(d) for d in (matchup.get("modelDepths") or [])]
            index_of = {round(d, 4): i for i, d in enumerate(depths)}
            row: Dict[int, float] = {}
            for comparison in matchup.get("comparisons") or []:
                residual = _finite(comparison.get(field))
                if residual is None:
                    continue
                depth = _finite(comparison.get("modelDepthM", comparison.get("depthM")))
                if depth is None:
                    continue
                index = index_of.get(round(depth, 4))
                if index is not None:
                    row[index] = residual
            out[profile_id] = row
    return out


def paired_residuals(
    left: Dict[str, Dict[int, float]], right: Dict[str, Dict[int, float]], level: int
) -> Tuple[List[Tuple[float, float]], List[str]]:
    """Residual pairs at one level, over profiles present under BOTH axes.

    Returns the pairs plus the profile ids, so n beside a row is the number of
    floats that actually carry an error under both definitions.
    """
    ids = sorted(set(left) & set(right))
    pairs: List[Tuple[float, float]] = []
    used: List[str] = []
    for profile_id in ids:
        a = left[profile_id].get(level)
        b = right[profile_id].get(level)
        if a is None or b is None:
            continue
        pairs.append((a, b))
        used.append(profile_id)
    return pairs, used


def rmse(values: Sequence[float]) -> Optional[float]:
    if not values:
        return None
    return math.sqrt(sum(v * v for v in values) / len(values))


def percentile(sorted_values: Sequence[float], pct: float) -> Optional[float]:
    """Linear-interpolation percentile (numpy/'linear' method)."""
    if not sorted_values:
        return None
    k = (len(sorted_values) - 1) * (pct / 100.0)
    low = math.floor(k)
    high = math.ceil(k)
    if low == high:
        return sorted_values[int(k)]
    return sorted_values[low] * (high - k) + sorted_values[high] * (k - low)


def bootstrap_difference(
    left_sq: Sequence[float],
    right_sq: Sequence[float],
    resamples: int = RESAMPLES,
    seed: int = SEED,
) -> Tuple[Optional[float], Optional[float], Optional[float]]:
    """Paired bootstrap of RMSE(left) - RMSE(right) over squared errors.

    ``left_sq`` / ``right_sq`` are per-profile SQUARED errors already aligned
    profile-for-profile. Each resample draws one set of indices and applies it to
    both sides, which is what makes the difference paired. The same index set is
    redrawn for every resample, so the only thing that varies between resamples
    is which profiles were drawn.

    Returns (mean_difference, ci_low, ci_high) where the mean is the observed
    difference on the full sample and the interval is the 2.5/97.5 percentile
    range of the resampled differences.
    """
    n = len(left_sq)
    if n == 0 or len(right_sq) != n:
        return None, None, None

    mean_difference = math.sqrt(sum(left_sq) / n) - math.sqrt(sum(right_sq) / n)

    rng = random.Random(seed)
    diffs: List[float] = []
    for _ in range(resamples):
        left_sum = 0.0
        right_sum = 0.0
        for _ in range(n):
            i = rng.randrange(n)
            left_sum += left_sq[i]
            right_sum += right_sq[i]
        diffs.append(math.sqrt(left_sum / n) - math.sqrt(right_sum / n))
    diffs.sort()
    return mean_difference, percentile(diffs, 2.5), percentile(diffs, 97.5)


def analyse(
    left: Dict[str, Dict[int, float]], right: Dict[str, Dict[int, float]], level_count: int
) -> List[Dict[str, Any]]:
    """One result row per (level, variable)."""
    rows: List[Dict[str, Any]] = []
    for variable in VARIABLES:
        for level in range(level_count):
            pairs, profile_ids = paired_residuals(left[variable], right[variable], level)
            left_sq = [a * a for a, _ in pairs]
            right_sq = [b * b for _, b in pairs]
            mean_diff, ci_low, ci_high = bootstrap_difference(left_sq, right_sq)
            native_better = sum(1 for _, b in pairs if abs(b) < abs(_))
            rows.append({
                "level": level,
                "variable": variable,
                "n": len(pairs),
                "rmse_ncss": rmse([a for a, _ in pairs]),
                "rmse_native": rmse([b for _, b in pairs]),
                "diff_mean": mean_diff,
                "ci_low": ci_low,
                "ci_high": ci_high,
                "n_native_better": native_better,
                "profile_ids": profile_ids,
            })
    return rows


def build_csv_rows(results: Sequence[Dict[str, Any]], native_depths: Sequence[float]) -> List[Dict[str, Any]]:
    """CSV rows keyed on the NATIVE depth label, which is the level readers quote."""
    return [{
        "level": f"{native_depths[row['level']]:g}" if row["level"] < len(native_depths) else str(row["level"]),
        "variable": row["variable"],
        "n": row["n"],
        "rmse_ncss": None if row["rmse_ncss"] is None else round(row["rmse_ncss"], 4),
        "rmse_native": None if row["rmse_native"] is None else round(row["rmse_native"], 4),
        "diff_mean": None if row["diff_mean"] is None else round(row["diff_mean"], 4),
        "ci_low": None if row["ci_low"] is None else round(row["ci_low"], 4),
        "ci_high": None if row["ci_high"] is None else round(row["ci_high"], 4),
        "n_native_better": row["n_native_better"],
    } for row in results]


def fmt(value: Optional[float], digits: int = 3) -> str:
    return f"{value:.{digits}f}" if isinstance(value, float) else "N/A"


def print_table(
    results: Sequence[Dict[str, Any]],
    native_depths: Sequence[float],
    ncss_depths: Sequence[float],
) -> None:
    print(HEADER_LINE)
    print()
    print(f"Paired bootstrap, {RESAMPLES} resamples, seed {SEED}. "
          f"Unit of resampling: profile. Positive diff favours native.")
    print()
    print("| Level (native / ncss_file) | Variable | n | RMSE ncss_file | RMSE native | "
          "Diff (ncss-native) | 95% CI | native better |")
    print("| :--- | :--- | ---: | ---: | ---: | ---: | :--- | ---: |")
    for row in results:
        level = row["level"]
        label = (
            f"{native_depths[level]:g} m / {ncss_depths[level]:g} m"
            if level < len(native_depths) and level < len(ncss_depths)
            else str(level)
        )
        ci = f"[{fmt(row['ci_low'])}, {fmt(row['ci_high'])}]"
        print(
            f"| {label} | {row['variable'].capitalize()} | {row['n']} | "
            f"{fmt(row['rmse_ncss'])} | {fmt(row['rmse_native'])} | "
            f"{fmt(row['diff_mean'])} | {ci} | {row['n_native_better']}/{row['n']} |"
        )


def main() -> None:
    profile_ids = included_profile_ids(AXES[0])
    native_depths = axis_depths("native", profile_ids)
    ncss_depths = axis_depths("ncss_file", profile_ids)
    level_count = max(len(native_depths), len(ncss_depths))

    residuals = {
        axis: {v: per_profile_residuals(axis, profile_ids, v) for v in VARIABLES}
        for axis in AXES
    }
    results = analyse(
        {"temperature": residuals["ncss_file"]["temperature"],
         "salinity": residuals["ncss_file"]["salinity"]},
        {"temperature": residuals["native"]["temperature"],
         "salinity": residuals["native"]["salinity"]},
        level_count,
    )

    print_table(results, native_depths, ncss_depths)

    # The headline comparison, spelled out per profile.
    headline = next(
        (r for r in results
         if r["variable"] == "temperature" and r["level"] < len(native_depths)
         and abs(native_depths[r["level"]] - 100.0) < 1e-9),
        None,
    )
    if headline:
        print()
        print(f"--- 100 m (native) / {ncss_depths[headline['level']]:g} m (ncss_file), "
              f"temperature, n = {headline['n']} ---")
        print(f"diff = {fmt(headline['diff_mean'])} C, "
              f"95% CI [{fmt(headline['ci_low'])}, {fmt(headline['ci_high'])}] C, "
              f"native better on {headline['n_native_better']}/{headline['n']} profiles")
        left = residuals["ncss_file"]["temperature"]
        right = residuals["native"]["temperature"]
        pairs, used = paired_residuals(left, right, headline["level"])
        print()
        print("| Profile | ncss_file resid | native resid | squared err ncss | squared err native | native better |")
        print("| :--- | ---: | ---: | ---: | ---: | :---: |")
        for profile_id, (a, b) in zip(used, pairs):
            print(f"| {profile_id} | {a:+.3f} | {b:+.3f} | {a * a:.3f} | {b * b:.3f} | "
                  f"{'yes' if abs(b) < abs(a) else 'no'} |")

    OUTPUT_CSV.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = ["level", "variable", "n", "rmse_ncss", "rmse_native",
                  "diff_mean", "ci_low", "ci_high", "n_native_better"]
    with open(OUTPUT_CSV, mode="w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(build_csv_rows(results, native_depths))
    print()
    print(f"Wrote {OUTPUT_CSV}")


if __name__ == "__main__":
    main()