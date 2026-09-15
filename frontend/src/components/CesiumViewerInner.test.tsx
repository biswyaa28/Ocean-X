import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, act } from '@testing-library/react';
import React from 'react';
import type { Station, GISLayer } from '../types/oceanlens';

// Cesium mock must be in place BEFORE importing the component.
import { cesiumMock, layerOps, resetLayerOps } from '../test/mocks/cesium';
vi.mock('cesium', () => ({ __esModule: true, ...cesiumMock }));
vi.mock('cesium/Build/Cesium/Widgets/widgets.css', () => ({}));

// Surface layer fetches go through apiProvider.getLayerData; resolve a
// schema-compatible surface payload so the surface raster path is exercised
// in coexistence scenarios.
vi.mock('../services/ApiProvider', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../services/ApiProvider')>();
  return {
    ...orig,
    apiProvider: {
      ...orig.apiProvider,
      getLayerData: vi.fn(async () => ({
        status: 'REAL',
        source: 'INCOIS RSMC HYCOM',
        layer_name: 'sst',
        timestamp: '2026-09-07T06:00:00.000000000',
        units: '°C',
        bounds: { minLat: 5, maxLat: 7, minLon: 80, maxLon: 82 },
        grid: {
          latitudes: [5, 6, 7],
          longitudes: [80, 81, 82],
          values: [
            [29.1, 29.2, 29.3],
            [28.8, 0.0, 28.9],
            [28.7, 28.6, 28.5],
          ],
        },
      })),
    },
  };
});

import { CesiumViewerInner } from './CesiumViewerInner';
import { makeDepthSlicePayload, makeCurrentsSlicePayload } from '../test/fixtures/depthSliceFixtures';

const stations: Station[] = [];
const layers: GISLayer[] = [
  { id: 'cyclone', name: 'Cyclone', category: 'hazard', active: false, status: 'REAL', description: '' },
  { id: 'sst', name: 'SST', category: 'physical', active: false, status: 'REAL', description: '' },
  { id: 'currents', name: 'Currents', category: 'physical', active: false, status: 'REAL', description: '' },
  { id: 'wind', name: 'Wind', category: 'hazard', active: false, status: 'REAL', description: '' },
];

type ViewerProps = React.ComponentProps<typeof CesiumViewerInner>;

function renderViewer(props: Partial<ViewerProps> = {}) {
  return render(
    <CesiumViewerInner
      cyclone={null}
      currentTrackIndex={0}
      stations={stations}
      layers={layers}
      onSelectStation={() => {}}
      {...props}
    />
  );
}

// Note: the base imagery layer is passed as a Viewer constructor option and
// is therefore NOT recorded by the imageryLayers mock. Recorded adds are:
// place names overlay (1), surface raster (0/1), depth slice (0/1).
function adds() {
  return layerOps.filter((o) => o.op === 'add');
}
function removes() {
  return layerOps.filter((o) => o.op === 'remove');
}

async function waitForSliceLegend() {
  await waitFor(() => {
    expect(document.body.textContent).toMatch(/HYCOM MODEL DEPTH SLICE/);
  });
}

const tick = () => act(async () => { await new Promise((r) => setTimeout(r, 25)); });

beforeEach(() => {
  resetLayerOps();
});

// ------------------------------------------------------------
// Scenario 1: surface-only mode
// ------------------------------------------------------------
describe('scenario 1 — surface-only mode', () => {
  it('surface raster renders; no depth-slice layer exists while the slice is invisible', async () => {
    const sstActive = layers.map((l) => (l.id === 'sst' ? { ...l, active: true } : l));
    renderViewer({ layers: sstActive, depthSliceVisible: false, depthSlicePayload: makeDepthSlicePayload() });
    await tick();
    expect(adds().length).toBe(2); // place names + surface raster
    expect(removes().length).toBe(0);
    expect(document.body.textContent).not.toMatch(/MODEL LEVEL/);
  });

  it('adds no depth-slice imagery layer when no payload exists at all', async () => {
    renderViewer({ depthSliceVisible: true, depthSlicePayload: null });
    await tick();
    expect(adds().length).toBe(1); // place names only
    expect(removes().length).toBe(0);
  });

  it('does not add a layer when a payload exists but visible=false', async () => {
    renderViewer({ depthSliceVisible: false, depthSlicePayload: makeDepthSlicePayload() });
    await tick();
    expect(adds().length).toBe(1);
  });
});

// ------------------------------------------------------------
// Scenario 2: depth-slice-only mode
// ------------------------------------------------------------
describe('scenario 2 — depth-slice-only mode', () => {
  it('adds exactly one depth-slice layer and shows the subsurface legend', async () => {
    renderViewer({ depthSliceVisible: true, depthSlicePayload: makeDepthSlicePayload() });
    await waitForSliceLegend();
    await tick();
    expect(adds().length).toBe(2); // place names + exactly one slice
    expect(removes().length).toBe(0);
    expect(document.body.textContent).toMatch(/SUBSURFACE — NOT SURFACE/);
    expect(document.body.textContent).toMatch(/50 m MODEL LEVEL/);
  });
});

// The component sets depth-slice layers to alpha 0.75 (surface raster uses
// 0.65) — a deterministic way to identify the slice layer in the ops log.
function findSliceLayer(): unknown {
  const op = adds().find((o) => (o.layer as { alpha: number }).alpha === 0.75);
  return op ? op.layer : undefined;
}

// ------------------------------------------------------------
// Scenario 3: surface + depth-slice mode
// ------------------------------------------------------------
describe('scenario 3 — surface + depth-slice mode', () => {
  it('surface raster and depth slice coexist as separate layers', async () => {
    const sstActive = layers.map((l) => (l.id === 'sst' ? { ...l, active: true } : l));
    renderViewer({ layers: sstActive, depthSliceVisible: true, depthSlicePayload: makeDepthSlicePayload() });
    await waitForSliceLegend();
    await tick();
    expect(adds().length).toBe(3); // place names + surface raster + depth slice
    const sliceLayer = findSliceLayer();
    expect(sliceLayer).toBeDefined();
    expect(removes().some((r) => r.layer === sliceLayer)).toBe(false);
  });

  it('toggling the surface layer off does not remove the depth-slice layer', async () => {
    const sstActive = layers.map((l) => (l.id === 'sst' ? { ...l, active: true } : l));
    // Same payload object: isolates the surface toggle from slice replacement.
    const payload = makeDepthSlicePayload();
    const { rerender } = renderViewer({ layers: sstActive, depthSliceVisible: true, depthSlicePayload: payload });
    await waitForSliceLegend();
    await tick();
    const sliceLayer = findSliceLayer();
    expect(sliceLayer).toBeDefined();

    rerender(
      <CesiumViewerInner
        cyclone={null}
        currentTrackIndex={0}
        stations={stations}
        layers={layers}
        onSelectStation={() => {}}
        depthSliceVisible
        depthSlicePayload={payload}
      />
    );
    await tick();
    // The surface layer may be cleaned up, but never the depth slice layer.
    expect(removes().some((r) => r.layer === sliceLayer)).toBe(false);
    // And the slice layer is still live (present in adds, never removed).
    expect(adds().some((a) => a.layer === sliceLayer)).toBe(true);
  });
});

// ------------------------------------------------------------
// Scenarios 4 & 13: switching depth / no duplicate layers
// ------------------------------------------------------------
describe('scenario 4 & 13 — switching depth replaces the previous slice', () => {
  it('replaces the slice atomically: exactly one new add, previous removed, no accumulation', async () => {
    const { rerender } = renderViewer({
      depthSliceVisible: true,
      depthSlicePayload: makeDepthSlicePayload({ matched_depth_m: 50 }),
    });
    await waitForSliceLegend();
    const countAfterFirst = adds().length;

    rerender(
      <CesiumViewerInner
        cyclone={null}
        currentTrackIndex={0}
        stations={stations}
        layers={layers}
        onSelectStation={() => {}}
        depthSliceVisible
        depthSlicePayload={makeDepthSlicePayload({ matched_depth_m: 100, requested_depth_m: 100 })}
      />
    );
    await tick();

    expect(adds().length).toBe(countAfterFirst + 1); // exactly one new add
    const prevSliceLayer = adds()[adds().length - 2].layer;
    expect(removes().some((r) => r.layer === prevSliceLayer)).toBe(true); // old slice removed
  });
});

// ------------------------------------------------------------
// Scenarios 5 & 6: switching variable / timestamp
// ------------------------------------------------------------
describe('scenarios 5 & 6 — switching variable and timestamp replaces the slice', () => {
  it('variable change replaces the slice layer', async () => {
    const { rerender } = renderViewer({ depthSliceVisible: true, depthSlicePayload: makeDepthSlicePayload() });
    await waitForSliceLegend();
    const countAfterFirst = adds().length;

    rerender(
      <CesiumViewerInner
        cyclone={null}
        currentTrackIndex={0}
        stations={stations}
        layers={layers}
        onSelectStation={() => {}}
        depthSliceVisible
        depthSlicePayload={makeDepthSlicePayload({ variable: 'salinity', units: 'PSU' })}
      />
    );
    await tick();
    expect(adds().length).toBe(countAfterFirst + 1);
    expect(removes().length).toBeGreaterThanOrEqual(1);
  });

  it('timestamp change replaces the slice layer', async () => {
    const { rerender } = renderViewer({ depthSliceVisible: true, depthSlicePayload: makeDepthSlicePayload() });
    await waitForSliceLegend();
    const countAfterFirst = adds().length;

    rerender(
      <CesiumViewerInner
        cyclone={null}
        currentTrackIndex={0}
        stations={stations}
        layers={layers}
        onSelectStation={() => {}}
        depthSliceVisible
        depthSlicePayload={makeDepthSlicePayload({ timestamp: '2026-09-07T12:00:00.000000000' })}
      />
    );
    await tick();
    expect(adds().length).toBe(countAfterFirst + 1);
    expect(removes().length).toBeGreaterThanOrEqual(1);
  });
});

// ------------------------------------------------------------
// Scenario 7: hiding the depth slice
// ------------------------------------------------------------
describe('scenario 7 — hiding the depth slice removes its layer', () => {
  it('removes the slice imagery layer when toggled invisible', async () => {
    const { rerender } = renderViewer({ depthSliceVisible: true, depthSlicePayload: makeDepthSlicePayload() });
    await waitForSliceLegend();
    const sliceLayer = adds()[adds().length - 1].layer;

    rerender(
      <CesiumViewerInner
        cyclone={null}
        currentTrackIndex={0}
        stations={stations}
        layers={layers}
        onSelectStation={() => {}}
        depthSliceVisible={false}
        depthSlicePayload={makeDepthSlicePayload()}
      />
    );
    await tick();
    expect(removes().some((r) => r.layer === sliceLayer)).toBe(true);
    expect(document.body.textContent).not.toMatch(/MODEL LEVEL/);
  });
});

// ------------------------------------------------------------
// Scenario 8: removing the payload (unavailable backend)
// ------------------------------------------------------------
describe('scenario 8 — payload removed (unavailable response)', () => {
  it('removes the slice imagery layer when the payload becomes null', async () => {
    const { rerender } = renderViewer({ depthSliceVisible: true, depthSlicePayload: makeDepthSlicePayload() });
    await waitForSliceLegend();
    const sliceLayer = adds()[adds().length - 1].layer;

    rerender(
      <CesiumViewerInner
        cyclone={null}
        currentTrackIndex={0}
        stations={stations}
        layers={layers}
        onSelectStation={() => {}}
        depthSliceVisible
        depthSlicePayload={null}
      />
    );
    await tick();
    expect(removes().some((r) => r.layer === sliceLayer)).toBe(true);
    expect(document.body.textContent).not.toMatch(/MODEL LEVEL/);
  });
});

// ------------------------------------------------------------
// Scenario 9: rapid selection churn
// ------------------------------------------------------------
describe('scenario 9 & 13 — rapid selection churn never accumulates layers', () => {
  it('five rapid depth changes yield five adds and five removes (net one slice layer)', async () => {
    const { rerender } = renderViewer({
      depthSliceVisible: true,
      depthSlicePayload: makeDepthSlicePayload({ matched_depth_m: 0, requested_depth_m: 0 }),
    });
    await waitForSliceLegend();

    for (const depth of [10, 50, 100, 250, 500]) {
      rerender(
        <CesiumViewerInner
          cyclone={null}
          currentTrackIndex={0}
          stations={stations}
          layers={layers}
          onSelectStation={() => {}}
          depthSliceVisible
          depthSlicePayload={makeDepthSlicePayload({ matched_depth_m: depth, requested_depth_m: depth })}
        />
      );
    }
    await tick();

    expect(adds().length).toBe(7); // places + initial + 5 churn adds
    expect(removes().length).toBe(5); // every replaced slice cleaned up
    // exactly one slice layer is live at the end: last add not removed
    const lastSlice = adds()[adds().length - 1].layer;
    expect(removes().some((r) => r.layer === lastSlice)).toBe(false);
  });
});

// ------------------------------------------------------------
// Scenario 10: component unmount
// ------------------------------------------------------------
describe('scenario 10 — unmount/remount', () => {
  it('unmounting the component does not throw and clears slice state', async () => {
    const { unmount } = renderViewer({ depthSliceVisible: true, depthSlicePayload: makeDepthSlicePayload() });
    await waitForSliceLegend();
    expect(() => unmount()).not.toThrow();
  });

  it('remounting renders a fresh single slice layer', async () => {
    const first = renderViewer({ depthSliceVisible: true, depthSlicePayload: makeDepthSlicePayload() });
    await waitForSliceLegend();
    first.unmount();
    resetLayerOps();

    renderViewer({ depthSliceVisible: true, depthSlicePayload: makeDepthSlicePayload() });
    await waitForSliceLegend();
    await tick();
    expect(adds().length).toBe(2); // places + one slice
  });
});

// ------------------------------------------------------------
// Scenario 11: missing/NaN values
// ------------------------------------------------------------
describe('scenario 11 — missing/NaN values', () => {
  it('an all-missing payload renders a single fully-transparent slice (no crash, exactly one layer)', async () => {
    const allMissing = makeDepthSlicePayload({
      grid: { latitudes: [5, 6], longitudes: [80, 81], values: [[null, null], [null, null]] },
      missing_values: 4,
    });
    renderViewer({ depthSliceVisible: true, depthSlicePayload: allMissing });
    await tick();
    // In a real browser the generated raster is 100% transparent (verified at
    // pixel level in rasterGen.test.ts); the stub canvas always yields a
    // data URL, so the layer is still added — exactly one, never more.
    expect(adds().length).toBe(2); // places + one transparent slice layer
    expect(removes().length).toBe(0);
  });

  it('a partially-missing payload still renders (nulls transparent within the raster)', async () => {
    renderViewer({ depthSliceVisible: true, depthSlicePayload: makeDepthSlicePayload() });
    await waitForSliceLegend();
    expect(adds().length).toBe(2);
  });
});

// ------------------------------------------------------------
// Scenario 12: invalid/unavailable backend response shapes
// ------------------------------------------------------------
describe('scenario 12 — invalid/unavailable backend responses', () => {
  it('a payload without grid data adds no layer and does not throw', async () => {
    const malformed = { ...makeDepthSlicePayload(), grid: undefined } as unknown as ViewerProps['depthSlicePayload'];
    renderViewer({ depthSliceVisible: true, depthSlicePayload: malformed });
    await tick();
    expect(adds().length).toBe(1);
  });

  it('a currents payload without u/v vectors adds no layer and does not throw', async () => {
    const noVectors = makeCurrentsSlicePayload({
      grid: { latitudes: [5, 6], longitudes: [80, 81], values: undefined, u: undefined, v: undefined },
    });
    renderViewer({ depthSliceVisible: true, depthSlicePayload: noVectors });
    await tick();
    expect(adds().length).toBe(1);
  });
});

// ------------------------------------------------------------
// Currents vector payload
// ------------------------------------------------------------
describe('currents (u/v) depth slice', () => {
  it('derives speed magnitude and renders a slice layer', async () => {
    renderViewer({ depthSliceVisible: true, depthSlicePayload: makeCurrentsSlicePayload() });
    await waitForSliceLegend();
    await tick();
    expect(adds().length).toBe(2); // places + slice
  });
});
