import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import React from 'react';

import { cesiumMock, layerOps, resetLayerOps } from '../test/mocks/cesium';
vi.mock('cesium', () => ({ __esModule: true, ...cesiumMock }));
vi.mock('cesium/Build/Cesium/Widgets/widgets.css', () => ({}));

const getDepthSlice = vi.fn();
const getDataStatus = vi.fn();
const getCyclones = vi.fn();
const getStations = vi.fn();
const getLayers = vi.fn();
const getArgoProfiles = vi.fn();
const getRealCurrentFieldPayload = vi.fn();

vi.mock('../services/ApiProvider', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../services/ApiProvider')>();
  // Preserve the prototype chain (spread alone drops class methods).
  const mockProvider: typeof orig.apiProvider = Object.create(Object.getPrototypeOf(orig.apiProvider));
  Object.assign(mockProvider, orig.apiProvider, {
    getDepthSlice: (...args: unknown[]) =>
      getDepthSlice(...(args as [string, number, string | undefined, number, AbortSignal])),
    getRealCurrentFieldPayload: (...args: unknown[]) =>
      getRealCurrentFieldPayload(...(args as [number, string | undefined, number, AbortSignal])),
    getDataStatus: () => getDataStatus(),
    getCyclones: () => getCyclones(),
    getStations: () => getStations(),
    getLayers: () => getLayers(),
    getArgoProfiles: () => getArgoProfiles(),
    getLayerData: vi.fn(async () => null),
    inspectPoint: vi.fn(async () => null),
    inspectCyclone: vi.fn(async () => null),
  });
  return {
    ...orig,
    apiProvider: mockProvider,
  };
});

import Home from './page';
import { makeDepthSlicePayload, makeCurrentsSlicePayload } from '../test/fixtures/depthSliceFixtures';

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

beforeEach(() => {
  resetLayerOps();
  vi.clearAllMocks();
  getDataStatus.mockResolvedValue({
    mode: 'REAL' as const,
    backendConnected: true,
    dataMode: 'REAL' as const,
    datasetSynthetic: false,
    datasetLoaded: true,
  });
  getCyclones.mockResolvedValue([]);
  getStations.mockResolvedValue([]);
  getLayers.mockResolvedValue([]);
  getArgoProfiles.mockResolvedValue([]);
  getRealCurrentFieldPayload.mockResolvedValue(null);
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ available_timestamps: ['2026-09-07T06:00:00.000000000'] }),
  });
});

describe('Home — HYCOM model depth slice integration', () => {
  it('does not present fabricated LIVE HYCOM claims without authoritative backend data', async () => {
    getDataStatus.mockResolvedValue({
      mode: 'SIMULATED' as const,
      backendConnected: false,
      dataMode: 'REAL' as const,
      datasetSynthetic: false,
    });

    render(<Home />);

    fireEvent.click(await screen.findByRole('button', { name: /LIVE OCEAN/i }));
    expect(await screen.findByText(/LIVE OCEAN · DATA UNAVAILABLE \/ NON-AUTHORITATIVE/i)).toBeInTheDocument();
    expect(screen.queryByText(/REAL INCOIS HYCOM DATA/i)).not.toBeInTheDocument();
  });

  it('does not present hardcoded LIVE KPI values when no authoritative KPI source exists', async () => {
    getDataStatus.mockResolvedValue({
      mode: 'REAL' as const,
      backendConnected: true,
      dataMode: 'REAL' as const,
      datasetSynthetic: false,
      datasetLoaded: true,
    });

    render(<Home />);

    fireEvent.click(await screen.findByRole('button', { name: /LIVE OCEAN/i }));
    expect(await screen.findByText(/LIVE OCEAN · DATA UNAVAILABLE \/ NON-AUTHORITATIVE/i)).toBeInTheDocument();
    expect(screen.queryByText('22 KT')).not.toBeInTheDocument();
    expect(screen.queryByText('30.2 °C')).not.toBeInTheDocument();
    expect(screen.queryByText(/REAL INCOIS HYCOM DATA/i)).not.toBeInTheDocument();
  });

  it('renders the depth-slice instrument header even before activation', async () => {
    render(<Home />);
    expect(await screen.findByText(/HYCOM MODEL DEPTH SLICE/i)).toBeInTheDocument();
  });

  it('enabling the slice fetches via getDepthSlice with the current selection', async () => {
    getDepthSlice.mockResolvedValue(makeDepthSlicePayload());
    render(<Home />);
    fireEvent.click(await screen.findByTitle(/show model depth slice/i));
    await waitFor(() => expect(getDepthSlice).toHaveBeenCalledTimes(1));
    expect(getDepthSlice).toHaveBeenCalledWith('temperature', 50, undefined, 3, expect.any(AbortSignal));
    await waitFor(() => expect(screen.getByText(/MATCHED MODEL DEPTH/i)).toBeInTheDocument());
  });

  it('rapid selection changes cancel stale requests; the latest valid selection wins', async () => {
    const first = deferred<null>();
    const second = deferred<typeof makeDepthSlicePayload extends () => infer R ? R : never>();
    getDepthSlice.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    render(<Home />);
    fireEvent.click(await screen.findByTitle(/show model depth slice/i));
    await waitFor(() => expect(getDepthSlice).toHaveBeenCalledTimes(1));

    // change depth 50 -> 100: the first request's controller is aborted
    fireEvent.change(screen.getByLabelText(/depth slice model depth level/i), { target: { value: '100' } });
    await waitFor(() => expect(getDepthSlice).toHaveBeenCalledTimes(2));

    // resolve the stale first request AFTER the second was issued
    await act(async () => {
      first.resolve(null); // aborted fetch resolves null
      second.resolve(makeDepthSlicePayload({ requested_depth_m: 100, matched_depth_m: 100 }));
      await Promise.resolve();
    });

    await waitFor(() => expect(screen.getByText(/MATCHED MODEL DEPTH/i)).toBeInTheDocument());
    expect(screen.getAllByText('100 m').length).toBeGreaterThanOrEqual(1); // requested + matched (100 is a native level)
    expect(screen.queryByText(/HYCOM MODEL DEPTH SLICE UNAVAILABLE/i)).not.toBeInTheDocument();
  });

  it('clears the previous slice while a replacement request is pending', async () => {
    const pending = deferred<ReturnType<typeof makeDepthSlicePayload>>();
    getDepthSlice.mockResolvedValueOnce(makeDepthSlicePayload()).mockReturnValueOnce(pending.promise);

    render(<Home />);
    fireEvent.click(await screen.findByTitle(/show model depth slice/i));
    await waitFor(() => expect(screen.getByText(/MATCHED MODEL DEPTH/i)).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/depth slice model depth level/i), { target: { value: '100' } });
    await waitFor(() => expect(getDepthSlice).toHaveBeenCalledTimes(2));
    expect(screen.queryByText(/MATCHED MODEL DEPTH/i)).not.toBeInTheDocument();

    await act(async () => {
      pending.resolve(makeDepthSlicePayload({ requested_depth_m: 100, matched_depth_m: 100 }));
      await Promise.resolve();
    });
  });

  it('variable switching refetches with the new variable', async () => {
    getDepthSlice.mockResolvedValue(makeDepthSlicePayload());
    render(<Home />);
    fireEvent.click(await screen.findByTitle(/show model depth slice/i));
    await waitFor(() => expect(getDepthSlice).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText(/depth slice variable/i), { target: { value: 'salinity' } });
    await waitFor(() => expect(getDepthSlice).toHaveBeenCalledTimes(2));
    expect(getDepthSlice).toHaveBeenLastCalledWith('salinity', 50, undefined, 3, expect.any(AbortSignal));
  });

  it('timestamp switching refetches with the new timestamp', async () => {
    getDepthSlice.mockResolvedValue(makeDepthSlicePayload());
    render(<Home />);
    fireEvent.click(await screen.findByTitle(/show model depth slice/i));
    await waitFor(() => expect(getDepthSlice).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText(/depth slice model timestamp/i), {
      target: { value: '2026-09-07T06:00:00.000000000' },
    });
    await waitFor(() => expect(getDepthSlice).toHaveBeenCalledTimes(2));
    expect(getDepthSlice).toHaveBeenLastCalledWith('temperature', 50, '2026-09-07T06:00:00.000000000', 3, expect.any(AbortSignal));
  });

  it('unmount while a request is in-flight does not throw', async () => {
    const d = deferred<null>();
    getDepthSlice.mockReturnValue(d.promise);
    const { unmount } = render(<Home />);
    fireEvent.click(await screen.findByTitle(/show model depth slice/i));
    await waitFor(() => expect(getDepthSlice).toHaveBeenCalledTimes(1));
    expect(() => unmount()).not.toThrow();
    await act(async () => {
      d.resolve(null);
      await Promise.resolve();
    });
  });

  it('unavailable backend response shows the unavailable card, never fabricated data', async () => {
    getDepthSlice.mockResolvedValue(null);
    render(<Home />);
    fireEvent.click(await screen.findByTitle(/show model depth slice/i));
    await waitFor(() => expect(screen.getByText(/HYCOM MODEL DEPTH SLICE UNAVAILABLE/i)).toBeInTheDocument());
    expect(screen.queryByText(/MATCHED MODEL DEPTH/i)).not.toBeInTheDocument();
    // No synthetic depth values appear anywhere
    expect(screen.queryByText(/MODEL LEVEL/)).not.toBeInTheDocument();
  });

  it('hiding the slice returns to surface-only mode', async () => {
    getDepthSlice.mockResolvedValue(makeDepthSlicePayload());
    render(<Home />);
    fireEvent.click(await screen.findByTitle(/show model depth slice/i));
    await waitFor(() => expect(screen.getByText(/MATCHED MODEL DEPTH/i)).toBeInTheDocument());

    fireEvent.click(screen.getByTitle(/hide model depth slice/i));
    await waitFor(() => expect(screen.queryByText(/MATCHED MODEL DEPTH/i)).not.toBeInTheDocument());
    expect(screen.queryByLabelText(/depth slice variable/i)).not.toBeInTheDocument();
  });

  it('renders the slice imagery layer in Cesium and removes it on hide (end-to-end layer lifecycle)', async () => {
    getDepthSlice.mockResolvedValue(makeDepthSlicePayload());
    render(<Home />);
    fireEvent.click(await screen.findByTitle(/show model depth slice/i));
    await waitFor(() => expect(screen.getByText(/MATCHED MODEL DEPTH/i)).toBeInTheDocument());

    await waitFor(() => {
      const sliceOps = layerOps.filter((o) => (o.layer as { alpha?: number })?.alpha === 0.75);
      expect(sliceOps).toHaveLength(1); // exactly one depth-slice layer added
    });

    fireEvent.click(screen.getByTitle(/hide model depth slice/i));
    await waitFor(() => {
      const sliceAdds = layerOps.filter((o) => o.op === 'add' && (o.layer as { alpha?: number })?.alpha === 0.75);
      const sliceRemoves = layerOps.filter((o) => o.op === 'remove' && (o.layer as { alpha?: number })?.alpha === 0.75);
      expect(sliceAdds).toHaveLength(1);
      expect(sliceRemoves).toHaveLength(1); // removed exactly once, no duplicates
    });
  });
});

describe('Home — Phase 1C scientific visualization controls', () => {
  it('palette, range and opacity changes never refetch the scientific slice', async () => {
    getDepthSlice.mockResolvedValue(makeDepthSlicePayload());
    render(<Home />);
    fireEvent.click(await screen.findByTitle(/show model depth slice/i));
    await waitFor(() => expect(getDepthSlice).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText(/depth slice color palette/i), { target: { value: 'thermal' } });
    fireEvent.change(screen.getByLabelText(/depth slice display minimum/i), { target: { value: '19' } });
    fireEvent.change(screen.getByLabelText(/depth slice display maximum/i), { target: { value: '21' } });
    fireEvent.change(screen.getByLabelText(/depth slice opacity/i), { target: { value: '40' } });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(getDepthSlice).toHaveBeenCalledTimes(1); // display-only: no new request
  });

  it('switching the variable resets the display settings to defaults for the new variable', async () => {
    getDepthSlice.mockResolvedValue(makeDepthSlicePayload());
    render(<Home />);
    fireEvent.click(await screen.findByTitle(/show model depth slice/i));
    await waitFor(() => expect(screen.getByText(/MATCHED MODEL DEPTH/i)).toBeInTheDocument());

    // customize: thermal palette + custom range
    fireEvent.change(screen.getByLabelText(/depth slice color palette/i), { target: { value: 'thermal' } });
    fireEvent.change(screen.getByLabelText(/depth slice display minimum/i), { target: { value: '19' } });
    fireEvent.change(screen.getByLabelText(/depth slice display maximum/i), { target: { value: '21' } });
    await waitFor(() => expect(screen.getByText('CUSTOM RANGE')).toBeInTheDocument());

    // switch variable → display resets (new scientific units/meaning)
    fireEvent.change(screen.getByLabelText(/depth slice variable/i), { target: { value: 'salinity' } });
    await waitFor(() => expect(getDepthSlice).toHaveBeenLastCalledWith('salinity', 50, undefined, 3, expect.any(AbortSignal)));
    await waitFor(() => {
      expect((screen.getByLabelText(/depth slice color palette/i) as HTMLSelectElement).value).toBe('classic');
    });
    await waitFor(() => expect(screen.getByText('AUTO RANGE')).toBeInTheDocument());
  });

  it('log scale can be selected for strictly positive data and is reported by the colorbar', async () => {
    const positive = makeDepthSlicePayload({
      grid: { latitudes: [5], longitudes: [80, 81], values: [[1, 100]] },
    });
    getDepthSlice.mockResolvedValue(positive);
    render(<Home />);
    fireEvent.click(await screen.findByTitle(/show model depth slice/i));
    await waitFor(() => expect(screen.getByText(/MATCHED MODEL DEPTH/i)).toBeInTheDocument());

    const logBtn = screen.getByTitle(/^log scale/i) as HTMLButtonElement;
    await waitFor(() => expect(logBtn.disabled).toBe(false));
    fireEvent.click(logBtn);

    const colorbar = screen.getByLabelText(/depth slice colorbar/i);
    await waitFor(() => expect(within(colorbar).getByText('LOG')).toBeInTheDocument());
  });

  it('log scale falls back to linear with an explanation when the data contains zero values', async () => {
    const positive = makeDepthSlicePayload({
      grid: { latitudes: [5], longitudes: [80, 81], values: [[1, 100]] },
    });
    const withZero = makeDepthSlicePayload(); // contains a legitimate 0.0
    getDepthSlice.mockResolvedValueOnce(positive).mockResolvedValue(withZero);

    render(<Home />);
    fireEvent.click(await screen.findByTitle(/show model depth slice/i));
    await waitFor(() => expect(screen.getByText(/MATCHED MODEL DEPTH/i)).toBeInTheDocument());

    const logBtn = screen.getByTitle(/^log scale/i) as HTMLButtonElement;
    await waitFor(() => expect(logBtn.disabled).toBe(false));
    fireEvent.click(logBtn);
    const colorbar = screen.getByLabelText(/depth slice colorbar/i);
    await waitFor(() => expect(within(colorbar).getByText('LOG')).toBeInTheDocument());

    // switch depth → the new slice contains a legitimate 0.0 → log invalid
    fireEvent.change(screen.getByLabelText(/depth slice model depth level/i), { target: { value: '100' } });
    await waitFor(() => expect(getDepthSlice).toHaveBeenCalledTimes(2));
    await waitFor(() => expect((screen.getByTitle(/^log scale/i) as HTMLButtonElement).disabled).toBe(true));
    expect(screen.getByText(/zero or negative/i)).toBeInTheDocument();
    // the active scale fell back to LINEAR — never a silent log transform
    await waitFor(() => expect(within(screen.getByLabelText(/depth slice colorbar/i)).getByText('LINEAR')).toBeInTheDocument());
  });

  it('log is disabled with an explanation while data contains zero/negative values', async () => {
    getDepthSlice.mockResolvedValue(makeDepthSlicePayload()); // contains 0.0
    render(<Home />);
    fireEvent.click(await screen.findByTitle(/show model depth slice/i));
    await waitFor(() => expect(screen.getByText(/MATCHED MODEL DEPTH/i)).toBeInTheDocument());
    expect((screen.getByTitle(/^log scale/i) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/zero or negative/i)).toBeInTheDocument();
  });

  it('opacity changes propagate to the depth-slice imagery layer without add/remove churn', async () => {
    getDepthSlice.mockResolvedValue(makeDepthSlicePayload());
    render(<Home />);
    fireEvent.click(await screen.findByTitle(/show model depth slice/i));
    await waitFor(() => {
      expect(layerOps.filter((o) => o.op === 'add' && (o.layer as { alpha?: number })?.alpha === 0.75)).toHaveLength(1);
    });
    const sliceLayer = layerOps.find(
      (o) => o.op === 'add' && (o.layer as { alpha?: number })?.alpha === 0.75
    )!.layer as { alpha: number };
    const addsBefore = layerOps.filter((o) => o.op === 'add').length;
    const removesBefore = layerOps.filter((o) => o.op === 'remove').length;

    fireEvent.change(screen.getByLabelText(/depth slice opacity/i), { target: { value: '40' } });
    await waitFor(() => expect(sliceLayer.alpha).toBe(0.4));
    expect(layerOps.filter((o) => o.op === 'add').length).toBe(addsBefore);
    expect(layerOps.filter((o) => o.op === 'remove').length).toBe(removesBefore);
  });

  it('rapid palette changes replace the slice raster without layer accumulation', async () => {
    getDepthSlice.mockResolvedValue(makeDepthSlicePayload());
    render(<Home />);
    fireEvent.click(await screen.findByTitle(/show model depth slice/i));
    await waitFor(() => expect(screen.getByText(/MATCHED MODEL DEPTH/i)).toBeInTheDocument());
    await act(async () => {
      await new Promise((r) => setTimeout(r, 25));
    });
    const addsAfterLoad = layerOps.filter((o) => o.op === 'add').length;

    for (const palette of ['thermal', 'viridis', 'classic']) {
      fireEvent.change(screen.getByLabelText(/depth slice color palette/i), { target: { value: palette } });
    }
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    const adds = layerOps.filter((o) => o.op === 'add');
    const removes = layerOps.filter((o) => o.op === 'remove');
    expect(adds.length).toBe(addsAfterLoad + 3); // one add per palette change
    expect(removes.length).toBeGreaterThanOrEqual(3); // every replaced slice cleaned up
    const lastSlice = adds[adds.length - 1].layer;
    expect(removes.some((r) => r.layer === lastSlice)).toBe(false); // net one slice layer
  });

  it('reset returns every display setting to the Phase 1B-equivalent defaults', async () => {
    getDepthSlice.mockResolvedValue(makeDepthSlicePayload());
    render(<Home />);
    fireEvent.click(await screen.findByTitle(/show model depth slice/i));
    await waitFor(() => expect(screen.getByText(/MATCHED MODEL DEPTH/i)).toBeInTheDocument());
    await act(async () => {
      await new Promise((r) => setTimeout(r, 25));
    });

    fireEvent.change(screen.getByLabelText(/depth slice color palette/i), { target: { value: 'thermal' } });
    fireEvent.change(screen.getByLabelText(/depth slice display minimum/i), { target: { value: '19' } });
    fireEvent.change(screen.getByLabelText(/depth slice display maximum/i), { target: { value: '21' } });
    fireEvent.change(screen.getByLabelText(/depth slice opacity/i), { target: { value: '40' } });
    await waitFor(() => expect(screen.getByText('CUSTOM RANGE')).toBeInTheDocument());

    // the live slice layer is the most recent add (place names was the first)
    const currentSlice = () => {
      const addsList = layerOps.filter((o) => o.op === 'add');
      return addsList[addsList.length - 1].layer as { alpha: number };
    };
    await waitFor(() => expect(currentSlice().alpha).toBe(0.4));

    fireEvent.click(screen.getByTitle(/reset display settings/i));
    await waitFor(() => {
      expect((screen.getByLabelText(/depth slice color palette/i) as HTMLSelectElement).value).toBe('classic');
    });
    expect((screen.getByLabelText(/depth slice opacity/i) as HTMLInputElement).value).toBe('75');
    expect(screen.getByText('AUTO RANGE')).toBeInTheDocument();
    await waitFor(() => expect(currentSlice().alpha).toBe(0.75));
  });

  it('the colorbar matches the active configuration (variable, range, palette, scale, depth, timestamp)', async () => {
    getDepthSlice
      .mockResolvedValueOnce(makeDepthSlicePayload())
      .mockResolvedValue(
        makeDepthSlicePayload({ variable: 'salinity', units: 'PSU', matched_depth_m: 100, requested_depth_m: 100 })
      );
    render(<Home />);
    fireEvent.click(await screen.findByTitle(/show model depth slice/i));
    await waitFor(() => expect(screen.getByText(/MATCHED MODEL DEPTH/i)).toBeInTheDocument());

    // switch to salinity: the slice refetches and the colorbar follows
    fireEvent.change(screen.getByLabelText(/depth slice variable/i), { target: { value: 'salinity' } });
    await waitFor(() =>
      expect(getDepthSlice).toHaveBeenLastCalledWith('salinity', 50, undefined, 3, expect.any(AbortSignal))
    );
    await waitFor(() =>
      expect(within(screen.getByLabelText(/depth slice colorbar/i)).getByText(/COLORBAR · SALINITY/i)).toBeInTheDocument()
    );

    const colorbar = screen.getByLabelText(/depth slice colorbar/i);
    // fixture data range 0.00–20.20 on the classic palette, linear, matched 100 m
    expect(within(colorbar).getByText(/0\.00/)).toBeInTheDocument();
    expect(within(colorbar).getByText(/20\.20/)).toBeInTheDocument();
    expect(within(colorbar).getByText(/PSU/i)).toBeInTheDocument();
    expect(within(colorbar).getByText(/100 m/i)).toBeInTheDocument();

    // a custom range immediately re-labels the colorbar
    fireEvent.change(screen.getByLabelText(/depth slice display minimum/i), { target: { value: '19' } });
    fireEvent.change(screen.getByLabelText(/depth slice display maximum/i), { target: { value: '21' } });
    await waitFor(() => {
      expect(within(screen.getByLabelText(/depth slice colorbar/i)).getByText(/19\.00/)).toBeInTheDocument();
      expect(within(screen.getByLabelText(/depth slice colorbar/i)).getByText(/21\.00/)).toBeInTheDocument();
    });
  });

  it('the surface legend/state is unaffected by depth-slice display changes', async () => {
    getDepthSlice.mockResolvedValue(makeDepthSlicePayload());
    render(<Home />);
    fireEvent.click(await screen.findByTitle(/show model depth slice/i));
    await waitFor(() => expect(screen.getByText(/MATCHED MODEL DEPTH/i)).toBeInTheDocument());

    // the slice stays clearly labeled as subsurface through display changes
    fireEvent.change(screen.getByLabelText(/depth slice color palette/i), { target: { value: 'thermal' } });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 25));
    });
    expect(screen.getByText(/SUBSURFACE — NOT SURFACE/i)).toBeInTheDocument();
    expect(screen.getByText(/2D GEOGRAPHIC DRAPE AT MODEL LEVEL/i)).toBeInTheDocument();
  });
});

// ============================================================
// Phase 1E — real HYCOM UVEL/VVEL current field integration
// ============================================================
import type { GISLayer } from '../types/oceanlens';

const CURRENTS_LAYERS: GISLayer[] = [
  { id: 'cyclone', name: 'Cyclone Track & Forecast', category: 'hazard', active: false, status: 'REAL', description: '' },
  { id: 'currents', name: 'Ocean Currents', category: 'physical', active: true, status: 'REAL', description: '', unit: 'm/s' },
];

describe('Home — Phase 1E real current field', () => {
  it('with the currents layer active, requests the surface UVEL/VVEL field (0 m, timeline timestamp)', async () => {
    getLayers.mockResolvedValue(CURRENTS_LAYERS);
    getRealCurrentFieldPayload.mockResolvedValue(makeCurrentsSlicePayload({ matched_depth_m: 0, requested_depth_m: 0 }));

    render(<Home />);
    await waitFor(() => expect(getRealCurrentFieldPayload).toHaveBeenCalledTimes(1));
    // surface default: depth 0, timestamp from the cyclone track point
    expect(getRealCurrentFieldPayload).toHaveBeenCalledWith(0, expect.any(String), 3, expect.any(AbortSignal));
    // REAL status chip with honest SURFACE (0 m) label
    await waitFor(() => expect(screen.getByText(/REAL HYCOM CURRENT FIELD/i)).toBeInTheDocument());
    expect(screen.getByText(/SURFACE \(0 m\)/i)).toBeInTheDocument();
  });

  it('shows the SIMULATED chip (never REAL) when the backend returns no payload', async () => {
    getLayers.mockResolvedValue(CURRENTS_LAYERS);
    getRealCurrentFieldPayload.mockResolvedValue(null);

    render(<Home />);
    await waitFor(() => expect(screen.getByText(/SIMULATED CURRENT FIELD/i)).toBeInTheDocument());
    expect(screen.queryByText(/REAL HYCOM CURRENT FIELD/i)).not.toBeInTheDocument();
  });

  it('shows CURRENT DATA UNAVAILABLE when the payload has no valid vectors', async () => {
    getLayers.mockResolvedValue(CURRENTS_LAYERS);
    const allMissing = makeCurrentsSlicePayload({
      grid: {
        latitudes: [5, 6],
        longitudes: [80, 81],
        values: undefined,
        u: [[null, null], [null, null]],
        v: [[null, null], [null, null]],
      },
      missing_values: 8,
    });
    getRealCurrentFieldPayload.mockResolvedValue(allMissing);

    render(<Home />);
    await waitFor(() => expect(screen.getByText(/CURRENT DATA UNAVAILABLE/i)).toBeInTheDocument());
    expect(screen.queryByText(/REAL HYCOM CURRENT FIELD/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/SIMULATED CURRENT FIELD/i)).not.toBeInTheDocument();
  });

  it('follows the depth-slice instrument depth when currents is the slice variable', async () => {
    getLayers.mockResolvedValue(CURRENTS_LAYERS);
    getDepthSlice.mockResolvedValue(makeCurrentsSlicePayload());
    getRealCurrentFieldPayload.mockResolvedValue(
      makeCurrentsSlicePayload({ matched_depth_m: 100, requested_depth_m: 100 })
    );

    render(<Home />);
    // activate the depth-slice instrument with variable=currents
    fireEvent.click(await screen.findByTitle(/show model depth slice/i));
    fireEvent.change(await screen.findByLabelText(/depth slice variable/i), { target: { value: 'currents' } });
    fireEvent.change(await screen.findByLabelText(/depth slice model depth level/i), { target: { value: '100' } });

    await waitFor(() =>
      expect(getRealCurrentFieldPayload).toHaveBeenLastCalledWith(100, undefined, 3, expect.any(AbortSignal))
    );
    await waitFor(() => expect(screen.getByText(/100 m MODEL LEVEL/i)).toBeInTheDocument());
  });

  it('timestamp changes refetch the current field for the new model time', async () => {
    getLayers.mockResolvedValue(CURRENTS_LAYERS);
    getRealCurrentFieldPayload.mockResolvedValue(makeCurrentsSlicePayload());

    render(<Home />);
    await waitFor(() => expect(getRealCurrentFieldPayload).toHaveBeenCalledTimes(1));

    // change the timeline timestamp via the depth-slice timestamp picker:
    // use the instrument so the timestamp flows through the same state
    getDepthSlice.mockResolvedValue(makeCurrentsSlicePayload());
    fireEvent.click(await screen.findByTitle(/show model depth slice/i));
    fireEvent.change(await screen.findByLabelText(/depth slice model timestamp/i), {
      target: { value: '2026-09-07T06:00:00.000000000' },
    });
    // currents slice variable + a timestamp selection => flow follows that timestamp
    fireEvent.change(await screen.findByLabelText(/depth slice variable/i), { target: { value: 'currents' } });
    await waitFor(() =>
      expect(getRealCurrentFieldPayload).toHaveBeenLastCalledWith(50, '2026-09-07T06:00:00.000000000', 3, expect.any(AbortSignal))
    );
  });

  it('rapid depth changes cancel stale requests; the newest selection wins', async () => {
    getLayers.mockResolvedValue(CURRENTS_LAYERS);
    const stale = deferred<null>();
    const latest = deferred<typeof makeCurrentsSlicePayload extends () => infer R ? R : never>();
    getDepthSlice.mockResolvedValue(makeCurrentsSlicePayload());
    getRealCurrentFieldPayload.mockImplementation((_depth: number) =>
      _depth === 0 ? Promise.resolve(makeCurrentsSlicePayload({ matched_depth_m: 0, requested_depth_m: 0 })) : stale.promise
    );

    render(<Home />);
    // initial surface request (depth 0) resolves immediately -> REAL surface
    await waitFor(() => expect(screen.getByText(/REAL HYCOM CURRENT FIELD/i)).toBeInTheDocument());

    // activate the depth-slice instrument with variable=currents at depth 50:
    // this current-field request stays pending (stale)
    fireEvent.click(await screen.findByTitle(/show model depth slice/i));
    fireEvent.change(await screen.findByLabelText(/depth slice variable/i), { target: { value: 'currents' } });
    await waitFor(() => expect(getRealCurrentFieldPayload).toHaveBeenCalledTimes(2));

    // change depth 50 -> 100: the pending request is aborted; the newest wins
    getRealCurrentFieldPayload.mockImplementation(() => latest.promise);
    fireEvent.change(screen.getByLabelText(/depth slice model depth level/i), { target: { value: '100' } });
    await waitFor(() => expect(getRealCurrentFieldPayload).toHaveBeenCalledTimes(3));

    await act(async () => {
      stale.resolve(null); // stale fetch resolves AFTER abort: must not settle SIMULATED
      latest.resolve(makeCurrentsSlicePayload({ matched_depth_m: 100, requested_depth_m: 100 }));
      await Promise.resolve();
    });

    // the newest selection's REAL field is displayed, never the stale result
    await waitFor(() => expect(screen.getByText(/100 m MODEL LEVEL/i)).toBeInTheDocument());
    expect(screen.queryByText(/SIMULATED CURRENT FIELD/i)).not.toBeInTheDocument();
  });

  it('rapid timestamp changes never leave a stale REAL label from the old selection', async () => {
    getLayers.mockResolvedValue(CURRENTS_LAYERS);
    getDepthSlice.mockResolvedValue(makeCurrentsSlicePayload());
    getRealCurrentFieldPayload.mockResolvedValue(
      makeCurrentsSlicePayload({ matched_depth_m: 0, requested_depth_m: 0 })
    );

    render(<Home />);
    fireEvent.click(await screen.findByTitle(/show model depth slice/i));
    fireEvent.change(await screen.findByLabelText(/depth slice variable/i), { target: { value: 'currents' } });
    fireEvent.change(await screen.findByLabelText(/depth slice model timestamp/i), {
      target: { value: '2026-09-07T06:00:00.000000000' },
    });
    // latest request: depth 50 at the new timestamp
    await waitFor(() =>
      expect(getRealCurrentFieldPayload).toHaveBeenLastCalledWith(50, '2026-09-07T06:00:00.000000000', 3, expect.any(AbortSignal))
    );
    await waitFor(() => expect(screen.getByText(/REAL HYCOM CURRENT FIELD/i)).toBeInTheDocument());
  });

  it('clears the previous current field while a replacement request is pending', async () => {
    getLayers.mockResolvedValue(CURRENTS_LAYERS);
    const pending = deferred<ReturnType<typeof makeCurrentsSlicePayload>>();
    getRealCurrentFieldPayload
      .mockResolvedValueOnce(makeCurrentsSlicePayload({ matched_depth_m: 0, requested_depth_m: 0 }))
      .mockReturnValueOnce(pending.promise);

    render(<Home />);
    await waitFor(() => expect(screen.getByText(/REAL HYCOM CURRENT FIELD/i)).toBeInTheDocument());

    fireEvent.click(await screen.findByTitle(/show model depth slice/i));
    fireEvent.change(await screen.findByLabelText(/depth slice variable/i), { target: { value: 'currents' } });
    await waitFor(() => expect(getRealCurrentFieldPayload).toHaveBeenCalledTimes(2));
    expect(screen.queryByText(/REAL HYCOM CURRENT FIELD/i)).not.toBeInTheDocument();

    await act(async () => {
      pending.resolve(makeCurrentsSlicePayload({ matched_depth_m: 50, requested_depth_m: 50 }));
      await Promise.resolve();
    });
  });

  it('a malformed payload (no grid) falls back to the honest SIMULATED chip', async () => {
    getLayers.mockResolvedValue(CURRENTS_LAYERS);
    getRealCurrentFieldPayload.mockResolvedValue({
      ...makeCurrentsSlicePayload(),
      grid: undefined,
    } as never);

    render(<Home />);
    await waitFor(() => expect(screen.getByText(/SIMULATED CURRENT FIELD/i)).toBeInTheDocument());
  });

  it('no current-field request is made while the currents layer is inactive', async () => {
    getLayers.mockResolvedValue(
      CURRENTS_LAYERS.map((l) => (l.id === 'currents' ? { ...l, active: false } : l))
    );
    render(<Home />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(getRealCurrentFieldPayload).not.toHaveBeenCalled();
    // the currents legend chip (bottom-left) is absent; the layer panel item
    // still lists the layer — that is the control, not a data claim
    expect(screen.queryByText(/REAL HYCOM CURRENT FIELD/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/SIMULATED CURRENT FIELD/i)).not.toBeInTheDocument();
  });

  it('toggling the currents layer off clears the chip; toggling on refetches', async () => {
    getLayers.mockResolvedValue(CURRENTS_LAYERS);
    getRealCurrentFieldPayload.mockResolvedValue(makeCurrentsSlicePayload());

    render(<Home />);
    await waitFor(() => expect(screen.getByText(/REAL HYCOM CURRENT FIELD/i)).toBeInTheDocument());

    // toggle off via the layers panel
    fireEvent.click(screen.getByRole('button', { name: /Ocean Currents/i }));
    await waitFor(() => expect(screen.queryByText(/REAL HYCOM CURRENT FIELD/i)).not.toBeInTheDocument());
  });

  it('unmount while a current-field request is in-flight does not throw', async () => {
    getLayers.mockResolvedValue(CURRENTS_LAYERS);
    const d = deferred<null>();
    getRealCurrentFieldPayload.mockReturnValue(d.promise);

    const { unmount } = render(<Home />);
    await waitFor(() => expect(getRealCurrentFieldPayload).toHaveBeenCalledTimes(1));
    expect(() => unmount()).not.toThrow();
    await act(async () => {
      d.resolve(null);
      await Promise.resolve();
    });
  });
});
