/**
 * OCEAN-X SIH26067 — Scientific visualization state model for the HYCOM
 * model depth slice (Phase 1C).
 *
 * This module is the single source of truth for the *display* side of the
 * depth-slice visualization (palette, display range, scale, opacity) and
 * for the pure resolution logic that turns (payload, display settings)
 * into a concrete render configuration.
 *
 * Hard guarantees:
 * - Display settings affect VISUALIZATION ONLY. The scientific payload
 *   (real HYCOM values, units, depths, timestamps) is never modified,
 *   clipped or overwritten.
 * - Log scale is only ever active when the selected data AND the effective
 *   display range are strictly positive. Zero/negative data disables log
 *   with an explicit reason — it is never silently transformed.
 * - An invalid user range (min >= max, non-finite) never reaches the
 *   renderer; the auto data range is used instead.
 */

import { DepthSlicePayload } from '../services/ApiProvider';
import { isMissingDepthValue } from './rasterGen';
import {
  CLASSIC_PALETTE,
  ScientificPalette,
  getPaletteForVariable,
} from './scientificPalettes';

export type DepthSliceScale = 'linear' | 'log';

/**
 * User-controlled scientific visualization settings for the depth slice.
 * `min`/`max` are display bounds only — `null` means "derive from the
 * current slice" (auto range).
 */
export interface DepthSliceDisplaySettings {
  paletteId: string;
  min: number | null;
  max: number | null;
  scale: DepthSliceScale;
  /** Layer opacity 0..1 — affects only the depth-slice imagery layer. */
  opacity: number;
}

/**
 * The subset of display settings that affects the resolved render
 * configuration (palette / range / scale). Opacity is deliberately
 * excluded: it never changes the raster or the colorbar, only the layer
 * alpha, so callers can memoize the render on exactly these fields.
 */
export type DepthSliceDisplayCore = Pick<
  DepthSliceDisplaySettings,
  'paletteId' | 'min' | 'max' | 'scale'
>;

/**
 * Phase 1C defaults preserve Phase 1B rendering semantics exactly:
 * classic ramp, auto range over the slice, linear scale, layer alpha 0.75.
 */
export const DEFAULT_DEPTH_SLICE_DISPLAY: DepthSliceDisplaySettings = {
  paletteId: CLASSIC_PALETTE.id,
  min: null,
  max: null,
  scale: 'linear',
  opacity: 0.75,
};

/** Fully resolved, always-valid configuration the renderer consumes. */
export interface DepthSliceRenderConfig {
  palette: ScientificPalette;
  rangeMin: number;
  rangeMax: number;
  /** Effective scale — 'log' only when mathematically valid. */
  scale: DepthSliceScale;
  /** True when the range is derived from the slice data (no user override). */
  isAutoRange: boolean;
  /** True when log scale is mathematically valid for this slice + range. */
  logAvailable: boolean;
  /** Human-readable reason when log is unavailable. */
  logUnavailableReason: string | null;
  /** Observed bounds of the real data (reported separately from display range). */
  dataMin: number;
  dataMax: number;
}

/**
 * Extract the scalar value grid from a depth-slice payload. Vector
 * (currents) slices are reduced to speed magnitude |(u, v)|; missing
 * components stay missing. Returns null when no usable grid exists.
 */
export function extractDepthSliceValues(payload: DepthSlicePayload | null): (number | null)[][] | null {
  if (!payload || !payload.grid) return null;
  if (payload.grid.values) return payload.grid.values;
  if (payload.grid.u && payload.grid.v) {
    return payload.grid.u.map((row, i) =>
      row.map((u, j) => {
        const v = payload.grid.v?.[i]?.[j];
        if (u === null || u === undefined || v === null || v === undefined) return null;
        return Math.sqrt(u * u + v * v);
      })
    );
  }
  return null;
}

/** Min/max over the valid (non-missing) cells. 0.0 is a REAL value. */
export function computeSliceDataRange(
  payload: DepthSlicePayload | null
): { min: number; max: number } | null {
  const values = extractDepthSliceValues(payload);
  if (!values) return null;
  let min = Infinity;
  let max = -Infinity;
  for (const row of values) {
    if (!row) continue;
    for (const v of row) {
      if (!isMissingDepthValue(v)) {
        if ((v as number) < min) min = v as number;
        if ((v as number) > max) max = v as number;
      }
    }
  }
  if (!isFinite(min) || !isFinite(max)) return null;
  return { min, max };
}

/** A display range is renderable only when finite and strictly increasing. */
export function validateDisplayRange(min: number, max: number): { valid: boolean; reason: string | null } {
  if (!isFinite(min) || !isFinite(max)) {
    return { valid: false, reason: 'Range bounds must be finite numbers.' };
  }
  if (min >= max) {
    return { valid: false, reason: 'MIN must be strictly less than MAX.' };
  }
  return { valid: true, reason: null };
}

/**
 * Resolve (payload, display settings) into an always-valid render config.
 * Returns null when there is no payload or no valid data to map.
 * Accepts the full display settings or just the render-relevant core.
 */
export function resolveDepthSliceRender(
  payload: DepthSlicePayload | null,
  settings: DepthSliceDisplayCore
): DepthSliceRenderConfig | null {
  const dataRange = computeSliceDataRange(payload);
  if (!payload || !dataRange) return null;

  // A user range is applied only when BOTH bounds are set and valid;
  // anything else falls back to the auto (observed) data range so an
  // invalid range can never produce an invalid visualization.
  let rangeMin = dataRange.min;
  let rangeMax = dataRange.max;
  let isAutoRange = true;
  if (settings.min !== null && settings.max !== null) {
    const check = validateDisplayRange(settings.min, settings.max);
    if (check.valid) {
      rangeMin = settings.min;
      rangeMax = settings.max;
      isAutoRange = false;
    }
  }

  // Log-scale safety: mathematically valid only when every selected value
  // and the effective display range are strictly positive.
  let logAvailable = true;
  let logUnavailableReason: string | null = null;
  if (dataRange.min <= 0) {
    logAvailable = false;
    logUnavailableReason =
      'Log scale is unavailable: the selected slice contains zero or negative values.';
  } else if (rangeMin <= 0) {
    logAvailable = false;
    logUnavailableReason =
      'Log scale is unavailable: the configured display range includes zero or negative values.';
  }

  const scale: DepthSliceScale =
    settings.scale === 'log' && logAvailable ? 'log' : 'linear';

  const palette = getPaletteForVariable(payload.variable, settings.paletteId);

  return {
    palette,
    rangeMin,
    rangeMax,
    scale,
    isAutoRange,
    logAvailable,
    logUnavailableReason,
    dataMin: dataRange.min,
    dataMax: dataRange.max,
  };
}
