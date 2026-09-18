import { EnvironmentalFlowField } from '../types/flow';
import type { DepthSlicePayload } from './ApiProvider';

/**
 * Generates a normalized EnvironmentalFlowField for Bay of Bengal (Wind or Ocean Current).
 * Follows the data architecture: RAW DATA -> PROVIDER ADAPTER -> NORMALIZED FLOW FIELD.
 */
export function generateBayOfBengalFlowField(
  type: 'wind' | 'current',
  cycloneLat: number = 18.2,
  cycloneLon: number = 88.4,
  maxWindKts: number = 125,
  timestampStr: string = '2026-09-08T12:00:00Z'
): EnvironmentalFlowField {
  const minLat = 5.0;
  const maxLat = 25.0;
  const minLon = 78.0;
  const maxLon = 98.0;
  const step = 0.4; // 0.4 degree spatial resolution grid for higher precision vector fields

  const latitudes: number[] = [];
  for (let lat = minLat; lat <= maxLat; lat += step) {
    latitudes.push(Number(lat.toFixed(1)));
  }

  const longitudes: number[] = [];
  for (let lon = minLon; lon <= maxLon; lon += step) {
    longitudes.push(Number(lon.toFixed(1)));
  }

  const uGrid: number[][] = [];
  const vGrid: number[][] = [];

  const isWind = type === 'wind';
  const maxVelocity = isWind ? maxWindKts * 0.514444 : 3.2; // Convert kts to m/s for wind, m/s for current

  for (let i = 0; i < latitudes.length; i++) {
    const lat = latitudes[i];
    const uRow: number[] = [];
    const vRow: number[] = [];

    for (let j = 0; j < longitudes.length; j++) {
      const lon = longitudes[j];

      // Distance to cyclone center in degrees
      const dLon = lon - cycloneLon;
      const dLat = lat - cycloneLat;
      const distDeg = Math.sqrt(dLon * dLon + dLat * dLat);

      if (isWind) {
        // --- INCOIS-STYLE ATMOSPHERIC WIND VECTOR FIELD ---
        // 1. SW Monsoon Regional Background Vector Field (SW -> NE stream flow)
        const latNorm = (lat - minLat) / (maxLat - minLat);
        const lonNorm = (lon - minLon) / (maxLon - minLon);

        const uBg = 10.0 + Math.sin(latNorm * Math.PI) * 4.0 + Math.cos(lonNorm * Math.PI) * 2.0;
        const vBg = 8.0 + Math.cos(latNorm * Math.PI * 0.8) * 3.5;

        // 2. Coherent Cyclonic Vortex around Active Cyclone Eye
        const coreRadius = 4.2;
        const normDist = Math.max(distDeg / coreRadius, 0.08);
        const vortexMag = maxVelocity * normDist * Math.exp(1 - normDist);

        // Counter-clockwise rotational vector (-dLat, +dLon) + subtle inward spiral
        const distSafe = distDeg + 0.001;
        const uRot = -vortexMag * (dLat / distSafe);
        const vRot = vortexMag * (dLon / distSafe);

        // Spiral inflow towards cyclone eye
        const uInflow = -vortexMag * 0.22 * (dLon / distSafe);
        const vInflow = -vortexMag * 0.22 * (dLat / distSafe);

        // Spatial blend: storm vortex dominates within 8 degrees of cyclone eye
        const stormWeight = Math.exp(-0.12 * distDeg * distDeg);

        const uTotal = uBg * (1 - stormWeight) + (uRot + uInflow) * stormWeight;
        const vTotal = vBg * (1 - stormWeight) + (vRot + vInflow) * stormWeight;

        uRow.push(Number(uTotal.toFixed(2)));
        vRow.push(Number(vTotal.toFixed(2)));
      } else {
        // --- INCOIS-STYLE OCEAN CURRENT VECTOR FIELD ---
        // 1. East India Coastal Current (EICC) northward along east coast + Bay gyre
        const latNorm = (lat - minLat) / (maxLat - minLat);
        const uCurrent = 0.5 + Math.sin(latNorm * Math.PI * 1.2) * 0.4;
        const vCurrent = 0.8 + Math.sin(lon * 0.15) * 0.35;

        // 2. Storm-Driven Oceanic Eddy Circulation
        const eddyRadius = 4.5;
        const normDist = Math.max(distDeg / eddyRadius, 0.1);
        const eddyMag = 2.2 * normDist * Math.exp(1 - normDist);

        const distSafe = distDeg + 0.001;
        const uEddy = -eddyMag * (dLat / distSafe);
        const vEddy = eddyMag * (dLon / distSafe);

        const eddyWeight = Math.exp(-0.1 * distDeg * distDeg);

        const uTotal = uCurrent * (1 - eddyWeight) + uEddy * eddyWeight;
        const vTotal = vCurrent * (1 - eddyWeight) + vEddy * eddyWeight;

        uRow.push(Number(uTotal.toFixed(2)));
        vRow.push(Number(vTotal.toFixed(2)));
      }
    }

    uGrid.push(uRow);
    vGrid.push(vRow);
  }

  return {
    type,
    timestamp: timestampStr,
    bounds: { minLat, maxLat, minLon, maxLon },
    grid: {
      latitudes,
      longitudes,
      u: uGrid,
      v: vGrid,
    },
    units: 'm/s',
    source: 'SIMULATED VECTOR FIELD', // Corrected source as per Section 7
    status: 'SIMULATED',
    surfaceOnly: true,
    statusReason: 'Analytical Bay-of-Bengal background + storm-driven eddy model (not HYCOM output)',
  };
}

/**
 * A cell value that carries no actual measurement. null is the wire
 * representation of a missing UVEL/VVEL cell; NaN marks it in the
 * normalized grid. A legitimate 0.0 m/s is VALID data, never missing.
 */
function isMissingCell(value: number | null | undefined): boolean {
  return value === null || value === undefined || Number.isNaN(value);
}

/**
 * Normalize a backend HYCOM UVEL/VVEL payload (Phase 1A depth-slice wire
 * format, variable=currents) into the EnvironmentalFlowField consumed by
 * the particle renderer.
 *
 * Preservation guarantees:
 * - latitude/longitude/timestamp/units/depth come from the payload only
 * - null (missing) cells become NaN in the normalized grid — never 0.0
 * - the grid is NEVER transposed or flipped: row i is latitudes[i],
 *   column j is longitudes[j], exactly as the backend serializes them
 * - source data values are not mutated (rounding is display-only and
 *   performed by the renderer, not here)
 *
 * Returns null when the payload cannot yield a usable field (malformed
 * shape, missing vectors, no coordinates): the caller decides whether to
 * fall back to the labelled synthetic field.
 */
export function normalizeHycomCurrentField(payload: DepthSlicePayload): EnvironmentalFlowField | null {
  if (!payload || !payload.grid) return null;

  const { grid, bounds } = payload;
  const lats = grid.latitudes;
  const lons = grid.longitudes;
  if (!Array.isArray(lats) || !Array.isArray(lons) || lats.length < 2 || lons.length < 2) return null;
  if (!Array.isArray(grid.u) || !Array.isArray(grid.v)) return null;
  if (grid.u.length !== lats.length || grid.v.length !== lats.length) return null;

  const u: number[][] = [];
  const v: number[][] = [];
  let validCells = 0;
  let missingCells = 0;

  for (let i = 0; i < lats.length; i++) {
    const uRow = grid.u[i];
    const vRow = grid.v[i];
    if (!Array.isArray(uRow) || !Array.isArray(vRow) || uRow.length !== lons.length || vRow.length !== lons.length) {
      return null;
    }
    const uOut: number[] = new Array(lons.length);
    const vOut: number[] = new Array(lons.length);
    for (let j = 0; j < lons.length; j++) {
      const uCell = uRow[j];
      const vCell = vRow[j];
      if (isMissingCell(uCell) || isMissingCell(vCell)) {
        // Missing either component invalidates the vector at this cell.
        // It stays NaN (missing) — never an arbitrary numerical value.
        uOut[j] = Number.NaN;
        vOut[j] = Number.NaN;
        missingCells++;
      } else if (typeof uCell !== 'number' || typeof vCell !== 'number') {
        return null; // malformed cell type: reject the whole payload
      } else {
        uOut[j] = uCell;
        vOut[j] = vCell;
        validCells++;
      }
    }
    u.push(uOut);
    v.push(vOut);
  }

  if (validCells === 0) return null; // no real vectors at all: not a field

  // Bounds are recomputed from the actual coordinate axes (never trusted
  // blindly) — the renderer seeds particles from these numbers.
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);

  void bounds; // payload bounds are reported for provenance only

  return {
    type: 'current',
    timestamp: payload.timestamp,
    bounds: { minLat, maxLat, minLon, maxLon },
    grid: { latitudes: lats, longitudes: lons, u, v },
    units: payload.units || 'm/s',
    source: payload.source || 'INCOIS RSMC HYCOM',
    status: 'REAL',
    depthM: payload.requested_depth_m,
    matchedDepthM: payload.matched_depth_m,
    surfaceOnly: payload.matched_depth_m === 0,
    statusReason:
      missingCells > 0
        ? `${missingCells} missing UVEL/VVEL cells rendered as gaps (no vectors generated)`
        : undefined,
  };
}

/**
 * Count cells carrying a usable vector (both components finite).
 */
export function countValidCurrentCells(field: EnvironmentalFlowField): number {
  let valid = 0;
  for (let i = 0; i < field.grid.u.length; i++) {
    for (let j = 0; j < field.grid.u[i].length; j++) {
      if (Number.isFinite(field.grid.u[i][j]) && Number.isFinite(field.grid.v[i][j])) valid++;
    }
  }
  return valid;
}

/**
 * Bilinear sampling of vector field velocity (u, v) at any continuous (lat, lon) position.
 *
 * Handles both the uniform synthetic grid and real HYCOM grids:
 * - non-uniform axes (binary search for the bracketing cell)
 * - descending latitude order (orientation preserved, never flipped)
 * - missing (NaN) cells: any bracketing cell without a real vector yields
 *   speed 0, so particles crossing a gap respawn instead of being advected
 *   by fabricated values. Missing regions stay missing.
 */
export function sampleFlowVelocity(
  field: EnvironmentalFlowField,
  lat: number,
  lon: number
): { u: number; v: number; speed: number } {
  const { bounds, grid } = field;

  // Clamp to bounds
  if (
    lat < bounds.minLat ||
    lat > bounds.maxLat ||
    lon < bounds.minLon ||
    lon > bounds.maxLon
  ) {
    return { u: 0, v: 0, speed: 0 };
  }

  const lats = grid.latitudes;
  const lons = grid.longitudes;

  // Locate the bracketing cell on each axis. Works for ascending and
  // descending axes alike (real HYCOM axes may be either) and for
  // non-uniform spacings (the raw model grid is not regular).
  const findBracket = (axis: number[], value: number): [number, number, number] | null => {
    const n = axis.length;
    if (n < 2) return null;
    const ascending = axis[1] >= axis[0];
    let lo = 0;
    let hi = n - 1;
    if (ascending ? value <= axis[0] : value >= axis[0]) return [0, 0, 0];
    if (ascending ? value >= axis[n - 1] : value <= axis[n - 1]) return [n - 1, n - 1, 0];
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      const above = ascending ? axis[mid] <= value : axis[mid] >= value;
      if (above) lo = mid;
      else hi = mid;
    }
    const span = axis[hi] - axis[lo];
    const frac = span !== 0 ? (value - axis[lo]) / span : 0;
    return [lo, hi, Math.min(Math.max(frac, 0), 1)];
  };

  const latBracket = findBracket(lats, lat);
  const lonBracket = findBracket(lons, lon);
  if (!latBracket || !lonBracket) return { u: 0, v: 0, speed: 0 };

  const [i0, i1, fi] = latBracket;
  const [j0, j1, fj] = lonBracket;

  const u00 = grid.u[i0][j0];
  const u10 = grid.u[i1][j0];
  const u01 = grid.u[i0][j1];
  const u11 = grid.u[i1][j1];

  const v00 = grid.v[i0][j0];
  const v10 = grid.v[i1][j0];
  const v01 = grid.v[i0][j1];
  const v11 = grid.v[i1][j1];

  // Missing cells propagate: if any corner of the bilinear stencil lacks a
  // real vector, no (fabricated) vector is produced at this position.
  if (
    !Number.isFinite(u00) || !Number.isFinite(u10) || !Number.isFinite(u01) || !Number.isFinite(u11) ||
    !Number.isFinite(v00) || !Number.isFinite(v10) || !Number.isFinite(v01) || !Number.isFinite(v11)
  ) {
    return { u: 0, v: 0, speed: 0 };
  }

  // Bilinear interpolation
  const u =
    (1 - fi) * (1 - fj) * u00 +
    fi * (1 - fj) * u10 +
    (1 - fi) * fj * u01 +
    fi * fj * u11;

  const v =
    (1 - fi) * (1 - fj) * v00 +
    fi * (1 - fj) * v10 +
    (1 - fi) * fj * v01 +
    fi * fj * v11;

  const speed = Math.sqrt(u * u + v * v);

  return { u, v, speed };
}
