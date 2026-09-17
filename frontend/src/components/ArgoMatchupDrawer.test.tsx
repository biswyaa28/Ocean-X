import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import React from 'react';
import type { ArgoProfile, ArgoObservationPoint, ArgoMatchupResponse } from '../types/oceanlens';
import {
  obsPoint,
  makeArgoProfile,
  makeArgoMatchup,
} from '../test/fixtures/argoFixtures';

/**
 * Phase 1D ArgoMatchupDrawer tests: observation-profile visualization,
 * tabbed integration with the existing matchup interface, request lifecycle
 * (cancellation, stale-response protection, unmount cleanup) and honest
 * provenance labeling. Assertions target rendered chart data — no screenshots.
 */

const getArgoObservations = vi.fn();
const getArgoMatchup = vi.fn();

vi.mock('../services/ApiProvider', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../services/ApiProvider')>();
  // Preserve the prototype chain (spread alone drops class methods).
  const mockProvider: typeof orig.apiProvider = Object.create(Object.getPrototypeOf(orig.apiProvider));
  Object.assign(mockProvider, orig.apiProvider, {
    getArgoObservations: (...args: unknown[]) =>
      getArgoObservations(...(args as [string, AbortSignal])),
    getArgoMatchup: (...args: unknown[]) =>
      getArgoMatchup(...(args as [string, AbortSignal])),
  });

  it('does not label synthetic fixture model data as real model data', async () => {
    getArgoObservations.mockResolvedValue(makeArgoProfile().observations);
    getArgoMatchup.mockResolvedValue(makeArgoMatchup({ modelDataStatus: 'SIMULATED' }));
    renderDrawer(makeArgoProfile());

    fireEvent.click(screen.getByTitle('Matchup tab'));
    await waitFor(() => expect(screen.getByText(/HYCOM MODEL — SYNTHETIC FIXTURE/i)).toBeInTheDocument());
    expect(screen.queryByText('REAL MODEL')).not.toBeInTheDocument();
  });
  return {
    ...orig,
    apiProvider: mockProvider,
  };
});

import { ArgoMatchupDrawer } from './ArgoMatchupDrawer';

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const CLOSE = { onClose: () => {} };

function renderDrawer(profile: ArgoProfile | null) {
  return render(<ArgoMatchupDrawer profile={profile} {...CLOSE} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  getArgoMatchup.mockResolvedValue(null);
});

describe('ArgoMatchupDrawer — opening an Argo profile', () => {
  it('renders nothing when no profile is selected', () => {
    renderDrawer(null);
    expect(screen.queryByText(/ARGO FLOAT PROFILE/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/ARGO OBSERVATION PROFILE/i)).not.toBeInTheDocument();
  });

  it('shows the existing profile metadata and fetches observations via the observations endpoint', async () => {
    const profile = makeArgoProfile();
    getArgoObservations.mockResolvedValue(profile.observations);
    renderDrawer(profile);

    await waitFor(() =>
      expect(getArgoObservations).toHaveBeenCalledWith('argo-2902746-p042', expect.any(AbortSignal))
    );
    // Task 1: profile metadata from actual response fields.
    expect(screen.getByText(/FLOAT: 2902746/i)).toBeInTheDocument();
    expect(screen.getByText(/CYCLE #42/i)).toBeInTheDocument();
    expect(screen.getByText(/15\.25°N, 88\.42°E/i)).toBeInTheDocument();
    expect(screen.getByText(/2026-09-08 03:15:00 UTC/i)).toBeInTheDocument();
    expect(screen.getByText(/argo-2902746-p042/i)).toBeInTheDocument();
    expect(screen.getByText(/INCOIS \/ Argo GDAC/i)).toBeInTheDocument();
    expect(screen.getByText(/REAL SOURCE — INGESTION PENDING/i)).toBeInTheDocument();
  });

  it('requests the observations endpoint once per profile within a drawer session', async () => {
    const profile = makeArgoProfile();
    getArgoObservations.mockResolvedValue(profile.observations);
    renderDrawer(profile);
    await waitFor(() => expect(getArgoObservations).toHaveBeenCalledTimes(1));
    // Re-render with the same profile object identity (e.g. parent re-render).
    expect(await screen.findByText(/ARGO OBSERVATION PROFILE/i)).toBeInTheDocument();
    expect(getArgoObservations).toHaveBeenCalledTimes(1);
  });
});

describe('ArgoMatchupDrawer — Profile tab visualization', () => {
  it('renders temperature and salinity depth profiles when both variables are available', async () => {
    const profile = makeArgoProfile();
    getArgoObservations.mockResolvedValue(profile.observations);
    renderDrawer(profile);
    await screen.findByText(/ARGO OBSERVATION PROFILE/i);

    expect(screen.getByText(/ARGO OBSERVATION — TEMPERATURE/i)).toBeInTheDocument();
    expect(screen.getByText(/ARGO OBSERVATION — SALINITY/i)).toBeInTheDocument();
    // Chart data is really rendered: one dot per valid observation per panel.
    expect(document.querySelectorAll('.recharts-dot').length).toBe(6); // 3 temp + 3 sal
  });

  it('shows an explicit unavailable state when salinity is missing (never fabricated)', async () => {
    const profile = makeArgoProfile();
    getArgoObservations.mockResolvedValue([
      obsPoint(0, 29.85, null),
      obsPoint(10, 29.8, undefined),
    ]);
    renderDrawer(profile);
    await screen.findByText(/ARGO OBSERVATION PROFILE/i);

    expect(screen.getByText(/SALINITY UNAVAILABLE/i)).toBeInTheDocument();
    expect(screen.getByText(/ARGO OBSERVATION — TEMPERATURE/i)).toBeInTheDocument();
    // Only the temperature chart is rendered.
    expect(document.querySelectorAll('.recharts-wrapper')).toHaveLength(1);
  });

  it('shows an explicit unavailable state when temperature is missing', async () => {
    getArgoObservations.mockResolvedValue([obsPoint(0, null, 32.84), obsPoint(10, undefined, 32.86)]);
    renderDrawer(makeArgoProfile());
    await screen.findByText(/ARGO OBSERVATION PROFILE/i);

    expect(screen.getByText(/TEMPERATURE UNAVAILABLE/i)).toBeInTheDocument();
    expect(screen.getByText(/ARGO OBSERVATION — SALINITY/i)).toBeInTheDocument();
    expect(document.querySelectorAll('.recharts-wrapper')).toHaveLength(1);
  });

  it('shows unavailable states for both variables on an empty profile', async () => {
    getArgoObservations.mockResolvedValue([]);
    renderDrawer(makeArgoProfile());
    await screen.findByText(/ARGO OBSERVATION PROFILE/i);

    expect(screen.getByText(/TEMPERATURE UNAVAILABLE/i)).toBeInTheDocument();
    expect(screen.getByText(/SALINITY UNAVAILABLE/i)).toBeInTheDocument();
    expect(document.querySelectorAll('.recharts-wrapper')).toHaveLength(0);
  });

  it('handles null and NaN values without crashing and never renders them as data', async () => {
    getArgoObservations.mockResolvedValue([
      obsPoint(0, 29.85, 32.84),
      obsPoint(10, null, NaN),
      obsPoint(25, NaN, 33.12),
      obsPoint(50, 27.6, 34.05),
    ]);
    renderDrawer(makeArgoProfile());
    await screen.findByText(/ARGO OBSERVATION PROFILE/i);

    // 2 valid temperatures + 3 valid salinities — null/NaN never become dots.
    expect(document.querySelectorAll('.recharts-dot').length).toBe(5);
  });

  it('handles duplicate and unsorted depths with a disclosed, deterministic strategy', async () => {
    getArgoObservations.mockResolvedValue([
      obsPoint(50, 27.6, 34.05),
      obsPoint(10, 29.8, null),
      obsPoint(0, 29.85, 32.84),
      obsPoint(50, 27.9, 34.1), // duplicate depth: later duplicate excluded
      obsPoint(25, 28.2, 33.5),
    ]);
    renderDrawer(makeArgoProfile());
    await screen.findByText(/ARGO OBSERVATION PROFILE/i);

    // 4 unique depth levels carry a valid temperature.
    expect(screen.getByText('4 VALID LEVELS')).toBeInTheDocument();
    // The duplicate handling is disclosed to the user.
    expect(screen.getByText(/DUPLICATE DEPTH LEVELS: 1/i)).toBeInTheDocument();
    expect(screen.getByText(/FIRST VALID VALUE PER VARIABLE IN SOURCE ORDER/i)).toBeInTheDocument();
    // Chart data is depth-sorted regardless of source order: dots render at
    // 4 unique depths for temperature.
    const charts = document.querySelectorAll('.recharts-wrapper');
    expect(charts[0].querySelectorAll('.recharts-dot').length).toBe(4);
  });

  it('renders shallow and deep profiles without errors', async () => {
    getArgoObservations.mockResolvedValue([obsPoint(0, 30.1, 31.4), obsPoint(2.5, 30.0, 31.5)]);
    const { rerender } = renderDrawer(makeArgoProfile());
    await screen.findByText(/ARGO OBSERVATION PROFILE/i);
    expect(document.querySelectorAll('.recharts-wrapper').length).toBe(2);

    const deep = makeArgoProfile({ profile_id: 'argo-deep', observations_count: 3 });
    getArgoObservations.mockResolvedValue([
      obsPoint(0, 30.0, 32.8),
      obsPoint(1000, 4.4, 34.6),
      obsPoint(2000, 2.2, 34.7),
    ]);
    rerender(<ArgoMatchupDrawer profile={deep} {...CLOSE} />);
    await waitFor(() => expect(getArgoObservations).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(document.querySelectorAll('.recharts-wrapper').length).toBe(2)
    );
  });
});

describe('ArgoMatchupDrawer — honest provenance labeling', () => {
  it('labels the visualization as an ARGO OBSERVATION PROFILE with source-provided depth', async () => {
    getArgoObservations.mockResolvedValue(makeArgoProfile().observations);
    renderDrawer(makeArgoProfile());
    await screen.findByText(/ARGO OBSERVATION PROFILE/i);

    expect(screen.getByText(/ARGO OBSERVATION PROFILE/i)).toBeInTheDocument();
    expect(screen.getByText(/SOURCE-PROVIDED DEPTH/i)).toBeInTheDocument();
    // Real in-situ observation identity (banner badge + provenance footer).
    expect(screen.getAllByText(/DEMO PROFILE SNAPSHOT/i).length).toBeGreaterThan(0);
    // Never mislabeled as model output, validation or prediction.
    expect(screen.queryByText(/MODEL PROFILE/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/VALIDATION/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/PREDICTION/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/HYCOM/i)).not.toBeInTheDocument();
  });
});

describe('ArgoMatchupDrawer — backend matchup statistics', () => {
  it('renders backend-provided temperature and salinity statistics without recomputing them', async () => {
    getArgoObservations.mockResolvedValue(makeArgoProfile().observations);
    getArgoMatchup.mockResolvedValue(
      makeArgoMatchup({
        modelDataStatus: 'SIMULATED',
        statistics: {
          temperature: { n: 3, meanResidual: 1.3333, mae: 2, rmse: 2.1602 },
          salinity: { n: 2, meanResidual: -0.5, mae: 1.5, rmse: 1.5811 },
        },
      })
    );
    renderDrawer(makeArgoProfile());

    fireEvent.click(screen.getByTitle('Matchup tab'));
    expect(await screen.findByText('MATCHUP STATISTICS')).toBeInTheDocument();
    expect(screen.getByText('N = 3')).toBeInTheDocument();
    expect(screen.getByText('1.3333')).toBeInTheDocument();
    expect(screen.getByText('2.1602')).toBeInTheDocument();
    expect(screen.getByText('-0.5000')).toBeInTheDocument();
    expect(screen.getByText(/SYNTHETIC FIXTURE-BACKED STATISTICS/i)).toBeInTheDocument();
  });

  it('shows honest unavailable states for zero and partially available statistics', async () => {
    getArgoObservations.mockResolvedValue(makeArgoProfile().observations);
    getArgoMatchup.mockResolvedValue(
      makeArgoMatchup({
        statistics: {
          temperature: { n: 0, meanResidual: null, mae: null, rmse: null },
          salinity: null,
        },
      })
    );
    renderDrawer(makeArgoProfile());

    fireEvent.click(screen.getByTitle('Matchup tab'));
    await screen.findByText('MATCHUP STATISTICS');
    expect(screen.getAllByText(/No valid matched pairs available for statistics\./i)).toHaveLength(2);
  });
});

describe('ArgoMatchupDrawer — fallback and unavailable data sources', () => {
  it('reuses the already-fetched profile payload when the observations endpoint is unavailable', async () => {
    const profile = makeArgoProfile();
    getArgoObservations.mockResolvedValue(null); // endpoint error/not ok
    renderDrawer(profile);
    await screen.findByText(/ARGO OBSERVATION PROFILE/i);

    // Embedded observations (same real backend data) still power the charts.
    expect(screen.getByText(/ARGO OBSERVATION — TEMPERATURE/i)).toBeInTheDocument();
    expect(document.querySelectorAll('.recharts-dot').length).toBe(6);
    expect(screen.queryByText(/ARGO OBSERVATIONS UNAVAILABLE/i)).not.toBeInTheDocument();
  });

  it('shows an explicit unavailable state when no observations exist anywhere', async () => {
    getArgoObservations.mockResolvedValue(null);
    renderDrawer(makeArgoProfile({ observations: [], observations_count: 0 }));
    await screen.findByText(/ARGO OBSERVATIONS UNAVAILABLE/i);
    expect(screen.queryByText(/ARGO OBSERVATION — TEMPERATURE/i)).not.toBeInTheDocument();
  });
});

describe('ArgoMatchupDrawer — request lifecycle', () => {
  it('rapid profile switching: a stale observation response never overwrites the active profile', async () => {
    const first = deferred<ArgoObservationPoint[] | null>();
    getArgoObservations.mockReturnValueOnce(first.promise).mockResolvedValue([
      obsPoint(0, 30.5, 31.9),
      obsPoint(100, 22.2, 34.4),
    ]);

    const profileA = makeArgoProfile();
    const { rerender } = renderDrawer(profileA);
    await waitFor(() => expect(getArgoObservations).toHaveBeenCalledTimes(1));

    // Switch to profile B while A's request is still in flight.
    const profileB = makeArgoProfile({
      profile_id: 'argo-2902747-p089',
      float_id: '2902747',
      cycle_number: 89,
    });
    rerender(<ArgoMatchupDrawer profile={profileB} {...CLOSE} />);
    await waitFor(() => expect(getArgoObservations).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(document.querySelectorAll('.recharts-dot').length).toBe(4));

    // A's stale response resolves AFTER B rendered — it must be ignored.
    await act(async () => {
      first.resolve([obsPoint(0, 29.85, 32.84), obsPoint(10, 29.8, 32.86), obsPoint(50, 27.6, 34.05)]);
      await Promise.resolve();
    });
    await waitFor(() => expect(document.querySelectorAll('.recharts-dot').length).toBe(4));
    expect(screen.getByText(/FLOAT: 2902747/i)).toBeInTheDocument();
    expect(getArgoObservations).toHaveBeenLastCalledWith('argo-2902747-p089', expect.any(AbortSignal));
  });

  it('rapid switching surfaces no visible error for aborted requests', async () => {
    const first = deferred<ArgoObservationPoint[] | null>();
    getArgoObservations.mockReturnValueOnce(first.promise).mockResolvedValue([
      obsPoint(0, 30.5, 31.9),
    ]);

    const profileA = makeArgoProfile();
    const { rerender } = renderDrawer(profileA);
    await waitFor(() => expect(getArgoObservations).toHaveBeenCalledTimes(1));

    const profileB = makeArgoProfile({ profile_id: 'argo-2902747-p089', float_id: '2902747' });
    rerender(<ArgoMatchupDrawer profile={profileB} {...CLOSE} />);
    await waitFor(() => expect(document.querySelectorAll('.recharts-dot').length).toBe(2));

    await act(async () => {
      first.resolve(null); // aborted fetch resolves null
      await Promise.resolve();
    });
    expect(screen.queryByText(/ARGO OBSERVATIONS UNAVAILABLE/i)).not.toBeInTheDocument();
  });

  it('unmount while a request is in-flight does not throw', async () => {
    const d = deferred<ArgoObservationPoint[] | null>();
    getArgoObservations.mockReturnValue(d.promise);
    const { unmount } = renderDrawer(makeArgoProfile());
    await waitFor(() => expect(getArgoObservations).toHaveBeenCalledTimes(1));
    expect(() => unmount()).not.toThrow();
    await act(async () => {
      d.resolve(null);
      await Promise.resolve();
    });
  });

  it('closing the drawer clears content; reopening reuses cached observations without a redundant request', async () => {
    const profile = makeArgoProfile();
    getArgoObservations.mockResolvedValue(profile.observations);
    const { rerender } = renderDrawer(profile);
    await screen.findByText(/ARGO OBSERVATION PROFILE/i);
    await waitFor(() => expect(document.querySelectorAll('.recharts-dot').length).toBe(6));
    expect(getArgoObservations).toHaveBeenCalledTimes(1);

    // Close: content disappears.
    rerender(<ArgoMatchupDrawer profile={null} {...CLOSE} />);
    expect(screen.queryByText(/ARGO OBSERVATION PROFILE/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/FLOAT: 2902746/i)).not.toBeInTheDocument();

    // Reopen the same profile: cached observations, no second request.
    rerender(<ArgoMatchupDrawer profile={profile} {...CLOSE} />);
    await waitFor(() => expect(document.querySelectorAll('.recharts-dot').length).toBe(6));
    expect(getArgoObservations).toHaveBeenCalledTimes(1);
  });

  it('reopening resets to the Profile tab', async () => {
    const profile = makeArgoProfile();
    getArgoObservations.mockResolvedValue(profile.observations);
    const { rerender } = renderDrawer(profile);
    await screen.findByText(/ARGO OBSERVATION PROFILE/i);

    fireEvent.click(screen.getByTitle('Data tab'));
    expect(screen.getByText(/RAW OBSERVATION RESPONSE/i)).toBeInTheDocument();

    rerender(<ArgoMatchupDrawer profile={null} {...CLOSE} />);
    rerender(<ArgoMatchupDrawer profile={profile} {...CLOSE} />);
    // Back on the Profile tab, not the previously selected Data tab.
    await waitFor(() => expect(screen.getByText(/ARGO OBSERVATION PROFILE/i)).toBeInTheDocument());
    expect(screen.queryByText(/RAW OBSERVATION RESPONSE/i)).not.toBeInTheDocument();
  });
});

describe('ArgoMatchupDrawer — existing matchup interface preserved', () => {
  it('keeps the HYCOM matchup, residuals table and compare action on the Matchup tab', async () => {
    const matchup: ArgoMatchupResponse = makeArgoMatchup();
    getArgoObservations.mockResolvedValue(makeArgoProfile().observations);
    getArgoMatchup.mockResolvedValue(matchup);
    renderDrawer(makeArgoProfile());

    fireEvent.click(screen.getByTitle('Matchup tab'));
    await waitFor(() => expect(screen.getByText(/MATCHED HYCOM MODEL LOCATION/i)).toBeInTheDocument());
    expect(screen.getByText(/VERTICAL DEPTH \/ PARAMETER RESIDUALS/i)).toBeInTheDocument();
    expect(screen.getByText(/ΔT = HYCOM − Argo/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /COMPARE WITH HYCOM/i })).toBeInTheDocument();
    // Residual values from the actual (fixture) response.
    expect(screen.getByText('-0.45')).toBeInTheDocument();
  });

  describe('ArgoMatchupDrawer — visual model comparison', () => {
    it('renders both profile series and exact matchup metadata without validation wording', async () => {
      getArgoObservations.mockResolvedValue(makeArgoProfile().observations);
      getArgoMatchup.mockResolvedValue(makeArgoMatchup());
      renderDrawer(makeArgoProfile());

      fireEvent.click(screen.getByTitle('Matchup tab'));
      await waitFor(() => expect(screen.getByText(/MODEL VS OBSERVATION/i)).toBeInTheDocument());

      expect(screen.getAllByText(/ARGO OBSERVATION/i).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/HYCOM MODEL/i).length).toBeGreaterThan(0);
      expect(screen.getByText('2026-09-08T03:15:00Z')).toBeInTheDocument();
      expect(screen.getByText('2026-09-08T00:00:00Z')).toBeInTheDocument();
      expect(screen.getByText('2')).toBeInTheDocument();
      expect(screen.getByText('15 m')).toBeInTheDocument();
      expect(screen.getByText(/RESIDUAL = HYCOM − Argo/i)).toBeInTheDocument();
      expect(screen.queryByText(/MODEL ERROR|VALIDATION SUCCESS|PREDICTION ACCURACY/i)).not.toBeInTheDocument();
    });

    it('shows salinity comparison unavailable when either source lacks valid salinity', async () => {
      getArgoObservations.mockResolvedValue(makeArgoProfile().observations);
      getArgoMatchup.mockResolvedValue(
        makeArgoMatchup({
          comparisons: makeArgoMatchup().comparisons.map((comparison) => ({
            ...comparison,
            argoSalinityPSU: null,
            modelSalinityPSU: null,
            salinityResidualPSU: null,
          })),
        })
      );
      renderDrawer(makeArgoProfile());

      fireEvent.click(screen.getByTitle('Matchup tab'));
      await waitFor(() => expect(screen.getByText(/SALINITY COMPARISON UNAVAILABLE/i)).toBeInTheDocument());
    });

    it('does not render a stale matchup after rapidly switching profiles', async () => {
      const first = deferred<ArgoMatchupResponse | null>();
      const second = makeArgoMatchup({
        argoProfileId: 'argo-2902747-p089',
        floatId: '2902747',
        observationTimestamp: '2026-09-09T03:15:00Z',
      });
      getArgoObservations.mockResolvedValue(makeArgoProfile().observations);
      getArgoMatchup.mockReturnValueOnce(first.promise).mockResolvedValue(second);

      const profileA = makeArgoProfile();
      const { rerender } = renderDrawer(profileA);
      await waitFor(() => expect(getArgoMatchup).toHaveBeenCalledTimes(1));

      const profileB = makeArgoProfile({ profile_id: 'argo-2902747-p089', float_id: '2902747' });
      rerender(<ArgoMatchupDrawer profile={profileB} {...CLOSE} />);
      await waitFor(() => expect(getArgoMatchup).toHaveBeenCalledTimes(2));
      fireEvent.click(screen.getByTitle('Matchup tab'));
      await waitFor(() => expect(screen.getByText(/MODEL VS OBSERVATION/i)).toBeInTheDocument());
      expect(screen.getByText('2026-09-09T03:15:00Z')).toBeInTheDocument();

      await act(async () => {
        first.resolve(makeArgoMatchup({ observationTimestamp: 'STALE-TIME' }));
        await Promise.resolve();
      });
      expect(screen.queryByText('STALE-TIME')).not.toBeInTheDocument();
    });

    it('does not render a stale manual matchup after switching profiles', async () => {
      const first = deferred<ArgoMatchupResponse | null>();
      const second = makeArgoMatchup({
        argoProfileId: 'argo-2902747-p089',
        floatId: '2902747',
        observationTimestamp: '2026-09-09T03:15:00Z',
      });
      getArgoObservations.mockResolvedValue(makeArgoProfile().observations);
      getArgoMatchup.mockResolvedValueOnce(makeArgoMatchup()).mockReturnValueOnce(first.promise).mockResolvedValue(second);

      const profileA = makeArgoProfile();
      const { rerender } = renderDrawer(profileA);
      await waitFor(() => expect(getArgoMatchup).toHaveBeenCalledTimes(1));
      fireEvent.click(screen.getByTitle('Matchup tab'));
      fireEvent.click(screen.getByRole('button', { name: /COMPARE WITH HYCOM/i }));

      const profileB = makeArgoProfile({ profile_id: 'argo-2902747-p089', float_id: '2902747' });
      rerender(<ArgoMatchupDrawer profile={profileB} {...CLOSE} />);
      await waitFor(() => expect(getArgoMatchup).toHaveBeenCalledTimes(3));
      expect(screen.queryByText('2026-09-08T03:15:00Z')).not.toBeInTheDocument();

      await act(async () => {
        first.resolve(makeArgoMatchup({ observationTimestamp: 'STALE-MANUAL-TIME' }));
        await Promise.resolve();
      });
      expect(screen.queryByText('STALE-MANUAL-TIME')).not.toBeInTheDocument();
      expect(screen.getByText('2026-09-09T03:15:00Z')).toBeInTheDocument();
    });
  });

  it('keeps the honest no-matchup error state on the Matchup tab', async () => {
    getArgoObservations.mockResolvedValue(makeArgoProfile().observations);
    getArgoMatchup.mockResolvedValue(null);
    renderDrawer(makeArgoProfile());

    fireEvent.click(screen.getByTitle('Matchup tab'));
    await waitFor(() => expect(screen.getByText(/NO REAL OBSERVATION AVAILABLE/i)).toBeInTheDocument());
  });

  it('the compare button refetches the matchup on demand', async () => {
    getArgoObservations.mockResolvedValue(makeArgoProfile().observations);
    getArgoMatchup.mockResolvedValue(makeArgoMatchup());
    renderDrawer(makeArgoProfile());
    await waitFor(() => expect(getArgoMatchup).toHaveBeenCalledTimes(1)); // auto-fetch on open

    fireEvent.click(screen.getByTitle('Matchup tab'));
    const btn = await screen.findByRole('button', { name: /COMPARE WITH HYCOM/i });
    fireEvent.click(btn);
    await waitFor(() => expect(getArgoMatchup).toHaveBeenCalledTimes(2));
  });
});

describe('ArgoMatchupDrawer — Data tab (raw observations)', () => {
  it('shows the raw observation response with QC flags and honest null rendering', async () => {
    getArgoObservations.mockResolvedValue([
      obsPoint(0, 29.85, 32.84, 1, 1),
      obsPoint(10, null, 32.86, 4, 1),
    ]);
    renderDrawer(makeArgoProfile());
    await screen.findByText(/ARGO OBSERVATION PROFILE/i);

    fireEvent.click(screen.getByTitle('Data tab'));
    expect(screen.getByText(/RAW OBSERVATION RESPONSE/i)).toBeInTheDocument();
    const table = screen.getByRole('table');
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(3); // header + 2 observations
    expect(within(table).getByText('29.85')).toBeInTheDocument();
    expect(within(table).getAllByText('—').length).toBe(1); // missing temperature → dash
    expect(within(table).getByText('4')).toBeInTheDocument(); // raw temp QC flag
  });
});
describe('ArgoMatchupDrawer — Phase 2C matchup diagnostics', () => {
  async function openMatchupTab(matchup: ArgoMatchupResponse, profile = makeArgoProfile()) {
    getArgoObservations.mockResolvedValue(profile.observations);
    getArgoMatchup.mockResolvedValue(matchup);
    renderDrawer(profile);
    fireEvent.click(screen.getByTitle('Matchup tab'));
    await screen.findByText(/MATCHUP DIAGNOSTICS/i);
  }

  it('renders backend-provided match coverage without recomputing it', async () => {
    await openMatchupTab(makeArgoMatchup());

    expect(screen.getByText('2 matched')).toBeInTheDocument();
    expect(screen.getByText('1 unmatched')).toBeInTheDocument();
  });

  it('renders the backend matched percentage', async () => {
    await openMatchupTab(makeArgoMatchup());

    expect(screen.getByText('66.67% matched')).toBeInTheDocument();
  });

  it('renders the neutral observation–model time separation', async () => {
    await openMatchupTab(makeArgoMatchup());

    expect(screen.getByText('3.25 h')).toBeInTheDocument();
    expect(screen.getByText(/OBSERVATION–MODEL TIME SEPARATION/i)).toBeInTheDocument();
    expect(screen.queryByText(/TIME ERROR|TEMPORAL MISMATCH/i)).not.toBeInTheDocument();
  });

  it('renders the neutral horizontal separation', async () => {
    await openMatchupTab(makeArgoMatchup());

    expect(screen.getByText('4.20 km')).toBeInTheDocument();
    expect(screen.getByText('HORIZONTAL SEPARATION')).toBeInTheDocument();
    expect(screen.queryByText(/LOCATION ERROR/i)).not.toBeInTheDocument();
  });

  it('renders the existing depth tolerance and native-depth semantics', async () => {
    await openMatchupTab(makeArgoMatchup());

    expect(screen.getByText('≤ 15 m')).toBeInTheDocument();
    expect(screen.getByText('NEAREST NATIVE HYCOM MODEL DEPTH (NO INTERPOLATION)')).toBeInTheDocument();
    // Source depth and native model depth are reported separately.
    expect(screen.getByText('50 m (source)')).toBeInTheDocument();
    expect(screen.getByText('50 m (native)')).toBeInTheDocument();
  });

  it('reports no interpolation and no subjective quality grade', async () => {
    await openMatchupTab(makeArgoMatchup());

    expect(screen.getByText('NONE')).toBeInTheDocument();
    expect(screen.getByText(/No depth interpolation is applied/i)).toBeInTheDocument();
    expect(screen.queryByText(/EXCELLENT|QUALITY GRADE|MATCHUP SCORE|POOR MATCHUP/i)).not.toBeInTheDocument();
  });

  it('shows variable valid-pair counts from Phase 2B statistics, not from chart points', async () => {
    await openMatchupTab(
      makeArgoMatchup({
        statistics: {
          temperature: { n: 7, meanResidual: 1, mae: 1, rmse: 1 },
          salinity: { n: 5, meanResidual: 1, mae: 1, rmse: 1 },
        },
      })
    );

    expect(screen.getByText('7 valid pairs')).toBeInTheDocument();
    expect(screen.getByText('5 valid pairs')).toBeInTheDocument();
    expect(screen.getByText(/MATCHED PAIRS AND VALID STATISTICAL PAIRS DIFFER/i)).toBeInTheDocument();
  });
});

describe('ArgoMatchupDrawer — Phase 2C diagnostic honesty and regressions', () => {
  async function openMatchupTab(matchup: ArgoMatchupResponse, profile = makeArgoProfile()) {
    getArgoObservations.mockResolvedValue(profile.observations);
    getArgoMatchup.mockResolvedValue(matchup);
    renderDrawer(profile);
    fireEvent.click(screen.getByTitle('Matchup tab'));
    await screen.findByText(/MATCHUP DIAGNOSTICS/i);
  }

  it('shows honest unavailable diagnostics without inventing a denominator or a zero', async () => {
    await openMatchupTab(
      makeArgoMatchup({
        timeDifferenceHours: null as unknown as number,
        distanceKm: undefined as unknown as number,
        matchingToleranceM: null as unknown as number,
        statistics: { temperature: null, salinity: null },
        diagnostics: null,
        modelDepthSelection: '',
      })
    );

    expect(screen.getByText(/MATCHUP COVERAGE UNAVAILABLE FROM THIS RESPONSE/i)).toBeInTheDocument();
    expect(screen.queryByText('0 matched')).not.toBeInTheDocument();
    expect(screen.queryByText('0.00% matched')).not.toBeInTheDocument();
    // Every unavailable field renders as Unavailable instead of a fabricated
    // value: 9 diagnostic rows + model-depth selection + 2 valid-pair rows.
    expect(screen.getAllByText('Unavailable')).toHaveLength(12);
    // No limitation statement is supportable from an all-unavailable response.
    expect(screen.queryByText('LIMITATIONS')).not.toBeInTheDocument();
  });

  it('keeps synthetic fixture provenance visible alongside diagnostics', async () => {
    await openMatchupTab(makeArgoMatchup({ modelDataStatus: 'SIMULATED' }));

    expect(screen.getByText(/HYCOM MODEL — SYNTHETIC FIXTURE/i)).toBeInTheDocument();
    expect(screen.getByText(/synthetic fixture-backed data, not scientific measurements/i)).toBeInTheDocument();
    expect(screen.queryByText(/REAL MODEL/i)).not.toBeInTheDocument();
  });

  it('does not change the Phase 2A comparison chart or residual table', async () => {
    await openMatchupTab(makeArgoMatchup());

    expect(screen.getByText(/MODEL VS OBSERVATION/i)).toBeInTheDocument();
    expect(document.querySelectorAll('.recharts-dot')).toHaveLength(8);
    expect(screen.getByText(/VERTICAL DEPTH \/ PARAMETER RESIDUALS/i)).toBeInTheDocument();
    expect(screen.getByText('-0.45')).toBeInTheDocument();
  });

  it('does not change the Phase 2B statistics card', async () => {
    await openMatchupTab(makeArgoMatchup());

    expect(screen.getByText(/MATCHUP STATISTICS/i)).toBeInTheDocument();
    expect(screen.getAllByText('N = 2')).toHaveLength(2); // temperature + salinity
    expect(screen.getByText('0.4253')).toBeInTheDocument();
    expect(screen.getAllByText('0.0600')).toHaveLength(3); // salinity mean/MAE/RMSE (fixture)
  });

  it('never shows stale diagnostics after rapidly switching profiles', async () => {
    const firstMatchup = deferred<ArgoMatchupResponse | null>();
    getArgoObservations.mockResolvedValue(makeArgoProfile().observations);
    getArgoMatchup.mockReturnValueOnce(firstMatchup.promise).mockResolvedValue(
      makeArgoMatchup({
        argoProfileId: 'argo-2902747-p089',
        floatId: '2902747',
        diagnostics: {
          totalArgoObservations: 8,
          matchedObservationCount: 7,
          unmatchedObservationCount: 1,
          matchedPercentage: 87.5,
          deepestMatchedObservationDepthM: 500,
          deepestMatchedModelDepthM: 500,
          repeatedNativeDepthMatchCount: 1,
          interpolationApplied: false,
        },
      })
    );

    const profileA = makeArgoProfile();
    const { rerender } = renderDrawer(profileA);
    fireEvent.click(screen.getByTitle('Matchup tab'));
    await waitFor(() => expect(getArgoMatchup).toHaveBeenCalledTimes(1));

    const profileB = makeArgoProfile({ profile_id: 'argo-2902747-p089', float_id: '2902747' });
    rerender(<ArgoMatchupDrawer profile={profileB} {...CLOSE} />);
    await waitFor(() => expect(getArgoMatchup).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByTitle('Matchup tab'));

    expect(await screen.findByText('7 matched')).toBeInTheDocument();
    expect(screen.getByText('87.50% matched')).toBeInTheDocument();
    expect(screen.getByText(/REPEATED NATIVE-DEPTH MATCHES: 1/i)).toBeInTheDocument();

    // A's stale response resolves AFTER B is displayed — it must not appear.
    await act(async () => {
      firstMatchup.resolve(makeArgoMatchup());
      await Promise.resolve();
    });
    expect(screen.queryByText('2 matched')).not.toBeInTheDocument();
    expect(screen.queryByText('66.67% matched')).not.toBeInTheDocument();
    expect(screen.getByText('7 matched')).toBeInTheDocument();
  });
});
