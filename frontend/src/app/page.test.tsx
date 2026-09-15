import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
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

vi.mock('../services/ApiProvider', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../services/ApiProvider')>();
  // Preserve the prototype chain (spread alone drops class methods).
  const mockProvider: typeof orig.apiProvider = Object.create(Object.getPrototypeOf(orig.apiProvider));
  Object.assign(mockProvider, orig.apiProvider, {
    getDepthSlice: (...args: unknown[]) =>
      getDepthSlice(...(args as [string, number, string | undefined, number, AbortSignal])),
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
import { makeDepthSlicePayload } from '../test/fixtures/depthSliceFixtures';

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
  getDataStatus.mockResolvedValue({ mode: 'REAL' as const, backendConnected: true });
  getCyclones.mockResolvedValue([]);
  getStations.mockResolvedValue([]);
  getLayers.mockResolvedValue([]);
  getArgoProfiles.mockResolvedValue([]);
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ available_timestamps: ['2026-09-07T06:00:00.000000000'] }),
  });
});

describe('Home — HYCOM model depth slice integration', () => {
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
    fireEvent.change(screen.getByLabelText(/requested depth in meters/i), { target: { value: '100' } });
    await waitFor(() => expect(getDepthSlice).toHaveBeenCalledTimes(2));

    // resolve the stale first request AFTER the second was issued
    await act(async () => {
      first.resolve(null); // aborted fetch resolves null
      second.resolve(makeDepthSlicePayload({ requested_depth_m: 100, matched_depth_m: 100 }));
      await Promise.resolve();
    });

    await waitFor(() => expect(screen.getByText(/MATCHED MODEL DEPTH/i)).toBeInTheDocument());
    expect(screen.getAllByText('100 m').length).toBeGreaterThanOrEqual(1); // requested + matched (100 is a native level)
    expect(screen.queryByText(/UNAVAILABLE/i)).not.toBeInTheDocument();
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
