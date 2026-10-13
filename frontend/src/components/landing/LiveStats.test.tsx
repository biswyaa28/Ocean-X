import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import LiveStats, { fetchLandingStats } from './LiveStats';

/**
 * The one behaviour this component must never get wrong: when the backend is
 * unreachable it shows NOTHING rather than a plausible-looking number. A landing
 * page that displays a confident figure nobody can verify is worse than one
 * that admits it has nothing to show.
 */

const originalFetch = global.fetch;

function jsonResponse(body: unknown, ok = true) {
  return {
    ok,
    json: async () => body,
  } as unknown as Response;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  global.fetch = originalFetch;
  cleanup();
});

describe('fetchLandingStats', () => {
  it('reads real figures when the backend answers', async () => {
    global.fetch = vi.fn(async (url: string) => {
      if (url.includes('/argo/profiles')) {
        return jsonResponse([{ profile_id: 'a' }, { profile_id: 'b' }, { profile_id: 'c' }]);
      }
      if (url.includes('/cyclones')) return jsonResponse([{ id: 1 }, { id: 2 }]);
      if (url.includes('/argo/matchup/summary')) {
        return jsonResponse({ includedProfileCount: 19, totalProfileCount: 23, modelRuns: ['a', 'b'] });
      }
      return jsonResponse({ dataScope: 'FULL' });
    }) as unknown as typeof fetch;

    const stats = await fetchLandingStats();
    expect(stats).not.toBeNull();
    expect(stats!.argoProfiles).toBe(3);
    expect(stats!.cyclones).toBe(2);
    expect(stats!.matchedProfiles).toBe(19);
    expect(stats!.totalProfiles).toBe(23);
    expect(stats!.modelRuns).toEqual(['a', 'b']);
    expect(stats!.dataScope).toBe('FULL');
  });

  it('returns null when the backend is unreachable', async () => {
    global.fetch = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;

    await expect(fetchLandingStats()).resolves.toBeNull();
  });

  it('returns null when the profile endpoint answers with a non-OK status', async () => {
    global.fetch = vi.fn(async () => jsonResponse(null, false)) as unknown as typeof fetch;
    await expect(fetchLandingStats()).resolves.toBeNull();
  });

  it('returns null when the payload is not a list of profiles', async () => {
    global.fetch = vi.fn(async (url: string) => {
      if (url.includes('/argo/profiles')) return jsonResponse({ error: 'nope' });
      return jsonResponse([]);
    }) as unknown as typeof fetch;
    await expect(fetchLandingStats()).resolves.toBeNull();
  });

  it('keeps working when only the optional endpoints fail', async () => {
    // Profiles answered; the summary did not. The profile count is real and must
    // still be shown, with the missing figure left absent rather than guessed.
    global.fetch = vi.fn(async (url: string) => {
      if (url.includes('/argo/profiles')) return jsonResponse([{ profile_id: 'a' }]);
      throw new Error('summary down');
    }) as unknown as typeof fetch;

    await expect(fetchLandingStats()).resolves.toBeNull();
  });
});

describe('LiveStats', () => {
  it('shows no numbers at all when the backend is down', async () => {
    global.fetch = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;

    render(<LiveStats />);

    await waitFor(() => expect(screen.getByTestId('live-stats-unavailable')).toBeTruthy());
    expect(screen.queryByTestId('live-stats')).toBeNull();
    // And critically: no bare digit that could be mistaken for a measurement.
    expect(screen.getByTestId('live-stats-unavailable').textContent).not.toMatch(/\d{2,}/);
  });

  it('shows measured figures when the backend answers', async () => {
    global.fetch = vi.fn(async (url: string) => {
      if (url.includes('/argo/profiles')) return jsonResponse([{ p: 1 }, { p: 2 }]);
      if (url.includes('/cyclones')) return jsonResponse([{ id: 1 }]);
      if (url.includes('/argo/matchup/summary')) {
        return jsonResponse({ includedProfileCount: 7, totalProfileCount: 9, modelRuns: ['r1'] });
      }
      return jsonResponse({ dataScope: 'FULL' });
    }) as unknown as typeof fetch;

    render(<LiveStats />);
    await waitFor(() => expect(screen.getByTestId('live-stats')).toBeTruthy());
    const text = screen.getByTestId('live-stats').textContent ?? '';
    expect(text).toContain('Argo profiles');
    expect(text).toContain('Cyclone tracks');
    expect(text).toContain('Matched to model');
  });

  it('renders a missing figure as a dash, never a fallback number', async () => {
    global.fetch = vi.fn(async (url: string) => {
      if (url.includes('/argo/profiles')) return jsonResponse([{ p: 1 }]);
      if (url.includes('/cyclones')) return jsonResponse([]);
      // Summary answers but with no counts.
      return jsonResponse({ modelRuns: [] });
    }) as unknown as typeof fetch;

    render(<LiveStats />);
    await waitFor(() => expect(screen.getByTestId('live-stats')).toBeTruthy());
    expect(screen.getByTestId('live-stat-missing')).toBeTruthy();
    expect(screen.getByTestId('live-stat-missing').textContent).toContain('Not reported by the backend');
  });
});