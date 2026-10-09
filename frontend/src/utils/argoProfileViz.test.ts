import { describe, it, expect } from 'vitest';
import type { ArgoObservationPoint } from '../types/oceanlens';
import { makeArgoMatchup } from '../test/fixtures/argoFixtures';
import {
  normalizeArgoObservations,
  normalizeArgoMatchupComparisons,
  ARGO_DUPLICATE_DEPTH_STRATEGY,
} from './argoProfileViz';

/**
 * Unit tests for the Phase 1D Argo profile chart normalization.
 *
 * The normalization builds a CHART-ONLY representation: the raw API response
 * (ArgoObservationPoint[]) is never mutated. Fixtures are synthetic shapes —
 * never real scientific values.
 */

function obs(
  depth: number | null,
  temperature?: number | null,
  salinity?: number | null
): ArgoObservationPoint {
  return {
    depth_m: depth as number,
    pressure_dbar: depth === null ? 0 : depth + 0.5,
    temperature_c: temperature,
    salinity_psu: salinity,
    temp_qc: 1,
    psal_qc: 1,
  };
}

describe('normalizeArgoObservations — basic shape', () => {
  it('returns an empty, honest representation for an empty observation list', () => {
    const result = normalizeArgoObservations([]);
    expect(result.points).toEqual([]);
    expect(result.stats.totalObservations).toBe(0);
    expect(result.stats.chartPoints).toBe(0);
    expect(result.stats.hasTemperature).toBe(false);
    expect(result.stats.hasSalinity).toBe(false);
    expect(result.stats.minDepthM).toBeNull();
    expect(result.stats.maxDepthM).toBeNull();
  });

  it('treats null/undefined observation input as empty rather than throwing', () => {
    for (const input of [null, undefined]) {
      const result = normalizeArgoObservations(input as ArgoObservationPoint[] | null);
      expect(result.points).toEqual([]);
      expect(result.stats.totalObservations).toBe(0);
    }
  });

  it('normalizes a well-formed temperature + salinity profile', () => {
    const result = normalizeArgoObservations([
      obs(0, 29.85, 32.84),
      obs(10, 29.8, 32.86),
      obs(50, 27.6, 34.05),
    ]);
    expect(result.points).toEqual([
      { depthM: 0, temperatureC: 29.85, salinityPsu: 32.84 },
      { depthM: 10, temperatureC: 29.8, salinityPsu: 32.86 },
      { depthM: 50, temperatureC: 27.6, salinityPsu: 34.05 },
    ]);
    expect(result.stats.totalObservations).toBe(3);
    expect(result.stats.chartPoints).toBe(3);
    expect(result.stats.validTemperatureCount).toBe(3);
    expect(result.stats.validSalinityCount).toBe(3);
    expect(result.stats.hasTemperature).toBe(true);
    expect(result.stats.hasSalinity).toBe(true);
    expect(result.stats.minDepthM).toBe(0);
    expect(result.stats.maxDepthM).toBe(50);
  });
});

describe('normalizeArgoObservations — missing / invalid values', () => {
  it('drops null temperature values from the temperature series but keeps the depth level', () => {
    const result = normalizeArgoObservations([
      obs(0, 29.85, 32.84),
      obs(10, null, 32.86),
      obs(50, 27.6, 34.05),
    ]);
    expect(result.points).toHaveLength(3);
    expect(result.points[1]).toEqual({ depthM: 10, temperatureC: null, salinityPsu: 32.86 });
    expect(result.stats.validTemperatureCount).toBe(2);
    expect(result.stats.validSalinityCount).toBe(3);
    expect(result.stats.hasTemperature).toBe(true);
  });

  it('drops NaN temperature and salinity values (they are not real observations)', () => {
    const result = normalizeArgoObservations([
      obs(0, NaN, NaN),
      obs(10, 29.8, 32.86),
    ]);
    expect(result.points[0]).toEqual({ depthM: 0, temperatureC: null, salinityPsu: null });
    expect(result.stats.validTemperatureCount).toBe(1);
    expect(result.stats.validSalinityCount).toBe(1);
  });

  it('treats 0.0 as a REAL value, never as missing', () => {
    const result = normalizeArgoObservations([obs(25, 0, 0)]);
    expect(result.points[0]).toEqual({ depthM: 25, temperatureC: 0, salinityPsu: 0 });
    expect(result.stats.hasTemperature).toBe(true);
    expect(result.stats.hasSalinity).toBe(true);
    expect(result.stats.validTemperatureCount).toBe(1);
    expect(result.stats.validSalinityCount).toBe(1);
  });

  it('handles a temperature-only profile (salinity entirely absent)', () => {
    const result = normalizeArgoObservations([
      obs(0, 29.85, undefined),
      obs(10, 29.8, null),
    ]);
    expect(result.stats.hasTemperature).toBe(true);
    expect(result.stats.hasSalinity).toBe(false);
    expect(result.stats.validSalinityCount).toBe(0);
    expect(result.points.map((p) => p.salinityPsu)).toEqual([null, null]);
  });

  it('handles a salinity-only profile (temperature entirely absent)', () => {
    const result = normalizeArgoObservations([
      obs(0, undefined, 32.84),
      obs(10, null, 32.86),
    ]);
    expect(result.stats.hasTemperature).toBe(false);
    expect(result.stats.hasSalinity).toBe(true);
    expect(result.points.map((p) => p.temperatureC)).toEqual([null, null]);
  });

  it('excludes observations whose depth is missing or NaN, and counts them', () => {
    const result = normalizeArgoObservations([
      obs(0, 29.85, 32.84),
      obs(null, 28.0, 33.0),
      obs(NaN, 27.0, 34.0),
      obs(50, 27.6, 34.05),
    ]);
    expect(result.points).toHaveLength(2);
    expect(result.stats.invalidDepthCount).toBe(2);
    expect(result.stats.totalObservations).toBe(4);
    expect(result.stats.chartPoints).toBe(2);
  });
});

describe('normalizeArgoObservations — duplicate depths', () => {
  it('keeps the FIRST valid value per variable at a duplicated depth (source order)', () => {
    const result = normalizeArgoObservations([
      obs(50, 27.6, 34.05),
      obs(50, 27.9, 34.1), // duplicate depth: excluded values, counted
    ]);
    expect(result.points).toEqual([{ depthM: 50, temperatureC: 27.6, salinityPsu: 34.05 }]);
    expect(result.stats.chartPoints).toBe(1);
    expect(result.stats.duplicateDepthObservations).toBe(1);
    expect(result.stats.totalObservations).toBe(2);
  });

  it('fills a variable from a later duplicate when the first observation at that depth lacked it', () => {
    const result = normalizeArgoObservations([
      obs(50, 27.6, null), // no salinity at first occurrence
      obs(50, null, 34.05), // duplicate depth provides the first VALID salinity
    ]);
    expect(result.points).toEqual([{ depthM: 50, temperatureC: 27.6, salinityPsu: 34.05 }]);
    expect(result.stats.duplicateDepthObservations).toBe(1);
    expect(result.stats.validSalinityCount).toBe(1);
  });

  it('never averages or invents values for duplicates', () => {
    const result = normalizeArgoObservations([
      obs(100, 21.3, 34.88),
      obs(100, 21.9, 34.9),
      obs(100, 20.1, 34.8),
    ]);
    expect(result.points).toEqual([{ depthM: 100, temperatureC: 21.3, salinityPsu: 34.88 }]);
    expect(result.stats.duplicateDepthObservations).toBe(2);
  });

  it('documents the duplicate-depth strategy as a stable exported constant', () => {
    expect(ARGO_DUPLICATE_DEPTH_STRATEGY).toMatch(/first valid value per variable/i);
    expect(ARGO_DUPLICATE_DEPTH_STRATEGY).toMatch(/source order/i);
  });
});

describe('normalizeArgoObservations — ordering', () => {
  it('sorts the chart representation by ascending depth', () => {
    const result = normalizeArgoObservations([
      obs(250, 12.8, 35.02),
      obs(0, 29.85, 32.84),
      obs(50, 27.6, 34.05),
      obs(10, 29.8, 32.86),
    ]);
    expect(result.points.map((p) => p.depthM)).toEqual([0, 10, 50, 250]);
  });

  it('never mutates the raw API response (array or observation objects)', () => {
    const raw: ArgoObservationPoint[] = [
      obs(250, 12.8, 35.02),
      obs(10, 29.8, 32.86),
      obs(10, 29.9, 32.9),
    ];
    const snapshot = JSON.parse(JSON.stringify(raw));
    normalizeArgoObservations(raw);
    expect(JSON.parse(JSON.stringify(raw))).toEqual(snapshot);
  });
});

describe('normalizeArgoObservations — extreme but legitimate profiles', () => {
  it('handles a shallow profile (few meters)', () => {
    const result = normalizeArgoObservations([obs(0, 30.1, 31.4), obs(2.5, 30.0, 31.5)]);
    expect(result.stats.minDepthM).toBe(0);
    expect(result.stats.maxDepthM).toBe(2.5);
    expect(result.points).toHaveLength(2);
  });

  describe('normalizeArgoMatchupComparisons', () => {
    it('keeps finite matched Argo and native HYCOM depths sorted without interpolation', () => {
      const matchup = makeArgoMatchup({
        comparisons: [
          {
            depthM: 50,
            argoTemperatureC: 27.6,
            modelTemperatureC: 27.2,
            matchedModelDepthM: 49.5,
            argoSalinityPSU: 34,
            modelSalinityPSU: 34.1,
            salinityResidualPSU: 0.1,
            temperatureResidualC: -0.4,
          },
          {
            depthM: 10,
            argoTemperatureC: 29.8,
            modelTemperatureC: 29.4,
            matchedModelDepthM: 10,
            argoSalinityPSU: 32.8,
            modelSalinityPSU: 32.9,
            salinityResidualPSU: 0.1,
            temperatureResidualC: -0.4,
          },
        ],
      });

      const normalized = normalizeArgoMatchupComparisons(matchup.comparisons);

      expect(normalized.temperaturePoints).toEqual([
        { depthM: 10, value: 29.8, series: 'ARGO OBSERVATION', comparisonIndex: 1 },
        { depthM: 10, value: 29.4, series: 'HYCOM MODEL', comparisonIndex: 1 },
        { depthM: 49.5, value: 27.2, series: 'HYCOM MODEL', comparisonIndex: 0 },
        { depthM: 50, value: 27.6, series: 'ARGO OBSERVATION', comparisonIndex: 0 },
      ]);
      expect(normalized.stats.temperatureArgoCount).toBe(2);
      expect(normalized.stats.temperatureModelCount).toBe(2);
      expect(normalized.stats.interpolationApplied).toBe(false);
    });

    it('excludes null, NaN, duplicate depth values, and reports unavailable salinity', () => {
      const normalized = normalizeArgoMatchupComparisons([
        {
          depthM: 0,
          argoTemperatureC: 30,
          modelTemperatureC: 29.5,
          matchedModelDepthM: 0,
          argoSalinityPSU: null,
          modelSalinityPSU: NaN,
        },
        {
          depthM: 0,
          argoTemperatureC: 31,
          modelTemperatureC: null,
          matchedModelDepthM: 0,
          argoSalinityPSU: null,
          modelSalinityPSU: null,
        },
      ]);

      expect(normalized.stats.temperatureArgoCount).toBe(2);
      expect(normalized.stats.temperatureModelCount).toBe(1);
      expect(normalized.stats.salinityAvailable).toBe(false);
      expect(normalized.stats.duplicateDepthCount).toBe(1);
    });

    it('preserves repeated native model depths as separate matched pairs', () => {
      const normalized = normalizeArgoMatchupComparisons([
        {
          depthM: 10,
          argoTemperatureC: 29.8,
          modelTemperatureC: 29.4,
          matchedModelDepthM: 10,
        },
        {
          depthM: 25,
          argoTemperatureC: 28.9,
          modelTemperatureC: 29.4,
          matchedModelDepthM: 10,
        },
      ]);

      expect(normalized.temperaturePoints).toHaveLength(4);
      expect(
        normalized.temperaturePoints.filter((point) => point.series === 'HYCOM MODEL')
      ).toEqual([
        expect.objectContaining({ depthM: 10, value: 29.4 }),
        expect.objectContaining({ depthM: 10, value: 29.4 }),
      ]);
      expect(
        new Set(
          normalized.temperaturePoints.map((point) => `${point.series}:${point.comparisonIndex}`)
        ).size
      ).toBe(4);
    });

    it('preserves all seven fixture matched pairs including the repeated 10 m model depth', () => {
      const normalized = normalizeArgoMatchupComparisons(
        [0, 10, 10, 50, 100, 250, 500].map((modelDepth, comparisonIndex) => ({
          depthM: [0, 10, 25, 50, 100, 250, 500][comparisonIndex],
          argoTemperatureC: 30 - comparisonIndex,
          modelTemperatureC: 29 - comparisonIndex,
          matchedModelDepthM: modelDepth,
          argoSalinityPSU: 32 + comparisonIndex,
          modelSalinityPSU: 33 + comparisonIndex,
        }))
      );

      expect(normalized.temperaturePoints).toHaveLength(14);
      expect(normalized.salinityPoints).toHaveLength(14);
      expect(
        normalized.temperaturePoints.filter((point) => point.series === 'HYCOM MODEL')
      ).toHaveLength(7);
      expect(
        normalized.temperaturePoints.filter(
          (point) => point.series === 'HYCOM MODEL' && point.depthM === 10
        )
      ).toHaveLength(2);
    });
  });

  it('handles a deep profile (2000 m)', () => {
    const depths = [0, 100, 250, 500, 1000, 1500, 2000];
    const result = normalizeArgoObservations(depths.map((d) => obs(d, 30 - d / 100, 35)));
    expect(result.stats.maxDepthM).toBe(2000);
    expect(result.points.map((p) => p.depthM)).toEqual(depths);
    expect(result.stats.chartPoints).toBe(7);
  });

  it('handles a single-observation profile', () => {
    const result = normalizeArgoObservations([obs(500, 8.95, 35.08)]);
    expect(result.points).toEqual([{ depthM: 500, temperatureC: 8.95, salinityPsu: 35.08 }]);
    expect(result.stats.minDepthM).toBe(500);
    expect(result.stats.maxDepthM).toBe(500);
  });
});

describe('normalizeArgoMatchupComparisons — interpolated vs native method', () => {
  it('carries the backend method through to the model chart points', () => {
    const normalized = normalizeArgoMatchupComparisons([
      {
        depthM: 0,
        method: 'native',
        argoTemperatureC: 29.85,
        modelTemperatureC: 29.4,
        matchedModelDepthM: 0,
      },
      {
        depthM: 25.05,
        method: 'interpolated',
        argoTemperatureC: 28.7,
        modelTemperatureC: 28.1,
        matchedModelDepthM: 25.05,
      },
    ]);

    const modelPoints = normalized.temperaturePoints.filter((p) => p.series === 'HYCOM MODEL');
    expect(modelPoints.map((p) => p.method)).toEqual(['native', 'interpolated']);
    expect(normalized.stats.interpolationApplied).toBe(true);
    expect(normalized.stats.interpolatedCount).toBe(1);
    expect(normalized.stats.nativeCount).toBe(1);
  });

  it('reports no interpolation when every matched level is native', () => {
    const normalized = normalizeArgoMatchupComparisons([
      {
        depthM: 50,
        method: 'native',
        argoTemperatureC: 27.6,
        modelTemperatureC: 27.2,
        matchedModelDepthM: 50,
      },
    ]);

    expect(normalized.stats.interpolationApplied).toBe(false);
    expect(normalized.stats.interpolatedCount).toBe(0);
    expect(normalized.stats.nativeCount).toBe(1);
  });

  it('never invents a method when the backend omits it', () => {
    const normalized = normalizeArgoMatchupComparisons([
      {
        depthM: 50,
        argoTemperatureC: 27.6,
        modelTemperatureC: 27.2,
        matchedModelDepthM: 50,
      },
    ]);

    expect(
      normalized.temperaturePoints.every((p) => p.method === undefined)
    ).toBe(true);
    expect(normalized.stats.interpolationApplied).toBe(false);
  });
});
