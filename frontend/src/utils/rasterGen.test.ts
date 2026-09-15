import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  generateDepthSliceImageDataUrlCached,
  generateLayerImageDataUrlCached,
  paintDepthSliceGrid,
  isMissingDepthValue,
  isSurfaceNoData,
  clearRasterCache,
} from './rasterGen';

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
    const args = ['temperature', 50, [5, 6], [80, 81], [[20, 21], [null, 19]], 't1'] as const;
    generateDepthSliceImageDataUrlCached(...args);
    const second = generateDepthSliceImageDataUrlCached(...args);
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
