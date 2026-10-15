import { describe, it, expect } from 'vitest';
import { getRiskCategory, RISK_DISCLAIMER, RISK_HEURISTIC_WEIGHTS } from './risk';

/**
 * This module is now a shared *contract* only — the backend is the sole scorer.
 *
 * The client-side `calculateRiskForPoint` was removed: it duplicated the
 * backend formula and, because TCHP/SST were optional arguments, silently
 * scored on invented constants when model data was absent. These tests pin
 * what must remain: the exposed weights, the disclaimer, and the band mapping.
 */

describe('risk contract — weights are exposed, not hidden', () => {
  it('exports every weight the backend uses', () => {
    expect(RISK_HEURISTIC_WEIGHTS).toEqual({
      windMaxPoints: 45,
      windSaturatesAtKts: 140,
      distanceMaxPoints: 30,
      distanceFloorPoints: 5,
      distanceScaleKm: 800,
      tchpMaxPoints: 15,
      tchpSaturatesAtKJPerCm2: 100,
      sstMaxPoints: 10,
      sstThresholdC: 26,
      sstSpanC: 5,
      scoreClampMin: 10,
      scoreClampMax: 98,
    });
  });

  it('states plainly that the weights are unvalidated', () => {
    expect(RISK_DISCLAIMER).toMatch(/NOT VALIDATED/);
    expect(RISK_DISCLAIMER).toMatch(/NOT FOR OPERATIONAL USE/);
    expect(RISK_DISCLAIMER).toMatch(/no published basis/i);
  });
});

describe('risk contract — no client-side scorer remains', () => {
  it('does not export a scoring function', async () => {
    const mod = await import('./risk');
    expect('calculateRiskForPoint' in mod).toBe(false);
  });
});

describe('getRiskCategory', () => {
  it('maps a score to the same bands the backend uses', () => {
    expect(getRiskCategory(90)).toBe('CRITICAL');
    expect(getRiskCategory(85)).toBe('CRITICAL');
    expect(getRiskCategory(70)).toBe('HIGH');
    expect(getRiskCategory(65)).toBe('HIGH');
    expect(getRiskCategory(45)).toBe('ELEVATED');
    expect(getRiskCategory(40)).toBe('ELEVATED');
    expect(getRiskCategory(39)).toBe('LOW');
    expect(getRiskCategory(10)).toBe('LOW');
  });
});