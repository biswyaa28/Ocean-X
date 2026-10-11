import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DataInspector, type InspectionData } from './DataInspector';
import type { GISLayer } from '../types/oceanlens';

const layer: GISLayer = {
  id: 'cyclone',
  name: 'Cyclone Track',
  category: 'hazard',
  active: true,
  status: 'REAL',
  description: 'NOAA IBTrACS best track',
  unit: 'kts',
};
import { KPIMetrics } from '../types/oceanlens';

/**
 * Null-observation rendering contract.
 *
 * Now that the backend reports a missing wind/pressure observation as `null`
 * instead of substituting 45.0 kt / 990.0 mb, every UI surface that renders
 * those values must show an explicit "not observed" state. A blank cell reads
 * as a bug; a fabricated number reads as data.
 */

const emptyObservation: InspectionData = {
  latitude: 9.6,
  longitude: 86.5,
  timestamp: '2020-05-15 21:00:00',
  maxWindKts: null,
  centralPressureMb: null,
  distanceToCoastKm: null,
};

describe('DataInspector — null observations', () => {
  it('renders NOT OBSERVED rather than a blank or a fabricated number', () => {
    render(<DataInspector activeLayer={layer} inspection={emptyObservation} onClose={vi.fn()} />);

    const labels = screen.getAllByText('NOT OBSERVED');
    // wind, pressure and distance all report absence.
    expect(labels.length).toBeGreaterThanOrEqual(3);
  });

  it('never renders the old fabricated constants', () => {
    render(<DataInspector activeLayer={layer} inspection={emptyObservation} onClose={vi.fn()} />);
    expect(screen.queryByText(/45 KTS/)).not.toBeInTheDocument();
    expect(screen.queryByText(/990 MB/)).not.toBeInTheDocument();
  });

  it('still renders real values when they exist', () => {
    render(
      <DataInspector
        activeLayer={layer}
        inspection={{
          ...emptyObservation,
          maxWindKts: 61.3,
          centralPressureMb: 985,
          distanceToCoastKm: 563,
        }}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText(/61\.3 KTS/)).toBeInTheDocument();
    expect(screen.getByText(/985 MB/)).toBeInTheDocument();
    expect(screen.getByText(/563 KM/)).toBeInTheDocument();
    expect(screen.queryByText('NOT OBSERVED')).not.toBeInTheDocument();
  });
});

describe('KPIMetrics — unavailable coastal risk', () => {
  const baseMetrics: KPIMetrics = {
    activeCyclones: 1,
    maxWindKts: null,
    maxWaveHeightM: null,
    avgSSTC: null,
    coastalRiskLevel: null,
    coastalRiskUnavailableReason: 'No real INCOIS HYCOM model data loaded.',
    dataConfidencePct: 92,
    forecastConfidencePct: 92,
  };

  it('permits a null risk level and a null wind', () => {
    // Type-level guarantee: these are the states the app must be able to hold.
    const m: KPIMetrics = baseMetrics;
    expect(m.coastalRiskLevel).toBeNull();
    expect(m.maxWindKts).toBeNull();
  });

  it('carries a human-readable reason so UNAVAILABLE is explainable', () => {
    expect(baseMetrics.coastalRiskUnavailableReason).toBeTruthy();
  });
});