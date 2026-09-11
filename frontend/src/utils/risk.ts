import { RiskAssessment, CycloneTrackPoint } from '../types/oceanlens';

export function getRiskCategory(score: number): 'LOW' | 'ELEVATED' | 'HIGH' | 'CRITICAL' {
  if (score >= 85) return 'CRITICAL';
  if (score >= 65) return 'HIGH';
  if (score >= 40) return 'ELEVATED';
  return 'LOW';
}

export function calculateRiskForPoint(
  cycloneName: string,
  trackPoint: CycloneTrackPoint,
  avgTchp = 65.0,
  avgSst = 30.2
): RiskAssessment {
  const windFactor = Math.min((trackPoint.maxWindKts / 140.0) * 45.0, 45.0);
  const distFactor = Math.max((1.0 - trackPoint.distanceToCoastKm / 800.0) * 30.0, 5.0);
  const tchpFactor = Math.min((avgTchp / 100.0) * 15.0, 15.0);
  const sstFactor = Math.min(Math.max((avgSst - 26.0) / 5.0, 0) * 10.0, 10.0);

  const score = Math.max(10, Math.min(98, Math.round(windFactor + distFactor + tchpFactor + sstFactor)));
  const category = getRiskCategory(score);

  const keyFactors = [
    `CYCLONE MAX WIND: ${Math.round(trackPoint.maxWindKts)} KNOTS (${trackPoint.category.toUpperCase()})`,
    `COASTAL DISTANCE: ${Math.round(trackPoint.distanceToCoastKm)} KM TO NEAREST SHORE`,
    `INCOIS TCHP: ${avgTchp.toFixed(1)} KJ/CM² OCEAN HEAT CONTENT`
  ];

  return {
    score,
    category,
    modelType: 'prototype_rule_based',
    evidence: [
      {
        variable: 'Maximum Sustained Wind',
        value: String(Math.round(trackPoint.maxWindKts)),
        unit: 'kts',
        trend: trackPoint.maxWindKts > 80 ? 'increasing' : 'neutral',
        relevance: 'Wind hazard intensity near storm core',
        status: 'REAL'
      },
      {
        variable: 'Central Pressure',
        value: String(Math.round(trackPoint.centralPressureMb)),
        unit: 'mb',
        trend: trackPoint.centralPressureMb < 960 ? 'decreasing' : 'neutral',
        relevance: 'Barometric pressure deficit driving storm surge potential',
        status: 'REAL'
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
      summary: `Risk assessment evaluates ${cycloneName} at ${category} severity level (Score: ${score}/100) based on NOAA track observation and INCOIS ocean fields.`,
      keyFactors,
      limitations: 'This is a prototype decision-support risk simulation. It does not replace official IMD/INCOIS warning bulletins.',
      generatedAt: trackPoint.timestamp
    },
    affectedRegions: [
      'West Bengal Coast (South 24 Parganas, East Midnapore)',
      'Odisha Coast (Bhadrak, Balasore, Jagatsinghpur)',
      'Bangladesh Coast (Khulna, Barisal Division)'
    ]
  };
}
