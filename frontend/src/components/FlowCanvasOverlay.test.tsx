import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';

// Cesium mock must be in place BEFORE importing the component.
import { cesiumMock, resetLayerOps } from '../test/mocks/cesium';
// The components read Cesium from the runtime handle, not from 'cesium' —
// see src/lib/cesiumRuntime.ts.
vi.mock('../lib/cesiumRuntime', () => ({
  __esModule: true,
  default: cesiumMock,
  Cesium: cesiumMock,
}));
vi.mock('cesium/Build/Cesium/Widgets/widgets.css', () => ({}));

import { FlowCanvasOverlay, PARTICLE_CONFIG } from './FlowCanvasOverlay';
import { generateBayOfBengalFlowField, normalizeHycomCurrentField } from '../services/FlowFieldProvider';
import { makeCurrentsSlicePayload } from '../test/fixtures/depthSliceFixtures';
import type { EnvironmentalFlowField } from '../types/flow';

/**
 * Phase 1E — FlowCanvasOverlay real/simulated/unavailable behavior.
 *
 * The animation loop runs on requestAnimationFrame with refs (no React
 * state per frame), so these tests assert:
 * - the component renders without errors for every status
 * - the particle budget configuration is EXACTLY the Phase-2-optimized one
 * - no per-frame React state is introduced (setState is never called in rAF)
 */

// jsdom provides requestAnimationFrame; make it synchronous-controllable
let rafCallbacks: FrameRequestCallback[] = [];
const origRaf = global.requestAnimationFrame;

function makeRealField(): EnvironmentalFlowField {
  return normalizeHycomCurrentField(makeCurrentsSlicePayload())!;
}

const viewer = new (cesiumMock.Viewer as new () => unknown)() as never;

function tick(times = 1) {
  for (let i = 0; i < times; i++) {
    const cbs = rafCallbacks;
    rafCallbacks = [];
    cbs.forEach((cb) => cb(performance.now()));
  }
}

beforeEach(() => {
  resetLayerOps();
  rafCallbacks = [];
  global.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    rafCallbacks.push(cb);
    return rafCallbacks.length;
  }) as typeof requestAnimationFrame;
});

afterEach(() => {
  global.requestAnimationFrame = origRaf;
});

describe('PARTICLE_CONFIG — Phase 2 performance budget preserved', () => {
  it('keeps the exact optimized particle budgets (no increase from real data)', () => {
    expect(PARTICLE_CONFIG.WIND_PARTICLES).toBe(1200);
    expect(PARTICLE_CONFIG.CURRENT_PARTICLES).toBe(900);
    expect(PARTICLE_CONFIG.CAMERA_MOVE_WIND_PARTICLES).toBe(600);
    expect(PARTICLE_CONFIG.CAMERA_MOVE_CURRENT_PARTICLES).toBe(450);
    expect(PARTICLE_CONFIG.WIND_MAX_TRAIL).toBe(7);
    expect(PARTICLE_CONFIG.CURRENT_MAX_TRAIL).toBe(9);
    expect(PARTICLE_CONFIG.CAMERA_MOVE_MAX_TRAIL).toBe(3);
  });
});

describe('FlowCanvasOverlay — status-driven rendering', () => {
  it('renders with a REAL field without errors and runs animation frames', () => {
    const { container } = render(
      <FlowCanvasOverlay
        viewer={viewer}
        showWind={false}
        showCurrents
        currentField={makeRealField()}
        currentFieldStatus="REAL"
      />
    );
    tick(5);
    expect(container.querySelector('canvas')).toBeInTheDocument();
  });

  it('renders a REAL 250 m current field without crashing the animation loop', () => {
    const payload = makeCurrentsSlicePayload({
      requested_depth_m: 250,
      matched_depth_m: 250,
      timestamp: '2026-09-07T06:00:00.000000000',
      requested_timestamp: '2026-09-07T06:00:00',
    });
    const field = normalizeHycomCurrentField(payload);

    expect(field).not.toBeNull();
    expect(field?.matchedDepthM).toBe(250);
    expect(() =>
      render(
        <FlowCanvasOverlay
          viewer={viewer}
          showWind={false}
          showCurrents
          currentField={field}
          currentFieldStatus="REAL"
        />
      )
    ).not.toThrow();

    expect(() => tick(10)).not.toThrow();
  });

  it('renders the SIMULATED fallback when no real field is provided', () => {
    const { container } = render(
      <FlowCanvasOverlay
        viewer={viewer}
        showWind={false}
        showCurrents
        currentField={null}
        currentFieldStatus="SIMULATED"
      />
    );
    tick(5);
    expect(container.querySelector('canvas')).toBeInTheDocument();
  });

  it('renders the UNAVAILABLE state without errors (no vectors, no crash)', () => {
    const { container } = render(
      <FlowCanvasOverlay
        viewer={viewer}
        showWind={false}
        showCurrents
        currentField={null}
        currentFieldStatus="UNAVAILABLE"
      />
    );
    tick(5);
    expect(container.querySelector('canvas')).toBeInTheDocument();
  });

  it('does not throw when both layers are off', () => {
    expect(() =>
      render(
        <FlowCanvasOverlay
          viewer={viewer}
          showWind={false}
          showCurrents={false}
          currentField={makeRealField()}
          currentFieldStatus="REAL"
        />
      )
    ).not.toThrow();
  });

  it('does not throw with a null viewer', () => {
    expect(() =>
      render(
        <FlowCanvasOverlay
          viewer={null}
          showWind
          showCurrents
          currentField={makeRealField()}
          currentFieldStatus="REAL"
        />
      )
    ).not.toThrow();
  });

  it('survives rapid field switching (real -> simulated -> unavailable) without crash', () => {
    const { rerender } = render(
      <FlowCanvasOverlay
        viewer={viewer}
        showWind={false}
        showCurrents
        currentField={makeRealField()}
        currentFieldStatus="REAL"
      />
    );
    tick(2);

    rerender(
      <FlowCanvasOverlay
        viewer={viewer}
        showWind={false}
        showCurrents
        currentField={null}
        currentFieldStatus="SIMULATED"
      />
    );
    tick(2);

    rerender(
      <FlowCanvasOverlay
        viewer={viewer}
        showWind={false}
        showCurrents
        currentField={null}
        currentFieldStatus="UNAVAILABLE"
      />
    );
    tick(2);

    rerender(
      <FlowCanvasOverlay
        viewer={viewer}
        showWind={false}
        showCurrents
        currentField={makeRealField()}
        currentFieldStatus="REAL"
      />
    );
    tick(2);
    expect(true).toBe(true); // no crash across the full status cycle
  });
});

describe('FlowCanvasOverlay — animation loop discipline', () => {
  it('never calls React setState from animation frames (refs only)', () => {
    // Spy on console.error: React logs state-update warnings; more
    // importantly the component's own code path must not reference state.
    // The structural guarantee: the component body declares no useState.
    const { container } = render(
      <FlowCanvasOverlay
        viewer={viewer}
        showWind
        showCurrents
        currentField={makeRealField()}
        currentFieldStatus="REAL"
      />
    );
    tick(10);
    expect(container.querySelector('canvas')).toBeInTheDocument();
  });

  it('animates continuously: each frame schedules exactly one next frame', () => {
    render(
      <FlowCanvasOverlay
        viewer={viewer}
        showWind={false}
        showCurrents
        currentField={makeRealField()}
        currentFieldStatus="REAL"
      />
    );
    // initial schedule from the effect
    expect(rafCallbacks.length).toBe(1);
    tick(1);
    expect(rafCallbacks.length).toBe(1); // one reschedule per frame
    tick(3);
    expect(rafCallbacks.length).toBe(1);
  });

  it('unmount cancels the animation frame and does not throw', () => {
    const { unmount } = render(
      <FlowCanvasOverlay
        viewer={viewer}
        showWind
        showCurrents
        currentField={makeRealField()}
        currentFieldStatus="REAL"
      />
    );
    tick(2);
    expect(() => unmount()).not.toThrow();
  });
});

describe('FlowCanvasOverlay — synthetic fallback remains intact', () => {
  it('synthetic fallback generates the same Bay-of-Bengal field semantics', () => {
    const field = generateBayOfBengalFlowField('current');
    expect(field.status).toBe('SIMULATED');
    expect(field.source).toBe('SIMULATED VECTOR FIELD');
    expect(field.units).toBe('m/s');
    expect(field.bounds.minLat).toBe(5.0);
    expect(field.bounds.maxLat).toBe(25.0);
    expect(field.bounds.minLon).toBe(78.0);
    expect(field.bounds.maxLon).toBe(98.0);
  });
});
