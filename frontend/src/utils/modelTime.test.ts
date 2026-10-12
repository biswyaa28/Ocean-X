/**
 * Client-side half of the time-matching contract.
 *
 * The application replays cyclone tracks from 2020-2025 against a model
 * dataset covering a completely different window. Everything model-derived must
 * be labelled with the model's own date and, when it is not the storm's date,
 * say so. These helpers are pure so both the rules and their edge cases are
 * testable without a browser.
 */
import { describe, it, expect } from 'vitest';
import {
  ARGO_WINDOW_DAYS,
  DEFAULT_MATCH_TOLERANCE_HOURS,
  LIVE_FRESHNESS_LIMIT_HOURS,
  buildModelTimeline,
  describeModelDataAge,
  describeModelRanges,
  filterProfilesToWindow,
  formatModelDate,
  hoursBetween,
  isTimeMatched,
  latestModelTimestamp,
  modelTimeBadgeText,
  resolveModelTimestamp,
} from './modelTime';
import type { ArgoProfile, CycloneTrackPoint } from '../types/oceanlens';

const MODEL_TIMES = [
  '2026-10-07T06:00:00.000000000',
  '2026-10-07T12:00:00.000000000',
  '2026-10-08T18:00:00.000000000',
];

function profile(id: string, observationTime: string): ArgoProfile {
  return {
    profile_id: id,
    float_id: id,
    platform_type: 'core',
    cycle_number: 1,
    latitude: 12,
    longitude: 88,
    observation_time: observationTime,
    data_status: 'REAL',
    institution: 'IFREMER',
    observations_count: 10,
    observations: [],
    provenance: { data_status: 'REAL' },
  } as ArgoProfile;
}

describe('resolveModelTimestamp', () => {
  it('uses the latest available model time when nothing is requested', () => {
    expect(resolveModelTimestamp(undefined, MODEL_TIMES)).toBe(MODEL_TIMES[2]);
  });

  it('returns a requested time that is in the dataset unchanged', () => {
    expect(resolveModelTimestamp(MODEL_TIMES[1], MODEL_TIMES)).toBe(MODEL_TIMES[1]);
  });

  it('resolves a different spelling of the same instant to the dataset label', () => {
    expect(resolveModelTimestamp('2026-10-07T12:00:00Z', MODEL_TIMES)).toBe(MODEL_TIMES[1]);
  });

  it('resolves a time outside the window to the nearest real model time', () => {
    expect(resolveModelTimestamp('2020-05-18T12:00:00', MODEL_TIMES)).toBe(MODEL_TIMES[0]);
    expect(resolveModelTimestamp('2031-01-01T00:00:00Z', MODEL_TIMES)).toBe(MODEL_TIMES[2]);
  });

  it('returns null when the request cannot be parsed', () => {
    expect(resolveModelTimestamp('nope', MODEL_TIMES)).toBeNull();
  });

  it('returns null when the dataset has no times', () => {
    expect(resolveModelTimestamp('2026-10-07T12:00:00Z', [])).toBeNull();
  });
});

describe('latestModelTimestamp', () => {
  it('picks the newest time by instant, not by string order', () => {
    expect(latestModelTimestamp([MODEL_TIMES[0], '2026-10-09T00:00:00.000000000'])).toBe(
      '2026-10-09T00:00:00.000000000'
    );
  });

  it('is null for an empty dataset', () => {
    expect(latestModelTimestamp([])).toBeNull();
  });
});

describe('hoursBetween / isTimeMatched', () => {
  it('measures the absolute gap in hours', () => {
    expect(hoursBetween('2026-10-07T06:00:00Z', '2026-10-08T06:00:00Z')).toBe(24);
  });

  it('is null for an unparseable timestamp, never zero', () => {
    expect(hoursBetween('2026-10-07T06:00:00Z', 'nope')).toBeNull();
  });

  it('matches inside the tolerance and not outside it', () => {
    expect(isTimeMatched('2026-10-07T06:00:00Z', '2026-10-08T06:00:00Z')).toBe(true);
    expect(isTimeMatched('2026-10-07T06:00:00Z', '2026-10-09T06:00:00Z')).toBe(true);
    expect(isTimeMatched('2026-10-07T06:00:00Z', '2026-10-09T06:00:01Z')).toBe(false);
  });

  it('does not match a 2020 replay point against 2026 model fields', () => {
    expect(isTimeMatched('2026-10-07T06:00:00Z', '2020-05-18T12:00:00Z')).toBe(false);
  });

  it('treats an unknown timestamp on either side as not matched', () => {
    expect(isTimeMatched(null, '2020-05-18T12:00:00Z')).toBe(false);
    expect(isTimeMatched('2026-10-07T06:00:00Z', undefined)).toBe(false);
    expect(isTimeMatched(null, null)).toBe(false);
  });

  it('uses a 48 hour tolerance', () => {
    expect(DEFAULT_MATCH_TOLERANCE_HOURS).toBe(48);
  });
});

describe('buildModelTimeline', () => {
  it('produces one scrubbable step per real model time', () => {
    const timeline = buildModelTimeline(MODEL_TIMES);
    expect(timeline).toHaveLength(3);
    expect(timeline.map((p) => p.timestamp)).toEqual(MODEL_TIMES);
    expect(timeline.every((p) => p.id.startsWith('model-'))).toBe(true);
  });

  it('carries no cyclone observations — it is model time, not storm data', () => {
    const [point] = buildModelTimeline(MODEL_TIMES);
    expect(point.maxWindKts).toBeNull();
    expect(point.centralPressureMb).toBeNull();
    expect(point.category).toBeNull();
    expect(point.distanceToCoastKm).toBeNull();
  });

  it('is empty for an empty dataset', () => {
    expect(buildModelTimeline([])).toEqual([]);
  });

  it('produces unique ids even for repeated stamps', () => {
    const timeline = buildModelTimeline(['2026-10-07T06:00:00.000000000', '2026-10-07T06:00:00.000000000']);
    expect(new Set(timeline.map((p) => p.id)).size).toBe(2);
  });
});

describe('filterProfilesToWindow', () => {
  const center = '2026-10-07T12:00:00Z';

  it('keeps profiles inside the window and drops those outside', () => {
    const profiles = [
      profile('inside', '2026-10-07T12:00:00Z'),
      profile('edge', '2026-10-11T11:00:00Z'), // just under +5 days
      profile('outside', '2026-10-12T13:00:00Z'), // just over +5 days
      profile('ancient', '2020-05-18T12:00:00Z'),
    ];
    const kept = filterProfilesToWindow(profiles, center, ARGO_WINDOW_DAYS);
    expect(kept.map((p) => p.profile_id)).toEqual(['inside', 'edge']);
  });

  it('returns nothing when there is no selected time', () => {
    expect(filterProfilesToWindow([profile('a', '2026-10-07T12:00:00Z')], null)).toEqual([]);
  });

  it('returns nothing when the selected time is unparseable', () => {
    expect(filterProfilesToWindow([profile('a', '2026-10-07T12:00:00Z')], 'not-a-date')).toEqual([]);
  });

  it('uses a five day window', () => {
    expect(ARGO_WINDOW_DAYS).toBe(5);
  });
});

describe('formatModelDate', () => {
  it('renders a UTC minute stamp', () => {
    expect(formatModelDate('2026-10-07T06:00:00.000000000')).toBe('2026-10-07 06:00 UTC');
  });

  it('accepts the space-separated form the backend emits', () => {
    expect(formatModelDate('2020-05-18 12:00:00')).toBe('2020-05-18 12:00 UTC');
  });

  it('is null when there is no date to show', () => {
    expect(formatModelDate(undefined)).toBeNull();
    expect(formatModelDate('nonsense')).toBeNull();
  });
});

describe('modelTimeBadgeText', () => {
  it('names the model date and the replay date it is not matched to', () => {
    const text = modelTimeBadgeText(
      ['2026-10-08T18:00:00.000000000'],
      '2020-05-18T18:00:00'
    );
    expect(text).toBe(
      'MODEL: 2026-10-08 18:00 UTC · NOT TIME-MATCHED to replay date 2020-05-18 18:00 UTC'
    );
  });

  it('lists every distinct model date on screen', () => {
    const text = modelTimeBadgeText(
      ['2026-10-08T18:00:00.000000000', '2026-10-10T06:00:00.000000000'],
      '2020-05-18T18:00:00'
    );
    expect(text).toBe(
      'MODEL: 2026-10-08 18:00 UTC / 2026-10-10 06:00 UTC · NOT TIME-MATCHED to replay date 2020-05-18 18:00 UTC'
    );
  });

  it('deduplicates repeated model dates', () => {
    const text = modelTimeBadgeText(
      ['2026-10-08T18:00:00.000000000', '2026-10-08T18:00:00.000000000'],
      '2020-05-18T18:00:00'
    );
    expect(text).toContain('MODEL: 2026-10-08 18:00 UTC ·');
  });

  it('is null when no model data is on screen', () => {
    expect(modelTimeBadgeText([], '2020-05-18T18:00:00')).toBeNull();
  });

  it('is null when the model dates on screen cannot be read', () => {
    expect(modelTimeBadgeText(['nope'], '2020-05-18T18:00:00')).toBeNull();
  });

  it('falls back to the raw replay stamp when the replay date is unparseable', () => {
    const text = modelTimeBadgeText(['2026-10-08T18:00:00.000000000'], 'unknown-stamp');
    expect(text).toContain('replay date unknown-stamp');
  });
});

describe('track shape compatibility', () => {
  it('model timeline points satisfy the timeline scrubber contract', () => {
    const point = buildModelTimeline(MODEL_TIMES)[0] as CycloneTrackPoint;
    expect(typeof point.id).toBe('string');
    expect(typeof point.latitude).toBe('number');
    expect(typeof point.longitude).toBe('number');
    expect(point.status).toBe('OBSERVATION');
  });
});
// ============================================================
// Data age: a model run that is days old is not "live", and the
// ribbon must say how old it is instead of implying now.
// ============================================================
describe('describeModelDataAge', () => {
  const NOW = Date.parse('2026-10-12T12:00:00Z');

  it('reports the age of the NEWEST model time', () => {
    const age = describeModelDataAge(['2026-10-08T06:00:00Z', '2026-10-08T18:00:00Z'], NOW)!;
    expect(age.hours).toBeCloseTo(90, 5);
    expect(age.isLive).toBe(false);
  });

  it('is live within 24 hours and not live beyond it', () => {
    expect(describeModelDataAge(['2026-10-12T06:00:00Z'], NOW)!.isLive).toBe(true); // 6 h old
    expect(describeModelDataAge(['2026-10-11T12:00:00Z'], NOW)!.isLive).toBe(true); // exactly 24 h
    expect(describeModelDataAge(['2026-10-11T11:00:00Z'], NOW)!.isLive).toBe(false); // 25 h old
  });

  it('labels the age in hours under two days and in days beyond', () => {
    expect(describeModelDataAge(['2026-10-12T09:00:00Z'], NOW)!.label).toBe('3 h old');
    expect(describeModelDataAge(['2026-10-10T12:00:00Z'], NOW)!.label).toBe('2 days old');
    expect(describeModelDataAge(['2026-10-09T12:00:00Z'], NOW)!.label).toBe('3 days old');
  });

  it('says "under 1 h" rather than rounding a fresh run to zero', () => {
    expect(describeModelDataAge(['2026-10-12T11:30:00Z'], NOW)!.label).toBe('under 1 h old');
  });

  it('never calls a future timestamp live', () => {
    expect(describeModelDataAge(['2026-10-13T12:00:00Z'], NOW)!.isLive).toBe(false);
  });

  it('has no age at all when there is no readable model time', () => {
    expect(describeModelDataAge([], NOW)).toBeNull();
    expect(describeModelDataAge([undefined, 'nope'], NOW)).toBeNull();
  });

  it('uses a 24 h live limit', () => {
    expect(LIVE_FRESHNESS_LIMIT_HOURS).toBe(24);
  });
});

describe('describeModelRanges', () => {
  it('reports both windows when they differ', () => {
    const ranges = describeModelRanges(
      { start: '2026-10-07T06:00:00.000000000', end: '2026-10-08T18:00:00.000000000' },
      { start: '2026-10-10T06:00:00.000000000', end: '2026-10-17T00:00:00.000000000' }
    );
    expect(ranges).toEqual([
      { label: 'SURFACE', text: '2026-10-07 06:00 UTC → 2026-10-08 18:00 UTC' },
      { label: 'DEPTH', text: '2026-10-10 06:00 UTC → 2026-10-17 00:00 UTC' },
    ]);
  });

  it('reports a single window when both datasets cover the same times', () => {
    const ranges = describeModelRanges(
      { start: '2026-10-07T06:00:00.000000000', end: '2026-10-08T18:00:00.000000000' },
      { start: '2026-10-07T06:00:00.000000000', end: '2026-10-08T18:00:00.000000000' }
    );
    expect(ranges).toEqual([
      { label: 'MODEL', text: '2026-10-07 06:00 UTC → 2026-10-08 18:00 UTC' },
    ]);
  });

  it('never invents a range it does not have', () => {
    expect(describeModelRanges(null, null)).toEqual([]);
    expect(describeModelRanges({ start: '2026-10-07T06:00:00.000000000', end: '2026-10-07T06:00:00.000000000' }, null))
      .toEqual([{ label: 'MODEL', text: '2026-10-07 06:00 UTC' }]);
  });
});
