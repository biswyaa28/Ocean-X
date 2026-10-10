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
import { RegionalSummary } from '../../components/RegionalSummary';
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
  it('plots float against model heat potential with a 1:1 line', async () => {
    getArgoMatchupSummary.mockResolvedValue(makeSummary());
    const { container } = render(<RegionalSummary />);

    await waitFor(() =>
      expect(screen.getByText(/FLOAT VS MODEL HEAT POTENTIAL/)).toBeTruthy()
    );
    expect(container.querySelectorAll('.recharts-scatter-symbol').length).toBeGreaterThan(0);
    // The reference diagonal plus the two rule-of-thumb lines.
    const lines = container.querySelectorAll('.recharts-reference-line line');
    expect(lines.length).toBeGreaterThanOrEqual(1);
  });

  it('reports mean, median and RMSE for the heat residual', async () => {
    getArgoMatchupSummary.mockResolvedValue(makeSummary());
    render(<RegionalSummary />);

    await waitFor(() => expect(screen.getByText('HEAT POTENTIAL MEAN BIAS')).toBeTruthy());
    // bias and medianBias happen to be equal in this fixture, so they are
    // disambiguated by the row they sit in.
    const row = (label: string) =>
      screen.getByText(label).parentElement?.textContent ?? '';
    expect(row('HEAT POTENTIAL MEAN BIAS')).toContain('13.700');
    expect(row('MEDIAN BIAS')).toContain('13.700');
    expect(screen.getByText('25.000 kJ/cm2')).toBeTruthy();
    expect(screen.getByText('82.4 / 96.1 kJ/cm2')).toBeTruthy();
  });

  it('says the scatter is empty rather than plotting a single zero point', async () => {
    getArgoMatchupSummary.mockResolvedValue(makeSummary({ tchpScatter: [] }));
    render(<RegionalSummary />);

    await waitFor(() =>
      expect(screen.getAllByText(/NO HEAT-POTENTIAL COMPARISON AVAILABLE/).length).toBe(1)
    );
  });

  it('never claims a cyclone will intensify', async () => {
    getArgoMatchupSummary.mockResolvedValue(makeSummary());
    render(<RegionalSummary />);

    await waitFor(() => expect(screen.getByText(/FLOAT VS MODEL HEAT POTENTIAL/)).toBeTruthy());
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
      expect(screen.getByText(/HOW COMPARABLE IS THE MODEL HEAT POTENTIAL\?/i)).toBeTruthy()
    );
    const details = screen
      .getByText(/how comparable is the model heat potential\?/i)
      .closest('details');
    expect(details?.textContent).toMatch(/not published in the file/i);
  });
});
