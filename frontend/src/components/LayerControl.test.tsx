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
    ['REAL SOURCE — INGESTION PENDING', 'REAL SOURCE / PENDING'],
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

  it('preserves Argo real-source pending status when supplied by the backend', () => {
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
    expect(within(argo).getByText('REAL SOURCE / PENDING')).toBeInTheDocument();
  });
});
