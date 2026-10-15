import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { RegionalSummary } from '../../components/RegionalSummary';
import type { ArgoMatchupSummary } from '../../types/oceanlens';

const getArgoMatchupSummary = vi.fn();

vi.mock('../../services/ApiProvider', () => ({
  apiProvider: {
    getArgoMatchupSummary: (...args: unknown[]) => getArgoMatchupSummary(...args),
  },
}));

function makeSummary(overrides: Partial<ArgoMatchupSummary> = {}): ArgoMatchupSummary {
  return {
    matchMode: 'model_levels',
    modelDataset: 'INCOIS HYCOM',
    modelRuns: ['20261004', '20261005'],
    floatBracketMaxGapM: 50,
    floatBracketMaxGapDeepM: 100,
    floatBracketDeepBreakpointM: 150,
    totalProfileCount: 23,
    includedProfileCount: 20,
    excludedProfileCount: 3,
    excludedProfileReasons: { no_overlap_with_model_depth_range: 3 },
    excludedProfiles: [],
    modelDepths: [17.5, 125],
    storedFileDepths: [17.5, 125],
    byModelDepth: [
      {
        modelDepthM: 17.5,
        temperature: { n: 12, bias: 0.25, mae: 0.3, rmse: 0.35 },
        salinity: { n: 11, bias: -0.1, mae: 0.1, rmse: 0.12 },
      },
    ],
    tchp: {
      n: 8,
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
    ],
    tchpProfiles: [],
    tchpIsothermC: 26,
    tchpDefinitionStatus: 'Model TCHP formula not published in the file.',
    tchpRuleOfThumbKJPerCm2: 50,
    overall: {
      temperature: { n: 12, bias: 1.11, mae: 1.18, rmse: 1.42 },
      salinity: { n: 11, bias: -0.324, mae: 0.373, rmse: 0.439 },
    },
    profiles: [],
    ...overrides,
  };
}

beforeEach(() => {
  getArgoMatchupSummary.mockReset();
  getArgoMatchupSummary.mockResolvedValue(makeSummary());
});

describe('RegionalSummary — compact variant', () => {
  // The default layout must not change for existing callers.
  it('renders the scatter plot and the per-depth charts by default', async () => {
    render(<RegionalSummary />);

    await waitFor(() => expect(screen.getByText('BIAS VS DEPTH — °C')).toBeTruthy());
    expect(screen.getByText('BIAS VS DEPTH — PSU')).toBeTruthy();
    expect(screen.getByText(/FLOAT-DERIVED TCHP vs INCOIS TCHP PRODUCT/i)).toBeTruthy();
  });

  it('keeps the headline counts in compact mode', async () => {
    render(<RegionalSummary compact />);

    await waitFor(() => expect(screen.getByText('20/23')).toBeTruthy());
    expect(screen.getByText('Excluded')).toBeTruthy();
    expect(screen.getByText('Runs')).toBeTruthy();
  });

  // Compact must omit, never summarise. A condensed aggregate the full view
  // never showed would be a number this project could not source.
  it('omits the TCHP scatter plot in compact mode', async () => {
    render(<RegionalSummary compact />);

    await waitFor(() => expect(screen.getByText('20/23')).toBeTruthy());
    expect(screen.queryByText(/FLOAT-DERIVED TCHP vs INCOIS TCHP PRODUCT/i)).toBeNull();
  });

  it('omits the per-depth bias charts in compact mode', async () => {
    render(<RegionalSummary compact />);

    await waitFor(() => expect(screen.getByText('20/23')).toBeTruthy());
    expect(screen.queryByText('BIAS VS DEPTH — °C')).toBeNull();
    expect(screen.queryByText('BIAS VS DEPTH — PSU')).toBeNull();
  });

  it('still reports the backend as unavailable rather than showing nothing', async () => {
    getArgoMatchupSummary.mockResolvedValue(null);
    render(<RegionalSummary compact />);

    const status = await screen.findByRole('status');
    expect(status.textContent).toMatch(/NOTHING IS FABRICATED/i);
  });

  it('still reports unavailable in compact mode when every cell is masked', async () => {
    getArgoMatchupSummary.mockResolvedValue(
      makeSummary({
        byModelDepth: [],
        overall: {
          temperature: { n: 0, bias: null, mae: null, rmse: null },
          salinity: { n: 0, bias: null, mae: null, rmse: null },
        },
      })
    );
    render(<RegionalSummary compact />);

    await waitFor(() => expect(screen.getByText('20/23')).toBeTruthy());
    expect(screen.getAllByText(/NO PER-DEPTH BIAS AVAILABLE/).length).toBeGreaterThan(0);
  });
});