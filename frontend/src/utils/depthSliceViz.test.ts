import { describe, it, expect } from 'vitest';
import {
  DEFAULT_DEPTH_SLICE_DISPLAY,
  DepthSliceDisplaySettings,
  extractDepthSliceValues,
  computeSliceDataRange,
  validateDisplayRange,
  resolveDepthSliceRender,
} from './depthSliceViz';
import { DepthSlicePayload } from '../services/ApiProvider';
import { makeDepthSlicePayload, makeCurrentsSlicePayload } from '../test/fixtures/depthSliceFixtures';

describe('DEFAULT_DEPTH_SLICE_DISPLAY — preserves Phase 1B semantics', () => {
  it('defaults to the classic palette, auto range, linear scale and the 1B layer alpha', () => {
    expect(DEFAULT_DEPTH_SLICE_DISPLAY).toEqual({
      paletteId: 'classic',
      min: null,
      max: null,
      scale: 'linear',
      opacity: 0.75,
    });
  });
});

describe('extractDepthSliceValues', () => {
  it('passes scalar grids through unchanged (nulls preserved)', () => {
    const p = makeDepthSlicePayload();
    const vals = extractDepthSliceValues(p);
    expect(vals).toEqual(p.grid.values);
  });

  it('derives speed magnitude from currents u/v grids', () => {
    const p = makeCurrentsSlicePayload();
    const vals = extractDepthSliceValues(p)!;
    expect(vals[0][0]).toBeCloseTo(Math.hypot(0.4, -0.2), 5);
    expect(vals[0][2]).toBeNull(); // null u stays missing
    expect(vals[1][1]).toBeCloseTo(Math.hypot(0.0, 0.3), 5);
  });

  it('returns null when the payload carries no usable grid', () => {
    const noGrid = { ...makeDepthSlicePayload(), grid: undefined } as unknown as DepthSlicePayload;
    expect(extractDepthSliceValues(noGrid)).toBeNull();
    const noVectors = makeCurrentsSlicePayload({
      grid: { latitudes: [5], longitudes: [80], values: undefined, u: undefined, v: undefined },
    });
    expect(extractDepthSliceValues(noVectors)).toBeNull();
  });
});

describe('computeSliceDataRange', () => {
  it('computes min/max over valid cells, ignoring missing values', () => {
    const p = makeDepthSlicePayload(); // values include null and 0.0
    const range = computeSliceDataRange(p)!;
    expect(range.min).toBe(0.0); // 0.0 is a REAL value for depth slices
    expect(range.max).toBe(20.2);
  });

  it('returns null when every cell is missing', () => {
    const p = makeDepthSlicePayload({
      grid: { latitudes: [5], longitudes: [80], values: [[null]] },
    });
    expect(computeSliceDataRange(p)).toBeNull();
  });

  it('returns null without a usable grid', () => {
    expect(computeSliceDataRange(null)).toBeNull();
  });
});

describe('validateDisplayRange', () => {
  it('accepts a strictly increasing finite range', () => {
    expect(validateDisplayRange(10, 20)).toEqual({ valid: true, reason: null });
  });

  it('rejects min >= max', () => {
    expect(validateDisplayRange(20, 10).valid).toBe(false);
    expect(validateDisplayRange(10, 10).valid).toBe(false);
    expect(validateDisplayRange(20, 10).reason).toMatch(/min/i);
  });

  it('rejects non-finite values', () => {
    expect(validateDisplayRange(NaN, 20).valid).toBe(false);
    expect(validateDisplayRange(10, Infinity).valid).toBe(false);
  });
});

describe('resolveDepthSliceRender', () => {
  it('returns null without a payload', () => {
    expect(resolveDepthSliceRender(null, DEFAULT_DEPTH_SLICE_DISPLAY)).toBeNull();
  });

  it('returns null when the slice has no valid data cells', () => {
    const allMissing = makeDepthSlicePayload({
      grid: { latitudes: [5], longitudes: [80], values: [[null]] },
    });
    expect(resolveDepthSliceRender(allMissing, DEFAULT_DEPTH_SLICE_DISPLAY)).toBeNull();
  });

  it('auto-ranges over the slice data by default (Phase 1B behavior)', () => {
    const r = resolveDepthSliceRender(makeDepthSlicePayload(), DEFAULT_DEPTH_SLICE_DISPLAY)!;
    expect(r.isAutoRange).toBe(true);
    expect(r.rangeMin).toBe(0.0);
    expect(r.rangeMax).toBe(20.2);
    expect(r.scale).toBe('linear');
    expect(r.palette.id).toBe('classic');
  });

  it('applies a valid user display range (visualization only)', () => {
    const settings: DepthSliceDisplaySettings = { ...DEFAULT_DEPTH_SLICE_DISPLAY, min: 19, max: 21 };
    const r = resolveDepthSliceRender(makeDepthSlicePayload(), settings)!;
    expect(r.isAutoRange).toBe(false);
    expect(r.rangeMin).toBe(19);
    expect(r.rangeMax).toBe(21);
    expect(r.dataMin).toBe(0.0); // data bounds still reported separately
    expect(r.dataMax).toBe(20.2);
  });

  it('falls back to the auto range when the user range is invalid (never renders an invalid ramp)', () => {
    const settings: DepthSliceDisplaySettings = { ...DEFAULT_DEPTH_SLICE_DISPLAY, min: 25, max: 20 };
    const r = resolveDepthSliceRender(makeDepthSlicePayload(), settings)!;
    expect(r.isAutoRange).toBe(true);
    expect(r.rangeMin).toBe(0.0);
    expect(r.rangeMax).toBe(20.2);
  });

  it('falls back to the auto range when only one bound is set', () => {
    const partial: DepthSliceDisplaySettings = { ...DEFAULT_DEPTH_SLICE_DISPLAY, min: 19, max: null };
    const r = resolveDepthSliceRender(makeDepthSlicePayload(), partial)!;
    expect(r.isAutoRange).toBe(true);
  });

  it('resolves the requested palette for the variable', () => {
    const settings: DepthSliceDisplaySettings = { ...DEFAULT_DEPTH_SLICE_DISPLAY, paletteId: 'haline' };
    const r = resolveDepthSliceRender(
      makeDepthSlicePayload({ variable: 'salinity', units: 'PSU' }),
      settings
    )!;
    expect(r.palette.id).toBe('haline');
  });

  it('falls back to the classic palette when the palette is not offered for the variable', () => {
    const settings: DepthSliceDisplaySettings = { ...DEFAULT_DEPTH_SLICE_DISPLAY, paletteId: 'haline' };
    // haline is a salinity palette; temperature does not offer it
    const r = resolveDepthSliceRender(makeDepthSlicePayload(), settings)!;
    expect(r.palette.id).toBe('classic');
  });

  describe('log-scale safety', () => {
    it('enables log only for strictly positive data with a positive display range', () => {
      const positive = makeDepthSlicePayload({
        grid: {
          latitudes: [5, 6],
          longitudes: [80, 81],
          values: [[1, 10], [100, 1000]],
        },
      });
      const settings: DepthSliceDisplaySettings = { ...DEFAULT_DEPTH_SLICE_DISPLAY, scale: 'log' };
      const r = resolveDepthSliceRender(positive, settings)!;
      expect(r.logAvailable).toBe(true);
      expect(r.logUnavailableReason).toBeNull();
      expect(r.scale).toBe('log');
    });

    it('disables log with an explicit reason when the data contains zero values', () => {
      // fixture values include a legitimate 0.0
      const settings: DepthSliceDisplaySettings = { ...DEFAULT_DEPTH_SLICE_DISPLAY, scale: 'log' };
      const r = resolveDepthSliceRender(makeDepthSlicePayload(), settings)!;
      expect(r.logAvailable).toBe(false);
      expect(r.logUnavailableReason).toMatch(/zero or negative/i);
      expect(r.scale).toBe('linear'); // never a silent log transform
    });

    it('disables log when the data contains negative values', () => {
      const negative = makeDepthSlicePayload({
        grid: { latitudes: [5], longitudes: [80, 81], values: [[-2, 5]] },
      });
      const settings: DepthSliceDisplaySettings = { ...DEFAULT_DEPTH_SLICE_DISPLAY, scale: 'log' };
      const r = resolveDepthSliceRender(negative, settings)!;
      expect(r.logAvailable).toBe(false);
      expect(r.scale).toBe('linear');
    });

    it('disables log when the configured display range includes zero or negative values', () => {
      const positive = makeDepthSlicePayload({
        grid: { latitudes: [5], longitudes: [80, 81], values: [[1, 10]] },
      });
      const settings: DepthSliceDisplaySettings = { ...DEFAULT_DEPTH_SLICE_DISPLAY, min: 0, max: 10, scale: 'log' };
      const r = resolveDepthSliceRender(positive, settings)!;
      expect(r.logAvailable).toBe(false);
      expect(r.logUnavailableReason).toMatch(/display range/i);
      expect(r.scale).toBe('linear');
    });
  });

  it('never mutates the scientific payload (display settings are visualization-only)', () => {
    const p = makeDepthSlicePayload();
    const before = JSON.stringify(p.grid.values);
    const settings: DepthSliceDisplaySettings = { ...DEFAULT_DEPTH_SLICE_DISPLAY, min: 19, max: 21, paletteId: 'thermal', scale: 'log' };
    resolveDepthSliceRender(p, settings);
    expect(JSON.stringify(p.grid.values)).toBe(before);
  });
});
