import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  generateDepthSliceImageDataUrlCached,
  generateLayerImageDataUrlCached,
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

  it('surface semantics regression guard: 0 stays masked (unchanged surface behavior)', () => {
    expect(isSurfaceNoData(0)).toBe(true);
    expect(isSurfaceNoData(null)).toBe(true);
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

describe('generateDepthSliceImageDataUrlCached render-config cache keys (Phase 1C)', () => {
  const viridis = getPaletteForVariable('temperature', 'viridis');
  const grid: (number | null)[][] = [[10, 20]];

  beforeEach(() => {
    clearRasterCache();
  });

  it('caches by the full render configuration (palette, range, scale) — no stale rasters', () => {
    const linearViridis: DepthSliceRenderOptions = { palette: viridis, rangeMin: 10, rangeMax: 20, scale: 'linear' };
    generateDepthSliceImageDataUrlCached('temperature', 50, [5], [80], grid, 't1', linearViridis);
    const hit = generateDepthSliceImageDataUrlCached('temperature', 50, [5], [80], grid, 't1', linearViridis);
    expect(hit.cacheHit).toBe(true);

    // different palette → regenerate
    const classic: DepthSliceRenderOptions = { palette: CLASSIC_PALETTE, rangeMin: 10, rangeMax: 20, scale: 'linear' };
    expect(
      generateDepthSliceImageDataUrlCached('temperature', 50, [5], [80], grid, 't1', classic).cacheHit
    ).toBe(false);

    // different range → regenerate
    expect(
      generateDepthSliceImageDataUrlCached('temperature', 50, [5], [80], grid, 't1', { ...linearViridis, rangeMin: 12 }).cacheHit
    ).toBe(false);

    // different scale → regenerate
    expect(
      generateDepthSliceImageDataUrlCached('temperature', 50, [5], [80], grid, 't1', { ...linearViridis, scale: 'log' }).cacheHit
    ).toBe(false);
  });

  it('a call without render options never collides with a configured raster of the same slice', () => {
    const configured: DepthSliceRenderOptions = { palette: viridis, rangeMin: 10, rangeMax: 20, scale: 'linear' };
    generateDepthSliceImageDataUrlCached('temperature', 50, [5], [80], grid, 't1', configured);
    const plain = generateDepthSliceImageDataUrlCached('temperature', 50, [5], [80], grid, 't1');
    expect(plain.cacheHit).toBe(false);
  });
});

describe('generateDepthSliceImageDataUrlCached (stubbed canvas)', () => {
  beforeEach(() => {
    clearRasterCache();
  });

  it('produces a data URL from the stubbed canvas', () => {
    const res = generateDepthSliceImageDataUrlCached(
      'temperature',
      50,
      [5, 6],
      [80, 81],
      [[20, 21], [null, 19]],
      '2026-09-07T06:00:00'
    );
    expect(res.dataUrl).toBe('data:image/png;base64,STUB');
    expect(res.cacheHit).toBe(false);
  });

  it('returns a cache hit for an identical variable/depth/timestamp/resolution', () => {
    const grid: (number | null)[][] = [[20, 21], [null, 19]];
    generateDepthSliceImageDataUrlCached('temperature', 50, [5, 6], [80, 81], grid, 't1');
    const second = generateDepthSliceImageDataUrlCached('temperature', 50, [5, 6], [80, 81], grid, 't1');
    expect(second.cacheHit).toBe(true);
  });

  it('does not serve a cached raster across different depths (avoid stale slice)', () => {
    const grid = [[20, 21], [null, 19]] as (number | null)[][];
    generateDepthSliceImageDataUrlCached('temperature', 50, [5, 6], [80, 81], grid, 't1');
    const other = generateDepthSliceImageDataUrlCached('temperature', 100, [5, 6], [80, 81], grid, 't1');
    expect(other.cacheHit).toBe(false);
  });

  it('does not serve a cached raster across different variables', () => {
    const grid = [[20, 21], [null, 19]] as (number | null)[][];
    generateDepthSliceImageDataUrlCached('temperature', 50, [5, 6], [80, 81], grid, 't1');
    const other = generateDepthSliceImageDataUrlCached('salinity', 50, [5, 6], [80, 81], grid, 't1');
    expect(other.cacheHit).toBe(false);
  });

  it('returns empty dataUrl for empty grids', () => {
    const res = generateDepthSliceImageDataUrlCached('temperature', 50, [], [], [], 't');
    expect(res.dataUrl).toBe('');
    expect(res.cacheHit).toBe(false);
  });

  it('returns empty dataUrl when the 2d canvas context is unavailable', async () => {
    // Fresh module copy: the shared raster context is cached at module level,
    // so the unavailable-canvas path needs an uncontaminated module.
    vi.resetModules();
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = vi.fn(() => null);
    try {
      const fresh = await import('./rasterGen');
      const res = fresh.generateDepthSliceImageDataUrlCached('temperature', 50, [5], [80], [[20]], 't');
      expect(res.dataUrl).toBe('');
      expect(res.cacheHit).toBe(false);
    } finally {
      HTMLCanvasElement.prototype.getContext = original;
      vi.resetModules();
    }
  });

  it('leaves the surface generator behavior intact (surface still caches separately)', () => {
    const res = generateLayerImageDataUrlCached('sst', [5, 6], [80, 81], [[28, 29], [30, 31]], 't1');
    expect(res.dataUrl).toBe('data:image/png;base64,STUB');
    const again = generateLayerImageDataUrlCached('sst', [5, 6], [80, 81], [[28, 29], [30, 31]], 't1');
    expect(again.cacheHit).toBe(true);
    // and a depth slice at the same timestamp does not collide with it
    const depth = generateDepthSliceImageDataUrlCached('sst', 0, [5, 6], [80, 81], [[28, 29], [30, 31]], 't1');
    expect(depth.cacheHit).toBe(false);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});
