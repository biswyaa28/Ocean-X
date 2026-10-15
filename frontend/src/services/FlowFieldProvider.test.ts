import { describe, it, expect } from 'vitest';
import {
  generateBayOfBengalFlowField,
  normalizeHycomCurrentField,
  countValidCurrentCells,
  sampleFlowVelocity,
} from './FlowFieldProvider';
import { makeCurrentsSlicePayload } from '../test/fixtures/depthSliceFixtures';
import type { EnvironmentalFlowField } from '../types/flow';

/**
 * Phase 1E — real UVEL/VVEL response normalization tests.
 *
 * All payloads are schema-compatible FIXTURES mirroring the Phase 1A wire
 * format; they exercise logic only and are never real scientific data.
 */

function makeField(u: number[][], v: number[][], lats: number[], lons: number[]): EnvironmentalFlowField {
  return {
    type: 'current',
    timestamp: '2026-09-08T12:00:00',
    bounds: {
      minLat: Math.min(...lats),
      maxLat: Math.max(...lats),
      minLon: Math.min(...lons),
      maxLon: Math.max(...lons),
    },
    grid: { latitudes: lats, longitudes: lons, u, v },
    units: 'm/s',
    source: 'TEST',
    status: 'REAL',
  };
}

describe('normalizeHycomCurrentField — real payload normalization', () => {
  it('normalizes a valid UVEL/VVEL payload with full provenance', () => {
    const payload = makeCurrentsSlicePayload();
    const field = normalizeHycomCurrentField(payload)!;

    expect(field).not.toBeNull();
    expect(field.type).toBe('current');
    expect(field.status).toBe('REAL');
    expect(field.units).toBe('m/s');
    expect(field.source).toBe(payload.source);
    expect(field.timestamp).toBe(payload.timestamp);
    expect(field.matchedDepthM).toBe(payload.matched_depth_m);
    expect(field.depthM).toBe(payload.requested_depth_m);

    // grid geometry preserved exactly: row i = latitudes[i], col j = longitudes[j]
    expect(field.grid.latitudes).toEqual(payload.grid.latitudes);
    expect(field.grid.longitudes).toEqual(payload.grid.longitudes);
    expect(field.grid.u.length).toBe(payload.grid.latitudes.length);
    expect(field.grid.u[0].length).toBe(payload.grid.longitudes.length);
  });

  it('preserves values without mutation (0.0 stays 0.0, signs preserved)', () => {
    const payload = makeCurrentsSlicePayload();
    const field = normalizeHycomCurrentField(payload)!;
    // fixture has u[0][1]=0.5, u[1][1]=0.0, u[2][1]=-0.1
    expect(field.grid.u[0][1]).toBe(0.5);
    expect(field.grid.u[1][1]).toBe(0.0); // legitimate zero, NOT missing
    expect(field.grid.u[2][1]).toBe(-0.1);
  });

  it('converts null cells to NaN in BOTH components (missing stays missing)', () => {
    const payload = makeCurrentsSlicePayload(); // u[0][2] and v[0][2] are null
    const field = normalizeHycomCurrentField(payload)!;
    expect(Number.isNaN(field.grid.u[0][2])).toBe(true);
    expect(Number.isNaN(field.grid.v[0][2])).toBe(true);
    expect(field.grid.u[0][0]).toBe(0.4); // neighbors untouched
    expect(field.statusReason).toContain('missing');
  });

  it('treats a null in EITHER component as a fully missing vector cell', () => {
    const payload = makeCurrentsSlicePayload({
      grid: {
        latitudes: [5, 6],
        longitudes: [80, 81],
        values: undefined,
        u: [
          [0.4, null],
          [0.3, 0.2],
        ],
        v: [
          [-0.2, 0.1],
          [0.0, -0.4],
        ],
      },
    });
    const field = normalizeHycomCurrentField(payload)!;
    expect(Number.isNaN(field.grid.u[0][1])).toBe(true);
    expect(Number.isNaN(field.grid.v[0][1])).toBe(true); // v was valid but u missing
    expect(countValidCurrentCells(field)).toBe(3);
  });

  it('reports surfaceOnly when the matched native depth is 0 m', () => {
    const surface = normalizeHycomCurrentField(
      makeCurrentsSlicePayload({ matched_depth_m: 0, requested_depth_m: 0 })
    )!;
    expect(surface.surfaceOnly).toBe(true);
    const subsurface = normalizeHycomCurrentField(
      makeCurrentsSlicePayload({ matched_depth_m: 250, requested_depth_m: 250 })
    )!;
    expect(subsurface.surfaceOnly).toBe(false);
  });

  it('computes bounds from the actual axes (not the reported bounds)', () => {
    const payload = makeCurrentsSlicePayload();
    const field = normalizeHycomCurrentField(payload)!;
    expect(field.bounds.minLat).toBe(Math.min(...payload.grid.latitudes));
    expect(field.bounds.maxLat).toBe(Math.max(...payload.grid.latitudes));
    expect(field.bounds.minLon).toBe(Math.min(...payload.grid.longitudes));
    expect(field.bounds.maxLon).toBe(Math.max(...payload.grid.longitudes));
  });
});

describe('normalizeHycomCurrentField — malformed payloads', () => {
  it('rejects a payload without a grid', () => {
    const payload = { ...makeCurrentsSlicePayload(), grid: undefined } as never;
    expect(normalizeHycomCurrentField(payload)).toBeNull();
  });

  it('rejects missing u or v arrays', () => {
    const noU = makeCurrentsSlicePayload({
      grid: { latitudes: [5, 6], longitudes: [80, 81], values: undefined, u: undefined, v: [[0, 0], [0, 0]] },
    });
    expect(normalizeHycomCurrentField(noU)).toBeNull();

    const noV = makeCurrentsSlicePayload({
      grid: { latitudes: [5, 6], longitudes: [80, 81], values: undefined, u: [[0, 0], [0, 0]], v: undefined },
    });
    expect(normalizeHycomCurrentField(noV)).toBeNull();
  });

  it('rejects ragged row lengths', () => {
    const payload = makeCurrentsSlicePayload({
      grid: {
        latitudes: [5, 6],
        longitudes: [80, 81, 82],
        values: undefined,
        u: [
          [0.4, 0.5, 0.6],
          [0.3, 0.2], // ragged
        ],
        v: [
          [-0.2, 0.1, 0.0],
          [0.3, -0.4],
        ],
      },
    });
    expect(normalizeHycomCurrentField(payload)).toBeNull();
  });

  it('rejects u/v row count not matching latitudes', () => {
    const payload = makeCurrentsSlicePayload({
      grid: {
        latitudes: [5, 6, 7],
        longitudes: [80, 81],
        values: undefined,
        u: [
          [0.4, 0.5],
          [0.3, 0.2],
        ],
        v: [
          [-0.2, 0.1],
          [0.3, -0.4],
        ],
      },
    });
    expect(normalizeHycomCurrentField(payload)).toBeNull();
  });

  it('rejects axes with fewer than 2 points (unusable for bilinear sampling)', () => {
    const payload = makeCurrentsSlicePayload({
      grid: {
        latitudes: [5],
        longitudes: [80, 81],
        values: undefined,
        u: [[0.4, 0.5]],
        v: [[-0.2, 0.1]],
      },
    });
    expect(normalizeHycomCurrentField(payload)).toBeNull();
  });

  it('rejects an all-null payload (no valid vectors at all)', () => {
    const payload = makeCurrentsSlicePayload({
      grid: {
        latitudes: [5, 6],
        longitudes: [80, 81],
        values: undefined,
        u: [
          [null, null],
          [null, null],
        ],
        v: [
          [null, null],
          [null, null],
        ],
      },
      missing_values: 8,
    });
    expect(normalizeHycomCurrentField(payload)).toBeNull();
  });

  it('rejects non-numeric cell types (malformed payload)', () => {
    const payload = makeCurrentsSlicePayload({
      grid: {
        latitudes: [5, 6],
        longitudes: [80, 81],
        values: undefined,
        u: [
          [0.4, 'fast' as unknown as number],
          [0.3, 0.2],
        ],
        v: [
          [-0.2, 0.1],
          [0.3, -0.4],
        ],
      },
    });
    expect(normalizeHycomCurrentField(payload)).toBeNull();
  });
});

describe('sampleFlowVelocity — real-grid aware sampling', () => {
  it('bilinearly samples a uniform grid (synthetic field unchanged)', () => {
    const field = generateBayOfBengalFlowField('current');
    const { u, v, speed } = sampleFlowVelocity(field, field.grid.latitudes[5], field.grid.longitudes[7]);
    expect(u).toBeCloseTo(field.grid.u[5][7], 5);
    expect(v).toBeCloseTo(field.grid.v[5][7], 5);
    expect(speed).toBeCloseTo(Math.hypot(field.grid.u[5][7], field.grid.v[5][7]), 5);
  });

  it('samples a NON-UNIFORM real grid correctly (binary search bracketing)', () => {
    // Irregular spacing typical of native model grids
    const lats = [5, 5.4, 6.1, 7.3, 9.0];
    const lons = [80, 80.3, 81.0, 82.2];
    const u = [
      [1, 1, 1, 1],
      [1, 1, 1, 1],
      [1, 1, 1, 1],
      [1, 1, 1, 1],
      [1, 1, 1, 1],
    ];
    const v = [
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ];
    const field = makeField(u, v, lats, lons);
    const s = sampleFlowVelocity(field, 6.1, 81.0);
    expect(s.u).toBeCloseTo(1, 6);
    expect(s.speed).toBeCloseTo(1, 6);
    // gradient check: a half-cell interpolation between two known values
    const u2 = [
      [0, 0, 0, 0],
      [1, 1, 1, 1],
      [2, 2, 2, 2],
      [3, 3, 3, 3],
      [4, 4, 4, 4],
    ];
    const field2 = makeField(u2, v, lats, lons);
    const mid = sampleFlowVelocity(field2, 5.4, 80.3); // exactly at row 1
    expect(mid.u).toBeCloseTo(1, 6);
    const between = sampleFlowVelocity(field2, 5.75, 80.3); // halfway rows 1-2
    expect(between.u).toBeCloseTo(1.5, 3);
  });

  it('supports descending latitude axes without flipping the grid', () => {
    // Some HYCOM products ship LAT descending; orientation must be preserved
    const lats = [9, 7, 5];
    const lons = [80, 81];
    const u = [
      [3, 3],
      [2, 2],
      [1, 1],
    ];
    const v = [
      [0, 0],
      [0, 0],
      [0, 0],
    ];
    const field = makeField(u, v, lats, lons);
    expect(sampleFlowVelocity(field, 9, 80.5).u).toBeCloseTo(3, 6);
    expect(sampleFlowVelocity(field, 5, 80.5).u).toBeCloseTo(1, 6);
    expect(sampleFlowVelocity(field, 7, 80.5).u).toBeCloseTo(2, 6);
    expect(sampleFlowVelocity(field, 8, 80.5).u).toBeCloseTo(2.5, 3);
  });

  it('returns zero speed inside a missing (NaN) region — no fabricated vectors', () => {
    const lats = [5, 6, 7];
    const lons = [80, 81, 82];
    const u = [
      [0.4, 0.5, 0.6],
      [0.3, Number.NaN, 0.4],
      [0.2, 0.3, 0.4],
    ];
    const v = [
      [-0.2, 0.1, 0.0],
      [0.3, Number.NaN, -0.4],
      [0.2, 0.25, 0.15],
    ];
    const field = makeField(u, v, lats, lons);
    const center = sampleFlowVelocity(field, 6, 81);
    expect(center.u).toBe(0);
    expect(center.v).toBe(0);
    expect(center.speed).toBe(0);
  });

  it('still samples valid cells adjacent to a missing region', () => {
    const lats = [5, 6, 7];
    const lons = [80, 81, 82];
    const u = [
      [0.4, 0.5, 0.6],
      [0.3, Number.NaN, 0.4],
      [0.2, 0.3, 0.4],
    ];
    const v = [
      [-0.2, 0.1, 0.0],
      [0.3, Number.NaN, -0.4],
      [0.2, 0.25, 0.15],
    ];
    const field = makeField(u, v, lats, lons);
    expect(sampleFlowVelocity(field, 5, 80).u).toBeCloseTo(0.4, 6);
    expect(sampleFlowVelocity(field, 7, 82).u).toBeCloseTo(0.4, 6);
  });

  it('clamps out-of-bounds positions to zero speed', () => {
    const field = makeField(
      [
        [1, 1],
        [1, 1],
      ],
      [
        [1, 1],
        [1, 1],
      ],
      [5, 6],
      [80, 81]
    );
    expect(sampleFlowVelocity(field, 4, 80.5).speed).toBe(0);
    expect(sampleFlowVelocity(field, 7, 80.5).speed).toBe(0);
    expect(sampleFlowVelocity(field, 5.5, 79).speed).toBe(0);
    expect(sampleFlowVelocity(field, 5.5, 82).speed).toBe(0);
  });

  it('handles grid points exactly on the boundary values', () => {
    const lats = [5, 6, 7];
    const lons = [80, 81, 82];
    const u = [
      [0.1, 0.2, 0.3],
      [0.4, 0.5, 0.6],
      [0.7, 0.8, 0.9],
    ];
    const v = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ];
    const field = makeField(u, v, lats, lons);
    expect(sampleFlowVelocity(field, 5, 80).u).toBeCloseTo(0.1, 6);
    expect(sampleFlowVelocity(field, 7, 82).u).toBeCloseTo(0.9, 6);
  });

  it('supports reusable out parameter to avoid per-sample allocations', () => {
    const field = generateBayOfBengalFlowField('current');
    const out = { u: 0, v: 0, speed: 0 };
    const returned = sampleFlowVelocity(field, 15.0, 85.0, out);
    expect(returned).toBe(out);
    expect(out.speed).toBeGreaterThan(0);
  });
});

describe('countValidCurrentCells', () => {
  it('counts only cells where both components are finite', () => {
    const field = makeField(
      [
        [0.4, Number.NaN],
        [0.3, 0.2],
      ],
      [
        [-0.2, 0.1],
        [Number.NaN, -0.4],
      ],
      [5, 6],
      [80, 81]
    );
    // (0,0) valid; (0,1) u NaN; (1,0) v NaN; (1,1) valid
    expect(countValidCurrentCells(field)).toBe(2);
  });
});
