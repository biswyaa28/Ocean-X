/* ================================================================
   OCEAN-X — mock model data facade (the future backend surface).
   UI components never generate scientific data directly; they call
   these functions. Today they return locally generated mock data;
   later each function maps 1:1 to an API endpoint:

     getMetadata()        -> GET /api/metadata
     getModelTimes()      -> GET /api/model/times
     getModelDepths()     -> GET /api/model/depths
     getModelSlice()      -> GET /api/model/slice
     getArgoProfiles()    -> GET /api/argo
     getArgoProfile()     -> GET /api/argo/{profile_id}
     getModelProfileAt()  -> (part of comparison endpoint)
     getComparison()      -> GET /api/comparison/{profile_id}

   No backend exists yet — everything here is honest local mock data.
   ================================================================ */
import { FieldEngine } from '../engine/fieldEngine.js';
import { Argo } from './mockArgo.js';
import { getModelProfileAt, getComparison } from '../engine/comparison.js';

function getMetadata() {
  return {
    datasetId: 'GLOBAL_MULTIYEAR_PHY_001_030',
    datasetLabel: 'GLORYS12V1',
    version: 'GLORYS12V1 · v202211',
    demoGrid: '0.5° × 13 z-levels (mock)',
    targetGrid: '≈1/12° × 50 z-levels',
    cadence: 'daily · 00:00 UTC',
    domain: '40°E–100°E · 30°S–30°N'
  };
}

function getModelTimes() { return FieldEngine.TIMES.slice(); }

function getModelDepths() { return FieldEngine.DEPTHS.slice(); }

function getModelSlice(depthIdx, timeIdx, variable) {
  const z = FieldEngine.DEPTHS[depthIdx], NL = 121, DL = 0.5;
  const vals = new Float32Array(NL * NL);
  let min = Infinity, max = -Infinity;
  for (let j = 0; j < NL; j++) {
    const lat = -30 + j * DL;
    for (let i = 0; i < NL; i++) {
      const v = FieldEngine.value(variable, 40 + i * DL, lat, z, timeIdx);
      vals[j * NL + i] = v;
      if (v < min) min = v; if (v > max) max = v;
    }
  }
  return { lon0: 40, lat0: -30, d: DL, nl: NL, values: vals, min, max, depth: z, time: FieldEngine.TIMES[timeIdx] };
}

export const api = {
  getMetadata,
  getModelTimes,
  getModelDepths,
  getModelSlice,
  getArgoProfiles: () => Argo.list(),
  getArgoProfile: id => Argo.get(id),
  getModelProfileAt,
  getComparison
};
