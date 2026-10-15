/**
 * OCEAN-X SIH26067 — Argo observation profile chart normalization (Phase 1D).
 *
 * Builds the CHART-ONLY representation of an Argo profile for the
 * depth-vs-variable visualization:
 *
 * Hard guarantees:
 * - The raw API response (ArgoObservationPoint[]) is NEVER mutated. The
 *   normalized points are a separate, chart-specific representation.
 * - `depth_m` is used exactly as supplied by the dataset (source-provided
 *   depth). No pressure-to-depth, TEOS-10 or GSW conversion is performed or
 *   implied anywhere in this module.
 * - null / undefined / NaN / non-finite values are treated as missing —
 *   they are never coerced, imputed or averaged. 0.0 is a REAL value.
 * - Duplicate depths are resolved deterministically: the FIRST VALID value
 *   per variable at each depth (in source order) is kept. Later duplicates
 *   never contribute averaged or invented values; they are only counted so
 *   the UI can disclose them.
 * - The chart representation is sorted by ascending depth; the source order
 *   of the raw response is preserved in the raw response itself.
 */

import {
  ArgoObservationPoint,
  DepthComparison,
  MatchupLevelMethod,
  MatchupMode,
} from '../types/oceanlens';

/** A chart-ready point at a unique, finite depth. Missing variables are null. */
export interface ArgoProfileChartPoint {
  depthM: number;
  temperatureC: number | null;
  salinityPsu: number | null;
}

/** Transparency statistics about how the raw response became the chart data. */
export interface ArgoProfileNormalizationStats {
  /** Observations in the raw response. */
  totalObservations: number;
  /** Unique finite-depth levels in the chart representation. */
  chartPoints: number;
  /** Chart points carrying a valid temperature. */
  validTemperatureCount: number;
  /** Chart points carrying a valid salinity. */
  validSalinityCount: number;
  /** Observations excluded because depth_m was missing/NaN/non-finite. */
  invalidDepthCount: number;
  /** Observations at a depth already seen earlier in source order. */
  duplicateDepthObservations: number;
  hasTemperature: boolean;
  hasSalinity: boolean;
  minDepthM: number | null;
  maxDepthM: number | null;
}

export interface NormalizedArgoProfile {
  /** Sorted by ascending depth. One entry per unique finite depth. */
  points: ArgoProfileChartPoint[];
  stats: ArgoProfileNormalizationStats;
}

/** Human-readable statement of the duplicate-depth strategy (surfaced in the UI). */
export const ARGO_DUPLICATE_DEPTH_STRATEGY =
  'Duplicate depths: the first valid value per variable in source order is kept; later duplicates are excluded from the chart and never averaged.';

/** A value is usable only when it is a finite number. 0.0 is REAL. */
function isValidNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Normalize raw Argo observations into the chart representation.
 * Accepts null/undefined input (treated as an empty profile).
 */
export function normalizeArgoObservations(
  observations: ArgoObservationPoint[] | null | undefined
): NormalizedArgoProfile {
  const source = Array.isArray(observations) ? observations : [];

  // First pass (source order): one chart point per unique finite depth,
  // first valid value per variable at that depth.
  const byDepth = new Map<number, ArgoProfileChartPoint>();
  let invalidDepthCount = 0;
  let duplicateDepthObservations = 0;

  for (const o of source) {
    if (!o || !isValidNumber(o.depth_m)) {
      invalidDepthCount++;
      continue;
    }
    const depth = o.depth_m;

    let point = byDepth.get(depth);
    if (!point) {
      point = { depthM: depth, temperatureC: null, salinityPsu: null };
      byDepth.set(depth, point);
    } else {
      duplicateDepthObservations++;
    }

    // First VALID value per variable wins; a later duplicate never overwrites.
    if (point.temperatureC === null && isValidNumber(o.temperature_c)) {
      point.temperatureC = o.temperature_c;
    }
    if (point.salinityPsu === null && isValidNumber(o.salinity_psu)) {
      point.salinityPsu = o.salinity_psu;
    }
  }

  // Chart representation only: sort by ascending depth.
  const points = Array.from(byDepth.values()).sort((a, b) => a.depthM - b.depthM);

  let validTemperatureCount = 0;
  let validSalinityCount = 0;
  let minDepthM: number | null = null;
  let maxDepthM: number | null = null;
  for (const p of points) {
    if (p.temperatureC !== null) validTemperatureCount++;
    if (p.salinityPsu !== null) validSalinityCount++;
    if (minDepthM === null || p.depthM < minDepthM) minDepthM = p.depthM;
    if (maxDepthM === null || p.depthM > maxDepthM) maxDepthM = p.depthM;
  }

  return {
    points,
    stats: {
      totalObservations: source.length,
      chartPoints: points.length,
      validTemperatureCount,
      validSalinityCount,
      invalidDepthCount,
      duplicateDepthObservations,
      hasTemperature: validTemperatureCount > 0,
      hasSalinity: validSalinityCount > 0,
      minDepthM,
      maxDepthM,
    },
  };
}

export interface ComparisonChartPoint {
  depthM: number;
  value: number;
  series: 'ARGO OBSERVATION' | 'HYCOM MODEL';
  comparisonIndex: number;
  /**
   * How the backend obtained the value for this matched level. Undefined on
   * ARGO OBSERVATION points.
   *  - 'native' / 'interpolated'          model value, float_levels mode
   *  - 'float_native' / 'float_interpolated' float value, model_levels mode
   */
  method?: MatchupLevelMethod | null;
}

export interface NormalizedArgoMatchup {
  temperaturePoints: ComparisonChartPoint[];
  salinityPoints: ComparisonChartPoint[];
  stats: {
    temperatureArgoCount: number;
    temperatureModelCount: number;
    salinityArgoCount: number;
    salinityModelCount: number;
    salinityAvailable: boolean;
    duplicateDepthCount: number;
    /** Model points obtained from a native level / by interpolation. */
    nativeCount: number;
    /** Which comparison mode produced these rows (echoed from the response). */
    matchMode?: MatchupMode;
    interpolatedCount: number;
    interpolationApplied: boolean;
  };
}

function isFiniteValue(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Normalize values returned by the existing matchup response.
 * Argo values use observation depth; HYCOM values use matchedModelDepthM.
 * The backend-reported `method` is carried through so the chart can mark
 * interpolated model points differently from native ones; no interpolation,
 * depth conversion or statistic is computed in the frontend.
 */
export function normalizeArgoMatchupComparisons(
  comparisons: DepthComparison[] | null | undefined
): NormalizedArgoMatchup {
  const temperaturePoints: ComparisonChartPoint[] = [];
  const salinityPoints: ComparisonChartPoint[] = [];
  const seenDepths = new Set<string>();
  const methods = new Set<MatchupLevelMethod>();
  let duplicateDepthCount = 0;

  for (const [comparisonIndex, comparison] of (Array.isArray(comparisons) ? comparisons : []).entries()) {
    const add = (
      points: ComparisonChartPoint[],
      depth: number | null | undefined,
      value: number | null | undefined,
      series: ComparisonChartPoint['series'],
      variable: string
    ) => {
      if (!isFiniteValue(depth) || !isFiniteValue(value)) return;
      const depthKey = `${variable}:${series}:${depth}`;
      if (seenDepths.has(depthKey)) {
        duplicateDepthCount++;
      }
      seenDepths.add(depthKey);
      if (series === 'HYCOM MODEL' && comparison.method) methods.add(comparison.method);
      // The model_levels mode interpolates the FLOAT onto the model's depth, so
      // the interpolation label there refers to the Argo point.
      if (series === 'ARGO OBSERVATION' && comparison.method) methods.add(comparison.method);
      points.push({ depthM: depth, value, series, comparisonIndex, method: comparison.method });
    };

    add(temperaturePoints, comparison.depthM, comparison.argoTemperatureC, 'ARGO OBSERVATION', 'temperature');
    add(temperaturePoints, comparison.matchedModelDepthM, comparison.modelTemperatureC, 'HYCOM MODEL', 'temperature');
    add(salinityPoints, comparison.depthM, comparison.argoSalinityPSU, 'ARGO OBSERVATION', 'salinity');
    add(salinityPoints, comparison.matchedModelDepthM, comparison.modelSalinityPSU, 'HYCOM MODEL', 'salinity');
  }

  const byDepth = (a: ComparisonChartPoint, b: ComparisonChartPoint) => a.depthM - b.depthM;
  temperaturePoints.sort(byDepth);
  salinityPoints.sort(byDepth);
  const count = (points: ComparisonChartPoint[], series: ComparisonChartPoint['series']) =>
    points.filter((point) => point.series === series).length;
  const salinityArgoCount = count(salinityPoints, 'ARGO OBSERVATION');
  const salinityModelCount = count(salinityPoints, 'HYCOM MODEL');

  return {
    temperaturePoints,
    salinityPoints,
    stats: {
      temperatureArgoCount: count(temperaturePoints, 'ARGO OBSERVATION'),
      temperatureModelCount: count(temperaturePoints, 'HYCOM MODEL'),
      salinityArgoCount,
      salinityModelCount,
      salinityAvailable: salinityArgoCount > 0 && salinityModelCount > 0,
      duplicateDepthCount,
      nativeCount: methods.has('native') ? 1 : 0,
      interpolatedCount: methods.has('interpolated') || methods.has('float_interpolated') ? 1 : 0,
      interpolationApplied:
        methods.has('interpolated') || methods.has('float_interpolated'),
    },
  };
}
