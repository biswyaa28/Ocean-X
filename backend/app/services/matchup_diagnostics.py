"""Neutral diagnostic context for backend-produced Argo/HYCOM matchups.

These values are counts and metadata reductions over the existing comparison
rows and over the Argo observation list that produced them. They describe the
matchup sample: coverage, separations and matching methodology.

They are NOT a matchup quality score, grade, acceptance decision, threshold
judgement or validation metric, and they change no matching semantics.
"""

import math
from typing import Any, Iterable, Optional, TypedDict


class MatchupDiagnostics(TypedDict):
    totalArgoObservations: int
    matchedObservationCount: int
    unmatchedObservationCount: int
    matchedPercentage: Optional[float]
    deepestMatchedObservationDepthM: Optional[float]
    deepestMatchedModelDepthM: Optional[float]
    repeatedNativeDepthMatchCount: int
    interpolationApplied: bool


def _finite_float(value: Any) -> Optional[float]:
    if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value):
        return float(value)
    return None


def _deepest(values: Iterable[Any]) -> Optional[float]:
    finite = [value for value in (_finite_float(v) for v in values) if value is not None]
    return max(finite) if finite else None


def build_matchup_diagnostics(
    total_observations: int,
    comparisons: Iterable[dict[str, Any]],
) -> MatchupDiagnostics:
    """Describe an existing matchup without changing its matching semantics.

    ``matchedObservationCount`` is the number of backend comparison rows: the
    existing matcher emits exactly one row per Argo observation that found a
    native HYCOM level inside the accepted depth tolerance. It is therefore the
    matched *observation* count - not the number of valid temperature/salinity
    statistical pairs, which Phase 2B statistics report separately because a
    depth-matched pair may still carry missing or non-finite values.

    Repeated native model depths do NOT collapse rows: two observations matched
    to the same native HYCOM level remain two matched observations.
    """
    rows = list(comparisons)

    total = total_observations if isinstance(total_observations, int) and total_observations > 0 else 0
    matched = len(rows)
    unmatched = max(total - matched, 0)

    native_depths = [
        depth for depth in (_finite_float(row.get("matchedModelDepthM")) for row in rows) if depth is not None
    ]

    return {
        "totalArgoObservations": total,
        "matchedObservationCount": matched,
        "unmatchedObservationCount": unmatched,
        # No denominator -> no percentage is invented.
        "matchedPercentage": round(matched / total * 100.0, 2) if total > 0 else None,
        "deepestMatchedObservationDepthM": _deepest(row.get("depthM") for row in rows),
        "deepestMatchedModelDepthM": _deepest(native_depths),
        "repeatedNativeDepthMatchCount": len(native_depths) - len(set(native_depths)),
        "interpolationApplied": False,
    }