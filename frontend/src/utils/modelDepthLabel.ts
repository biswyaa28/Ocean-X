/**
 * How a model (HYCOM) depth must be written in the UI.
 *
 * The archived subset files store a DEPTH coordinate that is the MIDPOINT of
 * their own DEPTH_bounds, so the level the app samples at 100 m is the one the
 * file labels 125 m. Both numbers are true and neither is a typo, so a reader
 * comparing a chart against the file needs to see both. Every place that shows a
 * model depth therefore goes through here rather than interpolating a depth
 * inline: the sampled depth is always the headline, and the file's own label
 * rides along whenever the two disagree.
 */

/** The sampled axis and the file's own labels, in the same order. */
export type ModelDepthAxis = {
  /** Depths actually sampled, i.e. the resolved native axis. */
  modelDepths?: ReadonlyArray<number | null> | null;
  /** Depths the file's own DEPTH coordinate carries. */
  storedFileDepths?: ReadonlyArray<number | null> | null;
};

/** True when this depth axis carries enough information to show a file label. */
export function hasModelDepthFileLabels(axis: ModelDepthAxis | null | undefined): boolean {
  return Boolean(axis?.modelDepths?.length && axis?.storedFileDepths?.length);
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Decimal places needed to write a depth exactly.
 *
 * The file's own labels include 17.5 and 52.5 m. Rounded to whole metres those
 * become 18 and 53, which is worse than showing nothing: it states a depth the
 * file never carried. So the precision follows the value instead of a default.
 */
function decimalsFor(value: number): number {
  return Number.isInteger(round1(value)) ? 0 : 1;
}

/**
 * The file's own label for `depth`, matched by position on the axis.
 *
 * Position, not value: the two axes hold the same levels in the same order, so
 * the sampled depth and its file label share an index. Returns null when the
 * file's label is unknown or is the same number (nothing to add).
 */
export function modelFileLabelDepth(
  depth: number | null | undefined,
  axis: ModelDepthAxis | null | undefined,
): number | null {
  if (depth === null || depth === undefined || !Number.isFinite(depth)) return null;
  if (!hasModelDepthFileLabels(axis)) return null;

  const sampled = axis!.modelDepths!;
  const stored = axis!.storedFileDepths!;
  const index = sampled.findIndex(
    (value) => value !== null && value !== undefined && Math.abs(Number(value) - depth) < 1e-6,
  );
  if (index < 0) return null;

  const fileDepth = stored[index];
  if (fileDepth === null || fileDepth === undefined || !Number.isFinite(Number(fileDepth))) {
    return null;
  }
  const numeric = Number(fileDepth);
  return Math.abs(numeric - depth) < 1e-6 ? null : numeric;
}

/**
 * A model depth for display: "100 m", or "100 m (file label 125 m)" when the
 * file calls that same level something else.
 */
export function modelDepthLabel(
  depth: number | null | undefined,
  axis: ModelDepthAxis | null | undefined,
  options: { decimals?: number } = {},
): string {
  if (depth === null || depth === undefined || !Number.isFinite(depth)) return '—';
  const sampledText = round1(depth).toFixed(options.decimals ?? decimalsFor(depth));
  const fileDepth = modelFileLabelDepth(depth, axis);
  if (fileDepth === null) return `${sampledText} m`;
  return `${sampledText} m (file label ${round1(fileDepth).toFixed(options.decimals ?? decimalsFor(fileDepth))} m)`;
}

/**
 * Compact form for axes, ticks and legends where a full sentence will not fit:
 * "100 m" or "100 m · file 125 m".
 */
export function modelDepthLabelCompact(
  depth: number | null | undefined,
  axis: ModelDepthAxis | null | undefined,
  options: { decimals?: number } = {},
): string {
  if (depth === null || depth === undefined || !Number.isFinite(depth)) return '—';
  const sampledText = round1(depth).toFixed(options.decimals ?? decimalsFor(depth));
  const fileDepth = modelFileLabelDepth(depth, axis);
  if (fileDepth === null) return `${sampledText} m`;
  return `${sampledText} m · file ${round1(fileDepth).toFixed(options.decimals ?? decimalsFor(fileDepth))} m`;
}

/** The largest sampled-vs-labelled disagreement on this axis, in metres. */
export function modelDepthAxisDisagreementM(
  axis: ModelDepthAxis | null | undefined,
): number {
  if (!hasModelDepthFileLabels(axis)) return 0;
  let largest = 0;
  axis!.modelDepths!.forEach((value, index) => {
    const fileDepth = axis!.storedFileDepths![index];
    if (value === null || value === undefined) return;
    if (fileDepth === null || fileDepth === undefined) return;
    largest = Math.max(largest, Math.abs(Number(fileDepth) - Number(value)));
  });
  return round1(largest);
}

/**
 * One line stating how far the file's own labels sit from the sampled depths.
 *
 * Shown wherever model depths are listed, because a reader who takes "125 m"
 * from the file and a chart that sampled 100 m will otherwise conclude the chart
 * is wrong.
 */
export function modelDepthAxisNote(axis: ModelDepthAxis | null | undefined): string | null {
  if (!hasModelDepthFileLabels(axis)) return null;
  const sampled = axis!.modelDepths!.map((value) => Number(value)).filter(Number.isFinite);
  const stored = axis!.storedFileDepths!.map((value) => Number(value)).filter(Number.isFinite);
  if (!sampled.length || !stored.length) return null;
  const disagreement = modelDepthAxisDisagreementM(axis);
  const sampledText = sampled.join(', ');
  const storedText = stored.join(', ');
  if (disagreement <= 0) {
    return `Model depths are shown as sampled (${sampledText} m); the file labels them identically.`;
  }
  return `Model depths are shown as sampled (${sampledText} m). The file labels the same levels ${storedText} m — up to ${disagreement} m apart, because the file's DEPTH coordinate is the midpoint of its own bounds.`;
}