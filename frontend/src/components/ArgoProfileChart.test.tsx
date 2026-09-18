import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import type { ArgoObservationPoint } from '../types/oceanlens';
import { normalizeArgoMatchupComparisons, normalizeArgoObservations } from '../utils/argoProfileViz';
import { ArgoProfileChart } from './ArgoProfileChart';

/**
 * Phase 1D Argo observation profile chart tests.
 *
 * Assertions target the NORMALIZED CHART DATA rendered into the Recharts SVG
 * (dot elements, axis tick geometry) — never screenshots. Fixture values are
 * synthetic shapes, not real scientific data.
 */

function obs(
  depth: number,
  temperature?: number | null,
  salinity?: number | null
): ArgoObservationPoint {
  return {
    depth_m: depth,
    pressure_dbar: depth + 0.5,
    temperature_c: temperature,
    salinity_psu: salinity,
    temp_qc: 1,
    psal_qc: 1,
  };
}

function renderChart(observations: ArgoObservationPoint[]) {
  const normalized = normalizeArgoObservations(observations);
  return render(<ArgoProfileChart normalized={normalized} />);
}

function renderComparison() {
  const normalized = normalizeArgoMatchupComparisons([
    {
      depthM: 0,
      argoTemperatureC: 29.8,
      modelTemperatureC: 29.4,
      matchedModelDepthM: 0,
      argoSalinityPSU: 32.8,
      modelSalinityPSU: 32.9,
    },
    {
      depthM: 50,
      argoTemperatureC: 27.6,
      modelTemperatureC: 27.2,
      matchedModelDepthM: 49.5,
      argoSalinityPSU: 34,
      modelSalinityPSU: 34.1,
    },
  ]);
  return render(<ArgoProfileChart normalized={normalizeArgoObservations([])} comparison={normalized} />);
}

/** All Y-axis (depth) tick labels with their SVG y coordinate (screen geometry). */
function yAxisTicks(container: HTMLElement, chartIndex = 0) {
  const charts = container.querySelectorAll('.recharts-wrapper');
  const chart = charts[chartIndex];
  expect(chart).toBeTruthy();
  // Recharts renders tick labels in a dedicated labels group per axis.
  const ticks = Array.from(
    chart.querySelectorAll('.recharts-yAxis-tick-labels .recharts-cartesian-axis-tick-value')
  );
  return ticks.map((t) => ({
    text: (t.textContent || '').trim(),
    y: Number((t as SVGElement).getAttribute('y')),
  }));
}

describe('ArgoProfileChart — available data', () => {
  it('renders a Recharts temperature profile with labeled quantity axes', () => {
    const { container } = renderChart([obs(0, 29.85, 32.84), obs(50, 27.6, 34.05)]);
    expect(container.querySelectorAll('.recharts-surface').length).toBeGreaterThan(0);
    expect(screen.getByText(/TEMPERATURE \(°C\)/i)).toBeInTheDocument();
    // Both variable panels carry a depth axis.
    expect(screen.getAllByText(/DEPTH \(M\)/i).length).toBe(2);
  });

  it('renders one chart dot per valid temperature observation (nulls leave gaps)', () => {
    const { container } = renderChart([
      obs(0, 29.85, 32.84),
      obs(10, 29.8, 32.86),
      obs(25, null, 33.12), // missing temperature: no dot, no fabricated value
      obs(50, 27.6, 34.05),
      obs(75, 24.1, 34.62),
    ]);
    const charts = container.querySelectorAll('.recharts-wrapper');
    // Panel order: temperature first, salinity second.
    const tempDots = charts[0].querySelectorAll('.recharts-dot');
    expect(tempDots.length).toBe(4);
    const salDots = charts[1].querySelectorAll('.recharts-dot');
    expect(salDots.length).toBe(5);
    // The missing level stays a visible GAP: the temperature profile renders
    // as two disconnected line curves, never a bridge across the null.
    expect(charts[0].querySelectorAll('.recharts-line-curve').length).toBe(2);
    // Salinity has no gaps: a single connected curve.
    expect(charts[1].querySelectorAll('.recharts-line-curve').length).toBe(1);
  });

  it('renders temperature and salinity panels when both variables are available', () => {
    renderChart([obs(0, 29.85, 32.84), obs(50, 27.6, 34.05)]);
    expect(screen.getByText(/SALINITY \(PSU\)/i)).toBeInTheDocument();
  });
});

describe('ArgoProfileChart — explicit unavailable states', () => {
  it('shows an explicit unavailable state when salinity is missing (never fabricated)', () => {
    const { container } = renderChart([obs(0, 29.85, undefined), obs(50, 27.6, null)]);
    expect(screen.getByText(/SALINITY UNAVAILABLE/i)).toBeInTheDocument();
    // Only the temperature chart is rendered.
    expect(container.querySelectorAll('.recharts-wrapper')).toHaveLength(1);
  });

  it('shows an explicit unavailable state when temperature is missing', () => {
    const { container } = renderChart([obs(0, undefined, 32.84), obs(50, null, 34.05)]);
    expect(screen.getByText(/TEMPERATURE UNAVAILABLE/i)).toBeInTheDocument();
    expect(container.querySelectorAll('.recharts-wrapper')).toHaveLength(1);
  });

  it('shows unavailable states for both variables on an empty profile', () => {
    const { container } = renderChart([]);
    expect(screen.getByText(/TEMPERATURE UNAVAILABLE/i)).toBeInTheDocument();
    expect(screen.getByText(/SALINITY UNAVAILABLE/i)).toBeInTheDocument();
    expect(container.querySelectorAll('.recharts-wrapper')).toHaveLength(0);
  });
});

describe('ArgoProfileChart — scientific depth orientation', () => {
  it('places depth 0 at the TOP and the deepest level at the BOTTOM (depth increases downward)', () => {
    const { container } = renderChart([
      obs(0, 29.85, 32.84),
      obs(250, 12.8, 35.02),
      obs(500, 8.95, 35.08),
    ]);
    const ticks = yAxisTicks(container, 0);
    const surface = ticks.find((t) => t.text === '0');
    const bottom = ticks.find((t) => t.text === '500');
    expect(surface).toBeDefined();
    expect(bottom).toBeDefined();
    // Smaller SVG y coordinate = higher on screen. Depth 0 must be ABOVE 500 m.
    expect(surface!.y).toBeLessThan(bottom!.y);
  });

  it('uses the source-provided depth values without transformation (ticks show real depths)', () => {
    const { container } = renderChart([
      obs(0, 29.85, 32.84),
      obs(10, 29.8, 32.86),
      obs(100, 21.3, 34.88),
      obs(200, 15.4, 34.96),
    ]);
    const ticks = yAxisTicks(container, 0).map((t) => t.text);
    expect(ticks).toContain('0');
    expect(ticks).toContain('200');
  });

  it('orients the salinity panel identically (depth increases downward)', () => {
    const { container } = renderChart([obs(0, 29.85, 32.84), obs(500, 8.95, 35.08)]);
    const ticks = yAxisTicks(container, 1); // salinity panel
    const surface = ticks.find((t) => t.text === '0');
    const bottom = ticks.find((t) => t.text === '500');
    expect(surface!.y).toBeLessThan(bottom!.y);
  });
});

describe('ArgoProfileChart — robustness', () => {
  it('renders a single-observation (single-depth) profile', () => {
    const { container } = renderChart([obs(500, 8.95, 35.08)]);
    expect(container.querySelectorAll('.recharts-wrapper').length).toBe(2);
    expect(container.querySelectorAll('.recharts-dot').length).toBe(2);
  });

  describe('ArgoProfileChart — model comparison', () => {
    it('renders explicitly labeled Argo and native HYCOM series for temperature and salinity', () => {
      const { container } = renderComparison();

      expect(screen.getAllByText(/ARGO OBSERVATION/i).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/HYCOM MODEL/i).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/PROFILE COMPARISON/i)).toHaveLength(2);
      expect(screen.getAllByText(/NO INTERPOLATION/i)).toHaveLength(2);
      expect(container.querySelectorAll('.recharts-wrapper')).toHaveLength(2);
    });

    it('shows an explicit unavailable state when matchup salinity is not available from both sources', () => {
      const comparison = normalizeArgoMatchupComparisons([
        {
          depthM: 0,
          argoTemperatureC: 29.8,
          modelTemperatureC: 29.4,
          matchedModelDepthM: 0,
          argoSalinityPSU: null,
          modelSalinityPSU: null,
        },
      ]);
      render(
        <ArgoProfileChart
          normalized={normalizeArgoObservations([])}
          comparison={comparison}
        />
      );

      expect(screen.getByText(/SALINITY COMPARISON UNAVAILABLE/i)).toBeInTheDocument();
    });
  });

  it('renders a deep profile (2000 m) with the full depth range on the axis', () => {
    const { container } = renderChart([
      obs(0, 30.0, 32.8),
      obs(500, 8.95, 35.08),
      obs(2000, 2.2, 34.7),
    ]);
    const ticks = yAxisTicks(container, 0).map((t) => t.text);
    expect(ticks).toContain('2000');
  });

  it('renders a shallow profile (single meters) without errors', () => {
    const { container } = renderChart([obs(0, 30.1, 31.4), obs(2.5, 30.0, 31.5)]);
    expect(container.querySelectorAll('.recharts-wrapper').length).toBe(2);
  });
});
