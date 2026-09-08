/* ================================================================
   OCEAN-X — co-location / matching logic.
   Future backend mapping: GET /api/comparison/{profile_id} will
   perform this matching server-side; the function signatures stay
   identical so the UI never changes.
   ================================================================ */
import { clamp } from './fieldEngine.js';

export function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371, d = Math.PI / 180;
  const dLat = (lat2 - lat1) * d, dLon = (lon2 - lon1) * d;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * d) * Math.cos(lat2 * d) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/* Model grid geometry (mock 0.5° demo grid) */
export const GRID_LON0 = 40, GRID_LAT0 = -30, GRID_D = 0.5;

/* Snap an observation position to the containing/rearest model grid cell. */
export function snapToGridCell(lon, lat) {
  const glon = clamp(Math.round((lon - GRID_LON0) / GRID_D) * GRID_D + GRID_LON0, GRID_LON0, 100);
  const glat = clamp(Math.round((lat - GRID_LAT0) / GRID_D) * GRID_D + GRID_LAT0, GRID_LAT0, 30);
  return {
    glon, glat,
    i: Math.round((glon - GRID_LON0) / GRID_D),
    j: Math.round((glat - GRID_LAT0) / GRID_D)
  };
}

/* Index of the model time nearest to the given observation time. */
export function nearestTimeIndex(times, t) {
  return times.reduce((best, ti, i) =>
    Math.abs(ti - t) < Math.abs(times[best] - t) ? i : best, 0);
}
