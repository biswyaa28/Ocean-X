import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DataInspector, type InspectionData } from './DataInspector';
import type { GISLayer } from '../types/oceanlens';

/**
 * Close-button contract.
 *
 * The panel is a persistent instrument with a real empty state, so "close"
 * means "clear the current inspection", not "dismiss the panel". The caller
 * wires onClose to setInspectionData(null); without a button to press, that
 * callback was dead and the only way back to the empty state was to pick
 * another point.
 */

const layer: GISLayer = {
  id: 'currents',
  name: 'Ocean Currents',
  category: 'physical',
  active: true,
  status: 'REAL',
  description: 'INCOIS RSMC HYCOM',
  unit: 'm/s',
};

const selection: InspectionData = {
  latitude: 18.2247,
  longitude: 88.4,
  timestamp: '2026-10-08 18:00 UTC',
  currentSpeedMS: 0.15,
};

describe('DataInspector — close button', () => {
  it('offers a close button when there is a selection to clear', () => {
    render(
      <DataInspector
        activeLayer={layer}
        inspection={selection}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: /clear inspection/i })).toBeTruthy();
  });

  it('calls onClose when the button is pressed', () => {
    const onClose = vi.fn();
    render(
      <DataInspector
        activeLayer={layer}
        inspection={selection}
        onClose={onClose}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /clear inspection/i }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // Nothing to clear, so nothing to offer.
  it('hides the button when there is no selection', () => {
    render(
      <DataInspector activeLayer={layer} inspection={null} onClose={vi.fn()} />
    );

    expect(screen.getByText(/INSPECTOR READY/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /clear inspection/i })).toBeNull();
  });

  // onClose is optional, so the panel must still work without it.
  it('renders without a close button when onClose is omitted', () => {
    render(<DataInspector activeLayer={layer} inspection={selection} />);

    expect(screen.queryByRole('button', { name: /clear inspection/i })).toBeNull();
  });

  it('is reachable and operable from the keyboard', () => {
    const onClose = vi.fn();
    render(
      <DataInspector
        activeLayer={layer}
        inspection={selection}
        onClose={onClose}
      />
    );

    const button = screen.getByRole('button', { name: /clear inspection/i });
    button.focus();
    expect(document.activeElement).toBe(button);

    fireEvent.click(button); // native buttons activate on Enter/Space
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
/**
 * Badge honesty contract.
 *
 * The badge is driven by the `dataStatus` the backend reported, not by
 * `status === 'NO_REAL_MODEL_DATA'` alone. Three different backend situations
 * share that status, and rendering all of them as "REAL DATASET — TIMESTAMP
 * UNAVAILABLE" claimed a real dataset was present when none was, including in
 * FIXTURE mode. An unrecognised status must also never fall through to REAL.
 */
describe('DataInspector — data status badge', () => {
  const base: InspectionData = {
    latitude: 18.2247,
    longitude: 88.4,
    timestamp: '2026-10-08 18:00 UTC',
  };

  const renderWith = (inspection: Partial<InspectionData>, layerStatus: GISLayer['status'] = 'REAL') =>
    render(
      <DataInspector
        activeLayer={{ ...layer, status: layerStatus }}
        inspection={{ ...base, ...inspection }}
        onClose={vi.fn()}
      />
    );

  it('says so plainly when no model data is available, never "REAL DATASET"', () => {
    // backend inspect_point "no dataset installed", REAL mode
    renderWith({ status: 'NO_REAL_MODEL_DATA', dataStatus: 'NOT CURRENTLY INTEGRATED' });
    expect(screen.getAllByText('NOT CURRENTLY INTEGRATED').length).toBeGreaterThan(0);
    expect(screen.queryByText('REAL DATASET — TIMESTAMP UNAVAILABLE')).toBeNull();
  });

  it('shows the simulated state when no model data is available in FIXTURE mode', () => {
    renderWith({ status: 'NO_REAL_MODEL_DATA', dataStatus: 'SIMULATED' }, 'SIMULATED');
    expect(screen.getAllByText('SIMULATED').length).toBeGreaterThan(0);
    expect(screen.queryByText('REAL DATASET — TIMESTAMP UNAVAILABLE')).toBeNull();
  });

  it('reports a simulated dataset as simulated, not real, when the timestamp is unavailable', () => {
    renderWith({
      status: 'NO_REAL_MODEL_DATA',
      dataStatus: 'SIMULATED DATASET — TIMESTAMP UNAVAILABLE',
    });
    expect(
      screen.getAllByText('SIMULATED DATASET — TIMESTAMP UNAVAILABLE').length
    ).toBeGreaterThan(0);
    expect(screen.queryByText('REAL DATASET — TIMESTAMP UNAVAILABLE')).toBeNull();
  });

  it('still reports a real dataset with an unavailable timestamp as real', () => {
    renderWith({
      status: 'NO_REAL_MODEL_DATA',
      dataStatus: 'REAL DATASET — TIMESTAMP UNAVAILABLE',
    });
    expect(
      screen.getAllByText('REAL DATASET — TIMESTAMP UNAVAILABLE').length
    ).toBeGreaterThan(0);
  });

  it('shows REAL for a successful reading', () => {
    renderWith({ status: 'OK', currentSpeedMS: 0.15 });
    expect(screen.getAllByText('REAL').length).toBeGreaterThan(0);
  });

  it('never falls through to REAL for a status it does not recognise', () => {
    renderWith({ status: 'INSPECT_FAILED' });
    expect(screen.queryByText('REAL')).toBeNull();
    expect(screen.getAllByText('UNKNOWN STATUS').length).toBeGreaterThan(0);
  });

  it('never renders REAL DATASET for an unrecognised status', () => {
    renderWith({ status: 'SOMETHING_NEW', dataStatus: 'BRAND_NEW_STATUS' as never });
    expect(screen.queryByText('REAL')).toBeNull();
    expect(screen.queryByText('REAL DATASET — TIMESTAMP UNAVAILABLE')).toBeNull();
  });
});
