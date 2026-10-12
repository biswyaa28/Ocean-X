/**
 * Client-side half of the time-matching contract.
 *
 * The app replays cyclone tracks from 2020-2025 against a model dataset that
 * covers a different window entirely. Every model-derived value must carry the
 * model's own date and, when that date is not the storm's, must say so. These
 * helpers are pure so the rules — and their edge cases — are testable without a
 * browser.
 *
 * The server is the authority on its own dataset: ``GET /layers/{name}`` and
 * ``GET /risk/{id}`` both report the model time they actually used, and those
 * reported values are what the UI labels. The resolution below is only for the
 * client's own timeline.
 */
import type { ArgoProfile, CycloneTrackPoint } from '../types/oceanlens';

/** Must stay in sync with backend ``DEFAULT_MATCH_TOLERANCE_HOURS``. */
export const DEFAULT_MATCH_TOLERANCE_HOURS = 48;

/** Half-width of the Argo window around the selected model time. */
export const ARGO_WINDOW_DAYS = 5;

const MS_PER_HOUR = 3600_000;
const MS_PER_DAY = 86_400_000;

/**
 * Parse a timestamp to epoch milliseconds, or ``null``.
 *
 * Handles the three shapes this project exchanges: NetCDF time labels
 * (``2026-10-07T06:00:00.000000000``), client ISO strings with ``Z``, and the
 * space-separated form NOAA/IBTrACS emits. Naive values are read as UTC, which
 * is what every producer here writes.
 */
export function parseTimestampMs(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  const iso = text.includes('T') ? text : text.replace(' ', 'T');
  // A bare date-time carries no offset, and `Date.parse` reads that as LOCAL
  // time. Every producer here writes UTC, so the designator is added rather
  // than assumed — otherwise the same field shifts by the viewer's timezone.
  const hasZone = /[Zz]$/.test(iso) || /[+-]\d{2}:?\d{2}$/.test(iso);
  const ms = Date.parse(hasZone ? iso : `${iso}Z`);
  return Number.isFinite(ms) ? ms : null;
}

/** Absolute hours between two timestamps, or ``null`` when either is unreadable. */
export function hoursBetween(
  first: string | null | undefined,
  second: string | null | undefined
): number | null {
  const a = parseTimestampMs(first);
  const b = parseTimestampMs(second);
  if (a === null || b === null) return null;
  return Math.abs(a - b) / MS_PER_HOUR;
}

/**
 * True only when both timestamps are readable and within the tolerance.
 *
 * An unreadable timestamp is *unknown*, never matched — that is the whole
 * point of the function.
 */
export function isTimeMatched(
  modelTimestamp: string | null | undefined,
  pointTimestamp: string | null | undefined,
  toleranceHours: number = DEFAULT_MATCH_TOLERANCE_HOURS
): boolean {
  const gap = hoursBetween(modelTimestamp, pointTimestamp);
  return gap !== null && gap <= toleranceHours;
}

/**
 * Resolve a requested time against the model's own available times.
 *
 * Returns the label of the model time that will actually be served, or ``null``
 * when nothing can be served. Mirrors the backend rule so the client's
 * timeline and the server agree on which day a layer belongs to.
 */
export function resolveModelTimestamp(
  requested: string | null | undefined,
  available: readonly string[]
): string | null {
  if (!available.length) return null;

  const parsed: { ms: number; label: string }[] = [];
  for (const label of available) {
    const ms = parseTimestampMs(label);
    if (ms !== null) parsed.push({ ms, label });
  }
  if (!parsed.length) return null;

  if (requested !== null && requested !== undefined && String(requested).trim()) {
    const target = parseTimestampMs(requested);
    // An unreadable request must not be answered with some other day.
    if (target === null) return null;
    return parsed.reduce((best, item) =>
      Math.abs(item.ms - target) < Math.abs(best.ms - target) ? item : best
    ).label;
  }

  // No request at all: the model's most recent state.
  return parsed.reduce((best, item) => (item.ms > best.ms ? item : best)).label;
}

/** Newest available model time by instant, or ``null`` for an empty dataset. */
export function latestModelTimestamp(available: readonly string[]): string | null {
  if (!available.length) return null;
  return resolveModelTimestamp(undefined, available);
}

/**
 * Build one scrubbable step per real model time.
 *
 * These are model times, not storm observations, so every observation field is
 * null: nothing here may look like a cyclone fix even by accident.
 */
export function buildModelTimeline(available: readonly string[]): CycloneTrackPoint[] {
  return available.map((timestamp, index) => ({
    id: `model-${index}-${timestamp}`,
    timestamp,
    latitude: 0,
    longitude: 0,
    maxWindKts: null,
    centralPressureMb: null,
    category: null,
    status: 'OBSERVATION',
    distanceToCoastKm: null,
    stormSpeedKts: null,
    stormDirDeg: null,
  }));
}

/**
 * Keep the Argo profiles observed within ±``windowDays`` of ``selectedTime``.
 *
 * In LIVE mode the marker sits on a model time, so only floats that actually
 * sampled near it are shown — the rest belong to a different date and would
 * place real in-situ data under a date it does not belong to.
 */
export function filterProfilesToWindow(
  profiles: readonly ArgoProfile[],
  selectedTime: string | null | undefined,
  windowDays: number = ARGO_WINDOW_DAYS
): ArgoProfile[] {
  const center = parseTimestampMs(selectedTime);
  if (center === null) return [];
  const halfWindow = windowDays * MS_PER_DAY;
  return profiles.filter((profile) => {
    const observed = parseTimestampMs(profile.observation_time);
    return observed !== null && Math.abs(observed - center) <= halfWindow;
  });
}

/** Render a timestamp as ``YYYY-MM-DD HH:MM UTC`` for user-facing labels. */
export function formatModelDate(value: string | null | undefined): string | null {
  const ms = parseTimestampMs(value);
  if (ms === null) return null;
  const date = new Date(ms);
  const months = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getUTCFullYear()}-${months[date.getUTCMonth()]}-${pad(date.getUTCDate())} ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} UTC`
  );
}

/**
 * The HISTORICAL REPLAY model-time badge.
 *
 * Model layers can render against a replay date only with an explicit,
 * visible statement that the field on screen is from another day. Returns
 * ``null`` when there is nothing to label (no model data, or unreadable dates).
 */
export function modelTimeBadgeText(
  modelTimestamps: readonly (string | null | undefined)[],
  replayTimestamp: string | null | undefined
): string | null {
  const labels: string[] = [];
  for (const timestamp of modelTimestamps) {
    const formatted = formatModelDate(timestamp);
    if (formatted && !labels.includes(formatted)) labels.push(formatted);
  }
  if (!labels.length) return null;

  const replay = formatModelDate(replayTimestamp) ?? (replayTimestamp?.trim() || null);
  if (!replay) return `MODEL: ${labels.join(' / ')}`;

  return `MODEL: ${labels.join(' / ')} · NOT TIME-MATCHED to replay date ${replay}`;
}