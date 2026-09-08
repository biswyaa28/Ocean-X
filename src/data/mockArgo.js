/* ================================================================
   OCEAN-X — mock Argo observation generator.
   24 deterministic mock floats; observations = model truth plus
   small physical offsets. Ported verbatim from the prototype.
   Future backend mapping: GET /api/argo, GET /api/argo/{profile_id}
   ================================================================ */
import { FieldEngine, mulberry32 } from '../engine/fieldEngine.js';
import { nearestTimeIndex } from '../engine/matching.js';

const LAND = [[55.5, 70, 13, 28.5], [40, 51.5, 1.5, 12], [40, 42, -26, 1.5],
[43.2, 50.6, -25.6, -12], [68, 89, 8, 28.5], [76, 81, 5.2, 10], [96.4, 100.6, -6.8, 6.2]];
const nearLand = (lon, lat) => {
  for (const a of [0, 1.2, -1.2]) for (const b of [0, 1.2, -1.2])
    if (LAND.some(([w, e, s, n]) => lon + a >= w && lon + a <= e && lat + b >= s && lat + b <= n)) return true;
  return false;
};
const r = mulberry32(26067);
const OBS_DEPTHS = [];
for (let z = 0; z <= 50; z += 5) OBS_DEPTHS.push(z);
for (let z = 60; z <= 200; z += 10) OBS_DEPTHS.push(z);
for (let z = 220; z <= 300; z += 20) OBS_DEPTHS.push(z);
for (let z = 350; z <= 1000; z += 50) OBS_DEPTHS.push(z);
const usedIds = new Set();
const mkId = () => {
  const pre = ['2902', '2903', '5601', '6901', '6903', '1901'];
  for (let k = 0; k < 60; k++) {
    const id = pre[(r() * pre.length) | 0] + String(1000 + ((r() * 8999) | 0));
    if (!usedIds.has(id)) { usedIds.add(id); return id; }
  }
  return '2902000';
};
const profiles = [];
const zones = [
  { c: [70, 2], rad: 26, n: 10 }, { c: [53.5, 9.5], rad: 4, n: 4 },
  { c: [87, -4], rad: 6, n: 4 }, { c: [62, -22], rad: 6, n: 3 }, { c: [74, -16], rad: 7, n: 3 }
];
for (const z of zones) {
  let placed = 0, guard = 0;
  while (placed < z.n && guard++ < 4000) {
    const lon = z.c[0] + (r() * 2 - 1) * z.rad, lat = z.c[1] + (r() * 2 - 1) * z.rad * 0.9;
    if (lon < 42.5 || lon > 97 || lat < -27.5 || lat > 27.5) continue;
    if (nearLand(lon, lat)) continue;
    if (profiles.some(p => Math.hypot(p.lon - lon, p.lat - lat) < 4.5)) continue;
    const jlon = +(lon + (r() * 0.4 - 0.2)).toFixed(2), jlat = +(lat + (r() * 0.4 - 0.2)).toFixed(2);
    profiles.push({
      id: mkId(), lon: jlon, lat: jlat,
      time: new Date(Date.UTC(2023, 6, 1) + (r() * 7.4 - 0.75) * 864e5),
      mode: r() < 0.55 ? 'D' : 'A',
      qcBad: r() < 0.25 ? 1 + ((r() * 2) | 0) : 0,
      cycle: 40 + ((r() * 160) | 0),
      platform: ['ARVOR-I', 'PROVOR-II', 'APEX', 'ARVOR-II'][(r() * 4) | 0],
      params: {
        zcOff: (r() * 2 - 1) * 9, wFac: .85 + r() * .35, sstOff: (r() * 2 - 1) * .35,
        sssOff: (r() * 2 - 1) * .12, szOff: (r() * 2 - 1) * 60, phOff: r() * 6.283, noise: .04 + r() * .05
      }
    });
    placed++;
  }
}
const cache = new Map();
const get = id => {
  if (cache.has(id)) return cache.get(id);
  const p = profiles.find(q => q.id === id); if (!p) return null;
  const matchedDay = nearestTimeIndex(FieldEngine.TIMES, p.time);
  const levels = OBS_DEPTHS.map(z => ({
    depth: z,
    temperature: FieldEngine.temp(p.lon, p.lat, z, matchedDay, p.params),
    salinity: FieldEngine.sal(p.lon, p.lat, z, matchedDay, p.params),
    qc: 1
  }));
  const h = [...p.id].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  for (let k = 0; k < p.qcBad; k++) levels[8 + ((h >> (k * 4)) % 28)].qc = 3;
  const prof = {
    meta: {
      id: p.id, lon: p.lon, lat: p.lat, time: p.time, mode: p.mode, platform: p.platform,
      cycle: p.cycle, matchedDay,
      qc: p.qcBad ? 'MIXED' : 'GOOD',
      qcDetail: p.qcBad ? p.qcBad + ' level(s) QC=3 (probably bad) — excluded from statistics'
        : 'all levels QC=1 (good)'
    },
    levels
  };
  cache.set(id, prof); return prof;
};

export const Argo = {
  OBS_DEPTHS,
  list: () => profiles.map(p => ({ id: p.id, lon: p.lon, lat: p.lat, time: p.time, mode: p.mode, cycle: p.cycle, platform: p.platform })),
  get
};
