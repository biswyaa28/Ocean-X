import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApiProvider } from './ApiProvider';
import { demoProvider } from './DemoProvider';
import { GISLayer } from '../types/oceanlens';

const BACKEND_LAYERS: GISLayer[] = [
  {
    id: 'currents',
    name: 'Ocean Currents (HYCOM)',
    category: 'physical',
    active: true,
    status: 'REAL',
    description: 'INCOIS HYCOM',
    unit: 'm/s',
  },
];

describe('ApiProvider.getLayers', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the backend /api/layers response as the authoritative layer source', async () => {
    const provider = new ApiProvider();

    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) }) // /health
      .mockResolvedValueOnce({ ok: true, json: async () => BACKEND_LAYERS }); // /api/layers

    const layers = await provider.getLayers();
    expect(global.fetch).toHaveBeenNthCalledWith(2, expect.stringContaining('/api/layers'));
    expect(layers).toEqual(BACKEND_LAYERS);
  });

  it('reaches the frontend as SIMULATED for FIXTURE backend data', async () => {
    const provider = new ApiProvider();
    const fixtureLayers: GISLayer[] = [
      {
        id: 'currents',
        name: 'Ocean Currents (HYCOM)',
        category: 'physical',
        active: true,
        status: 'SIMULATED',
        description: 'synthetic fixture',
        unit: 'm/s',
      },
    ];

    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) }) // /health
      .mockResolvedValueOnce({ ok: true, json: async () => fixtureLayers }); // /api/layers

    const layers = await provider.getLayers();
    expect(layers[0].status).toBe('SIMULATED');
    expect(layers).toEqual(fixtureLayers);
  });

  it('does not call demoProvider.getLayers() when the backend health check fails', async () => {
    const provider = new ApiProvider();
    const demoSpy = vi.spyOn(demoProvider, 'getLayers');

    global.fetch = vi.fn().mockResolvedValueOnce({ ok: false, json: async () => ({}) }); // /health fails

    const layers = await provider.getLayers();
    expect(demoSpy).not.toHaveBeenCalled();
    expect(layers).toEqual([]);
    // Only the health probe was issued; no demo substitution and no /layers call.
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('does not call demoProvider.getLayers() when /api/layers returns a non-OK response', async () => {
    const provider = new ApiProvider();
    const demoSpy = vi.spyOn(demoProvider, 'getLayers');

    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) }) // /health succeeds
      .mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({ detail: 'unavailable' }) }); // /api/layers fails

    const layers = await provider.getLayers();
    expect(demoSpy).not.toHaveBeenCalled();
    expect(layers).toEqual([]);
  });

  it('does not silently convert an empty /api/layers payload into demo layers', async () => {
    const provider = new ApiProvider();
    const demoSpy = vi.spyOn(demoProvider, 'getLayers');

    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) }) // /health succeeds
      .mockResolvedValueOnce({ ok: true, json: async () => [] }); // /api/layers empty

    const layers = await provider.getLayers();
    expect(demoSpy).not.toHaveBeenCalled();
    expect(layers).toEqual([]);
  });

  it('does not call demoProvider.getLayers() when the /api/layers fetch rejects', async () => {
    const provider = new ApiProvider();
    const demoSpy = vi.spyOn(demoProvider, 'getLayers');

    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) }) // /health succeeds
      .mockRejectedValueOnce(new Error('network error')); // /api/layers fails

    const layers = await provider.getLayers();
    expect(demoSpy).not.toHaveBeenCalled();
    expect(layers).toEqual([]);
  });

  it('preserves the REAL backend unavailable state instead of demo availability', async () => {
    const provider = new ApiProvider();
    const demoLayers = await demoProvider.getLayers();
    const demoSpy = vi.spyOn(demoProvider, 'getLayers');

    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) }) // REAL backend /health OK
      .mockResolvedValueOnce({ ok: true, json: async () => [] }); // REAL backend has no layer data

    const layers = await provider.getLayers();
    expect(demoSpy).not.toHaveBeenCalled();
    expect(layers).not.toEqual(demoLayers);
    expect(layers).toEqual([]);
  });

  it('does not manufacture layers from a non-array backend payload', async () => {
    const provider = new ApiProvider();
    const demoSpy = vi.spyOn(demoProvider, 'getLayers');

    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) }) // /health succeeds
      .mockResolvedValueOnce({ ok: true, json: async () => ({ layers: BACKEND_LAYERS }) }); // malformed

    const layers = await provider.getLayers();
    expect(demoSpy).not.toHaveBeenCalled();
    expect(layers).toEqual([]);
  });
});
