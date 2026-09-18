/**
 * OCEAN-X SIH26067 - Client-side raster generation utilities.
 * Generates scientific colormap Data URLs for spatial heatmap overlays
 * (SST / Salinity / TCHP) with canvas + ImageData buffer reuse and a
 * bounded cache keyed by layer/timestamp/grid-resolution.
 */

import { CLASSIC_PALETTE, samplePalette, ScientificPalette } from './scientificPalettes';

export type RasterLayerType = 'sst' | 'salinity' | 'tchp';

/**
 * Phase 1C scientific render options for depth slices. Display-only:
 * values are mapped through the palette/range/scale for visualization and
 * are never modified, clipped or persisted.
 */
export interface DepthSliceRenderOptions {
  palette: ScientificPalette;
  rangeMin: number;
  rangeMax: number;
  scale: 'linear' | 'log';
}

interface RasterGenContext {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D | null;
  scaleCanvas: HTMLCanvasElement;
  scaleCtx: CanvasRenderingContext2D | null;
  imgData: ImageData | null;
  imgDataWidth: number;
  imgDataHeight: number;
}

let rasterCtx: RasterGenContext | null = null;

const MAX_CACHE_ENTRIES = 24;

const dataUrlCache = new Map<string, string>();

function getRasterContext(): RasterGenContext | null {
  if (typeof document === 'undefined') return null;
  if (rasterCtx) return rasterCtx;

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const scaleCanvas = document.createElement('canvas');
  scaleCanvas.width = 512;
  scaleCanvas.height = 512;
  const scaleCtx = scaleCanvas.getContext('2d');
  if (scaleCtx) {
    scaleCtx.imageSmoothingEnabled = true;
    scaleCtx.imageSmoothingQuality = 'high';
  }

  rasterCtx = {
    canvas,
    ctx,
    scaleCanvas,
    scaleCtx,
    imgData: null,
    imgDataWidth: 0,
    imgDataHeight: 0,
  };
  return rasterCtx;
}

/**
 * Builds (or reuses) a single pre-allocated ImageData sized for the grid.
 */
function getReusableImageData(ctx: CanvasRenderingContext2D, width: number, height: number): ImageData {
  const rc = getRasterContext();
  if (!rc) return ctx.createImageData(width, height);

  if (!rc.imgData || rc.imgDataWidth !== width || rc.imgDataHeight !== height) {
    rc.imgData = ctx.createImageData(width, height);
    rc.imgDataWidth = width;
    rc.imgDataHeight = height;
  }
  return rc.imgData;
}

/** A cell the surface ramp treats as no-data (surface semantics: 0 == masked). Exported for regression tests. */
export function isSurfaceNoData(val: number | null | undefined): val is null | undefined {
  return val === null || val === undefined || isNaN(val as number) || val === 0;
}

/** A cell with no actual measurement (depth-slice semantics: only null/NaN is missing). */
export function isMissingDepthValue(val: number | null | undefined): val is null | undefined {
  return val === null || val === undefined || isNaN(val as number);
}

/**
 * Scientific colormap identical in output to the previous per-call generator.
 * Values -> RGBA with the INCOIS-style ramps. Invalid (null/NaN/0) cells are
 * fully transparent so provenance semantics ("no data" masking) are preserved.
 */
function paintGrid(
  imgData: ImageData,
  layerType: RasterLayerType,
  latitudes: number[],
  longitudes: number[],
  values: (number | null)[][]
): void {
  const nLat = latitudes.length;
  const nLon = longitudes.length;
  const data = imgData.data;

  for (let i = 0; i < nLat; i++) {
    const row = nLat - 1 - i;
    for (let j = 0; j < nLon; j++) {
      const val = values[i] ? values[i][j] : null;
      const idx = (row * nLon + j) * 4;
      if (isSurfaceNoData(val)) {
        data[idx + 3] = 0;
        continue;
      }

      let r = 0, g = 0, b = 0;
      const a = 180;
      if (layerType === 'sst') {
        const norm = Math.max(0, Math.min(1, (val - 25.0) / 7.0));
        if (norm < 0.5) {
          const t = norm * 2;
          r = Math.round(30 + t * (45 - 30));
          g = Math.round(78 + t * (212 - 78));
          b = Math.round(216 + t * (191 - 216));
        } else {
          const t = (norm - 0.5) * 2;
          r = Math.round(45 + t * (244 - 45));
          g = Math.round(212 + t * (63 - 212));
          b = Math.round(191 + t * (94 - 191));
        }
      } else if (layerType === 'salinity') {
        const norm = Math.max(0, Math.min(1, (val - 28.0) / 7.0));
        if (norm < 0.5) {
          const t = norm * 2;
          r = Math.round(30 + t * (13 - 30));
          g = Math.round(27 + t * (148 - 27));
          b = Math.round(75 + t * (136 - 75));
        } else {
          const t = (norm - 0.5) * 2;
          r = Math.round(13 + t * (245 - 13));
          g = Math.round(148 + t * (158 - 148));
          b = Math.round(136 + t * (11 - 136));
        }
      } else {
        const norm = Math.max(0, Math.min(1, (val - 10.0) / 100.0));
        r = Math.round(168 + norm * (244 - 168));
        g = Math.round(85 - norm * 60);
        b = Math.round(247 - norm * 200);
      }

      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = a;
    }
  }
}

/**
 * Generates a raster Data URL for the requested layer slice, reusing the
 * persistent offscreen canvases and ImageData buffer. Results are cached
 * under `${layerType}_${timestamp}_${nLat}x${nLon}` so revisiting a loaded
 * timestamp/layer is a pure cache lookup.
 */
export function generateLayerImageDataUrlCached(
  layerType: RasterLayerType,
  latitudes: number[],
  longitudes: number[],
  values: (number | null)[][],
  timestamp?: string
): { dataUrl: string; cacheHit: boolean; generationMs: number } {
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;

  const nLat = latitudes.length;
  const nLon = longitudes.length;
  if (!nLat || !nLon || !values) return { dataUrl: '', cacheHit: false, generationMs: 0 };

  const cacheKey = `${layerType}_${timestamp || 'latest'}_${nLat}x${nLon}`;
  const cached = dataUrlCache.get(cacheKey);
  if (cached) {
    // LRU refresh
    dataUrlCache.delete(cacheKey);
    dataUrlCache.set(cacheKey, cached);
    return { dataUrl: cached, cacheHit: true, generationMs: performance.now() - t0 };
  }

  const rc = getRasterContext();
  if (!rc || !rc.ctx) return { dataUrl: '', cacheHit: false, generationMs: 0 };

  if (rc.canvas.width !== nLon || rc.canvas.height !== nLat) {
    rc.canvas.width = nLon;
    rc.canvas.height = nLat;
  }

  const imgData = getReusableImageData(rc.ctx, nLon, nLat);
  paintGrid(imgData, layerType, latitudes, longitudes, values);
  rc.ctx.putImageData(imgData, 0, 0);

  let dataUrl: string;
  if (rc.scaleCtx) {
    rc.scaleCtx.clearRect(0, 0, 512, 512);
    rc.scaleCtx.drawImage(rc.canvas, 0, 0, 512, 512);
    dataUrl = rc.scaleCanvas.toDataURL();
  } else {
    dataUrl = rc.canvas.toDataURL();
  }

  // Bounded cache eviction (oldest inserted first)
  if (dataUrlCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = dataUrlCache.keys().next().value;
    if (oldestKey !== undefined) dataUrlCache.delete(oldestKey);
  }
  dataUrlCache.set(cacheKey, dataUrl);

  return { dataUrl, cacheHit: false, generationMs: performance.now() - t0 };
}

export function clearRasterCache(): void {
  dataUrlCache.clear();
}

// ============================================================
// HYCOM model depth slices (Phase 1B)
// ============================================================

/**
 * Deep-ocean colormap for HYCOM model depth slices.
 *
 * Color transfer comes from the scientific palette registry (Phase 1C):
 * by default the classic Phase 1B ramp (blue → cyan → yellow → red)
 * auto-ranged over the valid cells of the slice — byte-identical to the
 * previous hardcoded colormap. Missing (null/NaN) cells stay fully
 * transparent; a legitimate 0.0 value is NOT masked (unlike surface
 * semantics).
 *
 * With `renderOptions`, the display range / palette / scale are user
 * controlled (visualization only): values outside the range clamp to the
 * ramp endpoints and log scale maps through log10 (only ever active for
 * strictly positive data; non-positive values clamp to the ramp bottom).
 *
 * Exported for direct pixel-level testing.
 */
export function paintDepthSliceGrid(
  imgData: ImageData,
  variable: string,
  latitudes: number[],
  longitudes: number[],
  values: (number | null)[][],
  renderOptions?: DepthSliceRenderOptions
): void {
  const nLat = latitudes.length;
  const nLon = longitudes.length;
  const data = imgData.data;

  const palette = renderOptions ? renderOptions.palette : CLASSIC_PALETTE;

  // Display range: explicit (validated by the caller) or auto-ranged over
  // the valid (non-missing) cells of this slice.
  let min: number;
  let max: number;
  if (renderOptions) {
    min = renderOptions.rangeMin;
    max = renderOptions.rangeMax;
  } else {
    let autoMin = Infinity;
    let autoMax = -Infinity;
    for (let i = 0; i < nLat; i++) {
      for (let j = 0; j < nLon; j++) {
        const v = values[i] ? values[i][j] : null;
        if (!isMissingDepthValue(v)) {
          if ((v as number) < autoMin) autoMin = v as number;
          if ((v as number) > autoMax) autoMax = v as number;
        }
      }
    }
    if (!isFinite(autoMin) || !isFinite(autoMax)) return; // all missing: fully transparent
    min = autoMin;
    max = autoMax;
  }

  const scale = renderOptions ? renderOptions.scale : 'linear';

  for (let i = 0; i < nLat; i++) {
    const row = nLat - 1 - i;
    for (let j = 0; j < nLon; j++) {
      const val = values[i] ? values[i][j] : null;
      const idx = (row * nLon + j) * 4;
      if (isMissingDepthValue(val)) {
        data[idx + 3] = 0; // missing values stay fully transparent
        continue;
      }
      let norm: number;
      if (scale === 'log') {
        // Log is only enabled by the UI for strictly positive data/ranges;
        // non-positive values defensively clamp to the ramp bottom instead
        // of producing NaN colors — they are never given a fake log value.
        if (val as number <= 0 || min <= 0) {
          norm = 0;
        } else {
          const lmin = Math.log10(min);
          const lmax = Math.log10(max);
          const span = lmax - lmin;
          norm = span > 0 ? (Math.log10(val as number) - lmin) / span : 0;
        }
      } else {
        const span = max - min;
        norm = span > 0 ? ((val as number) - min) / span : 0;
      }
      const clamped = Math.max(0, Math.min(1, norm));
      const { r, g, b } = samplePalette(palette, clamped);
      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = 190;
    }
  }
  // `variable` is kept in the signature so future per-variable ramps remain
  // a drop-in change without touching call sites.
  void variable;
}

/**
 * Generates a raster Data URL for a HYCOM model depth slice.
 * Reuses the persistent canvas/ImageData machinery and the bounded LRU
 * cache; the cache key includes variable + matched depth + timestamp (and
 * the full render configuration when provided) so a depth slice can never
 * collide with a surface raster, another level, or a differently styled
 * rendering of the same slice.
 */
export function generateDepthSliceImageDataUrlCached(
  variable: string,
  matchedDepthM: number,
  latitudes: number[],
  longitudes: number[],
  values: (number | null)[][],
  timestamp?: string,
  renderOptions?: DepthSliceRenderOptions
): { dataUrl: string; cacheHit: boolean; generationMs: number } {
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;

  const nLat = latitudes.length;
  const nLon = longitudes.length;
  if (!nLat || !nLon || !values) return { dataUrl: '', cacheHit: false, generationMs: 0 };

  let cacheKey = `depthslice_${variable}_${matchedDepthM}m_${timestamp || 'latest'}_${nLat}x${nLon}`;
  if (renderOptions) {
    cacheKey += `_${renderOptions.palette.id}_${renderOptions.rangeMin}_${renderOptions.rangeMax}_${renderOptions.scale}`;
  }
  const cached = dataUrlCache.get(cacheKey);
  if (cached) {
    // LRU refresh
    dataUrlCache.delete(cacheKey);
    dataUrlCache.set(cacheKey, cached);
    return { dataUrl: cached, cacheHit: true, generationMs: performance.now() - t0 };
  }

  const rc = getRasterContext();
  if (!rc || !rc.ctx) return { dataUrl: '', cacheHit: false, generationMs: 0 };

  if (rc.canvas.width !== nLon || rc.canvas.height !== nLat) {
    rc.canvas.width = nLon;
    rc.canvas.height = nLat;
  }

  const imgData = getReusableImageData(rc.ctx, nLon, nLat);
  paintDepthSliceGrid(imgData, variable, latitudes, longitudes, values, renderOptions);
  rc.ctx.putImageData(imgData, 0, 0);

  let dataUrl: string;
  if (rc.scaleCtx) {
    rc.scaleCtx.clearRect(0, 0, 512, 512);
    rc.scaleCtx.drawImage(rc.canvas, 0, 0, 512, 512);
    dataUrl = rc.scaleCanvas.toDataURL();
  } else {
    dataUrl = rc.canvas.toDataURL();
  }

  // Bounded cache eviction (oldest inserted first)
  if (dataUrlCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = dataUrlCache.keys().next().value;
    if (oldestKey !== undefined) dataUrlCache.delete(oldestKey);
  }
  dataUrlCache.set(cacheKey, dataUrl);

  return { dataUrl, cacheHit: false, generationMs: performance.now() - t0 };
}
