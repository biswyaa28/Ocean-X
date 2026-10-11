import { describe, it, expect } from 'vitest';
import {
  calculateRiskForPoint,
  getRiskCategory,
  RISK_DISCLAIMER,
  RISK_HEURISTIC_WEIGHTS,
} from '../utils/risk';
import type { CycloneTrackPoint } from '../types/oceanlens';

/**
 * These tests pin the de-fabrication of the client-side demo heuristic.
 *
 * The previous signature was `calculateRiskForPoint(name, pt, avgTchp = 65.0,
 * avgSst = 30.2)`. Because those defaults were optional, any caller that
 * omitted them silently produced a confident-looking score from two invented
 * constants — including on a machine with no model dataset installed.
 */

function pt(over: Partial<CycloneTrackPoint> = {}): CycloneTrackPoint {
  return {
    id: 's-pt-0',
    timestamp: '2020-05-15 21:00:00',
    latitude: 9.6,
    longitude: 86.5,
    maxWindKts: 60,
    centralPressureMb: 985,
    category: 'Cyclonic Storm',
    windSource: 'WMO',
    pressureSource: 'WMO',
    status: 'OBSERVATION',
    distanceToCoastKm: 300,
    stormSpeedKts: 12,
    stormDirDeg: 310,
    ...over,
  };
}

describe('calculateRiskForPoint — refuses to invent inputs', () => {
  it('returns UNAVAILABLE (not a score) when wind was never observed', () => {
    const r = calculateRiskForPoint('AMPHAN', pt({ maxWindKts: null }), 100, 29);
    expect(r.status).toBe('UNAVAILABLE');
    expect(r.heuristicDemoScore).toBeNull();
    expect(r.category).toBeNull();
    expect(r.unavailableReason).toMatch(/wind/i);
  });

  it('returns UNAVAILABLE when TCHP is missing (the old 65.0 default)', () => {
    const r = calculateRiskForPoint('AMPHAN', pt(), null, 29);
    expect(r.status).toBe('UNAVAILABLE');
    expect(r.heuristicDemoScore).toBeNull();
    expect(r.unavailableReason).toMatch(/TCHP/);
  });

  it('returns UNAVAILABLE when SST is missing (the old 30.2 default)', () => {
    const r = calculateRiskForPoint('AMPHAN', pt(), 100, null);
    expect(r.status).toBe('UNAVAILABLE');
    expect(r.heuristicDemoScore).toBeNull();
  });

  it('returns UNAVAILABLE when distance to land is missing', () => {
    const r = calculateRiskForPoint('AMPHAN', pt({ distanceToCoastKm: null }), 100, 29);
    expect(r.status).toBe('UNAVAILABLE');
    expect(r.unavailableReason).toMatch(/distance to land/i);
  });

  it('has no default TCHP/SST — omitting them cannot produce a score', () => {
    // TypeScript requires the arguments; this asserts the runtime behaviour
    // for a JS caller that omits them.
    const r = (calculateRiskForPoint as any)('AMPHAN', pt());
    expect(r.status).toBe('UNAVAILABLE');
    expect(r.heuristicDemoScore).toBeNull();
  });
});

describe('calculateRiskForPoint — labelling', () => {
  const r = calculateRiskForPoint('AMPHAN', pt(), 100, 29);

  it('always reports it as unvalidated and not for operational use', () => {
    expect(r.validated).toBe(false);
    expect(r.operationalUse).toBe('NOT FOR OPERATIONAL USE');
    expect(r.disclaimer).toBe(RISK_DISCLAIMER);
    expect(r.disclaimer).toMatch(/NOT VALIDATED/);
  });

  it('exposes the weights so they cannot be mistaken for a published scale', () => {
    expect(r.weights).toEqual(RISK_HEURISTIC_WEIGHTS);
    expect(r.weights.windMaxPoints).toBe(45);
    expect(r.weights.windSaturatesAtKts).toBe(140);
  });

  it('claims no landfall geography', () => {
    expect(r.affectedRegions).toEqual([]);
    expect(JSON.stringify(r)).not.toMatch(/West Bengal Coast/);
  });

  it('states in the summary that it is not a forecast', () => {
    expect(r.explanation?.summary).toMatch(/not a forecast/i);
    expect(r.explanation?.limitations).toMatch(/NOT VALIDATED/);
  });
});

describe('calculateRiskForPoint — honest evidence', () => {
  it('reports missing pressure as null + UNAVAILABLE, not a default', () => {
    const r = calculateRiskForPoint('AMPHAN', pt({ centralPressureMb: null }), 100, 29);
    const pressure = r.evidence.find((e) => e.variable === 'Central Pressure');
    expect(pressure?.value).toBeNull();
    expect(pressure?.status).toBe('UNAVAILABLE');
    expect(pressure?.trend).toBe('unknown');
  });

  it('records which agency the wind came from', () => {
    const r = calculateRiskForPoint('AMPHAN', pt({ windSource: 'IMD' }), 100, 29);
    const src = r.evidence.find((e) => e.variable.includes('source'));
    expect(src?.value).toBe('IMD');
  });

  it('does not invent a category when wind is absent', () => {
    const r = calculateRiskForPoint('AMPHAN', pt({ maxWindKts: null, category: null }), 100, 29);
    expect(r.evidence).toEqual([]);
  });

  it('scores the observed wind, not the old fabricated 45.0 kt', () => {
    const r = calculateRiskForPoint('AMPHAN', pt({ maxWindKts: 61.3 }), 100, 29);
    const wind = r.evidence.find((e) => e.variable === 'Maximum Sustained Wind');
    expect(wind?.value).toBe('61.3');
    expect(wind?.value).not.toBe('45');
  });
});

describe('getRiskCategory', () => {
  it('keeps the existing band boundaries', () => {
    expect(getRiskCategory(90)).toBe('CRITICAL');
    expect(getRiskCategory(70)).toBe('HIGH');
    expect(getRiskCategory(45)).toBe('ELEVATED');
    expect(getRiskCategory(10)).toBe('LOW');
  });
});