/* OCEAN-X — shared display formatters (ported verbatim from the prototype). */

export const fmtLat = v => Math.abs(v).toFixed(2) + '° ' + (v >= 0 ? 'N' : 'S');
export const fmtLon = v => Math.abs(v).toFixed(2) + '° ' + (v >= 0 ? 'E' : 'W');
export const fmtUTC = d => d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
export const fmtDate = d => d.toISOString().slice(0, 10);
export const fmtHours = h => (h >= 0 ? '+' : '−') + Math.abs(h).toFixed(1) + ' h';
