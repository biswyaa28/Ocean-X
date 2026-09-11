import { EnvironmentalFlowField } from '../types/flow';

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

        let uBg = 10.0 + Math.sin(latNorm * Math.PI) * 4.0 + Math.cos(lonNorm * Math.PI) * 2.0;
        let vBg = 8.0 + Math.cos(latNorm * Math.PI * 0.8) * 3.5;

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
        let uCurrent = 0.5 + Math.sin(latNorm * Math.PI * 1.2) * 0.4;
        let vCurrent = 0.8 + Math.sin(lon * 0.15) * 0.35;

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
  };
}

/**
 * Bilinear sampling of vector field velocity (u, v) at any continuous (lat, lon) position.
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
  const step = lats[1] - lats[0];

  const iFloat = (lat - bounds.minLat) / step;
  const jFloat = (lon - bounds.minLon) / step;

  const i0 = Math.floor(iFloat);
  const j0 = Math.floor(jFloat);
  const i1 = Math.min(i0 + 1, lats.length - 1);
  const j1 = Math.min(j0 + 1, lons.length - 1);

  const fi = iFloat - i0;
  const fj = jFloat - j0;

  const u00 = grid.u[i0][j0];
  const u10 = grid.u[i1][j0];
  const u00_1 = grid.u[i0][j1];
  const u11 = grid.u[i1][j1];

  const v00 = grid.v[i0][j0];
  const v10 = grid.v[i1][j0];
  const v00_1 = grid.v[i0][j1];
  const v11 = grid.v[i1][j1];

  // Bilinear interpolation
  const u =
    (1 - fi) * (1 - fj) * u00 +
    fi * (1 - fj) * u10 +
    (1 - fi) * fj * u00_1 +
    fi * fj * u11;

  const v =
    (1 - fi) * (1 - fj) * v00 +
    fi * (1 - fj) * v10 +
    (1 - fi) * fj * v00_1 +
    fi * fj * v11;

  const speed = Math.sqrt(u * u + v * v);

  return { u, v, speed };
}
