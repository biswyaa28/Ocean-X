"""Regional matchup summary across many Argo profiles.

The per-profile matchup answers "how well does the model match this float".
This module answers the regional question: "how large is the model bias as a
function of depth across the Bay of Bengal", which is the number a model
evaluation actually needs.

Aggregation rule
----------------
Statistics are computed PER DEPTH and PER PROFILE, then combined across
profiles, rather than pooling every pair. A pooled RMSE would be dominated by
whichever profile happened to contribute the most pairs, and profiles with
different level counts are not comparable that way. So for each model depth:

* each profile contributes at most ONE bias at that depth (its residual there);
* bias is the mean of those per-profile biases;
* MAE and RMSE are taken over the per-profile biases.

That makes "RMSE at 125 m" mean "how much profiles disagree at 125 m", with
every profile weighted equally, regardless of how finely it sampled.

Exclusions are counted with a reason rather than silently dropped, because a
profile that contributes nothing is itself a result: a float that never
profiles the model's depth range, a float flagged too far from its model time,
and a float sampled too coarsely to support an interpolation are three
different findings.
"""

import math
import statistics
from typing import Any, Dict, Iterable, List, Optional, Tuple

# Excluded-profile reasons. Kept as constants so the API contract and the UI
# cannot drift apart.
REASON_TIME_GAP = "time_gap_too_large"
REASON_NO_OVERLAP = "no_overlap_with_model_depth_range"
REASON_NO_PAIRS = "no_pairs_after_qc_and_sampling_gap"
REASON_COARSE = "float_sampling_too_coarse"
REASON_UNAVAILABLE = "model_data_unavailable"


def _finite(value: Any) -> Optional[float]:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value) if math.isfinite(value) else None
    return None


def reduce_residuals(residuals: Iterable[Optional[float]]) -> Dict[str, Any]:
    """Bias, MAE and RMSE over a set of residuals. Never invents a value."""
    usable = [value for value in (_finite(r) for r in residuals) if value is not None]
    if not usable:
        return {"n": 0, "bias": None, "mae": None, "rmse": None}
    n = len(usable)
    return {
        "n": n,
        "bias": round(sum(usable) / n, 4),
        "mae": round(sum(abs(value) for value in usable) / n, 4),
        "rmse": round(math.sqrt(sum(value * value for value in usable) / n), 4),
    }


def _overall_from_profiles(reduced: Iterable[Dict[str, Any]]) -> Dict[str, Any]:
    """Equal-weight-per-profile bias / MAE / RMSE from per-profile reductions."""
    rows = [row for row in reduced if row.get("n")]
    if not rows:
        return {"n": 0, "bias": None, "mae": None, "rmse": None}
    count = len(rows)
    return {
        "n": count,
        "bias": round(sum(row["bias"] for row in rows) / count, 4),
        "mae": round(sum(row["mae"] for row in rows) / count, 4),
        "rmse": round(math.sqrt(sum(row["rmse"] ** 2 for row in rows) / count), 4),
    }


def summarize_matches(matches: Iterable[Dict[str, Any]]) -> Dict[str, Any]:
    """Aggregate per-profile matchups into per-depth and overall statistics.

    ``matches`` is a list of ``{"profileId", "floatId", "timeDifferenceHours",
    "timeGapStatus", "comparisons": [...]}``. Comparisons are expected in the
    default ``model_levels`` shape (one row per model level).
    """
    matches = list(matches)

    # depth -> per-profile bias, for temperature and salinity.
    temperature_by_depth: Dict[float, List[float]] = {}
    salinity_by_depth: Dict[float, List[float]] = {}
    profile_rows: List[Dict[str, Any]] = []

    for match in matches:
        comparisons = match.get("comparisons") or []
        pairs = 0
        temperature_pairs = 0
        salinity_pairs = 0
        temperature_residuals: List[float] = []
        salinity_residuals: List[float] = []

        for comparison in comparisons:
            depth = _finite(comparison.get("modelDepthM", comparison.get("depthM")))
            if depth is None:
                continue
            pairs += 1

            temperature_residual = _finite(comparison.get("_temperatureResidualRaw"))
            if temperature_residual is not None:
                temperature_by_depth.setdefault(depth, []).append(temperature_residual)
                temperature_residuals.append(temperature_residual)
                temperature_pairs += 1

            salinity_residual = _finite(comparison.get("_salinityResidualRaw"))
            if salinity_residual is not None:
                salinity_by_depth.setdefault(depth, []).append(salinity_residual)
                salinity_residuals.append(salinity_residual)
                salinity_pairs += 1

        profile_rows.append({
            "profileId": match.get("profileId"),
            "floatId": match.get("floatId"),
            "observationTimestamp": match.get("observationTimestamp"),
            "timeDifferenceHours": _finite(match.get("timeDifferenceHours")),
            "timeGapStatus": match.get("timeGapStatus"),
            "modelRun": match.get("modelRun"),
            "pairCount": pairs,
            "temperaturePairCount": temperature_pairs,
            "salinityPairCount": salinity_pairs,
            "temperature": reduce_residuals(temperature_residuals),
            "salinity": reduce_residuals(salinity_residuals),
        })

    # --- TCHP -----------------------------------------------------------------
    # Aggregated per profile, like the depth rows, so one profile contributes at
    # most one TCHP residual no matter how many levels it sampled. The median is
    # reported alongside the mean because a regional TCHP bias is a
    # heavy-tailed quantity: a handful of shallow, very warm profiles can move
    # the mean a long way without describing the region.
    tchp_residuals: List[float] = []
    tchp_scatter: List[Dict[str, Any]] = []
    tchp_rows: List[Dict[str, Any]] = []
    for match in matches:
        float_tchp = _finite(match.get("tchpFloatKjCm2"))
        model_tchp = _finite(match.get("tchpModelKjCm2"))
        residual = _finite(match.get("tchpResidualKjCm2"))
        if residual is not None:
            tchp_residuals.append(residual)
        if float_tchp is not None and model_tchp is not None:
            tchp_scatter.append({
                "profileId": match.get("profileId"),
                "floatId": match.get("floatId"),
                "tchpFloatKjCm2": float_tchp,
                "tchpModelKjCm2": model_tchp,
                "residualKjCm2": residual,
            })
        tchp_rows.append({
            "profileId": match.get("profileId"),
            "floatId": match.get("floatId"),
            "tchpFloatKjCm2": float_tchp,
            "tchpModelKjCm2": model_tchp,
            "tchpResidualKjCm2": residual,
            "tchpResidualPercent": _finite(match.get("tchpResidualPercent")),
            "d26FloatM": _finite(match.get("d26FloatM")),
            "mldModelM": _finite(match.get("mldModelM")),
            "metricsStatus": match.get("metricsStatus"),
            "metricsReason": match.get("metricsReason"),
        })

    tchp_reduced = reduce_residuals(tchp_residuals)
    if tchp_residuals:
        tchp_reduced["medianBias"] = round(statistics.median(tchp_residuals), 4)
        tchp_reduced["meanModelMinusFloat"] = round(
            statistics.fmean(
                [
                    row["tchpModelKjCm2"] - row["tchpFloatKjCm2"]
                    for row in tchp_scatter
                ]
            ),
            4,
        )
        tchp_reduced["meanFloat"] = round(
            statistics.fmean([row["tchpFloatKjCm2"] for row in tchp_scatter]), 4
        )
        tchp_reduced["meanModel"] = round(
            statistics.fmean([row["tchpModelKjCm2"] for row in tchp_scatter]), 4
        )
    else:
        tchp_reduced.update({
            "medianBias": None, "meanModelMinusFloat": None,
            "meanFloat": None, "meanModel": None,
        })

    all_depths = sorted(set(temperature_by_depth) | set(salinity_by_depth))
    per_depth: List[Dict[str, Any]] = []
    for depth in all_depths:
        per_depth.append({
            "modelDepthM": depth,
            "temperature": reduce_residuals(temperature_by_depth.get(depth, [])),
            "salinity": reduce_residuals(salinity_by_depth.get(depth, [])),
        })

    # Overall: every profile counts once regardless of how many pairs it
    # contributed. Bias is the mean of per-profile biases; MAE and RMSE are
    # built from each profile's own MAE / MSE. Reducing the per-profile BIASES
    # instead would let a profile's +3 C and -3 C residuals cancel to a zero
    # bias and then contribute zero error, understating MAE and RMSE.
    overall = {
        "temperature": _overall_from_profiles([row["temperature"] for row in profile_rows]),
        "salinity": _overall_from_profiles([row["salinity"] for row in profile_rows]),
    }

    return {
        "byModelDepth": per_depth,
        "overall": overall,
        "tchp": tchp_reduced,
        "tchpScatter": tchp_scatter,
        "tchpProfiles": tchp_rows,
        "profiles": profile_rows,
        "profileCount": len(profile_rows),
    }


def exclusion_counts(exclusions: Iterable[Tuple[str, Dict[str, Any]]]) -> Dict[str, int]:
    """Count excluded profiles by reason."""
    counts: Dict[str, int] = {}
    for reason, _detail in exclusions:
        counts[reason] = counts.get(reason, 0) + 1
    return counts