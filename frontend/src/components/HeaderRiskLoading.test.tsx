import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Header } from './Header';
import type { KPIMetrics, AppMode, OceanMode, DataStatus } from '../types/oceanlens';

/**
 * The header risk chip had two states when it needed three.
 *
 * While a score was in flight the derived assessment was null, so the chip
 * rendered "UNAVAILABLE — No risk assessment received from the backend." The
 * backend had not declined anything; it had not answered yet. Reporting an
 * in-flight request as an unavailable one is a state the backend never sent,
 * and this panel's whole contract is to report only states it can source.
 */

const metrics: KPIMetrics = {
  activeCyclones: 1,
  maxWindKts: 61.3,
  maxWaveHeightM: 6.7,
  avgSSTC: 29.4,
  coastalRiskLevel: null,
  coastalRiskScore: null,
  coastalRiskWeights: null,
  coastalRiskUnavailableReason: null,
  coastalRiskLoading: true,
  dataConfidencePct: 92,
  forecastConfidencePct: 92,
};

const baseProps = {
  mode: 'OPERATIONS' as AppMode,
  oceanMode: 'HISTORICAL' as OceanMode,
  dataStatus: 'REAL' as DataStatus,
  backendConnected: true,
  onToggleLayers: () => {},
  onModeChange: () => {},
  onOceanModeChange: () => {},
};

describe('Header risk chip — in-flight state', () => {
  it('says the score is being fetched rather than unavailable', () => {
    render(<Header {...baseProps} metrics={metrics} />);

    expect(screen.getByText('SCORING…')).toBeInTheDocument();
    expect(screen.queryByText('UNAVAILABLE')).not.toBeInTheDocument();
  });

  it('does not invent a band or score while loading', () => {
    render(<Header {...baseProps} metrics={metrics} />);

    ['HIGH', 'CRITICAL', 'ELEVATED', 'MODERATE', 'LOW'].forEach((band) => {
      expect(screen.queryAllByText(band).length).toBe(0);
    });
    expect(screen.queryByText(/\d+\/100/)).not.toBeInTheDocument();
  });

  it('reports loading through the tooltip too', () => {
    render(<Header {...baseProps} metrics={metrics} />);

    expect(screen.getAllByTitle(/has not answered yet/i).length).toBeGreaterThan(0);
  });

  it('still reports a real unavailability when the backend has declined', () => {
    render(
      <Header
        {...baseProps}
        metrics={{
          ...metrics,
          coastalRiskLoading: false,
          coastalRiskUnavailableReason: 'No real INCOIS HYCOM model data loaded.',
        }}
      />
    );

    expect(screen.getByText('UNAVAILABLE')).toBeInTheDocument();
    expect(screen.queryByText('SCORING…')).not.toBeInTheDocument();
  });

  it('shows the band once a score has arrived', () => {
    render(
      <Header
        {...baseProps}
        metrics={{
          ...metrics,
          coastalRiskLoading: false,
          coastalRiskLevel: 'HIGH',
          coastalRiskScore: 61,
        }}
      />
    );

    // The band and the score render in one node, as the suite asserts elsewhere.
    expect(screen.getByText(/HIGH 61\/100/)).toBeInTheDocument();
    expect(screen.queryByText('SCORING…')).not.toBeInTheDocument();
  });
});