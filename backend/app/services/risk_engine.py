"""Heuristic demo risk score.

This module deliberately produces a **non-scientific** number and labels it as
such everywhere it surfaces. The weights are hand-tuned constants with no
published basis, no calibration and no validation against historical landfall
damage; they are returned alongside the score in every response so no consumer
can mistake them for a real risk scale.

Two rules this module must never break:

1. **No invented inputs.** If a required input cannot be read from a real
   source, the assessment returns ``status='UNAVAILABLE'`` with a reason. It
   must never fall back to a plausible-looking default.
2. **No invented geography.** Landfall-region prediction is not implemented, so
   ``affectedRegions`` is empty and the omission is stated explicitly.
"""

from typing import List, Optional, Tuple

from app.models.schemas import (
    RISK_DISCLAIMER,
    RISK_HEURISTIC_WEIGHTS,
    Cyclone,
    Evidence,
    Explanation,
    RiskAssessment,
)
from app.providers.incois_provider import incois_provider


def get_risk_category(score: int) -> str:
    if score >= 85:
        return 'CRITICAL'
    elif score >= 65:
        return 'HIGH'
    elif score >= 40:
        return 'ELEVATED'
    else:
        return 'LOW'


def _unavailable(reason: str, cyclone: Optional[Cyclone] = None) -> RiskAssessment:
    """Build a well-formed, honest 'we cannot score this' response."""
    return RiskAssessment(
        status='UNAVAILABLE',
        unavailableReason=reason,
        heuristicDemoScore=None,
        category=None,
        modelType='prototype_rule_based',
        validated=False,
        operationalUse='NOT FOR OPERATIONAL USE',
        disclaimer=RISK_DISCLAIMER,
        weights=RISK_HEURISTIC_WEIGHTS,
        evidence=[],
        explanation=None,
        affectedRegions=[],
    )


def _layer_mean(layer) -> Tuple[Optional[float], Optional[int], Optional[int]]:
    """nanmean over the VALID cells of a layer, with coverage counts.

    Returns ``(mean, valid_count, total_count)``. Only finite cells contribute
    to the mean; masked land cells do not. A zero-valued cell IS a real
    measurement and is included — excluding it would bias the mean upward
    (e.g. TCHP = 0 over cool water is a genuine reading, not missing data).

    Returns ``(None, valid, total)`` when there is no usable data, so the
    caller can report unavailability instead of scoring on a default.
    """
    if layer is None:
        return None, 0, 0
    grid = getattr(layer, 'grid', None)
    values = getattr(grid, 'values', None) if grid is not None else None
    if not values:
        return None, 0, 0

    total = 0
    valid_vals: List[float] = []
    for row in values:
        if not row:
            continue
        for v in row:
            total += 1
            if v is None:
                continue
            fv = float(v)
            if fv == fv and fv not in (float('inf'), float('-inf')):  # NaN-safe
                valid_vals.append(fv)

    if not valid_vals:
        return None, 0, total
    return float(sum(valid_vals) / len(valid_vals)), len(valid_vals), total


def calculate_prototype_risk(
    cyclone: Cyclone,
    timestamp: Optional[str] = None,
    track_index: Optional[int] = None,
) -> RiskAssessment:
    """Score a cyclone with an explicitly unvalidated heuristic.

    Returns ``status='UNAVAILABLE'`` whenever a required real input is missing.
    """
    if not cyclone.track:
        return _unavailable(f"Cyclone {cyclone.name} has no track points.")

    if track_index is not None and 0 <= track_index < len(cyclone.track):
        track_pt = cyclone.track[track_index]
    elif timestamp:
        found = [pt for pt in cyclone.track if pt.timestamp == timestamp]
        track_pt = (
            found[0]
            if found
            else cyclone.track[min(cyclone.currentTrackIndex, len(cyclone.track) - 1)]
        )
    else:
        track_pt = cyclone.track[min(cyclone.currentTrackIndex, len(cyclone.track) - 1)]

    # --- Required real inputs: no defaults, ever -----------------------------
    if track_pt.maxWindKts is None:
        return _unavailable(
            f"No observed maximum sustained wind at {track_pt.timestamp} "
            f"(WMO_WIND and NEWDELHI_WIND both blank in IBTrACS). "
            "The heuristic cannot be scored without it.",
            cyclone,
        )

    if track_pt.distanceToCoastKm is None:
        return _unavailable(
            f"No observed distance to land at {track_pt.timestamp}. "
            "The heuristic cannot be scored without it.",
            cyclone,
        )

    query_ts = timestamp or track_pt.timestamp
    try:
        tchp_layer = incois_provider.get_layer_data("tchp", timestamp=query_ts)
    except Exception as exc:  # provider I/O failure must not become a score
        return _unavailable(f"TCHP layer unavailable: {exc}", cyclone)
    try:
        sst_layer = incois_provider.get_layer_data("sst", timestamp=query_ts)
    except Exception as exc:
        return _unavailable(f"SST layer unavailable: {exc}", cyclone)

    avg_tchp, tchp_valid, tchp_total = _layer_mean(tchp_layer)
    avg_sst, sst_valid, sst_total = _layer_mean(sst_layer)

    missing = []
    if avg_tchp is None:
        missing.append("TCHP")
    if avg_sst is None:
        missing.append("SST")
    if missing:
        return _unavailable(
            "No real INCOIS HYCOM model data loaded, so "
            + " and ".join(missing)
            + " could not be read. The demo heuristic returns no score rather "
            "than substituting a default. Install the model dataset or run the "
            "backend in FIXTURE mode to see the pipeline.",
            cyclone,
        )

    # --- Heuristic scoring ---------------------------------------------------
    w = RISK_HEURISTIC_WEIGHTS
    wind_factor = min(
        (track_pt.maxWindKts / w['windSaturatesAtKts']) * w['windMaxPoints'],
        w['windMaxPoints'],
    )
    dist_factor = max(
        (1.0 - track_pt.distanceToCoastKm / w['distanceScaleKm']) * w['distanceMaxPoints'],
        w['distanceFloorPoints'],
    )
    tchp_factor = min(
        (avg_tchp / w['tchpSaturatesAtKJPerCm2']) * w['tchpMaxPoints'],
        w['tchpMaxPoints'],
    )
    sst_factor = min(
        max((avg_sst - w['sstThresholdC']) / w['sstSpanC'], 0.0) * w['sstMaxPoints'],
        w['sstMaxPoints'],
    )

    score = int(round(wind_factor + dist_factor + tchp_factor + sst_factor))
    score = int(max(w['scoreClampMin'], min(w['scoreClampMax'], score)))
    category = get_risk_category(score)

    pressure_available = track_pt.centralPressureMb is not None
    evidence_items = [
        Evidence(
            variable='Maximum Sustained Wind',
            value=str(round(track_pt.maxWindKts, 1)),
            unit='kts',
            trend='increasing' if track_pt.maxWindKts > 80 else 'neutral',
            relevance='Wind hazard intensity near storm core',
            status='REAL',
        ),
        Evidence(
            variable='Wind observation source',
            value=track_pt.windSource,
            unit='',
            trend='neutral',
            relevance='Agency the wind value was read from (WMO consensus, or IMD fallback)',
            status='REAL',
        ),
        Evidence(
            variable='Central Pressure',
            value=(
                str(round(track_pt.centralPressureMb, 1)) if pressure_available else None
            ),
            unit='mb',
            trend=(
                'decreasing'
                if pressure_available and track_pt.centralPressureMb < 960
                else ('neutral' if pressure_available else 'unknown')
            ),
            relevance='Barometric pressure deficit driving storm surge potential',
            status='REAL' if pressure_available else 'UNAVAILABLE',
        ),
        Evidence(
            variable='Tropical Cyclone Heat Potential (TCHP)',
            value=str(round(avg_tchp, 1)),
            unit='KJ/cm2',
            trend='increasing' if avg_tchp > 60 else 'neutral',
            relevance='Upper ocean heat content supporting storm maintenance',
            status='REAL',
        ),
        Evidence(
            variable='Absolute Sea Surface Temperature (SST)',
            value=str(round(avg_sst, 1)),
            unit='°C',
            trend='neutral',
            relevance='Surface ocean thermal energy',
            status='REAL',
        ),
    ]

    key_factors = [
        f"CYCLONE MAX WIND: {round(track_pt.maxWindKts)} KNOTS "
        f"({track_pt.windSource or 'unknown source'})"
        + (f" / {(track_pt.category or '').upper()}" if track_pt.category else ""),
        f"COASTAL DISTANCE: {round(track_pt.distanceToCoastKm)} KM TO NEAREST SHORE",
        f"INCOIS TCHP: {round(avg_tchp, 1)} KJ/CM² "
        f"(mean over {tchp_valid} of {tchp_total} valid cells, not cyclone-centred)",
        f"INCOIS SST: {round(avg_sst, 1)} °C "
        f"(mean over {sst_valid} of {sst_total} valid cells, not cyclone-centred)",
    ]

    explanation = Explanation(
        summary=(
            f"Unvalidated demo heuristic scores {cyclone.name} at {category} "
            f"(heuristicDemoScore: {score}/100). This is a demonstration "
            f"number, not a forecast or an official warning."
        ),
        keyFactors=key_factors,
        limitations=(
            f"{RISK_DISCLAIMER} It does not replace official IMD/INCOIS "
            "warning bulletins. TCHP and SST are unweighted basin means, not "
            "values at the cyclone position. Affected-region prediction is not "
            "implemented, so no landfall geography is claimed."
        ),
        generatedAt=track_pt.timestamp,
    )

    return RiskAssessment(
        status='OK',
        unavailableReason=None,
        heuristicDemoScore=score,
        category=category,
        modelType='prototype_rule_based',
        validated=False,
        operationalUse='NOT FOR OPERATIONAL USE',
        disclaimer=RISK_DISCLAIMER,
        weights=RISK_HEURISTIC_WEIGHTS,
        evidence=evidence_items,
        explanation=explanation,
        affectedRegions=[],
    )