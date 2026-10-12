/**
 * Phase 3 — Data mode banner / indicator tests.
 *
 * Verifies that the Header component correctly renders the global
 * data-mode indicator for REAL and FIXTURE modes, and that the
 * synthetic-fixture warning is never silently suppressed.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { Header } from '../components/Header';
import type { Cyclone } from '../types/oceanlens';

// Minimal props that satisfy the Header contract
const BASE_PROPS = {
  mode: 'OPERATIONS' as const,
  onModeChange: vi.fn(),
  oceanMode: 'HISTORICAL' as const,
  onOceanModeChange: vi.fn(),
  dataStatus: 'REAL' as const,
  backendConnected: true,
  metrics: null,
  datasetLoaded: true,
};

describe('Header data-mode indicator (Phase 3)', () => {
  it('renders DATA: REAL indicator when dataMode=REAL and datasetSynthetic=false', () => {
    render(
      <Header
        {...BASE_PROPS}
        dataMode="REAL"
        datasetSynthetic={false}
      />
    );
    const indicator = screen.getByTitle(/production HYCOM dataset/i);
    expect(indicator).toBeTruthy();
    expect(indicator.textContent).toMatch(/DATA:\s*REAL/i);
    // Must NOT show the fixture warning
    expect(indicator.textContent).not.toMatch(/FIXTURE/i);
    expect(indicator.textContent).not.toMatch(/SYNTHETIC/i);
  });

  it('renders synthetic fixture warning when dataMode=FIXTURE', () => {
    render(
      <Header
        {...BASE_PROPS}
        dataMode="FIXTURE"
        datasetSynthetic={true}
      />
    );
    const indicator = screen.getByTitle(/FIXTURE mode/i);
    expect(indicator).toBeTruthy();
    expect(indicator.textContent).toMatch(/SYNTHETIC FIXTURE/i);
    expect(indicator.textContent).toMatch(/NOT SCIENTIFIC EVIDENCE/i);
    // Must NOT show plain DATA: REAL
    expect(indicator.textContent).not.toBe('DATA: REAL');
  });

  it('renders synthetic fixture warning when only datasetSynthetic=true', () => {
    render(
      <Header
        {...BASE_PROPS}
        dataMode="REAL"
        datasetSynthetic={true}
      />
    );
    const indicator = screen.getByTitle(/FIXTURE mode/i);
    expect(indicator.textContent).toMatch(/SYNTHETIC FIXTURE/i);
  });

  it('does not claim real LIVE data when the model has no time range', () => {
    render(
      <Header
        {...BASE_PROPS}
        oceanMode="LIVE"
        metrics={null}
        dataMode="REAL"
        datasetSynthetic={false}
      />
    );
    // No dataset range supplied: the ribbon says so rather than implying real data.
    expect(screen.getByText(/LIVE OCEAN · NO MODEL TIME RANGE AVAILABLE/i)).toBeInTheDocument();
    expect(screen.getByText('UNAVAILABLE')).toBeInTheDocument();
    expect(screen.queryByText(/REAL INCOIS HYCOM DATA/i)).not.toBeInTheDocument();
  });

  it('reports the real model date range and Argo count in LIVE', () => {
    render(
      <Header
        {...BASE_PROPS}
        oceanMode="LIVE"
        metrics={null}
        dataMode="REAL"
        datasetSynthetic={false}
        modelDateRange={{
          start: '2026-10-07T06:00:00.000000000',
          end: '2026-10-08T18:00:00.000000000',
          steps: 7,
        }}
        argoProfileCount={12}
      />
    );
    // The window is published, and the ribbon says how old the newest of it is.
    expect(screen.getByText('2026-10-07 06:00 UTC → 2026-10-08 18:00 UTC')).toBeInTheDocument();
    expect(screen.getAllByText(/LATEST MODEL RUN ·/).length).toBeGreaterThan(0);
    expect(screen.getByText('12 PROFILES ±5 d')).toBeInTheDocument();
    expect(screen.queryByText(/NO MODEL TIME RANGE AVAILABLE/i)).not.toBeInTheDocument();
  });

  it('names the actual cyclone and year in HISTORICAL REPLAY', () => {
    render(
      <Header
        {...BASE_PROPS}
        oceanMode="HISTORICAL"
        metrics={null}
        dataMode="REAL"
        datasetSynthetic={false}
        cyclone={
          {
            id: '2020136N10088',
            name: 'AMPHAN',
            basin: 'North Indian Ocean',
            dataStatus: 'REAL',
            currentTrackIndex: 28,
            track: [{ timestamp: '2020-05-15T06:00:00Z' }],
            forecastCone: [],
          } as unknown as Cyclone
        }
      />
    );
    expect(screen.getByText(/HISTORICAL REPLAY · AMPHAN \(2020\) · NOAA IBTrACS/i)).toBeInTheDocument();
  });

  it('labels a disconnected demo fallback as non-authoritative instead of REAL', () => {
    render(
      <Header
        {...BASE_PROPS}
        backendConnected={false}
        dataMode="REAL"
        datasetSynthetic={false}
      />
    );
    const indicator = document.getElementById('oceanx-data-mode-indicator');
    expect(indicator?.textContent).toMatch(/DEMO|DISCONNECTED/i);
    expect(indicator?.textContent).toMatch(/NON-AUTHORITATIVE/i);
    expect(indicator?.textContent).not.toMatch(/^DATA:\s*REAL$/i);
  });

  it('indicator has id oceanx-data-mode-indicator for automation', () => {
    render(
      <Header
        {...BASE_PROPS}
        dataMode="REAL"
        datasetSynthetic={false}
      />
    );
    const el = document.getElementById('oceanx-data-mode-indicator');
    expect(el).not.toBeNull();
  });

  it('fixture mode indicator has amber styling (not emerald)', () => {
    const { container } = render(
      <Header
        {...BASE_PROPS}
        dataMode="FIXTURE"
        datasetSynthetic={true}
      />
    );
    const indicator = container.querySelector('#oceanx-data-mode-indicator');
    expect(indicator).not.toBeNull();
    // Should contain amber color class
    const classList = indicator?.className ?? '';
    expect(classList).toMatch(/amber/);
  });

  it('defaults to REAL mode when no dataMode prop provided (no silent fixture)', () => {
    render(<Header {...BASE_PROPS} />);
    const indicator = document.getElementById('oceanx-data-mode-indicator');
    expect(indicator).not.toBeNull();
    // Default must not falsely show fixture warning
    expect(indicator?.textContent).not.toMatch(/FIXTURE/i);
    expect(indicator?.textContent).toMatch(/DATA:\s*REAL/i);
  });
});

/**
 * Live Ocean honesty: the mode may be called LIVE only while the model data
 * actually is. A run that is days old is published as an aged model state,
 * with the age stated, and both dataset windows are shown when they differ.
 */
const SURFACE = { start: '2026-10-07T06:00:00.000000000', end: '2026-10-08T18:00:00.000000000', steps: 7 };
const DEPTH = { start: '2026-10-10T06:00:00.000000000', end: '2026-10-17T00:00:00.000000000', steps: 28 };
// After every published model time, so the age is a real age.
const NOW = Date.parse('2026-10-20T00:00:00Z');

describe('Header LIVE data age', () => {
  it('states the age of the newest model run', () => {
    render(
      <Header
        {...BASE_PROPS}
        oceanMode="LIVE"
        metrics={null}
        modelDateRange={SURFACE}
        modelDepthDateRange={DEPTH}
        nowMs={NOW}
      />
    );
    expect(screen.getAllByText(/LATEST MODEL RUN · 3 days old/i).length).toBe(2);
  });

  it('does not call stale data live', () => {
    render(
      <Header
        {...BASE_PROPS}
        oceanMode="LIVE"
        metrics={null}
        modelDateRange={SURFACE}
        modelDepthDateRange={DEPTH}
        nowMs={NOW}
      />
    );
    expect(screen.queryByText(/^LIVE OCEAN ·/)).not.toBeInTheDocument();
    expect(screen.getByText(/LATEST MODEL DATA · NOT LIVE/i)).toBeInTheDocument();
  });

  it('calls fresh data live and says how fresh it is', () => {
    render(
      <Header
        {...BASE_PROPS}
        oceanMode="LIVE"
        metrics={null}
        modelDateRange={{ start: '2026-10-19T06:00:00.000000000', end: '2026-10-19T18:00:00.000000000', steps: 2 }}
        nowMs={NOW}
      />
    );
    expect(screen.getByText(/LIVE OCEAN ·/)).toBeInTheDocument();
    expect(screen.getAllByText(/LATEST MODEL RUN · 6 h old/i).length).toBe(2);
  });

  it('shows both the surface and the depth window when they differ', () => {
    render(
      <Header
        {...BASE_PROPS}
        oceanMode="LIVE"
        metrics={null}
        modelDateRange={SURFACE}
        modelDepthDateRange={DEPTH}
        nowMs={NOW}
      />
    );
    expect(screen.getByText('SURFACE:')).toBeInTheDocument();
    expect(screen.getByText('2026-10-07 06:00 UTC → 2026-10-08 18:00 UTC')).toBeInTheDocument();
    expect(screen.getByText('DEPTH:')).toBeInTheDocument();
    expect(screen.getByText('2026-10-10 06:00 UTC → 2026-10-17 00:00 UTC')).toBeInTheDocument();
  });

  it('never states an age it cannot know', () => {
    render(<Header {...BASE_PROPS} oceanMode="LIVE" metrics={null} nowMs={NOW} />);
    expect(screen.queryByText(/LATEST MODEL RUN/)).not.toBeInTheDocument();
  });
});
