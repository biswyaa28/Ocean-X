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

  it('does not label LIVE as real without authoritative LIVE KPI data', () => {
    render(
      <Header
        {...BASE_PROPS}
        oceanMode="LIVE"
        metrics={null}
        dataMode="REAL"
        datasetSynthetic={false}
      />
    );
    expect(screen.getByText(/LIVE OCEAN · DATA UNAVAILABLE \/ NON-AUTHORITATIVE/i)).toBeInTheDocument();
    expect(screen.queryByText(/REAL INCOIS HYCOM DATA/i)).not.toBeInTheDocument();
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
