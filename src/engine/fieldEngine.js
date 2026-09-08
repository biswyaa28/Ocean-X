/* ================================================================
   OCEAN-X — deterministic mock field engine.
   Ported verbatim from the frozen prototype (prototype/index.html).
   All data is locally generated — no live Copernicus Marine /
   GLORYS12V1 / Argo access. This module is the future swap point
   for server-side model field endpoints.
   ================================================================ */

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export const gs = (x, y, cx, cy, sx, sy) =>
  Math.exp(-(((x - cx) * (x - cx)) / (2 * sx * sx) + ((y - cy) * (y - cy)) / (2 * sy * sy)));

export function makeNoise(seed, cells) {
  const r = mulberry32(seed); const g = [];
  for (let y = 0; y <= cells; y++) { const row = []; for (let x = 0; x <= cells; x++) row.push(r()); g.push(row); }
  const sm = t => t * t * (3 - 2 * t);
  return (x, y) => {
    x = clamp(x, 0, cells); y = clamp(y, 0, cells);
    const xi = Math.min(cells - 1, Math.floor(x)), yi = Math.min(cells - 1, Math.floor(y));
    const fx = sm(x - xi), fy = sm(y - yi);
    const a = g[yi][xi], b = g[yi][xi + 1], c = g[yi + 1][xi], d = g[yi + 1][xi + 1];
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
}

function parseHex(h) {
  h = h.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function makeRamp(stops) {
  const S = stops.map(([p, c]) => [p, parseHex(c)]);
  return t => {
    t = clamp(t, 0, 1); let i = 0;
    while (i < S.length - 2 && t > S[i + 1][0]) i++;
    const [p0, c0] = S[i], [p1, c1] = S[i + 1];
    const f = clamp((t - p0) / ((p1 - p0) || 1), 0, 1);
    return [c0[0] + (c1[0] - c0[0]) * f, c0[1] + (c1[1] - c0[1]) * f, c0[2] + (c1[2] - c0[2]) * f];
  };
}

export const css = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

export function interpZ(xs, vs, z) {
  if (z <= xs[0]) return vs[0];
  for (let i = 1; i < xs.length; i++) {
    if (z <= xs[i]) { const f = (z - xs[i - 1]) / (xs[i] - xs[i - 1]); return vs[i - 1] + (vs[i] - vs[i - 1]) * f; }
  }
  return vs[vs.length - 1];
}

/* ---------------- colormaps ---------------- */
export const RAMP_TEMP = makeRamp([[0, '#0d1e42'], [.15, '#1d4e9e'], [.32, '#2b8fd0'], [.46, '#41c1d9'], [.60, '#8fd6b5'], [.72, '#efde8a'], [.84, '#f09c46'], [.93, '#d9582c'], [1, '#b1301c']]);
export const RAMP_SAL = makeRamp([[0, '#0d2130'], [.22, '#1c4f56'], [.42, '#2a7f72'], [.60, '#5ead8b'], [.78, '#a9cfa0'], [.92, '#e7ddab'], [1, '#f2e3b2']]);
export const RAMP_DIV = makeRamp([[0, '#4472d8'], [.30, '#2c4a8c'], [.50, '#1c2434'], [.70, '#74341f'], [1, '#e25836']]);

export const VARS = {
  temperature: { label: 'Temperature', unit: '°C', ramp: RAMP_TEMP, gridStep: 1, contour: 1 },
  salinity: { label: 'Salinity', unit: 'PSU', ramp: RAMP_SAL, gridStep: 0.5, contour: 0.2 }
};

/* ================================================================
   FieldEngine — deterministic mock GLORYS12V1-like scalar fields
   ================================================================ */
export const FieldEngine = (() => {
  const DEPTHS = [0, 10, 20, 30, 50, 75, 100, 150, 200, 300, 500, 750, 1000];
  const TIMES = (() => { const a = []; for (let i = 0; i < 7; i++) a.push(new Date(Date.UTC(2023, 6, 1 + i))); return a; })();
  const nA = makeNoise(117, 10), nB = makeNoise(231, 10), nC = makeNoise(397, 10);

  const sst = (lon, lat, day) => {
    let v = 27.6;
    v += 2.3 * gs(lon, lat, 88, -6, 15, 9);
    v -= 1.9 * gs(lon, lat, 52, -19, 9, 7);
    v -= 0.9 * gs(lon, lat, 44, -25, 6, 5);
    v += 1.35 * gs(lon, lat, 66, 20, 9, 5);
    v -= (0.95 + 0.26 * day) * 2.1 * gs(lon, lat, 53.5, 10.5, 4.5, 3.5);
    v -= 2.7 * Math.pow(Math.abs(lat) / 30, 2.1);
    v += 0.5 * (nA(lon / 9, lat / 9) - 0.5) * 2;
    v += 0.15 * Math.sin(day * 1.1 + 1.2 + lon * 0.13 + lat * 0.07);
    v += 0.05 * day;
    return v;
  };
  const therm = (lon, lat) => {
    const eq = Math.exp(-Math.pow(lat / 10, 2));
    const mld = 35 + 45 * Math.pow(Math.abs(lat) / 30, 1.3) + 10 * (nB(lon / 7, lat / 7) - 0.5) * 2;
    const zc = mld + 95 + 25 * (nC(lon / 8, lat / 8) - 0.5) * 2 + 20 * eq;
    const s = 30 + 10 * (nB(lon / 6, lat / 6) - 0.5);
    return { zc, s };
  };
  const temp = (lon, lat, z, day, p = {}) => {
    const { zc, s } = therm(lon, lat);
    const zcp = zc + (p.zcOff || 0), sp = s * (p.wFac == null ? 1 : p.wFac);
    const Ts = sst(lon, lat, day) + (p.sstOff || 0);
    const Td = 4.1 + 1.7 * Math.exp(-z / 500);
    const sig = 1 / (1 + Math.exp((z - zcp) / sp));
    let v = Td + (Ts - Td) * sig;
    v += 0.4 * Math.exp(-Math.pow((z - (zcp + 40)) / 140, 2)) * Math.sin(z / 55 + (p.phOff || 0) + lon * 0.9 + lat * 0.6);
    v += (p.noise || 0) * Math.sin(z * 0.7 + lon * 3.1);
    return v;
  };
  const sss = (lon, lat, day) => {
    let s = 34.55;
    s += 1.35 * gs(lon, lat, 58, 22, 8, 5.5);
    s -= 1.9 * gs(lon, lat, 88, 15, 7, 5);
    s += 0.85 * gs(lon, lat, 64, -22, 10, 6);
    s -= 0.45 * gs(lon, lat, 86, -6, 12, 7);
    s += 0.3 * (nA(lon / 7, lat / 7) - 0.5) * 2;
    s -= 0.02 * day;
    return s;
  };
  const sal = (lon, lat, z, day, p = {}) => {
    const Ss = sss(lon, lat, day) + (p.sssOff || 0);
    let s = Ss + 0.65 / (1 + Math.exp(-(z - (170 + (p.szOff || 0))) / 70)) - 0.5 / (1 + Math.exp(-(z - 650) / 160));
    s += 0.05 * Math.exp(-Math.pow((z - 200) / 180, 2)) * Math.sin(z / 70 + (p.phOff || 0));
    s += (p.noise || 0) * 0.5 * Math.sin(z * 0.8 + lon * 2.7);
    return s;
  };
  const bathy = (lon, lat) => {
    let d = 4300;
    d -= 1900 * gs(lon, lat, 66, -14, 5.5, 10);
    d -= 1400 * gs(lon, lat, 80, -28, 9, 5);
    d -= 2600 * gs(lon, lat, 56, -20, 3.5, 3.5);
    d -= 1600 * gs(lon, lat, 73, 17, 6, 4);
    d += 2300 * gs(lon, lat, 96.5, -8.5, 3.2, 3.5);
    d += 300 * (nB(lon / 9, lat / 9) - 0.5) * 2;
    return Math.max(1300, d);
  };
  const value = (variable, lon, lat, z, day, p) => variable === 'temperature' ? temp(lon, lat, z, day, p) : sal(lon, lat, z, day, p);
  return { DEPTHS, TIMES, temp, sal, value, bathy, noiseC: nC };
})();

