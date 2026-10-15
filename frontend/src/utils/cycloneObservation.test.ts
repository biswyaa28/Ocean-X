import { describe, it, expect } from 'vitest';
import {
  hasObservedRadius,
  observedRadii,
  formatCycloneIntensity,
  cycloneEyeLabel,
} from './cycloneObservation';
import type { CycloneTrackPoint } from '../types/oceanlens';

function pt(over: Partial<CycloneTrackPoint> = {}): CycloneTrackPoint {
  return {
    id: 'pt-0',
    timestamp: '2020-05-15 21:00:00',
    latitude: 9.6,
    longitude: 86.5,
    maxWindKts: null,
    centralPressureMb: null,
    category: null,
    windSource: null,
    pressureSource: null,
    status: 'OBSERVATION',
    distanceToCoastKm: 563,
    stormSpeedKts: 12,
    stormDirDeg: 310,
    ...over,
  };
}

describe('hasObservedRadius', () => {
  it('accepts a positive observed radius', () => {
    expect(hasObservedRadius(120)).toBe(true);
    expect(hasObservedRadius(0.5)).toBe(true);
  });

  it('rejects absent, zero and non-finite radii', () => {
    expect(hasObservedRadius(null)).toBe(false);
    expect(hasObservedRadius(undefined)).toBe(false);
    expect(hasObservedRadius(0)).toBe(false);
    expect(hasObservedRadius(NaN)).toBe(false);
  });
});

describe('observedRadii', () => {
  it('omits radii the agency did not report instead of defaulting them', () => {
    const r = observedRadii({ r34ktsKm: null, r50ktsKm: null, r64ktsKm: null, source: null });
    expect(r).toEqual({ r34ktsKm: null, r50ktsKm: null });
  });

  it('keeps a real radius and its source', () => {
    const r = observedRadii({
      r34ktsKm: 120,
      r50ktsKm: null,
      r64ktsKm: null,
      source: 'USA quadrant radii (IBTrACS)',
    });
    expect(r.r34ktsKm).toBe(120);
    expect(r.r50ktsKm).toBeNull();
  });

  it('tolerates a missing windRadius object entirely', () => {
    expect(observedRadii(null)).toEqual({ r34ktsKm: null, r50ktsKm: null });
    expect(observedRadii(undefined)).toEqual({ r34ktsKm: null, r50ktsKm: null });
  });

  it('never returns the old hardcoded 260/140/75 constants', () => {
    const r = observedRadii({ r34ktsKm: null, r50ktsKm: null, r64ktsKm: null, source: null });
    expect(r.r34ktsKm).not.toBe(260);
    expect(r.r50ktsKm).not.toBe(140);
  });
});

describe('formatCycloneIntensity', () => {
  it('reports absence explicitly rather than rendering null/undefined', () => {
    expect(formatCycloneIntensity(pt())).toBe('INTENSITY NOT OBSERVED');
    expect(formatCycloneIntensity(pt({ maxWindKts: null, category: null }))).not.toMatch(/null|undefined/);
  });

  it('handles a missing track point', () => {
    expect(formatCycloneIntensity(null)).toBe('INTENSITY NOT OBSERVED');
    expect(formatCycloneIntensity(undefined)).toBe('INTENSITY NOT OBSERVED');
  });

  it('uses UNCLASSIFIED when wind exists but the category does not', () => {
    expect(formatCycloneIntensity(pt({ maxWindKts: 55, category: null }))).toBe(
      'UNCLASSIFIED · 55 KT'
    );
  });

  it('uses the real category when present', () => {
    expect(formatCycloneIntensity(pt({ maxWindKts: 61.3, category: 'Severe Cyclonic Storm' }))).toBe(
      'SEVERE CYCLONIC STORM · 61.3 KT'
    );
  });
});

describe('cycloneEyeLabel', () => {
  it('does not throw or emit null when the served point has no observation', () => {
    const label = cycloneEyeLabel('AMPHAN', pt());
    expect(label).toContain('AMPHAN');
    expect(label).toContain('INTENSITY NOT OBSERVED');
    expect(label).not.toMatch(/null/);
  });

  it('tolerates an entirely absent point', () => {
    expect(cycloneEyeLabel('AMPHAN', null)).toContain('INTENSITY NOT OBSERVED');
  });

  it('never emits the fabricated 45 KT / 990 mb signature', () => {
    const label = cycloneEyeLabel('AMPHAN', pt({ maxWindKts: 45, category: 'Cyclonic Storm' }));
    expect(label).toBe('EYE OF STORM: AMPHAN\nCYCLONIC STORM · 45 KT');
  });
});