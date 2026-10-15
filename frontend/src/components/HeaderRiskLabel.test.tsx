import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Header } from './Header';
import type { KPIMetrics, AppMode, OceanMode, DataStatus } from '../types/oceanlens';

/**
 * The coastal-risk figure in the header comes from an unvalidated demo
 * heuristic. It must be labelled as such wherever it appears, and it must
 * never display a substituted band or number.
 */

const weights = {
  windMaxPoints: 45,
  windSaturatesAtKts: 140,
  distanceMaxPoints: 30,
  distanceFloorPoints: 5,
  distanceScaleKm: 800,
  tchpMaxPoints: 15,
  tchpSaturatesAtKJPerCm2: 100,
  sstMaxPoints: 10,
  sstThresholdC: 26,
  sstSpanC: 5,
  scoreClampMin: 10,
  scoreClampMax: 98,
};

const metrics: KPIMetrics = {
  activeCyclones: 1,
  maxWindKts: 61.3,
  maxWaveHeightM: 6.7,
  avgSSTC: 29.4,
  coastalRiskLevel: 'ELEVATED',
  coastalRiskScore: 48,
  coastalRiskWeights: weights,
  coastalRiskUnavailableReason: null,
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
    expect(screen.getByText(/HEURISTIC DEMO, NOT VALIDATED/i)).toBeInTheDocument();
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
          coastalRiskScore: null,
          coastalRiskWeights: null,
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
          coastalRiskScore: null,
          coastalRiskWeights: null,
          coastalRiskUnavailableReason: 'No real INCOIS HYCOM model data loaded.',
        }}
      />
    );
    // The reason reaches the UI verbatim via the tooltip.
    const withReason = screen.getAllByTitle(/No real INCOIS HYCOM model data loaded\./);
    expect(withReason.length).toBeGreaterThan(0);
  });

  it('lists the backend weights in the tooltip when a score exists', () => {
    render(<Header {...baseProps} metrics={metrics} />);
    const tooltips = screen.getAllByTitle(/Unvalidated heuristic demo score/);
    expect(tooltips.length).toBeGreaterThan(0);
    const text = tooltips[0].getAttribute('title') ?? '';
    expect(text).toMatch(/windMaxPoints = 45/);
    expect(text).toMatch(/windSaturatesAtKts = 140/);
    expect(text).toMatch(/distanceScaleKm = 800/);
  });

  it('shows the backend score alongside the band', () => {
    render(<Header {...baseProps} metrics={metrics} />);
    expect(screen.getByText(/ELEVATED 48\/100/)).toBeInTheDocument();
  });
});