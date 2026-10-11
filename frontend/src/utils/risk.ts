/**
 * Client-side mirror of the backend demo heuristic.
 *
 * This is NOT a scientific model. The weights are hand-tuned constants with no
 * published basis and no validation, and the backend is the authoritative
 * scorer. This exists only so the UI has something to render instantly before
 * (or instead of) a backend response arrives.
 *
 * Two invariants, matching the backend:
 *   1. No invented inputs. Missing wind or TCHP yields an UNAVAILABLE
 *      assessment with a reason, never a score computed from a default.
 *   2. The score is labelled unvalidated everywhere it is shown.
 */
import { RiskAssessment, CycloneTrackPoint } from '../types/oceanlens';

/** Must stay in sync with backend RISK_HEURISTIC_WEIGHTS. */
export const RISK_HEURISTIC_WEIGHTS: Record<string, number> = {
  windMaxPoints: 45.0,
  windSaturatesAtKts: 140.0,
  distanceMaxPoints: 30.0,
  distanceFloorPoints: 5.0,
  distanceScaleKm: 800.0,
  tchpMaxPoints: 15.0,
  tchpSaturatesAtKJPerCm2: 100.0,
  sstMaxPoints: 10.0,
  sstThresholdC: 26.0,
  sstSpanC: 5.0,
  scoreClampMin: 10.0,
  scoreClampMax: 98.0,
};

export const RISK_DISCLAIMER =
  'NOT VALIDATED, NOT FOR OPERATIONAL USE. These weights are hand-tuned demo ' +
  'constants with no published basis, no calibration and no verification ' +
  'against historical landfall damage. They are exposed above so they cannot ' +
  'be mistaken for a scientific scale.';

export function getRiskCategory(score: number): 'LOW' | 'ELEVATED' | 'HIGH' | 'CRITICAL' {
  if (score >= 85) return 'CRITICAL';
  if (score >= 65) return 'HIGH';
  if (score >= 40) return 'ELEVATED';
  return 'LOW';
}

function unavailable(reason: string): RiskAssessment {
  return {
    status: 'UNAVAILABLE',
    unavailableReason: reason,
    heuristicDemoScore: null,
    category: null,
    modelType: 'prototype_rule_based',
    validated: false,
    operationalUse: 'NOT FOR OPERATIONAL USE',
    disclaimer: RISK_DISCLAIMER,
    weights: RISK_HEURISTIC_WEIGHTS,
    evidence: [],
    explanation: null,
    affectedRegions: [],
  };
}

/**
 * Score a track point, or return an honest "cannot score" assessment.
 *
 * `avgTchp` / `avgSst` are deliberately **required** — the previous signature
 * defaulted them to 65.0 and 30.2, which silently produced a confident-looking
 * score on any machine without the model dataset installed.
 */
export function calculateRiskForPoint(
  cycloneName: string,
  trackPoint: CycloneTrackPoint,
  avgTchp: number | null,
  avgSst: number | null
): RiskAssessment {
  if (trackPoint.maxWindKts === null || trackPoint.maxWindKts === undefined) {
    return unavailable(
      `No observed maximum sustained wind at ${trackPoint.timestamp} ` +
        `(WMO_WIND and NEWDELHI_WIND both blank in IBTrACS) for ${cycloneName}.`
    );
  }
  if (trackPoint.distanceToCoastKm === null || trackPoint.distanceToCoastKm === undefined) {
    return unavailable(`No observed distance to land at ${trackPoint.timestamp} for ${cycloneName}.`);
  }
  if (avgTchp === null || avgTchp === undefined || avgSst === null || avgSst === undefined) {
    return unavailable(
      'No real INCOIS HYCOM model data loaded, so TCHP and SST could not be read. ' +
        'The demo heuristic returns no score rather than substituting a default.'
    );
  }

  const w = RISK_HEURISTIC_WEIGHTS;
  const wind = trackPoint.maxWindKts;
  const dist = trackPoint.distanceToCoastKm;

  const windFactor = Math.min((wind / w.windSaturatesAtKts) * w.windMaxPoints, w.windMaxPoints);
  const distFactor = Math.max(
    (1.0 - dist / w.distanceScaleKm) * w.distanceMaxPoints,
    w.distanceFloorPoints
  );
  const tchpFactor = Math.min((avgTchp / w.tchpSaturatesAtKJPerCm2) * w.tchpMaxPoints, w.tchpMaxPoints);
  const sstFactor = Math.min(
    Math.max((avgSst - w.sstThresholdC) / w.sstSpanC, 0) * w.sstMaxPoints,
    w.sstMaxPoints
  );

  const score = Math.max(
    w.scoreClampMin,
    Math.min(w.scoreClampMax, Math.round(windFactor + distFactor + tchpFactor + sstFactor))
  );
  const category = getRiskCategory(score);
  const pressure = trackPoint.centralPressureMb;

  const keyFactors = [
    `CYCLONE MAX WIND: ${Math.round(wind)} KNOTS (${trackPoint.windSource ?? 'unknown source'})` +
      (trackPoint.category ? ` / ${trackPoint.category.toUpperCase()}` : ''),
    `COASTAL DISTANCE: ${Math.round(dist)} KM TO NEAREST SHORE`,
    `INCOIS TCHP: ${avgTchp.toFixed(1)} KJ/CM² (basin mean, not cyclone-centred)`,
    `INCOIS SST: ${avgSst.toFixed(1)} °C (basin mean, not cyclone-centred)`
  ];

  return {
    status: 'OK',
    unavailableReason: null,
    heuristicDemoScore: score,
    category,
    modelType: 'prototype_rule_based',
    validated: false,
    operationalUse: 'NOT FOR OPERATIONAL USE',
    disclaimer: RISK_DISCLAIMER,
    weights: RISK_HEURISTIC_WEIGHTS,
    evidence: [
      {
        variable: 'Maximum Sustained Wind',
        value: wind.toFixed(1),
        unit: 'kts',
        trend: wind > 80 ? 'increasing' : 'neutral',
        relevance: 'Wind hazard intensity near storm core',
        status: 'REAL'
      },
      {
        variable: 'Wind observation source',
        value: trackPoint.windSource ?? null,
        unit: '',
        trend: 'neutral',
        relevance: 'Agency the wind value was read from (WMO consensus, or IMD fallback)',
        status: 'REAL'
      },
      {
        variable: 'Central Pressure',
        value: pressure === null || pressure === undefined ? null : pressure.toFixed(1),
        unit: 'mb',
        trend: pressure === null || pressure === undefined ? 'unknown' : pressure < 960 ? 'decreasing' : 'neutral',
        relevance: 'Barometric pressure deficit driving storm surge potential',
        status: pressure === null || pressure === undefined ? 'UNAVAILABLE' : 'REAL'
      },
      {
        variable: 'Tropical Cyclone Heat Potential (TCHP)',
        value: avgTchp.toFixed(1),
        unit: 'KJ/cm2',
        trend: avgTchp > 60 ? 'increasing' : 'neutral',
        relevance: 'Upper ocean heat content supporting storm maintenance',
        status: 'REAL'
      },
      {
        variable: 'Absolute Sea Surface Temperature (SST)',
        value: avgSst.toFixed(1),
        unit: '°C',
        trend: 'neutral',
        relevance: 'Surface ocean thermal energy',
        status: 'REAL'
      }
    ],
    explanation: {
      summary:
        `Unvalidated demo heuristic scores ${cycloneName} at ${category} ` +
        `(heuristicDemoScore: ${score}/100). This is a demonstration number, ` +
        `not a forecast or an official warning.`,
      keyFactors,
      limitations:
        `${RISK_DISCLAIMER} It does not replace official IMD/INCOIS warning ` +
        'bulletins. TCHP and SST are unweighted basin means, not values at the ' +
        'cyclone position. Affected-region prediction is not implemented, so no ' +
        'landfall geography is claimed.',
      generatedAt: trackPoint.timestamp
    },
    affectedRegions: []
  };
}