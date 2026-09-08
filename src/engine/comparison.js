/* ================================================================
   OCEAN-X — model vs observation comparison engine.
   Residual terminology: "Analysis–Observation Residual" — never
   "model error"; the underlying model represents an assimilative
   analysis. Ported verbatim from the prototype.
   ================================================================ */
import { FieldEngine, interpZ } from './fieldEngine.js';
import { Argo } from '../data/mockArgo.js';
import { haversine, snapToGridCell } from './matching.js';

export function getModelProfileAt({ lon, lat, timeIdx, depths, variable }) {
  return depths.map(z => FieldEngine.value(variable, lon, lat, z, timeIdx));
}

export function getComparison(id, variable) {
  const prof = Argo.get(id); if (!prof) return null;
  const m = prof.meta, times = FieldEngine.TIMES, tIdx = m.matchedDay;
  const { glon, glat, i, j } = snapToGridCell(m.lon, m.lat);
  const native = FieldEngine.DEPTHS.map(z => FieldEngine.value(variable, glon, glat, z, tIdx));
  const lvAll = prof.levels.filter(l => l.depth <= 1000);
  const lv = lvAll.filter(l => l.qc === 1);
  const excluded = lvAll.length - lv.length;
  const modelAt = lv.map(l => interpZ(FieldEngine.DEPTHS, native, l.depth));
  const obsAt = lv.map(l => l[variable]);
  const res = lv.map((l, i2) => modelAt[i2] - obsAt[i2]);
  const n = lv.length; let bias = 0, mae = 0, rmse = 0, maxA = 0, maxI = 0;
  res.forEach((v, i2) => {
    bias += v; mae += Math.abs(v); rmse += v * v;
    if (Math.abs(v) > maxA) { maxA = Math.abs(v); maxI = i2; }
  });
  bias /= n; mae /= n; rmse = Math.sqrt(rmse / n);
  return {
    profile: prof, variable,
    obsDepths: lv.map(l => l.depth), obsValues: obsAt, modelValues: modelAt, residuals: res,
    excluded, stats: { bias, mae, rmse, maxAbs: maxA, maxDepth: lv[maxI].depth, n },
    match: {
      timeIdx: tIdx, time: times[tIdx], lon: glon, lat: glat,
      i, j,
      distanceKm: haversine(m.lat, m.lon, glat, glon),
      dtHours: (times[tIdx].getTime() - m.time.getTime()) / 3.6e6
    }
  };
}
