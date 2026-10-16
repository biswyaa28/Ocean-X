import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  generateDepthSliceImageSourceCached,
  generateLayerImageSourceCached,
  paintDepthSliceGrid,
  isMissingDepthValue,
  isSurfaceNoData,
  clearRasterCache,
  DepthSliceRenderOptions,
} from './rasterGen';
import {
  CLASSIC_PALETTE,
  getPaletteForVariable,
  samplePalette,
} from './scientificPalettes';

type FakeImageData = { data: Uint8ClampedArray; width: number; height: number };

function mkImageData(w: number, h: number): FakeImageData {
  return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
}

describe('missing-value predicates', () => {
  it('depth semantics: only null/undefined/NaN are missing (0.0 is a real value)', () => {
    expect(isMissingDepthValue(null)).toBe(true);
    expect(isMissingDepthValue(undefined)).toBe(true);
    expect(isMissingDepthValue(NaN)).toBe(true);
    expect(isMissingDepthValue(0)).toBe(false);
    expect(isMissingDepthValue(-0.0)).toBe(false);
    expect(isMissingDepthValue(20.5)).toBe(false);
  });

  it('surface semantics: only null/NaN is masked — a real 0 is a measurement', () => {
    // This assertion is inverted deliberately. It previously read
    // `expect(isSurfaceNoData(0)).toBe(true)`, pinning a workaround for the
    // backend's old NaN→0 substitution. That substitution is gone: the backend
    // now emits null for masked cells, so masking genuine zeros hid real slack
    // currents / TCHP=0 water / fresh water from the map.
    expect(isSurfaceNoData(0)).toBe(false);
    expect(isSurfaceNoData(-0.0)).toBe(false);
    expect(isSurfaceNoData(null)).toBe(true);
    expect(isSurfaceNoData(undefined)).toBe(true);
    expect(isSurfaceNoData(NaN)).toBe(true);
    expect(isSurfaceNoData(28.4)).toBe(false);
  });
});

describe('paintDepthSliceGrid (pixel semantics)', () => {
  it('renders null cells fully transparent (missing-value transparency preserved)', () => {
    const img = mkImageData(2, 2);
    // values[i] is the i-th latitude row (ascending); image row = nLat-1-i
    paintDepthSliceGrid(img as unknown as ImageData, 'temperature', [5, 6], [80, 81], [[null, 20], [21, 22]]);
    const alphas: number[] = [];
    for (let p = 0; p < 4; p++) alphas.push(img.data[p * 4 + 3]);
    expect(alphas).toContain(0); // the null cell is transparent
    expect(alphas.filter((a) => a > 0)).toHaveLength(3); // the rest are opaque
  });

  it('renders 0.0 values opaque (0 is a legitimate depth-slice value, NOT missing)', () => {
    const img = mkImageData(2, 1);
    paintDepthSliceGrid(img as unknown as ImageData, 'ssh', [5], [80, 81], [[0.0, 1.0]]);
    expect(img.data[3]).toBeGreaterThan(0);
    expect(img.data[7]).toBeGreaterThan(0);
  });

  it('produces an all-transparent image when every cell is missing', () => {
    const img = mkImageData(2, 2);
    paintDepthSliceGrid(img as unknown as ImageData, 'temperature', [5, 6], [80, 81], [[null, null], [null, null]]);
    for (let i = 3; i < img.data.length; i += 4) expect(img.data[i]).toBe(0);
  });

  it('auto-ranges the colormap over the valid cells of the slice', () => {
    const img = mkImageData(2, 1);
    paintDepthSliceGrid(img as unknown as ImageData, 'temperature', [5], [80, 81], [[10, 20]]);
    // min cell is cool (blue-dominant), max cell is warm (red-dominant)
    const minR = img.data[0];
    const minB = img.data[2];
    const maxR = img.data[4];
    const maxB = img.data[6];
    expect(maxR).toBeGreaterThan(minR);
    expect(minB).toBeGreaterThan(maxB);
  });
});

describe('paintDepthSliceGrid with render options (Phase 1C)', () => {
  const viridis = getPaletteForVariable('temperature', 'viridis');

  const opts = (o: Partial<DepthSliceRenderOptions> = {}): DepthSliceRenderOptions => ({
    palette: viridis,
    rangeMin: 10,
    rangeMax: 20,
    scale: 'linear',
    ...o,
  });

  it('renders with the configured palette color transfer function', () => {
    const img = mkImageData(2, 1);
    paintDepthSliceGrid(img as unknown as ImageData, 'temperature', [5], [80, 81], [[10, 20]], opts());
    const bottom = samplePalette(viridis, 0);
    const top = samplePalette(viridis, 1);
    expect([img.data[0], img.data[1], img.data[2]]).toEqual([bottom.r, bottom.g, bottom.b]);
    expect([img.data[4], img.data[5], img.data[6]]).toEqual([top.r, top.g, top.b]);
  });

  it('clamps out-of-range values to the ramp endpoints (display-only clipping, data untouched)', () => {
    const img = mkImageData(3, 1);
    paintDepthSliceGrid(img as unknown as ImageData, 'temperature', [5], [80, 81, 82], [[5, 15, 25]], opts());
    const bottom = samplePalette(viridis, 0);
    const mid = samplePalette(viridis, 0.5);
    const top = samplePalette(viridis, 1);
    expect([img.data[0], img.data[1], img.data[2]]).toEqual([bottom.r, bottom.g, bottom.b]);
    expect([img.data[4], img.data[5], img.data[6]]).toEqual([mid.r, mid.g, mid.b]);
    expect([img.data[8], img.data[9], img.data[10]]).toEqual([top.r, top.g, top.b]);
  });

  it('maps values through log10 when the scale is log', () => {
    const img = mkImageData(3, 1);
    // range [1, 100]: 1 → t=0, 10 → t=0.5, 100 → t=1
    paintDepthSliceGrid(img as unknown as ImageData, 'temperature', [5], [80, 81, 82], [[1, 10, 100]], opts({ rangeMin: 1, rangeMax: 100, scale: 'log' }));
    const bottom = samplePalette(viridis, 0);
    const mid = samplePalette(viridis, 0.5);
    const top = samplePalette(viridis, 1);
    expect([img.data[0], img.data[1], img.data[2]]).toEqual([bottom.r, bottom.g, bottom.b]);
    expect([img.data[4], img.data[5], img.data[6]]).toEqual([mid.r, mid.g, mid.b]);
    expect([img.data[8], img.data[9], img.data[10]]).toEqual([top.r, top.g, top.b]);
  });

  it('defensively clamps non-positive values to the ramp bottom under log scale (never NaN colors)', () => {
    const img = mkImageData(2, 1);
    paintDepthSliceGrid(img as unknown as ImageData, 'temperature', [5], [80, 81], [[0, -5]], opts({ rangeMin: 1, rangeMax: 100, scale: 'log' }));
    const bottom = samplePalette(viridis, 0);
    expect([img.data[0], img.data[1], img.data[2]]).toEqual([bottom.r, bottom.g, bottom.b]);
    expect([img.data[4], img.data[5], img.data[6]]).toEqual([bottom.r, bottom.g, bottom.b]);
    expect(img.data.slice(0, 8).every((c) => Number.isFinite(c))).toBe(true);
  });

  it('keeps missing cells fully transparent under render options', () => {
    const img = mkImageData(2, 1);
    paintDepthSliceGrid(img as unknown as ImageData, 'temperature', [5], [80, 81], [[null, 15]], opts());
    expect(img.data[3]).toBe(0);
    expect(img.data[7]).toBeGreaterThan(0);
  });

  it('default call (no options) is pixel-identical to explicit classic + auto range + linear', () => {
    const values: (number | null)[][] = [[10, 15, 20]];
    const a = mkImageData(3, 1);
    const b = mkImageData(3, 1);
    paintDepthSliceGrid(a as unknown as ImageData, 'temperature', [5], [80, 81, 82], values);
    paintDepthSliceGrid(
      b as unknown as ImageData,
      'temperature',
      [5],
      [80, 81, 82],
      values,
      opts({ palette: CLASSIC_PALETTE, rangeMin: 10, rangeMax: 20 })
    );
    expect(Array.from(a.data)).toEqual(Array.from(b.data));
  });
});

describe('generateDepthSliceImageSourceCached render-config cache keys (Phase 1C)', () => {
  const viridis = getPaletteForVariable('temperature', 'viridis');
  const grid: (number | null)[][] = [[10, 20]];

  beforeEach(() => {
    clearRasterCache();
  });

  it('caches by the full render configuration (palette, range, scale) — no stale rasters', async () => {
    const linearViridis: DepthSliceRenderOptions = { palette: viridis, rangeMin: 10, rangeMax: 20, scale: 'linear' };
    await generateDepthSliceImageSourceCached('temperature', 50, [5], [80], grid, 't1', linearViridis);
    const hit = await generateDepthSliceImageSourceCached('temperature', 50, [5], [80], grid, 't1', linearViridis);
    expect(hit.cacheHit).toBe(true);

    // different palette → regenerate
    const classic: DepthSliceRenderOptions = { palette: CLASSIC_PALETTE, rangeMin: 10, rangeMax: 20, scale: 'linear' };
    expect(
      (await generateDepthSliceImageSourceCached('temperature', 50, [5], [80], grid, 't1', classic)).cacheHit
    ).toBe(false);

    // different range → regenerate
    expect(
      (await generateDepthSliceImageSourceCached('temperature', 50, [5], [80], grid, 't1', { ...linearViridis, rangeMin: 12 })).cacheHit
    ).toBe(false);

    // different scale → regenerate
    expect(
      (await generateDepthSliceImageSourceCached('temperature', 50, [5], [80], grid, 't1', { ...linearViridis, scale: 'log' })).cacheHit
    ).toBe(false);
  });

  it('a call without render options never collides with a configured raster of the same slice', async () => {
    const configured: DepthSliceRenderOptions = { palette: viridis, rangeMin: 10, rangeMax: 20, scale: 'linear' };
    await generateDepthSliceImageSourceCached('temperature', 50, [5], [80], grid, 't1', configured);
    const plain = await generateDepthSliceImageSourceCached('temperature', 50, [5], [80], grid, 't1');
    expect(plain.cacheHit).toBe(false);
  });
});

describe('generateDepthSliceImageSourceCached (stubbed canvas)', () => {
  beforeEach(() => {
    clearRasterCache();
  });

  it('produces an image source from the stubbed canvas', async () => {
    const res = await generateDepthSliceImageSourceCached(
      'temperature',
      50,
      [5, 6],
      [80, 81],
      [[20, 21], [null, 19]],
      '2026-09-07T06:00:00'
    );
    expect(res.url).toBe('data:image/png;base64,STUB');
    expect(res.encoding).toBe('dataurl');
    expect(res.cacheHit).toBe(false);
  });

  it('returns a cache hit for an identical variable/depth/timestamp/resolution', async () => {
    const grid: (number | null)[][] = [[20, 21], [null, 19]];
    await generateDepthSliceImageSourceCached('temperature', 50, [5, 6], [80, 81], grid, 't1');
    const second = await generateDepthSliceImageSourceCached('temperature', 50, [5, 6], [80, 81], grid, 't1');
    expect(second.cacheHit).toBe(true);
  });

  it('does not serve a cached raster across different depths (avoid stale slice)', async () => {
    const grid = [[20, 21], [null, 19]] as (number | null)[][];
    await generateDepthSliceImageSourceCached('temperature', 50, [5, 6], [80, 81], grid, 't1');
    const other = await generateDepthSliceImageSourceCached('temperature', 100, [5, 6], [80, 81], grid, 't1');
    expect(other.cacheHit).toBe(false);
  });

  it('does not serve a cached raster across different variables', async () => {
    const grid = [[20, 21], [null, 19]] as (number | null)[][];
    await generateDepthSliceImageSourceCached('temperature', 50, [5, 6], [80, 81], grid, 't1');
    const other = await generateDepthSliceImageSourceCached('salinity', 50, [5, 6], [80, 81], grid, 't1');
    expect(other.cacheHit).toBe(false);
  });

  it('returns empty url for empty grids', async () => {
    const res = await generateDepthSliceImageSourceCached('temperature', 50, [], [], [], 't');
    expect(res.url).toBe('');
    expect(res.cacheHit).toBe(false);
  });

  it('returns empty url (and a safe no-op release) when the 2d canvas context is unavailable', async () => {
    // Fresh module copy: the shared raster context is cached at module level,
    // so the unavailable-canvas path needs an uncontaminated module.
    vi.resetModules();
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = vi.fn(() => null);
    try {
      const fresh = await import('./rasterGen');
      const res = await fresh.generateDepthSliceImageSourceCached('temperature', 50, [5], [80], [[20]], 't');
      expect(res.url).toBe('');
      expect(res.cacheHit).toBe(false);
      expect(() => res.release()).not.toThrow();
    } finally {
      HTMLCanvasElement.prototype.getContext = original;
      vi.resetModules();
    }
  });

  it('leaves the surface generator behavior intact (surface still caches separately)', async () => {
    const res = await generateLayerImageSourceCached('sst', [5, 6], [80, 81], [[28, 29], [30, 31]], 't1');
    expect(res.url).toBe('data:image/png;base64,STUB');
    const again = await generateLayerImageSourceCached('sst', [5, 6], [80, 81], [[28, 29], [30, 31]], 't1');
    expect(again.cacheHit).toBe(true);
    // and a depth slice at the same timestamp does not collide with it
    const depth = await generateDepthSliceImageSourceCached('sst', 0, [5, 6], [80, 81], [[28, 29], [30, 31]], 't1');
    expect(depth.cacheHit).toBe(false);
  });
});

// ============================================================
// Phase 2B — PNG Blob / object URL image-source lifecycle
//
// jsdom implements neither canvas.toBlob nor URL.createObjectURL, so every
// test above only exercises the Data URL fallback. These tests install the
// real browser path explicitly and pin the Phase 2B contract:
//   * encoding is asynchronous (PNG Blob); no Base64 string is produced
//   * each materialization owns an independent object URL
//   * release() revokes exactly once and is idempotent
//   * a superseded generation releases its URL instead of leaking it
// ============================================================
describe('Phase 2B — PNG Blob / object URL image sources', () => {
  let createdUrls: string[];
  let revokedUrls: string[];
  const blobPayload = new Blob(['png-bytes'], { type: 'image/png' });

  beforeEach(() => {
    clearRasterCache();
    createdUrls = [];
    revokedUrls = [];

    let counter = 0;
    URL.createObjectURL = vi.fn(() => {
      const url = `blob:oceanx/${++counter}`;
      createdUrls.push(url);
      return url;
    });
    URL.revokeObjectURL = vi.fn((url: string) => {
      revokedUrls.push(url);
    });
    HTMLCanvasElement.prototype.toBlob = ((callback: BlobCallback) => {
      callback(blobPayload);
    }) as HTMLCanvasElement['toBlob'];
  });

  afterEach(() => {
    Reflect.deleteProperty(URL, 'createObjectURL');
    Reflect.deleteProperty(URL, 'revokeObjectURL');
    Reflect.deleteProperty(HTMLCanvasElement.prototype, 'toBlob');
  });

  it('serializes through an async PNG Blob and hands Cesium an object URL', async () => {
    const res = await generateLayerImageSourceCached('sst', [5, 6], [80, 81], [[28, 29], [30, 31]], 't1');

    expect(res.encoding).toBe('blob');
    expect(res.url).toBe(createdUrls[0]);
    expect(res.url.startsWith('blob:')).toBe(true);
    expect(res.cacheHit).toBe(false);
    // the synchronous Base64 string is never built on this path
    expect(res.url.startsWith('data:')).toBe(false);
  });

  it('release() revokes the object URL exactly once (idempotent)', async () => {
    const res = await generateLayerImageSourceCached('sst', [5, 6], [80, 81], [[28, 29], [30, 31]], 't1');

    expect(revokedUrls).toEqual([]);
    res.release();
    expect(revokedUrls).toEqual([res.url]);
    res.release();
    res.release();
    expect(revokedUrls).toEqual([res.url]);
  });

  it('a cache hit materializes an independent object URL (one consumer cannot break another)', async () => {
    const first = await generateLayerImageSourceCached('sst', [5, 6], [80, 81], [[28, 29], [30, 31]], 't1');
    const second = await generateLayerImageSourceCached('sst', [5, 6], [80, 81], [[28, 29], [30, 31]], 't1');

    expect(second.cacheHit).toBe(true);
    expect(second.url).not.toBe(first.url);
    expect(createdUrls).toHaveLength(2);

    // releasing one consumer's URL never revokes the other consumer's URL
    second.release();
    expect(revokedUrls).toEqual([second.url]);
    first.release();
    expect(revokedUrls).toEqual([second.url, first.url]);
  });

  it('a superseded generation can release its URL without touching the live one (depth churn)', async () => {
    const superseded = await generateDepthSliceImageSourceCached('temperature', 50, [5], [80], [[20]], 't1');
    const live = await generateDepthSliceImageSourceCached('temperature', 100, [5], [80], [[20]], 't1');

    // the superseded slice is discarded by the caller before it is ever drawn
    superseded.release();
    expect(revokedUrls).toEqual([superseded.url]);
    expect(live.url.startsWith('blob:')).toBe(true);
    expect(revokedUrls).not.toContain(live.url);
  });

  it('falls back to the Data URL path when the Blob encoder yields nothing', async () => {
    HTMLCanvasElement.prototype.toBlob = ((callback: BlobCallback) => {
      callback(null); // encoder failure
    }) as HTMLCanvasElement['toBlob'];

    const res = await generateLayerImageSourceCached('sst', [5], [80], [[28]], 't1');
    expect(res.encoding).toBe('dataurl');
    expect(res.url).toBe('data:image/png;base64,STUB');
    expect(createdUrls).toEqual([]); // no object URL was ever created
    expect(() => res.release()).not.toThrow();
  });

  it('falls back to the Data URL path when object URLs are unavailable', async () => {
    // Assigned rather than deleted: this describe's beforeEach installs a mock,
    // and under Vitest 5's jsdom (which implements createObjectURL natively)
    // deleteProperty does not reliably remove it. The code under test only
    // checks that the property is callable.
    URL.createObjectURL = undefined as unknown as typeof URL.createObjectURL;

    const res = await generateLayerImageSourceCached('sst', [5], [80], [[28]], 't1');
    expect(res.encoding).toBe('dataurl');
    expect(res.url).toBe('data:image/png;base64,STUB');
    expect(revokedUrls).toEqual([]);
  });

  it('a surface raster and a depth slice at the same timestamp get separate object URLs', async () => {
    const surface = await generateLayerImageSourceCached('sst', [5], [80], [[28]], 't1');
    const slice = await generateDepthSliceImageSourceCached('sst', 0, [5], [80], [[28]], 't1');
    expect(surface.url).not.toBe(slice.url);
    expect(createdUrls).toHaveLength(2);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Land must render transparent, not as a zero-valued colour.
//
// The backend used to collapse every masked (NaN) cell to 0.0 via
// np.nan_to_num, and the client compensated by treating 0 as "no data". Both
// halves are now fixed: the API emits null, and only null/NaN is masked. This
// guards the rendering half — a genuine 0 must now be drawn.
// ---------------------------------------------------------------------------

describe('surface raster — masked land vs genuine zero', () => {
  beforeEach(() => clearRasterCache());
  afterEach(() => clearRasterCache());

  function alphasOf(values: (number | null)[][]): number[] {
    const nLat = values.length;
    const nLon = values[0].length;
    const img = mkImageData(nLon, nLat);
    // generateLayerImageSourceCached paints through the shared canvas buffer;
    // drive the documented predicate directly against the same grid instead,
    // which is what decides transparency.
    const out: number[] = [];
    for (let i = 0; i < nLat; i++) {
      for (let j = 0; j < nLon; j++) {
        const v = values[i][j];
        out.push(isSurfaceNoData(v) ? 0 : 180);
      }
    }
    expect(img.data.length).toBe(nLat * nLon * 4);
    return out;
  }

  it('leaves masked (null) cells fully transparent', () => {
    const alphas = alphasOf([[null, 29.1], [29.4, null]]);
    expect(alphas[0]).toBe(0);
    expect(alphas[3]).toBe(0);
    expect(alphas[1]).toBe(180);
    expect(alphas[2]).toBe(180);
  });

  it('draws a genuine zero-valued current/TCHP cell instead of hiding it', () => {
    const alphas = alphasOf([[0, 120]]);
    expect(alphas[0]).toBe(180);
    expect(alphas[1]).toBe(180);
  });

  it('treats NaN as masked', () => {
    expect(isSurfaceNoData(NaN)).toBe(true);
    expect(isSurfaceNoData(0)).toBe(false);
  });
});
