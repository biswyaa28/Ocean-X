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

// ============================================================
// Phase 2B — bounded layer-data cache + in-flight deduplication
//
// The cache key must include every response-affecting request parameter:
//   getLayerData  → layer | timestamp | stride
//   getDepthSlice → variable | depth | timestamp | stride
// A key that omits one of these would silently serve the wrong scientific
// slice, so each dimension gets its own collision test.
// ============================================================

const LAYER_PAYLOAD = {
  status: 'REAL',
  source: 'INCOIS RSMC HYCOM',
  layer_name: 'sst',
  timestamp: '2026-09-07T06:00:00.000000000',
  units: '°C',
  bounds: { minLat: 5, maxLat: 7, minLon: 80, maxLon: 82 },
  grid: { latitudes: [5, 6], longitudes: [80, 81], values: [[28.1, 28.2], [28.3, 28.4]] },
};

const DEPTH_PAYLOAD = {
  status: 'REAL',
  source: 'INCOIS RSMC HYCOM',
  dataset_file: 'hycom_20260907.nc',
  variable: 'temperature',
  units: '°C',
  timestamp: '2026-09-07T06:00:00',
  requested_depth_m: 50,
  matched_depth_m: 50,
  available_depths_m: [0, 50, 100],
  depth_selection: 'nearest_native_level',
  missing_values: 0,
  bounds: { minLat: 5, maxLat: 7, minLon: 80, maxLon: 82 },
  grid: { latitudes: [5], longitudes: [80], values: [[20]] },
};

function okResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

/** Installs a fetch double. `handler` receives the URL and the fetch init. */
function installFetch(handler: (url: string, init?: RequestInit) => unknown) {
  const fetchMock = vi.fn();
  fetchMock.mockImplementation(async (input: unknown, init?: RequestInit) => handler(String(input), init));
  global.fetch = fetchMock;
  return fetchMock;
}

function callsTo(fetchMock: ReturnType<typeof vi.fn>, needle: string): number {
  return fetchMock.mock.calls.filter((call) => String(call[0]).includes(needle)).length;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
describe('ApiProvider Phase 2B — layer-data cache & request deduplication', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('serves an identical request from the cache without a second HTTP request', async () => {
    const provider = new ApiProvider();
    const fetchMock = installFetch((url) => (url.includes('/layers/sst') ? okResponse(LAYER_PAYLOAD) : okResponse({})));

    const first = await provider.getLayerData('sst', 't1', 3);
    const second = await provider.getLayerData('sst', 't1', 3);

    expect(first).toEqual(LAYER_PAYLOAD);
    expect(second).toEqual(LAYER_PAYLOAD);
    expect(callsTo(fetchMock, '/layers/sst')).toBe(1);
  });

  it('concurrent identical requests share ONE in-flight promise and ONE HTTP request', async () => {
    const provider = new ApiProvider();
    const gate = deferred<unknown>();
    const fetchMock = installFetch((url) => {
      if (url.includes('/layers/sst')) return gate.promise;
      return okResponse({});
    });

    const first = provider.getLayerData('sst', 't1', 3);
    const second = provider.getLayerData('sst', 't1', 3);
    const third = provider.getLayerData('sst', 't1', 3);
    await settle(); // let the shared /health probe + the layer request start
    expect(callsTo(fetchMock, '/layers/sst')).toBe(1);

    gate.resolve(okResponse(LAYER_PAYLOAD));
    const results = await Promise.all([first, second, third]);
    expect(results).toEqual([LAYER_PAYLOAD, LAYER_PAYLOAD, LAYER_PAYLOAD]);
    expect(callsTo(fetchMock, '/layers/sst')).toBe(1);
  });

  it('an in-flight entry is released after settlement (a later key miss refetches)', async () => {
    const provider = new ApiProvider();
    const gate = deferred<unknown>();
    const fetchMock = installFetch((url) => {
      if (url.includes('/layers/sst')) return gate.promise;
      return okResponse({});
    });

    const pending = provider.getLayerData('sst', 't1', 3);
    gate.resolve(okResponse(LAYER_PAYLOAD));
    await pending;

    // a *different* key must still hit the network
    await provider.getLayerData('sst', 't2', 3);
    expect(callsTo(fetchMock, '/layers/sst')).toBe(2);
  });

  it('different timestamps never collide', async () => {
    const provider = new ApiProvider();
    const fetchMock = installFetch((url) => {
      if (url.includes('/layers/sst')) {
        return okResponse({ ...LAYER_PAYLOAD, timestamp: url.includes('t2') ? 't2' : 't1' });
      }
      return okResponse({});
    });

    const t1 = await provider.getLayerData('sst', 't1', 3);
    const t2 = await provider.getLayerData('sst', 't2', 3);
    expect(t1?.timestamp).toBe('t1');
    expect(t2?.timestamp).toBe('t2');
    expect(callsTo(fetchMock, '/layers/sst')).toBe(2);
  });

  it('different strides never collide', async () => {
    const provider = new ApiProvider();
    const fetchMock = installFetch((url) => (url.includes('/layers/sst') ? okResponse(LAYER_PAYLOAD) : okResponse({})));

    await provider.getLayerData('sst', 't1', 3);
    await provider.getLayerData('sst', 't1', 5);
    expect(callsTo(fetchMock, '/layers/sst')).toBe(2);
  });

  it('different layers never collide', async () => {
    const provider = new ApiProvider();
    const fetchMock = installFetch((url) => (url.includes('/layers/') ? okResponse(LAYER_PAYLOAD) : okResponse({})));

    await provider.getLayerData('sst', 't1', 3);
    await provider.getLayerData('salinity', 't1', 3);
    expect(callsTo(fetchMock, '/layers/sst')).toBe(1);
    expect(callsTo(fetchMock, '/layers/salinity')).toBe(1);
  });

  it('a missing timestamp ("latest") is a distinct key from an explicit timestamp', async () => {
    const provider = new ApiProvider();
    const fetchMock = installFetch((url) => (url.includes('/layers/sst') ? okResponse(LAYER_PAYLOAD) : okResponse({})));

    await provider.getLayerData('sst', undefined, 3);
    await provider.getLayerData('sst', 't1', 3);
    expect(callsTo(fetchMock, '/layers/sst')).toBe(2);
  });
});


describe('ApiProvider Phase 2B — depth-slice cache, eviction, failures and cancellation', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('caches depth slices per (variable, depth, timestamp, stride) — no dimension collides', async () => {
    const provider = new ApiProvider();
    const fetchMock = installFetch((url) => (url.includes('/model/depth-slice') ? okResponse(DEPTH_PAYLOAD) : okResponse({})));

    await provider.getDepthSlice('temperature', 50, 't1', 3);
    await provider.getDepthSlice('temperature', 50, 't1', 3); // cache hit
    expect(callsTo(fetchMock, '/model/depth-slice')).toBe(1);

    await provider.getDepthSlice('temperature', 100, 't1', 3); // different depth
    await provider.getDepthSlice('salinity', 50, 't1', 3); // different variable
    await provider.getDepthSlice('temperature', 50, 't2', 3); // different timestamp
    await provider.getDepthSlice('temperature', 50, 't1', 5); // different stride
    expect(callsTo(fetchMock, '/model/depth-slice')).toBe(5);
  });

  it('the currents depth slice and the current-field fetch share ONE request', async () => {
    const provider = new ApiProvider();
    const fetchMock = installFetch((url) => (url.includes('/model/depth-slice') ? okResponse(DEPTH_PAYLOAD) : okResponse({})));

    const [slice, field] = await Promise.all([
      provider.getDepthSlice('currents', 50, 't1', 3),
      provider.getRealCurrentFieldPayload(50, 't1', 3),
    ]);

    expect(slice).toEqual(DEPTH_PAYLOAD);
    expect(field).toEqual(DEPTH_PAYLOAD);
    expect(callsTo(fetchMock, '/model/depth-slice')).toBe(1);
  });

  it('keeps the cache bounded: the oldest entry is evicted, recent ones stay', async () => {
    const provider = new ApiProvider();
    const fetchMock = installFetch((url) => (url.includes('/layers/sst') ? okResponse(LAYER_PAYLOAD) : okResponse({})));

    // MAX_ENTRIES is 24 per cache.
    for (let i = 0; i < 25; i++) {
      await provider.getLayerData('sst', `t${i}`, 3);
    }
    expect(callsTo(fetchMock, '/layers/sst')).toBe(25);

    // t0 (oldest) was evicted → refetched
    await provider.getLayerData('sst', 't0', 3);
    expect(callsTo(fetchMock, '/layers/sst')).toBe(26);

    // t24 (most recent) is still cached → no extra request
    await provider.getLayerData('sst', 't24', 3);
    expect(callsTo(fetchMock, '/layers/sst')).toBe(26);
  });

  it('a rejected request is never cached (the next call retries)', async () => {
    const provider = new ApiProvider();
    let attempts = 0;
    const fetchMock = installFetch((url) => {
      if (url.includes('/layers/sst')) {
        attempts++;
        if (attempts === 1) throw new Error('network down');
        return okResponse(LAYER_PAYLOAD);
      }
      return okResponse({});
    });

    expect(await provider.getLayerData('sst', 't1', 3)).toBeNull();
    expect(await provider.getLayerData('sst', 't1', 3)).toEqual(LAYER_PAYLOAD);
    expect(callsTo(fetchMock, '/layers/sst')).toBe(2);
  });

  it('a non-OK response is never cached (the next call retries)', async () => {
    const provider = new ApiProvider();
    let healthy = false;
    const fetchMock = installFetch((url) => {
      if (url.includes('/layers/sst')) {
        return healthy ? okResponse(LAYER_PAYLOAD) : { ok: false, status: 503, json: async () => ({ detail: 'unavailable' }) };
      }
      return okResponse({});
    });

    expect(await provider.getLayerData('sst', 't1', 3)).toBeNull();
    healthy = true;
    expect(await provider.getLayerData('sst', 't1', 3)).toEqual(LAYER_PAYLOAD);
    expect(callsTo(fetchMock, '/layers/sst')).toBe(2);
  });
});


describe('ApiProvider Phase 2B — cancellation semantics & health-probe sharing', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('an already-aborted consumer issues no request and receives no data', async () => {
    const provider = new ApiProvider();
    const fetchMock = installFetch(() => okResponse(LAYER_PAYLOAD));
    const controller = new AbortController();
    controller.abort();

    expect(await provider.getLayerData('sst', 't1', 3, controller.signal)).toBeNull();
    expect(callsTo(fetchMock, '/layers/sst')).toBe(0);
  });

  it('one consumer aborting never cancels a request another consumer still needs', async () => {
    const provider = new ApiProvider();
    const gate = deferred<unknown>();
    let layersSignal: AbortSignal | undefined;
    const fetchMock = installFetch((url, init) => {
      if (url.includes('/layers/sst')) {
        layersSignal = init?.signal ?? undefined;
        return gate.promise;
      }
      return okResponse({});
    });

    const controller = new AbortController();
    const detached = provider.getLayerData('sst', 't1', 3, controller.signal);
    const interested = provider.getLayerData('sst', 't1', 3);
    await settle(); // let the shared /health probe + the layer request start
    expect(callsTo(fetchMock, '/layers/sst')).toBe(1);

    controller.abort();
    expect(await detached).toBeNull();
    // the shared request is still alive for the remaining subscriber
    expect(layersSignal?.aborted).toBe(false);

    gate.resolve(okResponse(LAYER_PAYLOAD));
    expect(await interested).toEqual(LAYER_PAYLOAD);
    expect(callsTo(fetchMock, '/layers/sst')).toBe(1);
  });

  it('aborting the only subscriber cancels the underlying request (pre-2B behavior preserved)', async () => {
    const provider = new ApiProvider();
    let layersSignal: AbortSignal | undefined;
    const fetchMock = installFetch((url, init) => {
      if (url.includes('/layers/sst')) {
        layersSignal = init?.signal ?? undefined;
        return new Promise((_resolve, reject) => {
          layersSignal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        });
      }
      return okResponse({});
    });

    const controller = new AbortController();
    const pending = provider.getLayerData('sst', 't1', 3, controller.signal);
    await settle();
    expect(callsTo(fetchMock, '/layers/sst')).toBe(1);
    expect(layersSignal?.aborted).toBe(false);

    controller.abort();
    expect(await pending).toBeNull();
    expect(layersSignal?.aborted).toBe(true);
  });

  it('concurrent layer requests share ONE /health probe', async () => {
    const provider = new ApiProvider();
    const fetchMock = installFetch((url) => (url.includes('/layers/') ? okResponse(LAYER_PAYLOAD) : okResponse({})));

    await Promise.all([provider.getLayerData('sst', 't1', 3), provider.getLayerData('salinity', 't1', 3)]);
    expect(callsTo(fetchMock, '/health')).toBe(1);
  });
});



// ---------------------------------------------------------------------------
// getRiskAssessment — the backend is the sole scorer.
//
// The header used to recompute the heuristic client-side with no model data,
// so it always rendered UNAVAILABLE (or, before that, a score invented from
// 65.0/30.2 defaults). It now reads GET /risk/{cycloneId} and shows whatever
// the backend says, including its UNAVAILABLE reason.
// ---------------------------------------------------------------------------

describe('ApiProvider.getRiskAssessment', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches the backend score for the requested cyclone', async () => {
    const provider = new ApiProvider();
    const body = {
      status: 'OK',
      heuristicDemoScore: 48,
      category: 'ELEVATED',
      weights: { windMaxPoints: 45 },
    };

    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ backendConnected: true }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => body });

    const result = await provider.getRiskAssessment('2020153N13072');
    expect(result).toEqual(body);
    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('/api/risk/2020153N13072'),
      expect.anything()
    );
  });

  it('passes the scrubbed track index through to the backend', async () => {
    const provider = new ApiProvider();
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ backendConnected: true }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ status: 'UNAVAILABLE' }) });

    await provider.getRiskAssessment('2020153N13072', 12);
    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('index=12'),
      expect.anything()
    );
  });

  it('surfaces an UNAVAILABLE assessment rather than substituting a score', async () => {
    const provider = new ApiProvider();
    const body = {
      status: 'UNAVAILABLE',
      unavailableReason: 'No real INCOIS HYCOM model data loaded.',
      heuristicDemoScore: null,
      category: null,
    };
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ backendConnected: true }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => body });

    const result = await provider.getRiskAssessment('X');
    expect(result?.status).toBe('UNAVAILABLE');
    expect(result?.heuristicDemoScore).toBeNull();
    expect(result?.unavailableReason).toBeTruthy();
  });

  it('returns null for a 404 instead of falling back to a different storm', async () => {
    const provider = new ApiProvider();
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ backendConnected: true }) })
      .mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({ detail: 'not found' }) });

    const result = await provider.getRiskAssessment('NOT-A-STORM');
    expect(result).toBeNull();
  });
});

describe('DemoProvider.getRiskAssessment', () => {
  it('never invents a score when the backend is unavailable', async () => {
    const result = await demoProvider.getRiskAssessment('ANY', 0);
    expect(result.status).toBe('UNAVAILABLE');
    expect(result.heuristicDemoScore).toBeNull();
    expect(result.validated).toBe(false);
    expect(result.operationalUse).toBe('NOT FOR OPERATIONAL USE');
    expect(result.unavailableReason).toBeTruthy();
  });
});
