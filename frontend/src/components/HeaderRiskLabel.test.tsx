import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Header } from './Header';
import type { KPIMetrics, AppMode, OceanMode, DataStatus } from '../types/oceanlens';

/**
 * The coastal-risk figure in the header comes from an unvalidated demo
 * heuristic. It must be labelled as such wherever it appears, and it must
 * never display a substituted band or number.
 */

const metrics: KPIMetrics = {
  activeCyclones: 1,
  maxWindKts: 61.3,
  maxWaveHeightM: 6.7,
  avgSSTC: 29.4,
  coastalRiskLevel: 'ELEVATED',
  dataConfidencePct: 92,
  forecastConfidencePct: 92,
};

const baseProps = {
  mode: 'OPERATIONS' as AppMode,
  onModeChange: vi.fn(),
  oceanMode: 'HISTORICAL' as OceanMode,
  onOceanModeChange: vi.fn(),
  dataStatus: 'REAL' as DataStatus,
  backendConnected: true,
};

describe('Header — unvalidated risk labelling', () => {
  it('labels the risk figure as an unvalidated demo heuristic', () => {
    render(<Header {...baseProps} metrics={metrics} />);
    expect(screen.getByText(/DEMO · NOT VALIDATED/i)).toBeInTheDocument();
  });

  it('shows the observed wind rather than a default', () => {
    render(<Header {...baseProps} metrics={metrics} />);
    expect(screen.getByText(/61\.3 KT/)).toBeInTheDocument();
  });

  it('shows NOT OBSERVED when the wind observation is absent', () => {
    render(
      <Header
        {...baseProps}
        metrics={{ ...metrics, maxWindKts: null, maxWaveHeightM: null }}
      />
    );
    expect(screen.getByText('NOT OBSERVED')).toBeInTheDocument();
    expect(screen.queryByText(/KT$/)).not.toBeInTheDocument();
  });

  it('shows UNAVAILABLE when the heuristic declined to score', () => {
    render(
      <Header
        {...baseProps}
        metrics={{
          ...metrics,
          coastalRiskLevel: null,
          coastalRiskUnavailableReason: 'No real INCOIS HYCOM model data loaded.',
        }}
      />
    );
    expect(screen.getByText('UNAVAILABLE')).toBeInTheDocument();
    // Never fall back to a plausible band.
    expect(screen.queryByText('HIGH')).not.toBeInTheDocument();
    expect(screen.queryByText('CRITICAL')).not.toBeInTheDocument();
  });

  it('explains the unavailability via a tooltip', () => {
    render(
      <Header
        {...baseProps}
        metrics={{
          ...metrics,
          coastalRiskLevel: null,
          coastalRiskUnavailableReason: 'No real INCOIS HYCOM model data loaded.',
        }}
      />
    );
    expect(
      screen.getByTitle('No real INCOIS HYCOM model data loaded.')
    ).toBeInTheDocument();
  });
});