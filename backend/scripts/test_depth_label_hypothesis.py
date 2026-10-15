#!/usr/bin/env python
"""H1 vs H2 vs H3: which depth does the model's level-i value represent?

Hypotheses
----------
The archived NCSS subsets carry ``DEPTH = [0, 17.5, 52.5, 125, 275, 500]``
while the upstream DEPTH read via OPeNDAP is ``[0, 10, 50, 100, 250, 500]``.

* **H1** - the file's DEPTH is where the value belongs.
* **H2** - the upstream nodes are where the value belongs.
* **H3** - the value is a LAYER value: compare against the float averaged over
  the ``DEPTH_bounds`` cell of that level.

STATUS: UNRESOLVED. Nothing below proves which hypothesis is right.
-------------------------------------------------------------------
Everything here is circumstantial; the provider has not been confirmed. The
default in production therefore stays on the file's own axis.

Evidence that does not depend on the data
-----------------------------------------
``DEPTH_bounds`` is [-5,5],[5,30],[30,75],[75,175],[175,375],[375,625]. Those
edges are exactly the midpoints between the upstream values (5 = (0+10)/2,
30 = (10+50)/2, ...), and ``nodes_from_cell_bounds`` inverts them uniquely back
to the upstream axis. That is algebra, but it does not discriminate: if the
upstream values are nodes, the bounds are midpoints between them (H2); if the
file's DEPTH are layer centres, the same bounds are layer edges (H1). Round
design depths versus arbitrary edges favours H2 only as a plausibility argument.
H3 (layer mean) is tested below.

External evidence (web research, 2026-10-09)
--------------------------------------------
* HYCOM's z-level output for the US Navy GOFS 3.0/3.1 (a different
  configuration from INCOIS's) uses standard depths 0, 2, 4, ... 10, ... 50,
  ... 100, 125, 150, 200, 250, ... 500 m. All of 0/10/50/100/250/500 are on that
  list; 17.5, 52.5 and 275 are not. That is suggestive only: INCOIS has not
  documented its own six levels, so it does not establish them.
* INCOIS's own pages do not document the six RSMC levels, and its RSMC page
  also advertises Conservative Temperature / Absolute Salinity layers; the
  file's TEMP/SALN attributes say only ``long_name='TEMP'``. If those are CT/SA
  they differ from Argo in-situ T / practical salinity by about +0.05-0.09 C and
  +0.16 g/kg in warm fresh surface water (computed with GSW). UNVERIFIED, so no
  conversion is applied; it is a candidate for part of the residual.
* Literature (abstracts only, not independently checked) describes strong
  near-surface stratification, barrier layers and temperature inversions in the
  Bay of Bengal, and a model that smooths them. This is qualitative context,
  not a quantitative test of any number here.

What this script can and cannot show
------------------------------------
The depth scan answers "at which depth does the float's temperature equal the
model's value?". That equals the label depth ONLY if the model is unbiased. A
model whose thermocline is too deep and warm (a real +1 to +4 C bias at
100-125 m) has its best-fit depth pulled SHALLOWER whatever the labels say, so
a scan optimum that matches neither H1 nor H2 (e.g. 90 m) is expected and is not
evidence against either. For that reason the verdict is built on paired,
per-profile comparisons of H1 vs H2 on the SAME profiles, with a bootstrap
interval, and the scan is reported as context only.

Fixes relative to the earlier version
-------------------------------------
* Every comparison uses the same profiles for all candidate depths. Previously
  each candidate depth kept whichever profiles happened to be valid there, so
  RMSE differences mixed depth effects with sample changes.
* Float interpolation is pure linear (no 1 m "native" snap), so the scan curve
  is smooth instead of stepped.
* Per-profile wins/losses and a paired bootstrap CI replace a bare mean RMSE.
* Level 1 (and every level) gets a MODEL-FREE check: how much does the float
  itself change between the H1 and H2 depth? If that equals the residual change,
  the shift effect is just the float's own vertical gradient.

Usage
-----
    cd backend && python scripts/test_depth_label_hypothesis.py
"""

from __future__ import annotations

import math
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
from app.services.matchup_interpolation import (  # noqa: E402
    float_bracket_max_gap_m,
    interpolate_float_at_depth,
    nodes_from_cell_bounds,
)
from app.services.model_observation_matchup import (  # noqa: E402
    _argo_data_mode,
    _extract_model_profiles,
    match_argo_with_hycom,
)

# Fallback if the installed file has no DEPTH_bounds. Verified via
# https://<host>/thredds/dodsC/osf/currents2/RSMC_hycom_<date>.nc.ascii?DEPTH
# on 2026-10-09; otherwise the axis is rebuilt from DEPTH_bounds.
FALLBACK_UPSTREAM_DEPTH_M: Tuple[float, ...] = (0.0, 10.0, 50.0, 100.0, 250.0, 500.0)

SCAN_HALF_RANGE_M = 40.0
SCAN_STEP_M = 5.0
BOOTSTRAP_RESAMPLES = 5000
BOOTSTRAP_SEED = 20261009
LAYER_STEP_M = 1.0


def _runs() -> List[Path]:
    return [p for p in settings.HYCOM_RAW_CANDIDATES if p.is_file()]


def _float_series(profile: Dict[str, Any]) -> Tuple[List[float], List[Optional[float]]]:
    result = build_matchup_levels(
        profile.get("observations", []),
        profile["latitude"],
        data_mode=_argo_data_mode(profile),
    )
    levels = result["levels"]
    return (
        [level["depth_m"] for level in levels],
        [level.get("temperature_c") for level in levels],
    )


def _float_at(depths: List[float], temps: List[Optional[float]], depth_m: float) -> Optional[float]:
    """Float temperature at one depth: linear, no snapping, production gap rule."""
    limit = float_bracket_max_gap_m(
        depth_m,
        settings.FLOAT_BRACKET_MAX_GAP_M,
        settings.FLOAT_BRACKET_MAX_GAP_DEEP_M,
        settings.FLOAT_BRACKET_DEEP_BREAKPOINT_M,
    )
    value, _method, _bracket, _reject = interpolate_float_at_depth(
        depths, temps, depth_m, limit, native_tolerance_m=0.0
    )
    return value


def _float_layer_mean(
    depths: List[float],
    temps: List[Optional[float]],
    lower_m: float,
    upper_m: float,
) -> Optional[float]:
    """Mean float temperature over [lower, upper], needing full coverage."""
    lower = max(lower_m, 0.0)
    if upper_m <= lower:
        return None
    count = max(int(round((upper_m - lower) / LAYER_STEP_M)), 1)
    grid = np.linspace(lower, upper_m, count + 1)
    values = [_float_at(depths, temps, float(z)) for z in grid]
    if any(v is None for v in values):
        return None  # the float does not cover the whole layer; no extrapolation
    return float(np.trapezoid(values, grid) / (upper_m - lower))


def _rmse(values: List[float]) -> Optional[float]:
    return math.sqrt(sum(v * v for v in values) / len(values)) if values else None


def _stats(residuals: List[float]) -> Dict[str, Any]:
    if not residuals:
        return {"n": 0, "bias": None, "median": None, "rmse": None}
    return {
        "n": len(residuals),
        "bias": statistics.fmean(residuals),
        "median": statistics.median(residuals),
        "rmse": _rmse(residuals),
    }


def _paired_bootstrap_mse_diff(
    h1: List[float], h2: List[float]
) -> Tuple[float, float, float]:
    """Mean per-profile (r2^2 - r1^2) with a 95% percentile bootstrap CI.

    Negative favours H2, positive favours H1. Resampling is over PROFILES, the
    independent units, not over levels.
    """
    diffs = np.array([b * b - a * a for a, b in zip(h1, h2)], dtype=float)
    rng = np.random.default_rng(BOOTSTRAP_SEED)
    picks = rng.integers(0, diffs.size, size=(BOOTSTRAP_RESAMPLES, diffs.size))
    means = diffs[picks].mean(axis=1)
    return float(diffs.mean()), float(np.percentile(means, 2.5)), float(np.percentile(means, 97.5))


def _parabolic_optimum(depths: List[float], rmses: List[float]) -> float:
    """Sub-step minimum from a parabola through the best point and neighbours."""
    best = int(np.argmin(rmses))
    if best == 0 or best == len(rmses) - 1:
        return depths[best]
    x0, x1, x2 = depths[best - 1], depths[best], depths[best + 1]
    y0, y1, y2 = rmses[best - 1], rmses[best], rmses[best + 1]
    denominator = (x0 - x1) * (x0 - x2) * (x1 - x2)
    if denominator == 0:
        return x1
    a = (x2 * (y1 - y0) + x1 * (y0 - y2) + x0 * (y2 - y1)) / denominator
    b = (x2 * x2 * (y0 - y1) + x1 * x1 * (y2 - y0) + x0 * x0 * (y1 - y2)) / denominator
    if a <= 0:
        return x1
    return -b / (2.0 * a)


def _fmt(value: Optional[float], digits: int = 3, signed: bool = True) -> str:
    if value is None:
        return "—"
    return f"{value:+.{digits}f}" if signed else f"{value:.{digits}f}"


def main() -> int:
    profiles = argo_provider.get_profiles()
    runs = _runs()
    if not profiles or not runs:
        print("need ingested Argo profiles and an installed model run")
        return 1

    included = []
    for profile in profiles:
        matchup = match_argo_with_hycom(profile["profile_id"])
        if matchup is None or matchup.get("statusMessage"):
            continue
        if matchup.get("timeGapStatus") != "good":
            continue
        path = next((p for p in runs if p.name == matchup.get("modelRun")), None)
        if path is None:
            continue
        included.append((profile, matchup, path))
    if not included:
        print("no profiles pass the regional-summary inclusion rule")
        return 1

    probe = xr.open_dataset(included[0][2], engine="netcdf4", chunks={})
    try:
        file_depths = [float(d) for d in np.atleast_1d(probe["DEPTH"].values).astype(float)]
        bounds = (
            np.asarray(probe["DEPTH_bounds"].values, dtype=float)
            if "DEPTH_bounds" in probe.variables
            else None
        )
    finally:
        probe.close()

    derived = nodes_from_cell_bounds(bounds) if bounds is not None else None
    upstream = list(derived) if derived is not None else list(FALLBACK_UPSTREAM_DEPTH_M)
    levels_n = len(file_depths)
    edges = (
        [(float(lo), float(hi)) for lo, hi in bounds]
        if bounds is not None and len(bounds) == levels_n
        else [None] * levels_n
    )

    print("=" * 104)
    print("H1 vs H2 vs H3: DEPTH LABEL TEST")
    print("=" * 104)
    print(f"  profiles included (same rule as the regional summary): {len(included)}")
    print(f"  H1 depths (file DEPTH)                    : {file_depths}")
    print(f"  H2 depths ({'rebuilt from DEPTH_bounds' if derived else 'fallback constant'})"
          f"{'' if derived else '      '}: {upstream}")
    if derived is not None:
        print(f"  check: rebuilt nodes {'==' if np.allclose(derived, FALLBACK_UPSTREAM_DEPTH_M) else '!='} "
              f"the upstream OPeNDAP values {list(FALLBACK_UPSTREAM_DEPTH_M)}")
    print(f"  H3 layers (DEPTH_bounds)                  : {edges}")
    print("  residual = model - float (positive = model too warm)\n")

    # level -> list of per-profile records
    records: Dict[int, List[Dict[str, Any]]] = {i: [] for i in range(levels_n)}

    for profile, _matchup, path in included:
        when = pd.to_datetime(profile["observation_time"], errors="raise").tz_localize(None)
        dataset = xr.open_dataset(path, engine="netcdf4", chunks={})
        try:
            extracted = _extract_model_profiles(
                dataset, profile["latitude"], profile["longitude"], when, "bilinear"
            )
        finally:
            dataset.close()
        if extracted is None:
            continue
        model_temps = np.atleast_1d(extracted["temp"]).astype(float)
        float_depths, float_temps = _float_series(profile)

        for index in range(min(levels_n, model_temps.size)):
            if not np.isfinite(model_temps[index]):
                continue
            model_value = float(model_temps[index])
            h1_depth, h2_depth = file_depths[index], upstream[index]

            f1 = _float_at(float_depths, float_temps, h1_depth)
            f2 = _float_at(float_depths, float_temps, h2_depth)
            edge = edges[index]
            f3 = _float_layer_mean(float_depths, float_temps, *edge) if edge else None

            scan: Dict[float, float] = {}
            for step in range(int(-SCAN_HALF_RANGE_M / SCAN_STEP_M),
                              int(SCAN_HALF_RANGE_M / SCAN_STEP_M) + 1):
                candidate = round(h1_depth + step * SCAN_STEP_M, 2)
                if candidate < 0.0:
                    continue
                value = _float_at(float_depths, float_temps, candidate)
                if value is not None:
                    scan[candidate] = model_value - value

            records[index].append({
                "profile": profile["profile_id"],
                "model": model_value,
                "r1": None if f1 is None else model_value - f1,
                "r2": None if f2 is None else model_value - f2,
                "r3": None if f3 is None else model_value - f3,
                "float_shift": None if (f1 is None or f2 is None) else f1 - f2,
                "scan": scan,
            })

    # --- per-level, paired on common profiles --------------------------------
    print("PER-LEVEL RESIDUALS (profiles valid under BOTH H1 and H2 only)")
    header = ["lvl", "H1 m", "H2 m", "n", "H1 bias", "H1 rmse", "H2 bias", "H2 rmse",
             "H2 wins", "dMSE(H2-H1) [95% CI]", "verdict"]
    widths = [4, 7, 7, 4, 9, 9, 9, 9, 9, 30, 12]
    print("  " + "".join(h.ljust(w) for h, w in zip(header, widths)))
    print("  " + "-" * sum(widths))
    pooled_h1: List[float] = []
    pooled_h2: List[float] = []
    for index in range(levels_n):
        common = [r for r in records[index] if r["r1"] is not None and r["r2"] is not None]
        if not common:
            print("  " + "".join(str(c).ljust(w) for c, w in zip(
                [index, file_depths[index], upstream[index], 0] + ["—"] * 6 + ["no data"], widths)))
            continue
        h1 = [r["r1"] for r in common]
        h2 = [r["r2"] for r in common]
        pooled_h1.extend(h1)
        pooled_h2.extend(h2)
        wins = sum(1 for a, b in zip(h1, h2) if abs(b) < abs(a))
        ties = sum(1 for a, b in zip(h1, h2) if abs(b) == abs(a))
        if all(a == b for a, b in zip(h1, h2)):
            diff_text, verdict = "identical", "same depth"
        else:
            mean, lo, hi = _paired_bootstrap_mse_diff(h1, h2)
            diff_text = f"{mean:+.3f} [{lo:+.3f}, {hi:+.3f}]"
            verdict = "H2" if hi < 0 else "H1" if lo > 0 else "undecided"
        s1, s2 = _stats(h1), _stats(h2)
        print("  " + "".join(str(c).ljust(w) for c, w in zip([
            index, file_depths[index], upstream[index], len(common),
            _fmt(s1["bias"]), _fmt(s1["rmse"], signed=False),
            _fmt(s2["bias"]), _fmt(s2["rmse"], signed=False),
            f"{wins}/{len(common)}" + (f" ({ties}t)" if ties else ""),
            diff_text, verdict,
        ], widths)))
    print("  (verdict is 'undecided' unless the bootstrap interval excludes zero)")
    print()

    # --- level-by-level model-free gradient check ----------------------------
    print("MODEL-FREE SHIFT CHECK: how far does the FLOAT ITSELF move between the H1 and H2 depth?")
    print("  If this matches the residual change, the effect of the label choice is the float's")
    print("  own vertical gradient, not a data problem. 'implied grad' = |shift| / |H1-H2|.")
    print("  " + "".join(h.ljust(14) for h in ["lvl", "|H1-H2| m", "mean T1-T2", "median", "implied C/km", "mean dRes"]))
    for index in range(levels_n):
        common = [r for r in records[index] if r["float_shift"] is not None]
        gap = abs(file_depths[index] - upstream[index])
        if not common or gap == 0:
            continue
        shifts = [r["float_shift"] for r in common]
        mean_shift = statistics.fmean(shifts)
        mean_dres = statistics.fmean([r["r1"] - r["r2"] for r in common])
        print("  " + "".join(str(c).ljust(14) for c in [
            index, f"{gap:.1f}", f"{mean_shift:+.3f}", f"{statistics.median(shifts):+.3f}",
            f"{abs(mean_shift) / gap * 1000:.1f}", f"{mean_dres:+.3f}",
        ]))
    print("  These are OBSERVED float values (the near-surface substitution rule applies only to the")
    print("  0 m model level and is not used here), so a large implied gradient is a property of the")
    print("  float data, not of the label. The mean float shift equals the mean residual change")
    print("  (an identity, since the model value is the same in both), so this check shows the")
    print("  label effect is the float's own gradient; it does not say which label is right.")
    print()

    # --- H3 layer mean ----------------------------------------------------
    print("H3 (LAYER MEAN over DEPTH_bounds) vs H1/H2, on profiles valid under all three")
    print("  " + "".join(h.ljust(10) for h in ["lvl", "n", "H1 rmse", "H2 rmse", "H3 rmse", "H3 bias", "best"]))
    for index in range(levels_n):
        common = [r for r in records[index]
                  if r["r1"] is not None and r["r2"] is not None and r["r3"] is not None]
        if not common:
            print(f"  {index:<10}{0:<10}(float does not cover the whole layer)")
            continue
        rm = {k: _rmse([r[k] for r in common]) for k in ("r1", "r2", "r3")}
        best = min(rm, key=lambda k: rm[k])
        print("  " + "".join(str(c).ljust(10) for c in [
            index, len(common), f"{rm['r1']:.3f}", f"{rm['r2']:.3f}", f"{rm['r3']:.3f}",
            f"{statistics.fmean([r['r3'] for r in common]):+.3f}",
            {"r1": "H1", "r2": "H2", "r3": "H3"}[best],
        ]))
    print()

    # --- pooled across levels (profile-level resampling is per level, see above)
    if pooled_h1:
        print("ALL LEVELS POOLED (a pooled RMSE is dominated by the largest-error level; see per-level)")
        print(f"  H1 rmse {_rmse(pooled_h1):.3f} C   H2 rmse {_rmse(pooled_h2):.3f} C   "
              f"n={len(pooled_h1)}")
        print()

    # --- depth scan on a COMMON sample -------------------------------------
    print("DEPTH SCAN (context only; see the confound in the module docstring)")
    print("  Same profiles for every candidate depth, so the curve is not distorted by sample changes.")
    print("  " + "".join(h.ljust(11) for h in ["lvl", "n(common)", "best", "refined", "RMSE@best",
                                               "RMSE@H1", "RMSE@H2", "|best-H1|", "|best-H2|"]))
    scan_level_curves: Dict[int, Tuple[List[float], List[float]]] = {}
    for index in range(levels_n):
        rows = records[index]
        if not rows:
            continue
        candidate_sets = [set(r["scan"]) for r in rows if r["scan"]]
        if not candidate_sets:
            continue
        # Candidate depths that most profiles cannot be scored at (above the
        # float's shallowest sample, say) would shrink the common sample to a
        # handful, so keep only candidates available for >= 80 % of profiles,
        # then restrict to profiles that cover all of those.
        scorable = [r for r in rows if r["scan"]]
        coverage: Dict[float, int] = {}
        for r in scorable:
            for c in r["scan"]:
                coverage[c] = coverage.get(c, 0) + 1
        covered = {c for c, k in coverage.items() if k >= 0.8 * len(scorable)}
        # Keep the contiguous run of covered candidates that contains H1, so the
        # curve is one connected window around the label under test.
        anchor = round(file_depths[index], 2)
        if anchor not in covered:
            continue
        run = [anchor]
        step = SCAN_STEP_M
        while round(run[0] - step, 2) in covered:
            run.insert(0, round(run[0] - step, 2))
        while round(run[-1] + step, 2) in covered:
            run.append(round(run[-1] + step, 2))
        all_candidates = run
        common_rows = [r for r in rows if all(c in r["scan"] for c in all_candidates)]
        if not common_rows:
            # Fall back to the candidates every profile can supply.
            shared = sorted(set.intersection(*candidate_sets))
            common_rows = [r for r in rows if all(c in r["scan"] for c in shared)]
            all_candidates = shared
        if not all_candidates or not common_rows:
            continue
        rmses = [_rmse([r["scan"][c] for r in common_rows]) for c in all_candidates]
        scan_level_curves[index] = (all_candidates, rmses)
        best_index = int(np.argmin(rmses))
        refined = _parabolic_optimum(all_candidates, rmses)

        def at(depth_m: float) -> Optional[float]:
            if depth_m in all_candidates:
                return rmses[all_candidates.index(depth_m)]
            return None

        r_h1, r_h2 = at(file_depths[index]), at(upstream[index])
        print("  " + "".join(str(c).ljust(11) for c in [
            index, len(common_rows), all_candidates[best_index], f"{refined:.1f}",
            f"{rmses[best_index]:.3f}",
            f"{r_h1:.3f}" if r_h1 is not None else "—",
            f"{r_h2:.3f}" if r_h2 is not None else "—",
            f"{abs(all_candidates[best_index] - file_depths[index]):.1f}",
            f"{abs(all_candidates[best_index] - upstream[index]):.1f}",
        ]))
    print("  (H2 is only scored when it falls on a scan step; the paired table above is the authority.)")
    print()

    if 3 in scan_level_curves:
        depths_sorted, rmses = scan_level_curves[3]
        print("  full RMSE curve for the disputed level (level 3), common sample")
        print("    depth " + " ".join(f"{d:>6.1f}" for d in depths_sorted))
        print("    rmse  " + " ".join(f"{v:>6.2f}" for v in rmses))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
