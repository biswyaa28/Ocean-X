import { describe, it, expect } from 'vitest';
import {
  ARGO_QC_ACCEPTED,
  RIBBON_DEFAULT_EXAGGERATION,
  RIBBON_DEPTH_TICKS_M,
  buildRibbonModelMarkers,
  buildRibbonProfile,
  decimateRibbonLevels,
  nearestRibbonLevel,
  ribbonDepthTicks,
  ribbonExaggerationLabel,
  ribbonHeightM,
  ribbonModelTooltip,
  ribbonPointTooltip,
  selectRibbonLevels,
  type RibbonLevel,
  type RibbonObservation,
} from './argoProfileRibbon';

/**
 * A profile shaped like a real one: warm mixed layer, sharp thermocline, cold
 * deep water, then uniform deep sampling down to 2000 m. The thermocline is the
 * part that must survive decimation.
 */
function syntheticProfile({
  stepM = 5,
  maxDepthM = 2000,
  thermoTopM = 80,
  thermoBottomM = 160,
}: {
  stepM?: number;
  maxDepthM?: number;
  thermoTopM?: number;
  thermoBottomM?: number;
} = {}): RibbonObservation[] {
  const observations: RibbonObservation[] = [];
  for (let depth = 0; depth <= maxDepthM; depth += stepM) {
    let temperature: number;
    if (depth <= thermoTopM) temperature = 29.2;
    else if (depth >= thermoBottomM) temperature = 12;
    else temperature = 29.2 - ((depth - thermoTopM) / (thermoBottomM - thermoTopM)) * 17.2;
    observations.push({
      depth_m: depth,
      temperature_c: Math.round(temperature * 1000) / 1000,
      salinity_psu: 34 + depth / 500,
      temp_qc: 1,
      psal_qc: 1,
    });
  }
  return observations;
}

function levelsFrom(observations: RibbonObservation[]): RibbonLevel[] {
  return observations.map((o) => ({ depthM: o.depth_m as number, value: o.temperature_c as number }));
}

describe('selectRibbonLevels', () => {
  it('keeps only QC-accepted levels', () => {
    const result = selectRibbonLevels(
      [
        { depth_m: 0, temperature_c: 29, temp_qc: 1 },
        { depth_m: 10, temperature_c: 29, temp_qc: 3 }, // rejected
        { depth_m: 20, temperature_c: 28, temp_qc: 2 }, // accepted
        { depth_m: 30, temperature_c: 28, temp_qc: 4 }, // rejected
      ],
      'temperature_c'
    );
    expect(result.levels.map((l) => l.depthM)).toEqual([0, 20]);
    expect(result.rejectedByQcCount).toBe(2);
  });

  it('excludes the adjusted-only flag 5 by default, because the basis is unknown', () => {
    const observations: RibbonObservation[] = [{ depth_m: 10, temperature_c: 29, temp_qc: 5 }];
    expect(selectRibbonLevels(observations, 'temperature_c').levels).toHaveLength(0);
    // The same level IS accepted when the caller states the data are adjusted.
    expect(
      selectRibbonLevels(observations, 'temperature_c', [1, 2, 5]).levels
    ).toHaveLength(1);
    expect(ARGO_QC_ACCEPTED).toEqual([1, 2]);
  });

  it('excludes flag 8 even when adjusted flags are accepted', () => {
    // 8 means interpolated between measurements; a ribbon shows what was measured.
    const observations: RibbonObservation[] = [{ depth_m: 10, temperature_c: 29, temp_qc: 8 }];
    expect(
      selectRibbonLevels(observations, 'temperature_c', [1, 2, 5]).levels
    ).toHaveLength(0);
  });

  it('assumes the backend default flag when a level carries none', () => {
    const result = selectRibbonLevels([{ depth_m: 5, temperature_c: 29 }], 'temperature_c');
    expect(result.levels).toHaveLength(1);
    expect(result.rejectedByQcCount).toBe(0);
  });

  it('drops levels whose selected variable is missing, and counts them separately', () => {
    const result = selectRibbonLevels(
      [
        { depth_m: 0, temperature_c: 29, salinity_psu: null, temp_qc: 1, psal_qc: 1 },
        { depth_m: 10, temperature_c: 29, salinity_psu: 34.5, temp_qc: 1, psal_qc: 1 },
      ],
      'salinity_psu'
    );
    expect(result.levels.map((l) => l.depthM)).toEqual([10]);
    expect(result.missingValueCount).toBe(1);
  });

  it('checks QC before the variable, so a rejected level is never counted as missing', () => {
    const result = selectRibbonLevels(
      [{ depth_m: 0, temperature_c: null, temp_qc: 3 }],
      'temperature_c'
    );
    expect(result.rejectedByQcCount).toBe(1);
    expect(result.missingValueCount).toBe(0);
  });

  it('sorts by depth and keeps one level per depth', () => {
    const result = selectRibbonLevels(
      [
        { depth_m: 30, temperature_c: 20, temp_qc: 1 },
        { depth_m: 10, temperature_c: 28, temp_qc: 1 },
        { depth_m: 10, temperature_c: 28, temp_qc: 1 },
      ],
      'temperature_c'
    );
    expect(result.levels.map((l) => l.depthM)).toEqual([10, 30]);
  });
});

describe('decimateRibbonLevels', () => {
  const levels = levelsFrom(syntheticProfile());

  it('keeps every level when the profile already fits the budget', () => {
    const short = levelsFrom(syntheticProfile({ maxDepthM: 100, stepM: 5 })); // 21 levels
    expect(decimateRibbonLevels(short, 100)).toEqual(short.map((_, index) => index));
    expect(decimateRibbonLevels(levels, levels.length)).toEqual(
      levels.map((_, index) => index)
    );
  });

  it('keeps both endpoints so the ribbon spans the whole profile', () => {
    const kept = decimateRibbonLevels(levels, 40);
    expect(kept[0]).toBe(0);
    expect(kept[kept.length - 1]).toBe(levels.length - 1);
    expect(levels[kept[0]].depthM).toBe(0);
    expect(levels[kept[kept.length - 1]].depthM).toBe(2000);
  });

  it('respects the segment budget', () => {
    for (const budget of [10, 40, 100, 250]) {
      expect(decimateRibbonLevels(levels, budget).length).toBeLessThanOrEqual(budget);
    }
  });

  it('never invents a level: every kept index is a real input index', () => {
    const kept = decimateRibbonLevels(levels, 60);
    expect(new Set(kept).size).toBe(kept.length); // no duplicates
    kept.forEach((index) => {
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(levels.length);
      expect(Number.isInteger(index)).toBe(true);
    });
  });

  it('keeps depths strictly increasing, so the ribbon never folds back on itself', () => {
    const depths = decimateRibbonLevels(levels, 37).map((index) => levels[index].depthM);
    for (let i = 1; i < depths.length; i++) {
      expect(depths[i]).toBeGreaterThan(depths[i - 1]);
    }
  });

  it('spends more of the budget on the thermocline than on uniform deep water', () => {
    const budget = 50;
    const depths = decimateRibbonLevels(levels, budget).map((index) => levels[index].depthM);
    const inThermo = depths.filter((d) => d >= 80 && d <= 160).length;

    // 80 of 2000 m is 4% of the column. A uniform fill would put ~2 of 50 there.
    expect(inThermo).toBeGreaterThanOrEqual(8);
    // Deep water, 90% of the column, must still be sampled.
    const inDeep = depths.filter((d) => d > 160).length;
    expect(inDeep).toBeGreaterThan(20);
  });

  it('resolves a very thin thermocline better than a uniform sample would', () => {
    // A sharp 40 m transition: uniform decimation would step straight over it.
    const thin = levelsFrom(syntheticProfile({ thermoTopM: 100, thermoBottomM: 140 }));
    const kept = decimateRibbonLevels(thin, 40);
    const depths = kept.map((index) => thin[index].depthM);
    expect(depths).toContain(100);
    expect(depths).toContain(140);
    // The largest retained gap inside the transition is far below the coarse
    // spacing a uniform fill of 40 points over 2000 m would leave.
    const inside = depths.filter((d) => d >= 100 && d <= 140);
    expect(inside.length).toBeGreaterThanOrEqual(4);
  });

  it('handles degenerate inputs', () => {
    expect(decimateRibbonLevels([], 40)).toEqual([]);
    expect(decimateRibbonLevels([{ depthM: 0, value: 1 }], 40)).toEqual([0]);
    expect(
      decimateRibbonLevels([{ depthM: 0, value: 1 }, { depthM: 1, value: 2 }], 40)
    ).toEqual([0, 1]);
  });

  it('never returns more points than the input has', () => {
    expect(decimateRibbonLevels(levels, 10_000)).toHaveLength(levels.length);
  });
});

describe('nearestRibbonLevel', () => {
  const points = [
    { depthM: 0, value: 29, t: 1 },
    { depthM: 50, value: 28, t: 0.9 },
    { depthM: 100, value: 24, t: 0.6 },
    { depthM: 200, value: 16, t: 0.2 },
  ];

  it('snaps an arbitrary position to a real measured level', () => {
    // 71 m sits between the 50 m and 100 m levels; neither was ever measured at 71.
    expect(nearestRibbonLevel(points, 71)?.depthM).toBe(50);
    expect(nearestRibbonLevel(points, 80)?.depthM).toBe(100);
  });

  it('never returns a depth that was not in the profile', () => {
    const measured = new Set(points.map((p) => p.depthM));
    for (const target of [1, 13.7, 71, 99.9, 150, 199]) {
      const level = nearestRibbonLevel(points, target);
      expect(measured.has(level!.depthM)).toBe(true);
      expect(level!.value).toBe(points.find((p) => p.depthM === level!.depthM)!.value);
    }
  });

  it('is exact at a measured depth', () => {
    expect(nearestRibbonLevel(points, 100)?.depthM).toBe(100);
    expect(nearestRibbonLevel(points, 0)?.depthM).toBe(0);
  });

  it('handles an empty profile and a nonsense target', () => {
    expect(nearestRibbonLevel([], 10)).toBeNull();
    expect(nearestRibbonLevel(points, Number.NaN)).toBeNull();
  });
});

describe('buildRibbonProfile', () => {
  it('draws only measured, QC-accepted levels', () => {
    const profile = buildRibbonProfile(syntheticProfile(), 'temperature_c', 40);
    expect(profile.rejection).toBeNull();
    expect(profile.eligibleLevelCount).toBe(401);
    const inputValues = new Set(syntheticProfile().map((o) => o.temperature_c));
    profile.points.forEach((point) => {
      expect(inputValues.has(point.value)).toBe(true);
    });
  });

  it('reports an explicit rejection instead of an empty ribbon', () => {
    expect(buildRibbonProfile([], 'temperature_c').rejection).toBe('NO_PROFILE');
    expect(buildRibbonProfile(null, 'temperature_c').rejection).toBe('NO_PROFILE');
    expect(
      buildRibbonProfile([{ depth_m: 0, temperature_c: 29, temp_qc: 4 }], 'temperature_c')
        .rejection
    ).toBe('NO_QC_ACCEPTED_LEVELS');
    expect(
      buildRibbonProfile([{ depth_m: 0, salinity_psu: null, temp_qc: 1 }], 'salinity_psu')
        .rejection
    ).toBe('NO_FINITE_VALUE_FOR_VARIABLE');
  });

  it('colours against the full eligible range, not the decimated subset', () => {
    const observations = syntheticProfile();
    const wide = buildRibbonProfile(observations, 'temperature_c', 100);
    const narrow = buildRibbonProfile(observations, 'temperature_c', 20);
    expect(wide.valueMin).toBe(narrow.valueMin);
    expect(wide.valueMax).toBe(narrow.valueMax);
    // The shallowest and deepest kept levels keep their colour under decimation.
    expect(wide.points[0].t).toBeCloseTo(narrow.points[0].t, 10);
  });

  it('normalises colour into 0..1 and survives a single-valued profile', () => {
    const profile = buildRibbonProfile(
      syntheticProfile({ thermoTopM: 0, thermoBottomM: 1, maxDepthM: 50 }),
      'temperature_c'
    );
    profile.points.forEach((point) => {
      expect(point.t).toBeGreaterThanOrEqual(0);
      expect(point.t).toBeLessThanOrEqual(1);
    });

    const flat = buildRibbonProfile(
      [
        { depth_m: 0, temperature_c: 20, temp_qc: 1 },
        { depth_m: 10, temperature_c: 20, temp_qc: 1 },
      ],
      'temperature_c'
    );
    expect(flat.points.every((p) => p.t === 0.5)).toBe(true);
  });

  it('records the profile extent and what it dropped', () => {
    const observations = syntheticProfile();
    observations.push({ depth_m: 2005, temperature_c: 11, temp_qc: 3 });
    const profile = buildRibbonProfile(observations, 'temperature_c', 40);
    expect(profile.maxDepthM).toBe(2000);
    expect(profile.minDepthM).toBe(0);
    expect(profile.rejectedByQcCount).toBe(1);
  });
});

describe('ribbonDepthTicks', () => {
  it('returns the standard marks a profile actually reaches', () => {
    expect(ribbonDepthTicks(2000)).toEqual([0, 100, 250, 500, 1000, 2000]);
    expect(ribbonDepthTicks(600)).toEqual([0, 100, 250, 500]);
    expect(ribbonDepthTicks(250)).toEqual([0, 100, 250]);
  });

  it('never labels a depth deeper than the float reached', () => {
    const maxDepth = 300;
    const ticks = ribbonDepthTicks(maxDepth);
    expect(Math.max(...ticks)).toBeLessThanOrEqual(maxDepth);
    expect(ticks).not.toContain(1000);
  });

  it('handles an unknown or degenerate extent', () => {
    expect(ribbonDepthTicks(null)).toEqual([]);
    expect(ribbonDepthTicks(0)).toEqual([]);
    expect(ribbonDepthTicks(Number.NaN)).toEqual([]);
  });

  it('agrees with the exported tick ladder', () => {
    expect(ribbonDepthTicks(5000)).toEqual([...RIBBON_DEPTH_TICKS_M]);
  });
});

describe('ribbonHeightM', () => {
  it('scales depth by the exaggeration and never inverts', () => {
    expect(ribbonHeightM(100, 40)).toBe(4000);
    expect(ribbonHeightM(0, 40)).toBe(0);
    expect(ribbonHeightM(100, 10)).toBe(1000);
    expect(ribbonHeightM(100, 100)).toBe(10_000);
  });

  it('falls back to 1x for a missing or nonsensical exaggeration', () => {
    expect(ribbonHeightM(100, 0)).toBe(100);
    expect(ribbonHeightM(100, -5)).toBe(100);
    expect(ribbonHeightM(100, Number.NaN)).toBe(100);
  });

  it('keeps exaggeration monotonic: more exaggeration is deeper on screen', () => {
    expect(ribbonHeightM(500, 10)).toBeLessThan(ribbonHeightM(500, 40));
    expect(ribbonHeightM(500, 40)).toBeLessThan(ribbonHeightM(500, 100));
  });

  it('labels the exaggeration as such, so the scene is never misread as true scale', () => {
    expect(ribbonExaggerationLabel(RIBBON_DEFAULT_EXAGGERATION)).toBe('vertical exaggeration 40x');
  });
});

describe('buildRibbonModelMarkers', () => {
  const comparisons = [
    { depthM: 0, modelTemperatureC: 29.4, method: 'native' },
    { depthM: 10, modelTemperatureC: 29.1, method: 'native' },
    { depthM: 50, modelTemperatureC: 28.4, method: 'native' },
    { depthM: 100, modelTemperatureC: 24.1, method: 'native' },
    { depthM: 250, modelTemperatureC: 18.2, method: 'native' },
    { depthM: 500, modelTemperatureC: 13.0, method: 'native' },
  ];

  const fileLabels: Record<number, number> = { 10: 17.5, 50: 52.5, 100: 125, 250: 275 };
  const fileLabelFor = (depthM: number) =>
    Object.prototype.hasOwnProperty.call(fileLabels, depthM) ? fileLabels[depthM] : null;

  it('produces one marker per model level with a value for the variable', () => {
    const markers = buildRibbonModelMarkers(comparisons, 'temperature_c', 12, 30, fileLabelFor);
    expect(markers.map((m) => m.depthM)).toEqual([0, 10, 50, 100, 250, 500]);
  });

  it("carries the file's own label only where it differs from the sampled depth", () => {
    const markers = buildRibbonModelMarkers(comparisons, 'temperature_c', 12, 30, fileLabelFor);
    expect(markers.find((m) => m.depthM === 100)?.fileLabelM).toBe(125);
    expect(markers.find((m) => m.depthM === 0)?.fileLabelM).toBeNull();
    expect(markers.find((m) => m.depthM === 500)?.fileLabelM).toBeNull();
  });

  it('colours markers on the same scale as the ribbon', () => {
    const markers = buildRibbonModelMarkers(comparisons, 'temperature_c', 12, 30, fileLabelFor);
    const surface = markers.find((m) => m.depthM === 0)!;
    const deep = markers.find((m) => m.depthM === 500)!;
    expect(surface.t).toBeCloseTo((29.4 - 12) / 18, 6);
    expect(deep.t).toBeCloseTo((13.0 - 12) / 18, 6);
    expect(deep.t).toBeLessThan(surface.t);
  });

  it('skips levels with no value for the selected variable', () => {
    const markers = buildRibbonModelMarkers(
      [
        { depthM: 0, modelTemperatureC: 29, method: 'native' },
        { depthM: 50, modelSalinityPSU: 34.5, modelTemperatureC: null, method: 'native' },
      ],
      'temperature_c',
      12,
      30,
      () => null
    );
    expect(markers.map((m) => m.depthM)).toEqual([0]);
  });

  it('returns nothing when the matchup has no comparisons or no model values', () => {
    expect(buildRibbonModelMarkers([], 'temperature_c', 12, 30, () => null)).toEqual([]);
    expect(buildRibbonModelMarkers(null, 'temperature_c', 12, 30, () => null)).toEqual([]);
    expect(
      buildRibbonModelMarkers([{ depthM: 10, modelTemperatureC: null }], 'temperature_c', 12, 30, () => null)
    ).toEqual([]);
  });
});

describe('ribbon tooltips', () => {
  it('shows the real depth and the measured value for a ribbon vertex', () => {
    expect(
      ribbonPointTooltip({ depthM: 120, value: 21.456, t: 0.5 }, 'temperature_c')
    ).toBe('120 m · 21.46 °C');
    expect(
      ribbonPointTooltip({ depthM: 17.5, value: 34.5, t: 0.5 }, 'salinity_psu')
    ).toBe('17.5 m · 34.50 PSU');
  });

  it('shows the file label on a model marker only when it differs', () => {
    const withLabel = {
      depthM: 100,
      fileLabelM: 125,
      value: 24.1,
      t: 0.7,
      method: 'native',
    };
    const sameLabel = { ...withLabel, fileLabelM: null, depthM: 500 };
    const formatter = (depthM: number, fileLabelM: number | null) =>
      fileLabelM === null ? `${depthM} m` : `${depthM} m (file label ${fileLabelM} m)`;

    expect(ribbonModelTooltip(withLabel, 'temperature_c', formatter)).toBe(
      '100 m (file label 125 m) · 24.10 °C · NATIVE'
    );
    expect(ribbonModelTooltip(sameLabel, 'temperature_c', formatter)).toBe(
      '500 m · 24.10 °C · NATIVE'
    );
  });

  it('omits the method when the backend did not report one', () => {
    expect(
      ribbonModelTooltip({ depthM: 10, fileLabelM: null, value: 29, t: 1, method: null }, 'temperature_c', () => '10 m')
    ).toBe('10 m · 29.00 °C');
  });
});