import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { LayerControl } from './LayerControl';
import { DataStatus } from '../types/oceanlens';

describe('LayerControl live provenance labels', () => {
  const renderLayerControl = (layers: Parameters<typeof LayerControl>[0]['layers']) =>
    render(<LayerControl layers={layers} onToggleLayer={vi.fn()} />);

  it('uses the supplied layer status instead of claiming REAL for simulated data', () => {
    render(
      <LayerControl
        layers={[
          {
            id: 'currents',
            name: 'Ocean Currents',
            category: 'physical',
            active: true,
            status: 'SIMULATED',
            description: 'Synthetic fallback',
            unit: 'm/s',
          },
        ]}
        onToggleLayer={vi.fn()}
      />
    );

    const currents = screen.getByRole('button', { name: /Ocean Currents/i });
    expect(within(currents).getByText('SIMULATED')).toBeInTheDocument();
    expect(within(currents).queryByText('REAL')).not.toBeInTheDocument();
  });

  it.each([
    ['REAL', 'REAL'],
    ['SIMULATED', 'SIMULATED'],
    ['NOT CURRENTLY INTEGRATED', 'NOT CURRENTLY INTEGRATED'],
    ['REAL SOURCE — INGESTION PENDING', 'REAL · GDAC'],
  ])('preserves backend %s status over the hardcoded default', (status, expectedBadge) => {
    render(
      <LayerControl
        layers={[{
          id: 'sst',
          name: 'Sea Surface Temperature',
          category: 'physical',
          active: false,
          status: status as DataStatus,
          description: 'Backend status',
          unit: '°C',
        }]}
        onToggleLayer={vi.fn()}
      />
    );

    const sst = screen.getByRole('button', { name: /Sea Surface Temperature/i });
    expect(within(sst).getByText(expectedBadge)).toBeInTheDocument();
    if (status === 'NOT CURRENTLY INTEGRATED') {
      expect(within(sst).queryByText('REAL')).not.toBeInTheDocument();
    }
  });

  it('does not claim REAL when a HYCOM layer is absent from the backend response', () => {
    renderLayerControl([]);

    const currents = screen.getByRole('button', { name: /Ocean Currents/i });
    expect(within(currents).queryByText('REAL')).not.toBeInTheDocument();
    expect(within(currents).getByText('NOT CURRENTLY INTEGRATED')).toBeInTheDocument();
  });

  it('does not claim REAL for any HYCOM layer when the backend layer array is empty', () => {
    renderLayerControl([]);

    for (const name of [
      'Ocean Currents',
      'Sea Surface Temperature',
      'Sea Surface Salinity',
      'Tropical Cyclone Heat Potential',
    ]) {
      const layer = screen.getByRole('button', { name: new RegExp(name, 'i') });
      expect(within(layer).queryByText('REAL')).not.toBeInTheDocument();
      expect(within(layer).getByText('NOT CURRENTLY INTEGRATED')).toBeInTheDocument();
    }
  });

  it('does not replace an absent backend layer with demo-provider data', () => {
    renderLayerControl([]);

    const currents = screen.getByRole('button', { name: /Ocean Currents/i });
    expect(within(currents).queryByText('SIMULATED')).not.toBeInTheDocument();
    expect(within(currents).getByText('NOT CURRENTLY INTEGRATED')).toBeInTheDocument();
  });

  it('shows real Argo state (REAL · GDAC) when supplied by the backend', () => {
    renderLayerControl([{
      id: 'argo',
      name: 'Argo Observations',
      category: 'physical',
      active: true,
      status: 'REAL SOURCE — INGESTION PENDING',
      description: 'Backend Argo status',
      unit: 'IN-SITU',
    }]);

    const argo = screen.getByRole('button', { name: /Argo Observations/i });
    expect(within(argo).getByText('REAL · GDAC')).toBeInTheDocument();
  });

  it('derives REAL status for Cyclone Track when IBTrACS cyclone data is loaded', () => {
    render(
      <LayerControl
        layers={[]}
        onToggleLayer={vi.fn()}
        cyclone={{
          id: 'AMPHAN',
          name: 'AMPHAN',
          basin: 'NI',
          dataStatus: 'REAL',
          currentTrackIndex: 0,
          track: [{
            id: 'pt-1',
            timestamp: '2020-05-18T00:00:00Z',
            latitude: 15.0,
            longitude: 88.0,
            maxWindKts: 120,
            centralPressureMb: 920,
          } as any],
          forecastCone: [],
          windRadius: { r34ktsKm: null, r50ktsKm: null, r64ktsKm: null, source: null },
          dataCompleteness: { trackPoints: 1, withWind: 1, withPressure: 1 },
          sourceAttribution: 'NOAA IBTrACS',
        }}
      />
    );

    const cyclone = screen.getByRole('button', { name: /Cyclone Track/i });
    expect(within(cyclone).getByText('REAL')).toBeInTheDocument();
    expect(within(cyclone).queryByText('NOT CURRENTLY INTEGRATED')).not.toBeInTheDocument();
  });

  it('hides empty layer rows that are not currently integrated (Coastal Risk, Storm Surge, Chlorophyll, Rainfall)', () => {
    renderLayerControl([]);

    expect(screen.queryByRole('button', { name: /Coastal Risk/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Storm Surge/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Chlorophyll-a/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Rainfall/i })).not.toBeInTheDocument();
    expect(screen.queryByText('ATMOSPHERE')).not.toBeInTheDocument();
  });
});
