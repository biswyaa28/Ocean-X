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