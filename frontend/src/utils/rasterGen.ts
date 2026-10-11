/**
 * OCEAN-X SIH26067 - Client-side raster generation utilities.
 * Generates scientific colormap images for spatial heatmap overlays
 * (SST / Salinity / TCHP + HYCOM depth slices) with canvas + ImageData buffer
 * reuse and a bounded cache keyed by layer/timestamp/grid-resolution.
 *
 * Phase 2B pipeline change (scientific output identical):
 *   BEFORE  float grid → ImageData → canvas → canvas.toDataURL('image/png')
 *           → Base64 Data URL string → Cesium image decode → WebGL texture
 *   AFTER   float grid → ImageData → canvas → canvas.toBlob('image/png')
 *           → Blob → URL.createObjectURL → Cesium image decode → WebGL texture
 * The synchronous Base64 stringify is gone (encoding is async and the decoder
 * reads the Blob directly). `canvas.toDataURL()` remains as a safe fallback
 * when `toBlob`/object URLs are unavailable (e.g. jsdom in tests).
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

/**
 * A canvas encoding result. Exactly one of `blob`/`dataUrl` is populated:
 * `blob` on the Phase 2B object-URL path, `dataUrl` on the fallback path.
 * Blobs stay alive in the bounded cache; object URLs are created (and
 * released) per imagery layer, never cached.
 */
interface EncodedRaster {
  blob: Blob | null;
  dataUrl: string | null;
}

const rasterCache = new Map<string, EncodedRaster>();

/**
 * A Cesium-consumable raster image source. `url` is either a Blob object URL
 * or a Data URL fallback — both are `string`, which is exactly what
 * `SingleTileImageryProvider` accepts (`Resource | string`).
 */
export interface RasterImageSource {
  /** Object URL (Blob path) or Data URL (fallback). '' when nothing was produced. */
  url: string;
  /** Which serialization path produced `url` (instrumentation). */
  encoding: 'blob' | 'dataurl';
  /** Releases the object URL. Idempotent; a no-op for Data URLs. */
  release: () => void;
  cacheHit: boolean;
  /** Wall-clock ms for the whole call (paint + encode). */
  generationMs: number;
  /** Wall-clock ms spent encoding the canvas; 0 on a cache hit. */
  serializationMs: number;
}

function emptyImageSource(): RasterImageSource {
  return { url: '', encoding: 'dataurl', release: () => {}, cacheHit: false, generationMs: 0, serializationMs: 0 };
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : 0;
}

/** Object URLs are only used when the environment really supports them. */
function canUseObjectUrls(): boolean {
  return typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function';
}

/**
 * Encodes the prepared canvas. Prefers an asynchronous PNG Blob (no Base64
 * string, no synchronous main-thread stringify); falls back to the previous
 * `toDataURL()` Data URL path when `toBlob` or object URLs are unavailable.
 */
async function encodeCanvas(canvas: HTMLCanvasElement): Promise<EncodedRaster> {
  if (canUseObjectUrls() && typeof canvas.toBlob === 'function') {
    try {
      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((result) => resolve(result), 'image/png');
      });
      if (blob) return { blob, dataUrl: null };
    } catch {
      // fall through to the Data URL fallback
    }
  }
  return { blob: null, dataUrl: canvas.toDataURL('image/png') };
}

/** Bounded LRU read (re-inserting the entry refreshes its recency). */
function readCachedRaster(cacheKey: string): EncodedRaster | undefined {
  const entry = rasterCache.get(cacheKey);
  if (!entry) return undefined;
  rasterCache.delete(cacheKey);
  rasterCache.set(cacheKey, entry);
  return entry;
}

/** Bounded LRU write; eviction just drops the cached Blob (garbage collected). */
function writeCachedRaster(cacheKey: string, entry: EncodedRaster): void {
  if (rasterCache.has(cacheKey)) rasterCache.delete(cacheKey);
  rasterCache.set(cacheKey, entry);
  while (rasterCache.size > MAX_CACHE_ENTRIES) {
    const oldestKey = rasterCache.keys().next().value;
    if (oldestKey === undefined) break;
    rasterCache.delete(oldestKey);
  }
}

/** Turns a cached encoding into a fresh, independently releasable source. */
function materializeSource(
  encoded: EncodedRaster,
  cacheHit: boolean,
  generationMs: number,
  serializationMs: number
): RasterImageSource {
  if (encoded.blob && canUseObjectUrls()) {
    const objectUrl = URL.createObjectURL(encoded.blob);
    let released = false;
    return {
      url: objectUrl,
      encoding: 'blob',
      release: () => {
        if (released) return;
        released = true;
        URL.revokeObjectURL(objectUrl);
      },
      cacheHit,
      generationMs,
      serializationMs,
    };
  }
  return {
    url: encoded.dataUrl ?? '',
    encoding: 'dataurl',
    release: () => {},
    cacheHit,
    generationMs,
    serializationMs,
  };
}

/**
 * Shared implementation: cache lookup, paint, encode, cache store.
 * The paint step is fully synchronous (so the captured bitmap can never be
 * clobbered by a concurrent generation reusing the shared canvas).
 */
async function generateImageSource(
  cacheKey: string,
  width: number,
  height: number,
  paint: (imgData: ImageData) => void
): Promise<RasterImageSource> {
  const t0 = now();

  const cached = readCachedRaster(cacheKey);
  if (cached) return materializeSource(cached, true, now() - t0, 0);

  const rc = getRasterContext();
  if (!rc || !rc.ctx) return emptyImageSource();

  if (rc.canvas.width !== width || rc.canvas.height !== height) {
    rc.canvas.width = width;
    rc.canvas.height = height;
  }

  const imgData = getReusableImageData(rc.ctx, width, height);
  paint(imgData);
  rc.ctx.putImageData(imgData, 0, 0);

  // Upscale to the 512x512 texture Cesium actually samples (high-quality
  // smoothing preserved — byte-identical to the pre-2B Data URL pipeline).
  let target: HTMLCanvasElement = rc.canvas;
  if (rc.scaleCtx) {
    rc.scaleCtx.clearRect(0, 0, 512, 512);
    rc.scaleCtx.drawImage(rc.canvas, 0, 0, 512, 512);
    target = rc.scaleCanvas;
  }

  const serializationT0 = now();
  const encoded = await encodeCanvas(target);
  const serializationMs = now() - serializationT0;

  writeCachedRaster(cacheKey, encoded);

  return materializeSource(encoded, false, now() - t0, serializationMs);
}

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

/**
 * A cell with no measurement — masked land or outside the model domain.
 *
 * Only `null` / `undefined` / NaN count. A genuine `0` is a real reading
 * (slack currents, TCHP = 0 over cool water, fresh water at 0 PSU) and must
 * be coloured, not masked. Treating 0 as no-data was a workaround for the
 * backend's old NaN→0 substitution; the backend now emits `null`, so that
 * workaround is removed — otherwise real zeros vanish from the map.
 */
export function isSurfaceNoData(val: number | null | undefined): val is null | undefined {
  return val === null || val === undefined || isNaN(val as number);
}

/** A cell with no actual measurement (depth-slice semantics: only null/NaN is missing). */
export function isMissingDepthValue(val: number | null | undefined): val is null | undefined {
  return val === null || val === undefined || isNaN(val as number);
}

/**
 * Scientific colormap identical in output to the previous per-call generator.
 * Values -> RGBA with the INCOIS-style ramps. Masked (null/NaN) cells are
 * fully transparent so land renders as land, not as a zero-valued colour.
 * A genuine 0 is coloured normally.
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
 * Generates a raster image source for the requested layer slice, reusing the
 * persistent offscreen canvases and ImageData buffer. Results are cached
 * under `${layerType}_${timestamp}_${nLat}x${nLon}` so revisiting a loaded
 * timestamp/layer is a pure cache lookup and only the cheap object URL is
 * re-created for the new imagery layer.
 */
export function generateLayerImageSourceCached(
  layerType: RasterLayerType,
  latitudes: number[],
  longitudes: number[],
  values: (number | null)[][],
  timestamp?: string
): Promise<RasterImageSource> {
  const nLat = latitudes.length;
  const nLon = longitudes.length;
  if (!nLat || !nLon || !values) return Promise.resolve(emptyImageSource());

  const cacheKey = `${layerType}_${timestamp || 'latest'}_${nLat}x${nLon}`;
  return generateImageSource(cacheKey, nLon, nLat, (imgData) =>
    paintGrid(imgData, layerType, latitudes, longitudes, values)
  );
}

export function clearRasterCache(): void {
  rasterCache.clear();
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
 * Generates a raster image source for a HYCOM model depth slice.
 * Reuses the persistent canvas/ImageData machinery and the bounded LRU
 * cache; the cache key includes variable + matched depth + timestamp (and
 * the full render configuration when provided) so a depth slice can never
 * collide with a surface raster, another level, or a differently styled
 * rendering of the same slice.
 */
export function generateDepthSliceImageSourceCached(
  variable: string,
  matchedDepthM: number,
  latitudes: number[],
  longitudes: number[],
  values: (number | null)[][],
  timestamp?: string,
  renderOptions?: DepthSliceRenderOptions
): Promise<RasterImageSource> {
  const nLat = latitudes.length;
  const nLon = longitudes.length;
  if (!nLat || !nLon || !values) return Promise.resolve(emptyImageSource());

  let cacheKey = `depthslice_${variable}_${matchedDepthM}m_${timestamp || 'latest'}_${nLat}x${nLon}`;
  if (renderOptions) {
    cacheKey += `_${renderOptions.palette.id}_${renderOptions.rangeMin}_${renderOptions.rangeMax}_${renderOptions.scale}`;
  }

  return generateImageSource(cacheKey, nLon, nLat, (imgData) =>
    paintDepthSliceGrid(imgData, variable, latitudes, longitudes, values, renderOptions)
  );
}
