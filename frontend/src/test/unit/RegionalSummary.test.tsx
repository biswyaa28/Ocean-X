/**
 * RegionalSummary — the panel must report the backend's regional numbers and
 * must not invent any of its own.
 *
 * The central risk in a summary panel is silent arithmetic: a component that
 * recomputes a mean, re-bins a depth, or falls back to a placeholder when the
 * backend is down. Each test below pins one of those failure modes shut.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { RegionalSummary, depthTooltipLabel } from '../../components/RegionalSummary';
import { apiProvider } from '../../services/ApiProvider';
import type { ArgoMatchupSummary } from '../../types/oceanlens';

vi.mock('../../services/ApiProvider', () => ({
  apiProvider: { getArgoMatchupSummary: vi.fn() },
}));

const getArgoMatchupSummary = vi.mocked(apiProvider.getArgoMatchupSummary);

function metric(n: number) {
  return { n, bias: 0.5, mae: 0.8, rmse: 1.1 };
}

function makeSummary(overrides: Partial<ArgoMatchupSummary> = {}): ArgoMatchupSummary {
  return {
    matchMode: 'model_levels',
    modelDataset: 'INCOIS HYCOM',
    modelRuns: ['20261004', '20261005'],
    floatBracketMaxGapM: 50,
    floatBracketMaxGapDeepM: 100,
    floatBracketDeepBreakpointM: 150,
    totalProfileCount: 23,
    includedProfileCount: 2,
    excludedProfileCount: 1,
    excludedProfileReasons: { no_overlap_with_model_depth_range: 1 },
    excludedProfiles: [
      { profileId: 'x', reason: 'no_overlap_with_model_depth_range' },
    ],
    byModelDepth: [
      {
        modelDepthM: 17.5,
        temperature: { n: 2, bias: 0.25, mae: 0.3, rmse: 0.35 },
        salinity: { n: 1, bias: -0.1, mae: 0.1, rmse: 0.12 },
      },
      {
        modelDepthM: 125,
        temperature: { n: 2, bias: 3.9, mae: 4.0, rmse: 4.6 },
        salinity: { n: 1, bias: -0.35, mae: 0.36, rmse: 0.42 },
      },
    ],
    tchp: {
      n: 2,
      bias: 13.7,
      mae: 20.1,
      rmse: 25.0,
      medianBias: 13.7,
      meanModelMinusFloat: 13.7,
      meanFloat: 82.4,
      meanModel: 96.1,
    },
    tchpScatter: [
      {
        profileId: 'p1',
        floatId: '2902746',
        tchpFloatKjCm2: 82.4,
        tchpModelKjCm2: 96.1,
        residualKjCm2: 13.7,
      },
      {
        profileId: 'p2',
        floatId: '2902747',
        tchpFloatKjCm2: 71.2,
        tchpModelKjCm2: 64.0,
        residualKjCm2: -7.2,
      },
    ],
    tchpProfiles: [],
    tchpIsothermC: 26,
    tchpDefinitionStatus: 'Model TCHP formula not published in the file.',
    tchpRuleOfThumbKJPerCm2: 50,
    overall: {
      temperature: { n: 2, bias: 1.11, mae: 1.18, rmse: 1.42 },
      salinity: { n: 2, bias: -0.324, mae: 0.373, rmse: 0.439 },
    },
    profiles: [
      {
        profileId: 'p1',
        floatId: '2902746',
        observationTimestamp: '2026-10-04T06:00:00Z',
        timeDifferenceHours: 4.5,
        timeGapStatus: 'good',
        modelRun: '20261004',
        pairCount: 6,
        temperaturePairCount: 6,
        salinityPairCount: 5,
        temperature: metric(6),
        salinity: metric(5),
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('RegionalSummary', () => {
  it('renders the regional counts and overall statistics from the backend', async () => {
    getArgoMatchupSummary.mockResolvedValue(makeSummary());
    render(<RegionalSummary />);

    await waitFor(() => expect(getArgoMatchupSummary).toHaveBeenCalledTimes(1));

    // Profile accounting: 2 of 23 included, 1 excluded.
    expect(screen.getByText('2/23')).toBeTruthy();
    expect(screen.getByText('No overlap with model depths')).toBeTruthy();

    // Overall bias / RMSE, echoed exactly as the backend computed them.
    expect(screen.getByText('1.110 °C')).toBeTruthy();
    expect(screen.getByText('1.420 °C')).toBeTruthy();
    expect(screen.getByText('-0.324 PSU')).toBeTruthy();
    expect(screen.getByText('0.439 PSU')).toBeTruthy();
  });

  it('plots one bar row per model depth for both variables', async () => {
    getArgoMatchupSummary.mockResolvedValue(makeSummary());
    const { container } = render(<RegionalSummary />);

    await waitFor(() => expect(getArgoMatchupSummary).toHaveBeenCalled());

    expect(screen.getByText('BIAS VS DEPTH — °C')).toBeTruthy();
    expect(screen.getByText('BIAS VS DEPTH — PSU')).toBeTruthy();
    // Two depths x two variables = four bar layers rendered by the chart.
    expect(container.querySelectorAll('.recharts-bar-rectangle').length).toBeGreaterThan(0);
  });

  it('reports the float bracket gap rule so the reader can judge the limit', async () => {
    getArgoMatchupSummary.mockResolvedValue(makeSummary());
    render(<RegionalSummary />);

    await waitFor(() => expect(getArgoMatchupSummary).toHaveBeenCalled());
    expect(screen.getByText('FLOAT BRACKET MAX GAP')).toBeTruthy();
    expect(screen.getByText('≤50 m ≤150 m · 100 m below')).toBeTruthy();
  });

  it('reveals per-profile rows only on request', async () => {
    getArgoMatchupSummary.mockResolvedValue(makeSummary());
    render(<RegionalSummary />);

    const toggle = await screen.findByRole('button', {
      name: /PER-PROFILE DETAIL \(1\)/,
    });
    expect(screen.queryByText('2902746')).toBeNull();

    toggle.click();
    await waitFor(() => expect(screen.getByText('2902746')).toBeTruthy());
    expect(screen.getByText('4.50')).toBeTruthy();
  });

  it('says the summary is unavailable rather than showing a placeholder when the backend fails', async () => {
    getArgoMatchupSummary.mockResolvedValue(null);
    render(<RegionalSummary />);

    const status = await screen.findByRole('status');
    expect(status.textContent).toMatch(/NOTHING IS FABRICATED/i);
    expect(screen.queryByText('0/0')).toBeNull();
  });

  it('shows a status instead of an empty chart when no depth produced a pair', async () => {
    getArgoMatchupSummary.mockResolvedValue(
      makeSummary({
        byModelDepth: [],
        overall: {
          temperature: { n: 0, bias: null, mae: null, rmse: null },
          salinity: { n: 0, bias: null, mae: null, rmse: null },
        },
      })
    );
    render(<RegionalSummary />);

    await waitFor(() =>
      expect(screen.getAllByText(/NO PER-DEPTH BIAS AVAILABLE/).length).toBe(2)
    );
    // A null bias is shown as an em dash, never as 0.000.
    expect(screen.getAllByText('— °C').length).toBeGreaterThan(0);
    expect(screen.queryByText('0.000 °C')).toBeNull();
  });
});
describe('RegionalSummary — TCHP scatter', () => {
  it('plots float-derived TCHP against the INCOIS TCHP product with a 1:1 line', async () => {
    getArgoMatchupSummary.mockResolvedValue(makeSummary());
    const { container } = render(<RegionalSummary />);

    await waitFor(() =>
      expect(screen.getByText(/FLOAT-DERIVED TCHP vs INCOIS TCHP PRODUCT/)).toBeTruthy()
    );
    expect(container.querySelectorAll('.recharts-scatter-symbol').length).toBeGreaterThan(0);
    // The reference diagonal plus the two rule-of-thumb lines.
    const lines = container.querySelectorAll('.recharts-reference-line line');
    expect(lines.length).toBeGreaterThanOrEqual(1);
  });

  it('reports mean and median difference plus RMSE, never calling it a bias', async () => {
    getArgoMatchupSummary.mockResolvedValue(makeSummary());
    render(<RegionalSummary />);

    await waitFor(() => expect(screen.getByText('MEAN DIFFERENCE (INCOIS − FLOAT)')).toBeTruthy());
    // bias and medianBias happen to be equal in this fixture, so they are
    // disambiguated by the row they sit in.
    const row = (label: string) =>
      screen.getByText(label).parentElement?.textContent ?? '';
    expect(row('MEAN DIFFERENCE (INCOIS − FLOAT)')).toContain('13.7');
    expect(row('MEDIAN DIFFERENCE')).toContain('13.7');
    expect(screen.getByText('25.0 kJ/cm2')).toBeTruthy();
    expect(screen.getByText('82.4 / 96.1 kJ/cm2')).toBeTruthy();
  });

  it('quotes the computed 2D-vs-3D ratio rather than a hardcoded one', async () => {
    getArgoMatchupSummary.mockResolvedValue(
      makeSummary({
        tchpModelDefinition: {
          status: 'OK',
          reason: null,
          profileCount: 20,
          floatIsothermC: 26,
          fieldMeanKjCm2: 114.09,
          modelProfileMeanKjCm2: 82.47,
          ratioAtFloatIsothermMean: 1.3972,
          ratioAtFloatIsothermMedian: 1.4161,
          referenceIsothermC: 25,
          referenceProfileMeanKjCm2: 115.31,
          referenceRatio: 0.9894,
          referenceCoverage: 20,
          modelProfileMaxGapM: 300,
        },
      })
    );
    render(<RegionalSummary />);

    await waitFor(() =>
      expect(screen.getByTestId('regional-tchp-definition-note')).toBeTruthy()
    );
    const note = screen.getByTestId('regional-tchp-definition-note').textContent ?? '';
    // The ratio comes from the payload, so a changed measurement changes the text.
    expect(note).toContain('1.42x');
    expect(note).toContain('25.0 °C');
    expect(note).toContain('definition difference, not model error');
  });

  it('withholds the definition note when the backend cannot compute one', async () => {
    getArgoMatchupSummary.mockResolvedValue(
      makeSummary({
        tchpModelDefinition: {
          status: 'UNAVAILABLE',
          reason: 'no profile supplied both a model TCHP field value and a model temperature profile',
          profileCount: 0,
          floatIsothermC: 26,
          fieldMeanKjCm2: null,
          modelProfileMeanKjCm2: null,
          ratioAtFloatIsothermMean: null,
          ratioAtFloatIsothermMedian: null,
          referenceIsothermC: null,
          referenceProfileMeanKjCm2: null,
          referenceRatio: null,
          referenceCoverage: 0,
          modelProfileMaxGapM: 300,
        },
      })
    );
    render(<RegionalSummary />);

    await waitFor(() => expect(screen.getAllByText(/FLOAT-DERIVED TCHP/).length).toBeGreaterThan(0));
    // A missing measurement must produce no claim, not a remembered one.
    expect(screen.queryByTestId('regional-tchp-definition-note')).toBeNull();
  });

  it('says the scatter is empty rather than plotting a single zero point', async () => {
    getArgoMatchupSummary.mockResolvedValue(makeSummary({ tchpScatter: [] }));
    render(<RegionalSummary />);

    await waitFor(() =>
      expect(screen.getAllByText(/NO TCHP COMPARISON AVAILABLE/).length).toBe(1)
    );
  });

  it('never claims a cyclone will intensify', async () => {
    getArgoMatchupSummary.mockResolvedValue(makeSummary());
    render(<RegionalSummary />);

    await waitFor(() => expect(screen.getByText(/FLOAT-DERIVED TCHP vs INCOIS TCHP PRODUCT/)).toBeTruthy());
    const text = (document.body.textContent ?? '').toLowerCase();
    // The caption legitimately negates these; strip it before scanning.
    const withoutCaption = text.split('this is a comparison, not a forecast').join(' ');
    expect(withoutCaption).not.toContain('will intensify');
    expect(withoutCaption).not.toContain('expected to');
    expect(withoutCaption).not.toContain('warning');
  });

  it('carries the caveat that the model formula is unpublished', async () => {
    getArgoMatchupSummary.mockResolvedValue(makeSummary());
    render(<RegionalSummary />);

    await waitFor(() =>
      expect(screen.getByText(/HOW COMPARABLE IS THE INCOIS TCHP PRODUCT\?/i)).toBeTruthy()
    );
    const details = screen
      .getByText(/how comparable is the incois tchp product\?/i)
      .closest('details');
    expect(details?.textContent).toMatch(/not published in the file/i);
  });

  it('names both the sampled depths and the file\'s own labels when they differ', async () => {
    getArgoMatchupSummary.mockResolvedValue(
      makeSummary({
        modelDepths: [0, 10, 50, 100, 250, 500],
        storedFileDepths: [0, 17.5, 52.5, 125, 275, 500],
      })
    );
    render(<RegionalSummary />);

    await waitFor(() => expect(screen.getByTestId('regional-depth-axis-note')).toBeTruthy());
    const note = screen.getByTestId('regional-depth-axis-note').textContent ?? '';
    // The sampled axis is the headline; the file's labels ride along so a reader
    // holding the file can reconcile the two.
    expect(note).toContain('0, 10, 50, 100, 250, 500 m');
    expect(note).toContain('0, 17.5, 52.5, 125, 275, 500 m');
    expect(note).toContain('25 m apart');
    expect(note).toContain('midpoint of its own bounds');
  });

  it('says the file labels the levels identically when the two axes agree', async () => {
    getArgoMatchupSummary.mockResolvedValue(
      makeSummary({
        modelDepths: [0, 10, 50, 100, 250, 500],
        storedFileDepths: [0, 10, 50, 100, 250, 500],
      })
    );
    render(<RegionalSummary />);

    await waitFor(() => expect(screen.getByTestId('regional-depth-axis-note')).toBeTruthy());
    expect(screen.getByTestId('regional-depth-axis-note').textContent).toBe(
      'Model depths are shown as sampled (0, 10, 50, 100, 250, 500 m); the file labels them identically.'
    );
  });

  it('renders the model depth axis note without depths when modelDepths is absent', async () => {
    getArgoMatchupSummary.mockResolvedValue(
      makeSummary({
        modelDepths: undefined,
      })
    );
    render(<RegionalSummary />);

    await waitFor(() => expect(screen.getByTestId('regional-depth-axis-note')).toBeTruthy());
    expect(screen.getByTestId('regional-depth-axis-note').textContent).toBe(
      "Model levels use the producer's native depth axis. Layer definition pending confirmation from INCOIS."
    );
  });

  it('renders n = <count> profiles beside overall temperature and salinity MAE and RMSE', async () => {
    getArgoMatchupSummary.mockResolvedValue(makeSummary());
    render(<RegionalSummary />);

    await waitFor(() => expect(screen.getByText('T OVERALL BIAS')).toBeTruthy());
    expect(screen.getByText('T OVERALL MAE (n = 2 profiles)')).toBeTruthy();
    expect(screen.getByText('T OVERALL RMSE (n = 2 profiles)')).toBeTruthy();
    expect(screen.getByText('S OVERALL MAE (n = 2 profiles)')).toBeTruthy();
    expect(screen.getByText('S OVERALL RMSE (n = 2 profiles)')).toBeTruthy();
  });
});

/**
 * Two different quantities are both called "n" by the backend, and they are not
 * the same number.
 *
 * `overall.temperature.n` / `overall.salinity.n` count PROFILES: the backend
 * reduces each profile to one bias first, so a profile that sampled ten levels
 * still contributes exactly one row (and the value happens to equal
 * includedProfileCount). Calling those "profiles" is correct.
 *
 * `byModelDepth[i].n` counts MATCHED PAIRS: it is `len()` of a flat list of
 * residuals, one appended per comparison row at that depth. It equals the
 * distinct-profile count only because model depths are unique per profile, an
 * invariant of the data rather than of the code. The two diverge as soon as a
 * profile contributes two rows at one depth, or a profile is dropped for one
 * variable at that depth and not the other.
 *
 * The per-depth tooltip must therefore never call this number "profiles".
 */
describe('RegionalSummary — n means different things at each depth', () => {
  const row = (n: number) => ({ modelDepthM: 50, bias: 0.1, n, spread: null });

  it('calls the per-depth count matched pairs, never profiles', () => {
    expect(depthTooltipLabel(50, row(19))).toBe('DEPTH 50 M · n = 19 matched pairs');
    expect(depthTooltipLabel(50, row(19))).not.toContain('profiles');
  });

  it('still calls the OVERALL count profiles, because that is what it is', async () => {
    getArgoMatchupSummary.mockResolvedValue(makeSummary());
    render(<RegionalSummary />);

    await waitFor(() => expect(screen.getByText('T OVERALL BIAS')).toBeTruthy());
    expect(screen.getByText(/T OVERALL MAE \(n = 2 profiles\)/)).toBeTruthy();
  });

  it('omits the count entirely when the depth produced no pair', () => {
    expect(depthTooltipLabel(500, undefined)).toBe('DEPTH 500 M');
  });
});

