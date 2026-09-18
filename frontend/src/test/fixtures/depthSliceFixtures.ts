import { DepthSlicePayload } from '../../services/ApiProvider';

/**
 * Schema-compatible HYCOM depth-slice payloads mirroring the Phase 1A wire
 * format (snake_case). TEST FIXTURES ONLY — never real scientific data.
 */

export const DEPTHS = [0, 10, 50, 100, 250, 500];

export function makeDepthSlicePayload(overrides: Partial<DepthSlicePayload> = {}): DepthSlicePayload {
  const values: (number | null)[][] = [
    [20.1, 20.2, null],
    [19.8, 0.0, 19.9], // note: 0.0 is a REAL value, not missing
    [19.7, 19.6, 19.5],
  ];
  return {
    status: 'REAL',
    source: 'INCOIS RSMC HYCOM',
    dataset_file: '/data/raw/ocean/currents/RSMC_hycom_20260908.nc',
    variable: 'temperature',
    units: '°C',
    timestamp: '2026-09-07T06:00:00.000000000',
    requested_timestamp: '2026-09-07T06:00:00',
    requested_depth_m: 50,
    matched_depth_m: 50,
    available_depths_m: [...DEPTHS],
    depth_selection: 'nearest native HYCOM model depth (no interpolation)',
    missing_values: 1,
    bounds: { minLat: 5, maxLat: 7, minLon: 80, maxLon: 82 },
    grid: {
      latitudes: values.map((_, i) => 5 + i),
      longitudes: values[0].map((_, j) => 80 + j),
      values,
    },
    provenance: {
      source: 'INCOIS RSMC HYCOM',
      provider: 'INCOIS',
      dataset: 'RSMC_hycom_20260908.nc',
      variable: 'temperature',
      units: '°C',
      timestamp: '2026-09-07T06:00:00.000000000',
      requested_depth_m: 50,
      matched_depth_m: 50,
      processing_status: 'fixture-backed test payload',
      data_status: 'REAL',
    },
    ...overrides,
  };
}

export function makeCurrentsSlicePayload(overrides: Partial<DepthSlicePayload> = {}): DepthSlicePayload {
  const u = [
    [0.4, 0.5, null],
    [0.3, 0.0, 0.2],
    [0.1, -0.1, 0.05],
  ];
  const v = [
    [-0.2, 0.1, null],
    [0.0, 0.3, -0.4],
    [0.2, 0.25, 0.15],
  ];
  return makeDepthSlicePayload({
    variable: 'currents',
    units: 'm/s',
    grid: {
      latitudes: [5, 6, 7],
      longitudes: [80, 81, 82],
      values: undefined,
      u,
      v,
    },
    ...overrides,
  });
}
