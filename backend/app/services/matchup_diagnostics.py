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
    interpolatedLevelCount: int
    nativeLevelCount: int
    interpolationApplied: bool
    missingQcLevelCount: int
    timeDifferenceHours: Optional[float]
    timeGapStatus: Optional[str]
    matchedPercentageBasis: str
    totalModelLevels: Optional[int]
    nearSurfaceSubstitutionCount: int


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
    missing_qc_level_count: int = 0,
    time_difference_hours: Optional[float] = None,
    time_gap_status: Optional[str] = None,
    total_model_levels: Optional[int] = None,
) -> MatchupDiagnostics:
    """Describe an existing matchup without changing its matching semantics.

    ``matchedObservationCount`` is the number of backend comparison rows: the
    matcher emits exactly one row per Argo observation that found a usable
    model value - either at a native HYCOM level inside the accepted depth
    tolerance (``matchMode="native"``) or by vertical interpolation inside the
    model's valid depth range (``matchMode="interpolated"``). It is therefore
    the matched *observation* count - not the number of valid
    temperature/salinity statistical pairs, which the statistics report
    separately because a matched pair may still carry missing or non-finite
    values.

    ``interpolatedLevelCount`` / ``nativeLevelCount`` split those rows by whether
    the pair required an interpolation on either side, so the caller can see how
    much of the sample is interpolated. In the default ``model_levels`` mode the
    model value is always native and any interpolation is on the float side. Repeated native model depths do NOT collapse
    rows: two observations matched to the same native HYCOM level remain two
    matched observations.

    ``total_model_levels`` is the number of model depth levels offered for
    matching. In the default ``model_levels`` mode a row is a MODEL level, so
    "matched" must be measured against the levels that could have matched (at
    most 6), not against the hundreds of float observations: 6 of 300 would read
    as 2 % and say nothing about coverage. When it is given, ``matchedPercentage``
    and ``unmatchedObservationCount`` use that basis and
    ``matchedPercentageBasis`` says so; otherwise the Argo-observation basis is
    kept for the float-level modes.

    ``missing_qc_level_count`` is a property of the whole Argo profile rather
    than of the matched rows, so it is passed in by the caller: it counts the
    levels whose QC flags were absent from the source and were therefore
    accepted on the lenient assumption documented in ``argo_levels``.
    ``time_difference_hours`` / ``time_gap_status`` are likewise properties of
    the observation-model pair, so they are passed in rather than derived here.
    """
    rows = list(comparisons)

    total = total_observations if isinstance(total_observations, int) and total_observations > 0 else 0
    matched = len(rows)
    model_basis = isinstance(total_model_levels, int) and total_model_levels > 0
    denominator = total_model_levels if model_basis else total
    unmatched = max(denominator - matched, 0)

    native_depths = [
        depth for depth in (_finite_float(row.get("matchedModelDepthM")) for row in rows) if depth is not None
    ]

    # Method naming differs by comparison mode: "float_levels"/"native" use
    # interpolated|native on the MODEL side, while "model_levels" reports
    # float_interpolated|float_native. Both describe the same split, so both
    # spellings are counted as interpolated.
    INTERPOLATED_METHODS = frozenset({"interpolated", "float_interpolated"})
    interpolated = sum(1 for row in rows if row.get("method") in INTERPOLATED_METHODS)
    # A surface level that borrowed a shallow float sample is neither a native
    # float level nor an interpolation; it is counted on its own and left out
    # of the native count so "native" keeps meaning a real level at that depth.
    near_surface = sum(
        1 for row in rows
        if _finite_float(row.get("floatNearSurfaceDepthM")) is not None
    )
    native = matched - interpolated - near_surface
    missing_qc = missing_qc_level_count if isinstance(missing_qc_level_count, int) else 0

    return {
        "totalArgoObservations": total,
        "matchedObservationCount": matched,
        "unmatchedObservationCount": unmatched,
        # No denominator -> no percentage is invented.
        "matchedPercentage": round(matched / denominator * 100.0, 2) if denominator > 0 else None,
        "deepestMatchedObservationDepthM": _deepest(row.get("depthM") for row in rows),
        "deepestMatchedModelDepthM": _deepest(native_depths),
        "repeatedNativeDepthMatchCount": len(native_depths) - len(set(native_depths)),
        "interpolatedLevelCount": interpolated,
        "nativeLevelCount": native,
        # True only when at least one row was actually interpolated.
        "interpolationApplied": interpolated > 0,
        "missingQcLevelCount": max(missing_qc, 0),
        "timeDifferenceHours": _finite_float(time_difference_hours),
        "timeGapStatus": time_gap_status,
        "matchedPercentageBasis": "model_levels" if model_basis else "argo_observations",
        "totalModelLevels": total_model_levels if model_basis else None,
        "nearSurfaceSubstitutionCount": near_surface,
    }