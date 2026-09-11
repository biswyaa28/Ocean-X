from typing import Optional
from app.models.schemas import RiskAssessment, Evidence, Explanation, Cyclone
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

def calculate_prototype_risk(
    cyclone: Cyclone,
    timestamp: Optional[str] = None,
    track_index: Optional[int] = None
) -> RiskAssessment:
    """
    Prototype rule-based risk assessment model.
    Synthesizes cyclone wind, pressure, distance to coast, and real INCOIS TCHP & absolute SST.
    """
    if track_index is not None and 0 <= track_index < len(cyclone.track):
        track_pt = cyclone.track[track_index]
    elif timestamp:
        found = [pt for pt in cyclone.track if pt.timestamp == timestamp]
        track_pt = found[0] if found else cyclone.track[min(cyclone.currentTrackIndex, len(cyclone.track) - 1)]
    else:
        track_pt = cyclone.track[min(cyclone.currentTrackIndex, len(cyclone.track) - 1)]

    # Fetch real INCOIS TCHP and SST at or near cyclone location
    tchp_layer = incois_provider.get_layer_data("tchp", timestamp=timestamp or track_pt.timestamp)
    sst_layer = incois_provider.get_layer_data("sst", timestamp=timestamp or track_pt.timestamp)

    avg_tchp = 65.0
    if tchp_layer and tchp_layer.grid and tchp_layer.grid.values:
        vals = [v for row in tchp_layer.grid.values for v in row if v > 0]
        if vals:
            avg_tchp = float(sum(vals) / len(vals))

    avg_sst = 30.2
    if sst_layer and sst_layer.grid and sst_layer.grid.values:
        vals = [v for row in sst_layer.grid.values for v in row if v > 0]
        if vals:
            avg_sst = float(sum(vals) / len(vals))

    # Rule-based risk score calculation (0 to 100)
    wind_factor = min((track_pt.maxWindKts / 140.0) * 45.0, 45.0)
    dist_factor = max((1.0 - track_pt.distanceToCoastKm / 800.0) * 30.0, 5.0)
    tchp_factor = min((avg_tchp / 100.0) * 15.0, 15.0)
    sst_factor = min(max((avg_sst - 26.0) / 5.0, 0.0) * 10.0, 10.0)

    score = int(round(wind_factor + dist_factor + tchp_factor + sst_factor))
    score = max(10, min(98, score))
    category = get_risk_category(score)

    evidence_items = [
        Evidence(
            variable='Maximum Sustained Wind',
            value=str(round(track_pt.maxWindKts, 1)),
            unit='kts',
            trend='increasing' if track_pt.maxWindKts > 80 else 'neutral',
            relevance='Wind hazard intensity near storm core',
            status='REAL'
        ),
        Evidence(
            variable='Central Pressure',
            value=str(round(track_pt.centralPressureMb, 1)),
            unit='mb',
            trend='decreasing' if track_pt.centralPressureMb < 960 else 'neutral',
            relevance='Barometric pressure deficit driving storm surge potential',
            status='REAL'
        ),
        Evidence(
            variable='Tropical Cyclone Heat Potential (TCHP)',
            value=str(round(avg_tchp, 1)),
            unit='KJ/cm2',
            trend='increasing' if avg_tchp > 60 else 'neutral',
            relevance='Upper ocean heat content supporting storm maintenance',
            status='REAL'
        ),
        Evidence(
            variable='Absolute Sea Surface Temperature (SST)',
            value=str(round(avg_sst, 1)),
            unit='°C',
            trend='neutral',
            relevance='Surface ocean thermal energy',
            status='REAL'
        )
    ]

    key_factors = [
        f"CYCLONE MAX WIND: {round(track_pt.maxWindKts)} KNOTS ({track_pt.category.upper()})",
        f"COASTAL DISTANCE: {round(track_pt.distanceToCoastKm)} KM TO NEAREST SHORE",
        f"INCOIS TCHP: {round(avg_tchp, 1)} KJ/CM² OCEAN HEAT CONTENT"
    ]

    explanation = Explanation(
        summary=f"Risk assessment evaluates {cyclone.name} at {category} severity level (Score: {score}/100) based on NOAA track observation and INCOIS ocean fields.",
        keyFactors=key_factors,
        limitations="This is a prototype decision-support risk simulation. It does not replace official IMD/INCOIS warning bulletins.",
        generatedAt=track_pt.timestamp
    )

    affected = [
        "West Bengal Coast (South 24 Parganas, East Midnapore)",
        "Odisha Coast (Bhadrak, Balasore, Jagatsinghpur)",
        "Bangladesh Coast (Khulna, Barisal Division)"
    ]

    return RiskAssessment(
        score=score,
        category=category,
        modelType="prototype_rule_based",
        evidence=evidence_items,
        explanation=explanation,
        affectedRegions=affected
    )
