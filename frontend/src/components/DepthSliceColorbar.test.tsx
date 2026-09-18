import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { DepthSliceColorbar, formatColorbarValue } from './DepthSliceColorbar';
import { getPaletteForVariable, paletteCssGradient } from '../utils/scientificPalettes';
import { DepthSliceScale } from '../utils/depthSliceViz';

const classic = getPaletteForVariable('temperature', 'classic');

function renderBar(overrides: Partial<React.ComponentProps<typeof DepthSliceColorbar>> = {}) {
  const props: React.ComponentProps<typeof DepthSliceColorbar> = {
    palette: classic,
    rangeMin: 19,
    rangeMax: 21,
    scale: 'linear' as DepthSliceScale,
    units: '°C',
    variableLabel: 'Temperature',
    isAutoRange: false,
    ...overrides,
  };
  return render(<DepthSliceColorbar {...props} />);
}

describe('formatColorbarValue', () => {
  it('formats small values with two decimals and large values compactly', () => {
    expect(formatColorbarValue(0.1234)).toBe('0.12');
    expect(formatColorbarValue(19.567)).toBe('19.57');
    expect(formatColorbarValue(123.456)).toBe('123.5');
    expect(formatColorbarValue(1234.56)).toBe('1235');
  });
});

describe('DepthSliceColorbar — legend/colorbar synchronization', () => {
  it('renders the palette gradient as its color scale', () => {
    const { container } = renderBar();
    const bar = container.querySelector('[data-testid="depth-slice-colorbar-gradient"]') as HTMLElement;
    expect(bar).toBeTruthy();
    expect(bar.style.background).toContain(paletteCssGradient(classic).slice(0, 30));
  });

  it('labels the configured min and max (custom range reflected)', () => {
    renderBar({ rangeMin: 19, rangeMax: 21 });
    expect(screen.getByText(/19\.00/)).toBeInTheDocument();
    expect(screen.getByText(/21\.00/)).toBeInTheDocument();
  });

  it('mid label is the arithmetic mean on linear scale', () => {
    renderBar({ rangeMin: 19, rangeMax: 21 });
    expect(screen.getByText(/20\.00/)).toBeInTheDocument();
  });

  it('mid label is the geometric mean on log scale', () => {
    renderBar({ rangeMin: 1, rangeMax: 100, scale: 'log' });
    expect(screen.getByText(/10\.00/)).toBeInTheDocument(); // sqrt(1*100)
  });

  it('shows the active scale explicitly', () => {
    const { rerender } = renderBar({ scale: 'linear' });
    expect(screen.getByText(/LINEAR/i)).toBeInTheDocument();
    rerender(
      <DepthSliceColorbar
        palette={classic}
        rangeMin={1}
        rangeMax={100}
        scale="log"
        units="PSU"
        variableLabel="Salinity"
        isAutoRange={false}
      />
    );
    expect(screen.getByText(/LOG/i)).toBeInTheDocument();
  });

  it('shows variable, units, matched depth and timestamp', () => {
    renderBar({
      units: 'PSU',
      variableLabel: 'Salinity',
      matchedDepthM: 100,
      timestamp: '2026-09-07T12:00:00.000000000',
    });
    expect(screen.getByText(/Salinity/i)).toBeInTheDocument();
    expect(screen.getByText(/PSU/i)).toBeInTheDocument();
    expect(screen.getByText(/100 m/i)).toBeInTheDocument();
    expect(screen.getByText(/2026-09-07 12:00/i)).toBeInTheDocument();
  });

  it('marks whether the range is auto-derived from data or user-configured', () => {
    renderBar({ isAutoRange: true });
    expect(screen.getByText(/AUTO/i)).toBeInTheDocument();
    renderBar({ isAutoRange: false });
    expect(screen.getByText(/CUSTOM/i)).toBeInTheDocument();
  });

  it('declares that the range affects display only (never the source data)', () => {
    renderBar();
    expect(screen.getByText(/display range only/i)).toBeInTheDocument();
  });
});
