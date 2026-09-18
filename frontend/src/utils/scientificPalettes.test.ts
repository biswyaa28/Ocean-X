import { describe, it, expect } from 'vitest';
import {
  CLASSIC_PALETTE_ID,
  samplePalette,
  palettesForVariable,
  getPaletteForVariable,
  paletteCssGradient,
  CLASSIC_PALETTE,
} from './scientificPalettes';
import { DEPTH_SLICE_VARIABLES } from '../services/ApiProvider';

describe('CLASSIC_PALETTE — Phase 1B ramp preservation', () => {
  it('reproduces the exact Phase 1B colormap node colors', () => {
    // Node colors of the previous hardcoded piecewise-linear ramp.
    expect(samplePalette(CLASSIC_PALETTE, 0)).toEqual({ r: 20, g: 60, b: 160 });
    expect(samplePalette(CLASSIC_PALETTE, 0.25)).toEqual({ r: 20, g: 160, b: 200 });
    expect(samplePalette(CLASSIC_PALETTE, 0.5)).toEqual({ r: 40, g: 220, b: 120 });
    expect(samplePalette(CLASSIC_PALETTE, 0.75)).toEqual({ r: 240, g: 210, b: 30 });
    expect(samplePalette(CLASSIC_PALETTE, 1)).toEqual({ r: 255, g: 80, b: 10 });
  });

  it('interpolates linearly between nodes exactly like the Phase 1B ramp', () => {
    // t=0.125 sits halfway into the first Phase 1B segment:
    // r=20, g=60+0.5*100, b=160+0.5*40
    expect(samplePalette(CLASSIC_PALETTE, 0.125)).toEqual({ r: 20, g: 110, b: 180 });
    // t=0.625 sits halfway into the third segment:
    // r=40+0.5*200, g=220-0.5*10, b=120-0.5*90
    expect(samplePalette(CLASSIC_PALETTE, 0.625)).toEqual({ r: 140, g: 215, b: 75 });
  });

  it('clamps out-of-range positions', () => {
    expect(samplePalette(CLASSIC_PALETTE, -0.5)).toEqual(samplePalette(CLASSIC_PALETTE, 0));
    expect(samplePalette(CLASSIC_PALETTE, 1.5)).toEqual(samplePalette(CLASSIC_PALETTE, 1));
  });
});

describe('palette registry — capability-driven variable palettes', () => {
  it('every backend-supported depth-slice variable has the classic palette first (default = Phase 1B look)', () => {
    for (const v of DEPTH_SLICE_VARIABLES) {
      const list = palettesForVariable(v.id);
      expect(list.length).toBeGreaterThanOrEqual(1);
      expect(list[0].id).toBe(CLASSIC_PALETTE_ID);
    }
  });

  it('temperature exposes a dedicated scientific thermal palette', () => {
    const ids = palettesForVariable('temperature').map((p) => p.id);
    expect(ids).toContain('thermal');
    expect(ids).toContain('viridis');
  });

  it('salinity exposes a dedicated scientific haline palette', () => {
    const ids = palettesForVariable('salinity').map((p) => p.id);
    expect(ids).toContain('haline');
    expect(ids).toContain('viridis');
  });

  it('thermal and haline palettes are distinct, sensible scientific ramps', () => {
    const thermal = getPaletteForVariable('temperature', 'thermal');
    const haline = getPaletteForVariable('salinity', 'haline');
    // cold end is blue-dominant for both; warm/haline ends differ
    expect(thermal.stops[0].rgb[2]).toBeGreaterThan(thermal.stops[0].rgb[0]);
    expect(haline.stops[thermal.stops.length - 1].rgb[0]).not.toBe(
      thermal.stops[thermal.stops.length - 1].rgb[0]
    );
  });

  it('falls back to the classic palette for unknown palette or variable ids (never throws)', () => {
    expect(getPaletteForVariable('temperature', 'does-not-exist').id).toBe(CLASSIC_PALETTE_ID);
    expect(getPaletteForVariable('does-not-exist', 'thermal').id).toBe(CLASSIC_PALETTE_ID);
  });

  it('all palettes have sorted stops anchored at 0 and 1 (valid color transfer functions)', () => {
    const seen = new Set<string>();
    for (const v of DEPTH_SLICE_VARIABLES) {
      for (const p of palettesForVariable(v.id)) {
        if (seen.has(p.id)) continue;
        seen.add(p.id);
        expect(p.stops[0].t).toBe(0);
        expect(p.stops[p.stops.length - 1].t).toBe(1);
        for (let i = 1; i < p.stops.length; i++) {
          expect(p.stops[i].t).toBeGreaterThan(p.stops[i - 1].t);
        }
      }
    }
  });
});

describe('paletteCssGradient — colorbar rendering source', () => {
  it('produces a CSS linear-gradient containing every stop', () => {
    const css = paletteCssGradient(CLASSIC_PALETTE);
    expect(css).toMatch(/^linear-gradient\(to right,/);
    for (const s of CLASSIC_PALETTE.stops) {
      const color = `rgb(${s.rgb[0]}, ${s.rgb[1]}, ${s.rgb[2]})`;
      expect(css).toContain(color);
    }
  });

  it('anchors the first stop at 0% and the last at 100%', () => {
    const css = paletteCssGradient(CLASSIC_PALETTE);
    expect(css).toContain(' 0%,');
    expect(css.endsWith(' 100%)')).toBe(true);
  });
});
