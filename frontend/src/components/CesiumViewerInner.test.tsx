import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, act } from '@testing-library/react';
import React from 'react';
import type { GISLayer } from '../types/oceanlens';

// Cesium mock must be in place BEFORE importing the component.
//
// The component reads Cesium from the runtime handle (src/lib/cesiumRuntime.ts),
// not from 'cesium' directly — see that file for why. So the mock targets the
// handle and publishes the same object onto window.Cesium, mirroring how the
// real classic-script load behaves.
import { cesiumMock, layerOps, resetLayerOps, resetViewerOptions, viewerOptions, requestRenderCalls, inputActions, createdViewers } from '../test/mocks/cesium';
vi.mock('../lib/cesiumRuntime', () => ({
  __esModule: true,
  default: cesiumMock,
  Cesium: cesiumMock,
}));
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
import { makeArgoProfile } from '../test/fixtures/argoFixtures';
import { normalizeHycomCurrentField } from '../services/FlowFieldProvider';
import { clearRasterCache } from '../utils/rasterGen';

const layers: GISLayer[] = [
  { id: 'cyclone', name: 'Cyclone', category: 'hazard', active: false, status: 'REAL', description: '' },
  { id: 'sst', name: 'SST', category: 'physical', active: false, status: 'REAL', description: '' },
  { id: 'currents', name: 'Currents', category: 'physical', active: false, status: 'REAL', description: '' },
];

type ViewerProps = React.ComponentProps<typeof CesiumViewerInner>;

function renderViewer(props: Partial<ViewerProps> = {}) {
  return render(
    <CesiumViewerInner
      cyclone={null}
      currentTrackIndex={0}
      layers={layers}
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
  resetViewerOptions();
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
          layers={layers}
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
          layers={layers}
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
          layers={layers}
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
          layers={layers}
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
          layers={layers}
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
          layers={layers}
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
  it('five rapid depth changes never accumulate more than one live slice layer', async () => {
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
              layers={layers}
              depthSliceVisible
          depthSlicePayload={makeDepthSlicePayload({ matched_depth_m: depth, requested_depth_m: depth })}
        />
      );
    }
    await tick();

    // Phase 2B: raster encoding is asynchronous, so a depth change that is
    // superseded before its PNG encode completes is discarded instead of being
    // added and immediately replaced. Fewer imagery adds/removes is the point
    // (no wasted texture allocation, no stale flash) — the invariant that must
    // hold is that exactly ONE slice layer is live at the end.
    const sliceAdds = adds().filter((o) => (o.layer as { alpha: number }).alpha === 0.75);
    const sliceRemoves = removes();
    expect(sliceAdds.length).toBeGreaterThanOrEqual(1); // at least the newest slice is applied
    expect(sliceAdds.length - sliceRemoves.length).toBe(1); // net exactly one live slice
    expect(sliceRemoves.length).toBeLessThan(sliceAdds.length); // no over-removal
    // the newest slice is the surviving one: it was never removed
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

// ------------------------------------------------------------
// Phase 1E — real HYCOM current field provenance chips
// ------------------------------------------------------------
describe('Phase 1E — current field status chips', () => {
  const currentsActive = layers.map((l) => (l.id === 'currents' ? { ...l, active: true } : l));

  it('REAL status shows the REAL HYCOM CURRENT FIELD chip with timestamp and matched depth', async () => {
    const payload = makeCurrentsSlicePayload({ matched_depth_m: 250, requested_depth_m: 250 });
    const field = normalizeHycomCurrentField(payload)!;
    renderViewer({
      layers: currentsActive,
      currentField: field,
      currentFieldStatus: 'REAL',
      currentFieldMetadata: payload,
    });
    await tick();
    expect(document.body.textContent).toMatch(/REAL HYCOM CURRENT FIELD/);
    expect(document.body.textContent).toMatch(/250 m MODEL LEVEL/);
    expect(document.body.textContent).not.toMatch(/SIMULATED CURRENT FIELD/);
  });

  it('REAL surface (0 m) field is labelled SURFACE (0 m), never a subsurface depth', async () => {
    const payload = makeCurrentsSlicePayload({ matched_depth_m: 0, requested_depth_m: 0 });
    const field = normalizeHycomCurrentField(payload)!;
    renderViewer({
      layers: currentsActive,
      currentField: field,
      currentFieldStatus: 'REAL',
      currentFieldMetadata: payload,
    });
    await tick();
    expect(document.body.textContent).toMatch(/SURFACE \(0 m\)/);
    expect(document.body.textContent).not.toMatch(/MODEL LEVEL/);
  });

  it('SIMULATED status shows the SIMULATED CURRENT FIELD chip, never a REAL claim', async () => {
    renderViewer({
      layers: currentsActive,
      currentField: null,
      currentFieldStatus: 'SIMULATED',
    });
    await tick();
    expect(document.body.textContent).toMatch(/SIMULATED CURRENT FIELD/);
    expect(document.body.textContent).not.toMatch(/REAL HYCOM CURRENT FIELD/);
    expect(document.body.textContent).toMatch(/SURFACE-ONLY/);
  });

  it('UNAVAILABLE status shows CURRENT DATA UNAVAILABLE and no depth/timestamp provenance', async () => {
    renderViewer({
      layers: currentsActive,
      currentField: null,
      currentFieldStatus: 'UNAVAILABLE',
      currentFieldStatusReason: 'HYCOM returned no valid UVEL/VVEL vectors for this depth/timestamp.',
    });
    await tick();
    expect(document.body.textContent).toMatch(/CURRENT DATA UNAVAILABLE/);
    expect(document.body.textContent).not.toMatch(/REAL HYCOM CURRENT FIELD/);
    expect(document.body.textContent).not.toMatch(/SIMULATED CURRENT FIELD/);
  });

  it('hides the currents chip entirely when the currents layer is inactive', async () => {
    renderViewer({
      layers, // currents inactive
      currentField: null,
      currentFieldStatus: 'SIMULATED',
    });
    await tick();
    expect(document.body.textContent).not.toMatch(/OCEAN CURRENT/);
  });

  it('defaults to the honest SIMULATED label when no status is provided', async () => {
    renderViewer({ layers: currentsActive });
    await tick();
    expect(document.body.textContent).toMatch(/SIMULATED CURRENT FIELD/);
  });
});

// ------------------------------------------------------------
// Phase 1C — scientific render configuration & opacity
// ------------------------------------------------------------
import {
  DEFAULT_DEPTH_SLICE_DISPLAY,
  resolveDepthSliceRender,
} from '../utils/depthSliceViz';

function rerenderViewer(
  rerender: (ui: React.ReactElement) => void,
  props: Partial<ViewerProps> = {}
) {
  rerender(
    <CesiumViewerInner
      cyclone={null}
      currentTrackIndex={0}
      layers={layers}
      {...props}
    />
  );
}

describe('Phase 1C — scientific render configuration', () => {
  it('renders with an explicit render configuration (palette/range/scale) without churn', async () => {
    const payload = makeDepthSlicePayload();
    const render = resolveDepthSliceRender(payload, {
      ...DEFAULT_DEPTH_SLICE_DISPLAY,
      min: 19,
      max: 21,
      paletteId: 'thermal',
    })!;
    renderViewer({ depthSliceVisible: true, depthSlicePayload: payload, depthSliceRender: render });
    await waitForSliceLegend();
    await tick();
    expect(adds().length).toBe(2); // places + exactly one slice
    expect(removes().length).toBe(0);
  });

  it('replaces the slice raster exactly once when the palette changes (no accumulation)', async () => {
    const payload = makeDepthSlicePayload();
    const classic = resolveDepthSliceRender(payload, DEFAULT_DEPTH_SLICE_DISPLAY)!;
    const thermal = resolveDepthSliceRender(payload, { ...DEFAULT_DEPTH_SLICE_DISPLAY, paletteId: 'thermal' })!;
    const utils = renderViewer({
      depthSliceVisible: true,
      depthSlicePayload: payload,
      depthSliceRender: classic,
    });
    await waitForSliceLegend();
    const addsBefore = adds().length;

    rerenderViewer(utils.rerender, { depthSliceVisible: true, depthSlicePayload: payload, depthSliceRender: thermal });
    await tick();
    expect(adds().length).toBe(addsBefore + 1); // exactly one new add
    expect(removes().length).toBe(1); // previous slice removed
    const lastSlice = adds()[adds().length - 1].layer;
    expect(removes().some((r) => r.layer === lastSlice)).toBe(false); // never accumulated
  });

  it('updates layer opacity in place without any imagery add/remove churn', async () => {
    const payload = makeDepthSlicePayload();
    const render = resolveDepthSliceRender(payload, DEFAULT_DEPTH_SLICE_DISPLAY)!;
    const utils = renderViewer({
      depthSliceVisible: true,
      depthSlicePayload: payload,
      depthSliceRender: render,
      depthSliceOpacity: 0.75,
    });
    await waitForSliceLegend();
    await tick();
    const addsBefore = adds().length;
    const removesBefore = removes().length;
    const sliceLayer = adds()[adds().length - 1].layer as { alpha: number };
    expect(sliceLayer.alpha).toBe(0.75);

    rerenderViewer(utils.rerender, {
      depthSliceVisible: true,
      depthSlicePayload: payload,
      depthSliceRender: render,
      depthSliceOpacity: 0.35,
    });
    await tick();
    expect((adds()[adds().length - 1].layer as { alpha: number }).alpha).toBe(0.35);
    expect(adds().length).toBe(addsBefore); // no re-add
    expect(removes().length).toBe(removesBefore); // no remove
  });

  it('opacity applies to the depth-slice layer only, never the surface raster', async () => {
    const sstActive = layers.map((l) => (l.id === 'sst' ? { ...l, active: true } : l));
    const payload = makeDepthSlicePayload();
    const render = resolveDepthSliceRender(payload, DEFAULT_DEPTH_SLICE_DISPLAY)!;
    renderViewer({
      layers: sstActive,
      depthSliceVisible: true,
      depthSlicePayload: payload,
      depthSliceRender: render,
      depthSliceOpacity: 0.6,
    });
    await waitForSliceLegend();
    await tick();
    // surface raster keeps its own fixed alpha of 0.65
    const surface = adds().find((o) => (o.layer as { alpha: number }).alpha === 0.65);
    expect(surface).toBeDefined();
    const slice = adds().find((o) => (o.layer as { alpha: number }).alpha === 0.6);
    expect(slice).toBeDefined();
    expect(slice!.layer).not.toBe(surface!.layer);
  });

  it('legend chip reflects palette, display range and scale', async () => {
    const payload = makeDepthSlicePayload();
    const render = resolveDepthSliceRender(payload, {
      ...DEFAULT_DEPTH_SLICE_DISPLAY,
      min: 19,
      max: 21,
      paletteId: 'thermal',
    })!;
    renderViewer({ depthSliceVisible: true, depthSlicePayload: payload, depthSliceRender: render });
    await waitFor(() => {
      expect(document.body.textContent).toMatch(/THERMAL/);
    });
    expect(document.body.textContent).toMatch(/19\.00\s*[–-]\s*21\.00/);
    expect(document.body.textContent).toMatch(/LINEAR/);
  });

  it('changing only depth-slice display settings never removes the surface raster', async () => {
    const sstActive = layers.map((l) => (l.id === 'sst' ? { ...l, active: true } : l));
    const payload = makeDepthSlicePayload();
    const render = resolveDepthSliceRender(payload, DEFAULT_DEPTH_SLICE_DISPLAY)!;
    const utils = renderViewer({
      layers: sstActive,
      depthSliceVisible: true,
      depthSlicePayload: payload,
      depthSliceRender: render,
    });
    await waitForSliceLegend();
    await tick();
    const surface = adds().find((o) => (o.layer as { alpha: number }).alpha === 0.65);
    expect(surface).toBeDefined();

    // palette + range + opacity all change: surface layer must survive
    rerenderViewer(utils.rerender, {
      layers: sstActive,
      depthSliceVisible: true,
      depthSlicePayload: payload,
      depthSliceRender: resolveDepthSliceRender(payload, {
        ...DEFAULT_DEPTH_SLICE_DISPLAY,
        paletteId: 'viridis',
        min: 19,
        max: 21,
      })!,
      depthSliceOpacity: 0.4,
    });
    await tick();
    expect(removes().some((r) => r.layer === surface!.layer)).toBe(false);
  });
});

// ------------------------------------------------------------
// Phase 2B: Cesium on-demand rendering (requestRenderMode)
//
// Cesium invalidates itself for camera movement, clock time and imagery/terrain
// arrival. Everything the *application* mutates in place (entity fields, imagery
// alpha, ...) must invalidate explicitly through requestRenderRef — and nothing
// else may request frames, or requestRenderMode is defeated.
// ------------------------------------------------------------
describe('Phase 2B — Cesium on-demand rendering', () => {
  function viewerOption(key: string): unknown {
    const opts = (viewerOptions[0] ?? {}) as Record<string, unknown>;
    return opts[key];
  }

  it('creates the viewer with requestRenderMode enabled (no continuous render loop)', async () => {
    renderViewer();
    await tick();

    expect(viewerOptions.length).toBe(1);
    expect(viewerOption('requestRenderMode')).toBe(true);
    expect(viewerOption('maximumRenderTimeChange')).toBe(0);
  });

  it('invalidates the scene when the timeline timestamp changes', async () => {
    const { rerender } = renderViewer({ timestamp: '2026-09-07T06:00:00Z' });
    await tick();

    const before = requestRenderCalls.length;
    rerender(
      <CesiumViewerInner
        cyclone={null}
        currentTrackIndex={0}
          layers={layers}
          timestamp="2026-09-07T18:00:00Z"
      />
    );
    await tick();

    expect(requestRenderCalls.length).toBeGreaterThan(before);
  });

  it('invalidates the scene when the depth slice changes', async () => {
    const { rerender } = renderViewer({
      depthSliceVisible: true,
      depthSlicePayload: makeDepthSlicePayload({ matched_depth_m: 50, requested_depth_m: 50 }),
    });
    await waitForSliceLegend();
    await tick();

    const before = requestRenderCalls.length;
    rerender(
      <CesiumViewerInner
        cyclone={null}
        currentTrackIndex={0}
          layers={layers}
          depthSliceVisible
        depthSlicePayload={makeDepthSlicePayload({ matched_depth_m: 250, requested_depth_m: 250 })}
      />
    );
    await tick();

    expect(requestRenderCalls.length).toBeGreaterThan(before);
  });

  it('invalidates the scene when a surface layer is switched off (imagery removal)', async () => {
    const sstActive = layers.map((l) => (l.id === 'sst' ? { ...l, active: true } : l));
    const { rerender } = renderViewer({ layers: sstActive });
    await tick();

    const before = requestRenderCalls.length;
    rerender(
      <CesiumViewerInner
        cyclone={null}
        currentTrackIndex={0}
          layers={layers}
        />
    );
    await tick();

    expect(removes().length).toBeGreaterThan(0);
    expect(requestRenderCalls.length).toBeGreaterThan(before);
  });

  it('issues NO render requests while nothing changes (the overlay never defeats requestRenderMode)', async () => {
    // All layers inactive: no raster fetch/generation can add render requests
    // during the idle window, so any growth would come from an animation loop.
    renderViewer({ timestamp: '2026-09-07T06:00:00Z' });
    await tick();

    const before = requestRenderCalls.length;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 120)); // ~7 animation frames
    });

    expect(requestRenderCalls.length).toBe(before);
  });
});

// ------------------------------------------------------------
// Phase 2B: raster imagery resource lifecycle (object URLs)
// ------------------------------------------------------------
describe('Phase 2B — raster imagery object URL lifecycle', () => {
  let revokedUrls: string[];
  // Captured before the suite overwrites them so afterEach can restore them.
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;

  beforeEach(() => {
    // The raster cache is module-global and shared across tests in this file;
    // without clearing it a slice generated by an earlier test (via the Data
    // URL fallback) would be served as a cache hit and no Blob would be made.
    clearRasterCache();
    revokedUrls = [];
    let counter = 0;
    URL.createObjectURL = vi.fn(() => `blob:oceanx/${++counter}`);
    URL.revokeObjectURL = vi.fn((url: string) => {
      revokedUrls.push(url);
    });
    HTMLCanvasElement.prototype.toBlob = ((callback: BlobCallback) => {
      callback(new Blob(['png'], { type: 'image/png' }));
    }) as HTMLCanvasElement['toBlob'];
  });

  afterEach(() => {
    // Restore the real environment. `revokeObjectURL` deliberately stays as a
    // harmless no-op: React's global cleanup unmounts the component *after*
    // this hook, and the unmount path releases its Blob URL.
    if (originalCreateObjectURL) URL.createObjectURL = originalCreateObjectURL;
    else Reflect.deleteProperty(URL, 'createObjectURL');
    URL.revokeObjectURL = originalRevokeObjectURL ?? (() => {});
    Reflect.deleteProperty(HTMLCanvasElement.prototype, 'toBlob');
  });

  it('hands Cesium an object URL and releases it when the slice is replaced', async () => {
    const { rerender } = renderViewer({
      depthSliceVisible: true,
      depthSlicePayload: makeDepthSlicePayload({ matched_depth_m: 50, requested_depth_m: 50 }),
    });
    await waitForSliceLegend();
    await tick();

    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(revokedUrls).toEqual([]); // the live slice keeps its URL

    rerender(
      <CesiumViewerInner
        cyclone={null}
        currentTrackIndex={0}
          layers={layers}
          depthSliceVisible
        depthSlicePayload={makeDepthSlicePayload({ matched_depth_m: 250, requested_depth_m: 250 })}
      />
    );
    await tick();

    // the replaced slice's object URL was freed exactly once
    expect(revokedUrls).toHaveLength(1);
    expect(revokedUrls[0].startsWith('blob:')).toBe(true);
  });

  it('releases the object URL when the slice is hidden', async () => {
    const { rerender } = renderViewer({
      depthSliceVisible: true,
      depthSlicePayload: makeDepthSlicePayload({ matched_depth_m: 50, requested_depth_m: 50 }),
    });
    await waitForSliceLegend();
    await tick();

    rerender(
      <CesiumViewerInner
        cyclone={null}
        currentTrackIndex={0}
          layers={layers}
          depthSliceVisible={false}
        depthSlicePayload={makeDepthSlicePayload({ matched_depth_m: 50, requested_depth_m: 50 })}
      />
    );
    await tick();

    expect(revokedUrls).toHaveLength(1);
  });

  it('releases the object URL on unmount (no leaked Blob URL)', async () => {
    const { unmount } = renderViewer({
      depthSliceVisible: true,
      depthSlicePayload: makeDepthSlicePayload({ matched_depth_m: 50, requested_depth_m: 50 }),
    });
    await waitForSliceLegend();
    await tick();

    unmount();
    expect(revokedUrls).toHaveLength(1);
  });
});

// ------------------------------------------------------------
// Phase 2B: interaction paths must survive on-demand rendering
// ------------------------------------------------------------
describe('Phase 2B — hover picking and camera interaction remain functional', () => {
  it('still registers the RAF-throttled hover pick and can run it without throwing', async () => {
    renderViewer({ timestamp: '2026-09-07T06:00:00Z' });
    await tick();

    const mouseMove = inputActions.find((a) => a.type === 2); // ScreenSpaceEventType.MOUSE_MOVE
    expect(mouseMove).toBeDefined();

    await act(async () => {
      mouseMove!.action({ endPosition: { x: 10, y: 20 } });
      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    });

    // Picking is a scene *read*: it must never be a render-invalidation trigger
    // (the hover path records the pick in perfMonitor instead).
    expect(inputActions.filter((a) => a.type === 2)).toHaveLength(1);
  });

  it('leaves camera movement to Cesium (flyTo still drives the viewer camera)', async () => {
    const { rerender } = renderViewer({ targetLocation: { lat: 12, lon: 80 } });
    await tick();

    const viewer = createdViewers[0];
    expect(viewer).toBeDefined();
    const flyToCalls = viewer.camera.flyTo.mock.calls.length;
    expect(flyToCalls).toBeGreaterThan(0);

    rerender(
      <CesiumViewerInner
        cyclone={null}
        currentTrackIndex={0}
          layers={layers}
          targetLocation={{ lat: 20, lon: 90 }}
      />
    );
    await tick();

    // The camera change is auto-detected by Cesium's render loop; the component
    // only needs to move the camera.
    expect(viewer.camera.flyTo.mock.calls.length).toBeGreaterThan(flyToCalls);
  });
});

describe('Argo float labels and dots', () => {
  const argoLayers: GISLayer[] = [
    ...layers,
    { id: 'argo', name: 'Argo Observations', category: 'physical', active: true, status: 'REAL', description: '' },
  ];

  it('keeps dots visible but hides text label by default until hover or selected', async () => {
    const p1 = makeArgoProfile({ profile_id: 'p1', float_id: '1001' });
    const p2 = makeArgoProfile({ profile_id: 'p2', float_id: '1002' });

    renderViewer({
      layers: argoLayers,
      argoProfiles: [p1, p2],
    });
    await tick();

    const viewer = createdViewers[0];
    expect(viewer).toBeDefined();

    const addCalls = viewer.entities.add.mock.calls.map((c) => c[0] as Record<string, unknown>);
    const p1Entity = addCalls.find((e) => e && e.name === 'Argo Float 1001');
    const p2Entity = addCalls.find((e) => e && e.name === 'Argo Float 1002');

    expect(p1Entity).toBeDefined();
    expect(p1Entity?.point).toBeDefined(); // Dot is always rendered
    expect((p1Entity?.label as Record<string, unknown>)?.show).toBe(false); // Label hidden by default
    expect((p1Entity?.label as Record<string, unknown>)?.text).toContain('REAL · GDAC');
    expect((p1Entity?.label as Record<string, unknown>)?.text).not.toContain('INGESTION PENDING');

    expect(p2Entity).toBeDefined();
    expect(p2Entity?.point).toBeDefined();
    expect((p2Entity?.label as Record<string, unknown>)?.show).toBe(false);
  });

  it('shows the text label for the selected float', async () => {
    const p1 = makeArgoProfile({ profile_id: 'p1', float_id: '1001' });
    const p2 = makeArgoProfile({ profile_id: 'p2', float_id: '1002' });

    renderViewer({
      layers: argoLayers,
      argoProfiles: [p1, p2],
      selectedArgoProfile: p1,
    });
    await tick();

    const viewer = createdViewers[0];
    const addCalls = viewer.entities.add.mock.calls.map((c) => c[0] as Record<string, unknown>);
    const p1Entity = addCalls.find((e) => e && e.name === 'Argo Float 1001');
    const p2Entity = addCalls.find((e) => e && e.name === 'Argo Float 1002');

    expect((p1Entity?.label as Record<string, unknown>)?.show).toBe(true);
    expect((p2Entity?.label as Record<string, unknown>)?.show).toBe(false);
  });
});

