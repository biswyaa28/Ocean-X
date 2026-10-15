/**
 * Turning a real Argo profile into a 3D ribbon.
 *
 * Everything here is pure and Cesium-free so the decisions that affect the
 * science — which levels are shown, how many, and what colour they take — can be
 * tested without a GPU, and so the renderer has no room to quietly re-interpret
 * the data.
 *
 * Two rules govern the whole module:
 *
 * 1. **Nothing is invented.** The ribbon is a sequence of REAL measured
 *    levels. Decimation chooses which measured levels to keep; it never
 *    interpolates, smooths or extrapolates a value. A returned depth is always
 *    byte-identical to a depth that was in the input.
 * 2. **Only QC-passed levels are eligible.** A rejected Argo value is not a
 *    measurement, and drawing one would put a number in the scene that the
 *    matchup pipeline has already refused to compare against anything.
 *
 * Colour is a transfer function only: a level's colour depends on where its
 * value sits in the range of the values ACTUALLY PRESENT, and never changes the
 * value.
 */

/** Which measured quantity the ribbon is coloured by. */
export type RibbonVariable = 'temperature_c' | 'salinity_psu';

/** Display names for the toggle. */
export const RIBBON_VARIABLE_LABELS: Record<RibbonVariable, string> = {
  temperature_c: 'Temperature',
  salinity_psu: 'Salinity',
};

/** Units for the toggle and the hover readout. */
export const RIBBON_VARIABLE_UNITS: Record<RibbonVariable, string> = {
  temperature_c: '°C',
  salinity_psu: 'PSU',
};

/**
 * QC flags accepted when the variable basis is not known.
 *
 * The backend accepts {1, 2} for raw data and {1, 2, 5} for adjusted data, and
 * picks between them from the profile's Argo data mode — information the
 * observation list does not carry. This module therefore uses the INTERSECTION,
 * which is correct for either basis. Flag 8 (interpolated between measurements)
 * is excluded for the same reason the backend excludes it: a ribbon should show
 * what was measured.
 *
 * Pass `acceptedQcFlags` explicitly when the basis IS known and the wider
 * adjusted set should be used.
 */
export const ARGO_QC_ACCEPTED = Object.freeze([1, 2]);

/** QC flag assumed for a level that carries no flag at all, matching the backend. */
export const ARGO_QC_DEFAULT = 1;

/** Depth marks drawn beside the ribbon. Deeper than a real profile reach is omitted. */
export const RIBBON_DEPTH_TICKS_M: readonly number[] = Object.freeze([0, 100, 250, 500, 1000, 2000]);

/** Default and permitted vertical exaggerations. */
export const RIBBON_EXAGGERATIONS = Object.freeze([10, 40, 100]);
export const RIBBON_DEFAULT_EXAGGERATION = 40;

/** Segment budget for the ribbon. Roughly one polyline per segment. */
export const RIBBON_MAX_SEGMENTS = 100;

/** A measured level that survived QC and is eligible for the ribbon. */
export interface RibbonLevel {
  /** True depth in metres, exactly as reported by the profile. */
  depthM: number;
  /** The measured value for the selected variable. */
  value: number;
}

/** One ribbon vertex: a measured level plus where its colour sits in range. */
export interface RibbonPoint extends RibbonLevel {
  /** Normalized position of `value` within the ribbon's value range, 0..1. */
  t: number;
}

/** A HYCOM model level drawn beside the ribbon for comparison. */
export interface RibbonModelMarker {
  /** Depth the model value was sampled at. */
  depthM: number;
  /** The file's own label for that level, when it differs from `depthM`. */
  fileLabelM: number | null;
  value: number;
  /** Normalized position within the SAME range as the ribbon, so the two compare. */
  t: number;
  /** How the float side reached this level, as reported by the backend. */
  method: string | null;
}

/** Why a ribbon could not be built. Never silently degrades to an empty ribbon. */
export type RibbonRejection =
  | 'NO_PROFILE'
  | 'NO_QC_ACCEPTED_LEVELS'
  | 'NO_FINITE_VALUE_FOR_VARIABLE';

/** Everything the renderer needs, plus the provenance of what was dropped. */
export interface RibbonProfile {
  points: RibbonPoint[];
  /** Full measured range of the selected variable, for the colour scale. */
  valueMin: number;
  valueMax: number;
  maxDepthM: number | null;
  minDepthM: number | null;
  /** Measured levels eligible for the ribbon, before decimation. */
  eligibleLevelCount: number;
  /** Levels dropped because their QC flag was not accepted. */
  rejectedByQcCount: number;
  /** Levels dropped because the selected variable was missing or non-finite. */
  missingValueCount: number;
  rejection: RibbonRejection | null;
}

const EMPTY_PROFILE: RibbonProfile = {
  points: [],
  valueMin: 0,
  valueMax: 0,
  maxDepthM: null,
  minDepthM: null,
  eligibleLevelCount: 0,
  rejectedByQcCount: 0,
  missingValueCount: 0,
  rejection: 'NO_PROFILE',
};

/** A profile observation, narrowed to what the ribbon reads. */
export interface RibbonObservation {
  depth_m?: number | null;
  temperature_c?: number | null;
  salinity_psu?: number | null;
  temp_qc?: number | null;
  psal_qc?: number | null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** The QC flag column for the selected variable, and the default when absent. */
function qcFlagFor(
  observation: RibbonObservation,
  variable: RibbonVariable,
): number {
  const raw = variable === 'temperature_c' ? observation.temp_qc : observation.psal_qc;
  return isFiniteNumber(raw) ? raw : ARGO_QC_DEFAULT;
}

/**
 * Measured levels eligible for the ribbon, QC-filtered and sorted by depth.
 *
 * Exported so the renderer and the tests agree on eligibility independently of
 * the decimation decision.
 */
export function selectRibbonLevels(
  observations: readonly RibbonObservation[] | null | undefined,
  variable: RibbonVariable,
  acceptedQcFlags: readonly number[] = ARGO_QC_ACCEPTED,
): {
  levels: RibbonLevel[];
  rejectedByQcCount: number;
  missingValueCount: number;
} {
  const accepted = new Set(acceptedQcFlags);
  const levels: RibbonLevel[] = [];
  let rejectedByQcCount = 0;
  let missingValueCount = 0;

  for (const observation of observations ?? []) {
    if (!observation || !isFiniteNumber(observation.depth_m)) continue;

    const value = variable === 'temperature_c' ? observation.temperature_c : observation.salinity_psu;

    // QC is checked first: a level the flag rejects is not a measurement, so its
    // value is irrelevant whether or not it happens to be present.
    if (!accepted.has(qcFlagFor(observation, variable))) {
      rejectedByQcCount++;
      continue;
    }
    if (!isFiniteNumber(value)) {
      missingValueCount++;
      continue;
    }

    levels.push({ depthM: observation.depth_m, value });
  }

  levels.sort((a, b) => a.depthM - b.depthM);

  // One level per depth: a duplicate depth is the same water, so the first
  // measured value at that depth wins and later ones are not drawn twice.
  const seenDepths = new Set<number>();
  const deduped: RibbonLevel[] = [];
  for (const level of levels) {
    if (seenDepths.has(level.depthM)) continue;
    seenDepths.add(level.depthM);
    deduped.push(level);
  }

  return { levels: deduped, rejectedByQcCount, missingValueCount };
}

/**
 * Absolute slope change at each interior level.
 *
 * This is what identifies the thermocline: where the profile's gradient changes
 * fastest is where the interesting structure is, and a uniform decimation would
 * spend its budget there anyway only by luck.
 */
function curvatureScores(levels: readonly RibbonLevel[]): number[] {
  const scores = new Array<number>(levels.length).fill(0);
  for (let i = 1; i < levels.length - 1; i++) {
    const previous = levels[i - 1];
    const current = levels[i];
    const next = levels[i + 1];
    const leftSpan = current.depthM - previous.depthM;
    const rightSpan = next.depthM - current.depthM;
    if (leftSpan <= 0 || rightSpan <= 0) continue;
    const slopeLeft = (current.value - previous.value) / leftSpan;
    const slopeRight = (next.value - current.value) / rightSpan;
    scores[i] = Math.abs(slopeRight - slopeLeft);
  }
  return scores;
}

/**
 * Choose which measured levels to keep.
 *
 * The budget is spent on two things at once: a share reserved for the levels
 * with the sharpest gradient change, so the thermocline stays sharp, and the
 * remainder spread evenly so the deep water column is still sampled. The first
 * and last measured levels are ALWAYS kept, so the ribbon spans the profile it
 * came from and never appears to reach a depth the float did not reach.
 *
 * Returns indices into `levels`, ascending. Never returns an index outside the
 * input and never invents a value.
 */
export function decimateRibbonLevels(
  levels: readonly RibbonLevel[],
  maxSegments: number = RIBBON_MAX_SEGMENTS,
): number[] {
  const count = levels.length;
  if (count === 0) return [];
  if (count <= 2) return levels.map((_, index) => index);

  const budget = Math.max(2, Math.min(maxSegments, count));
  if (count <= budget) return levels.map((_, index) => index);

  // Endpoints first: the ribbon must span the profile it came from.
  const selected = new Set<number>([0, count - 1]);
  const interior = Array.from({ length: count - 2 }, (_, offset) => offset + 1);
  const curvature = curvatureScores(levels);

  // Half the remaining budget is reserved for the sharpest gradient changes, so
  // the thermocline stays sharp instead of being thinned away by the uniform fill.
  const curvatureBudget = Math.floor((budget - 2) / 2);
  const byCurvature = interior.slice().sort((a, b) => curvature[b] - curvature[a]);
  for (const index of byCurvature) {
    if (selected.size - 2 >= curvatureBudget) break;
    selected.add(index);
  }

  // Then spread the rest evenly so the whole water column stays sampled.
  for (let step = 1; step < budget - 1; step++) {
    if (selected.size >= budget) break;
    const candidate = Math.round((step * (count - 1)) / (budget - 1));
    if (candidate > 0 && candidate < count - 1) selected.add(candidate);
  }

  // Rounding can collapse two steps onto the same level; backfill so the budget
  // is actually reached whenever the input has enough levels to fill it.
  for (const index of interior) {
    if (selected.size >= budget) break;
    selected.add(index);
  }

  return Array.from(selected).sort((a, b) => a - b);
}

/**
 * Build the drawable ribbon from a profile's raw observations.
 *
 * Returns an explicit rejection rather than an empty ribbon when there is
 * nothing to draw, so the UI can say why instead of showing a bare line.
 */
export function buildRibbonProfile(
  observations: readonly RibbonObservation[] | null | undefined,
  variable: RibbonVariable,
  maxSegments: number = RIBBON_MAX_SEGMENTS,
  acceptedQcFlags: readonly number[] = ARGO_QC_ACCEPTED,
): RibbonProfile {
  if (!Array.isArray(observations) || observations.length === 0) {
    return { ...EMPTY_PROFILE };
  }

  const { levels, rejectedByQcCount, missingValueCount } = selectRibbonLevels(
    observations,
    variable,
    acceptedQcFlags,
  );

  if (levels.length === 0) {
    return {
      ...EMPTY_PROFILE,
      eligibleLevelCount: 0,
      rejectedByQcCount,
      missingValueCount,
      rejection:
        rejectedByQcCount > 0 && missingValueCount === 0
          ? 'NO_QC_ACCEPTED_LEVELS'
          : 'NO_FINITE_VALUE_FOR_VARIABLE',
    };
  }

  // The colour range spans EVERY eligible level, not just the kept ones, so
  // decimation cannot shift the colours of the levels it did keep.
  let valueMin = Infinity;
  let valueMax = -Infinity;
  for (const level of levels) {
    if (level.value < valueMin) valueMin = level.value;
    if (level.value > valueMax) valueMax = level.value;
  }

  const keptIndices = decimateRibbonLevels(levels, maxSegments);
  const span = valueMax - valueMin;
  const points: RibbonPoint[] = keptIndices.map((index) => {
    const level = levels[index];
    return {
      depthM: level.depthM,
      value: level.value,
      // A single-valued profile (everything equal) has no range; sit it mid-ramp
      // rather than dividing by zero.
      t: span > 0 ? (level.value - valueMin) / span : 0.5,
    };
  });

  return {
    points,
    valueMin,
    valueMax,
    maxDepthM: levels[levels.length - 1].depthM,
    minDepthM: levels[0].depthM,
    eligibleLevelCount: levels.length,
    rejectedByQcCount,
    missingValueCount,
    rejection: null,
  };
}

/**
 * Depth marks for the ribbon's depth axis: the standard marks that the profile
 * actually reaches. A 300 m float is not labelled as if it reached 2000 m.
 */
export function ribbonDepthTicks(maxDepthM: number | null | undefined): number[] {
  if (!isFiniteNumber(maxDepthM) || maxDepthM <= 0) return [];
  return RIBBON_DEPTH_TICKS_M.filter((tick) => tick <= maxDepthM);
}

/**
 * Height in metres below the sea surface for a depth, at a vertical
 * exaggeration.
 *
 * The globe is in real metres, so an unexaggerated 2000 m column is invisible
 * from orbit. Exaggeration multiplies the drawn depth only; the labels and the
 * hover readout always carry the REAL depth, so the scene never implies the
 * ocean is deeper than it is.
 */
export function ribbonHeightM(
  depthM: number,
  exaggeration: number,
): number {
  if (!isFiniteNumber(depthM)) return 0;
  const factor = isFiniteNumber(exaggeration) && exaggeration > 0 ? exaggeration : 1;
  return depthM * factor;
}

/** Human label for the exaggeration, always stating that it is a exaggeration. */
export function ribbonExaggerationLabel(exaggeration: number): string {
  return `vertical exaggeration ${exaggeration}x`;
}

/** A model comparison row, narrowed to what the markers read. */
export interface RibbonMatchupComparison {
  depthM?: number | null;
  modelTemperatureC?: number | null;
  modelSalinityPSU?: number | null;
  method?: string | null;
}

/**
 * HYCOM levels to draw beside the ribbon.
 *
 * Coloured on the SAME scale as the ribbon (the caller supplies the ribbon's
 * min/max), because two independently scaled colour ramps would make a warm bias
 * look identical to a cold one. The file's own depth label rides along whenever
 * it differs from the depth actually sampled, so the marker reads
 * "100 m (file label 125 m)".
 */
export function buildRibbonModelMarkers(
  comparisons: readonly RibbonMatchupComparison[] | null | undefined,
  variable: RibbonVariable,
  valueMin: number,
  valueMax: number,
  fileLabelFor: (depthM: number) => number | null,
): RibbonModelMarker[] {
  if (!Array.isArray(comparisons)) return [];
  const span = valueMax - valueMin;
  const markers: RibbonModelMarker[] = [];

  for (const comparison of comparisons) {
    if (!comparison || !isFiniteNumber(comparison.depthM)) continue;
    const value =
      variable === 'temperature_c' ? comparison.modelTemperatureC : comparison.modelSalinityPSU;
    if (!isFiniteNumber(value)) continue;

    markers.push({
      depthM: comparison.depthM,
      fileLabelM: fileLabelFor(comparison.depthM),
      value,
      t: span > 0 ? (value - valueMin) / span : 0.5,
      method: comparison.method ?? null,
    });
  }

  markers.sort((a, b) => a.depthM - b.depthM);
  return markers;
}

/** Hover/click text for one ribbon vertex. */
export function ribbonPointTooltip(point: RibbonPoint, variable: RibbonVariable): string {
  return `${formatRibbonDepth(point.depthM)} · ${point.value.toFixed(2)} ${RIBBON_VARIABLE_UNITS[variable]}`;
}

/** Hover/click text for one model marker, including the file label when it differs. */
export function ribbonModelTooltip(
  marker: RibbonModelMarker,
  variable: RibbonVariable,
  labelFormatter: (depthM: number, fileLabelM: number | null) => string,
): string {
  const depthText = labelFormatter(marker.depthM, marker.fileLabelM);
  const methodText = marker.method ? ` · ${marker.method.toUpperCase()}` : '';
  return `${depthText} · ${marker.value.toFixed(2)} ${RIBBON_VARIABLE_UNITS[variable]}${methodText}`;
}

function formatRibbonDepth(depthM: number): string {
  return `${Number.isInteger(depthM) ? depthM.toFixed(0) : depthM.toFixed(1)} m`;
}

/**
 * Nearest measured level to an arbitrary ribbon position.
 *
 * The whole ribbon is one primitive, so a pick reports a world position rather
 * than an index. Snapping to the nearest MEASURED level means the readout can
 * only ever quote a real observation: a point between two levels reports one of
 * those two, never an interpolated depth that was never sampled.
 */
export function nearestRibbonLevel(
  points: readonly RibbonPoint[],
  targetDepthM: number,
): RibbonPoint | null {
  if (!points.length || !Number.isFinite(targetDepthM)) return null;
  let best = points[0];
  let bestGap = Math.abs(best.depthM - targetDepthM);
  for (const point of points) {
    const gap = Math.abs(point.depthM - targetDepthM);
    if (gap < bestGap) {
      best = point;
      bestGap = gap;
    }
  }
  return best;
}

/**
 * Everything the 3D scene and its control panel need, computed once.
 *
 * The renderer and the panel read the SAME object rather than each rebuilding
 * the profile, so the colour ramp on the ribbon, the numbers in the legend and
 * the level count can never disagree with each other.
 */
export interface ArgoRibbonSceneData {
  profile: RibbonProfile;
  markers: RibbonModelMarker[];
  /** True when at least one model level has a value to draw. */
  hasModelData: boolean;
  /** Why nothing is drawn, or null when the ribbon is drawable. */
  rejection: RibbonRejection | null;
}

/** Axis shape needed to label model markers with the file's own depths. */
export interface RibbonAxisLabels {
  modelDepths?: ReadonlyArray<number | null> | null;
  storedFileDepths?: ReadonlyArray<number | null> | null;
}

/**
 * Build the ribbon, the model markers and the status in one pass over the data.
 *
 * `fileLabelFor` is injected rather than imported so this module stays free of
 * the display helper's dependency graph, and so tests can state the labelling
 * behaviour directly.
 */
export function buildArgoRibbonSceneData(
  observations: readonly RibbonObservation[] | null | undefined,
  variable: RibbonVariable,
  comparisons: readonly RibbonMatchupComparison[] | null | undefined,
  axis: RibbonAxisLabels | null | undefined,
  fileLabelFor: (depthM: number) => number | null,
  maxSegments: number = RIBBON_MAX_SEGMENTS,
): ArgoRibbonSceneData {
  const profile = buildRibbonProfile(observations, variable, maxSegments);
  const markers = buildRibbonModelMarkers(
    comparisons,
    variable,
    profile.valueMin,
    profile.valueMax,
    fileLabelFor
  );
  return {
    profile,
    markers,
    hasModelData: markers.length > 0,
    rejection: profile.rejection,
  };
}