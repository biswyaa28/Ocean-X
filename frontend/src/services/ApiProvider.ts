import { DataProvider } from './DataProvider';
import { demoProvider } from './DemoProvider';
import {
  Cyclone,
  Hazard,
  RiskAssessment,
  GISLayer,
  KPIMetrics,
  DataStatus,
  DataModeType,
  ArgoProfile,
  ArgoMatchupResponse,
  ArgoObservationPoint,
  ArgoMatchupSummary,
  MatchupMode,
  MatchupSpatialMode,
} from '../types/oceanlens';
import { perfMonitor } from '../utils/perfMonitor';

export type ScientificDataStatus = 'REAL' | 'SIMULATED' | 'DEMO' | 'UNAVAILABLE';

export interface ScientificProvenance {
  source?: string;
  provider?: string;
  dataset?: string;
  variable?: string;
  units?: string;
  timestamp?: string;
  latitude?: number;
  longitude?: number;
  requested_depth_m?: number;
  matched_depth_m?: number;
  processing_status?: string;
  data_status: ScientificDataStatus;
  asset_id?: string;
  source_url?: string;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000/api';

/** True when a fetch rejected because it was aborted mid-flight. */
function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

// ============================================================
// Phase 2B — shared layer-data cache & request deduplication
//
// The legend (page.tsx) and the raster overlay (CesiumViewerInner.tsx) request
// the exact same /layers/{name} slice, and the depth-slice metadata fetch can
// coincide with the current-field fetch (variable=currents). Both pairs used to
// issue two identical HTTP requests. A bounded in-memory LRU cache plus
// identical-in-flight-request sharing collapses each pair into ONE request.
//
// Deliberately dependency-free (no React Query/SWR): a Map + Promise is enough.
// ============================================================

/** Bounded cache sizes — the keys are small, the payloads are the grids. */
const LAYER_DATA_CACHE_MAX_ENTRIES = 24;
const DEPTH_SLICE_CACHE_MAX_ENTRIES = 24;

/**
 * Minimal bounded LRU cache. Map insertion order doubles as recency order:
 * `get` re-inserts (most-recently-used) and `set` evicts the oldest entry.
 */
class BoundedLruCache<T> {
  private readonly entries = new Map<string, T>();

  constructor(private readonly maxEntries: number) {}

  get(key: string): T | undefined {
    const value = this.entries.get(key);
    if (value === undefined) return undefined;
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  set(key: string, value: T): void {
    if (this.entries.has(key)) this.entries.delete(key);
    this.entries.set(key, value);
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  clear(): void {
    this.entries.clear();
  }
}

/**
 * One in-flight HTTP request shared by every concurrent caller with the same
 * cache key. `subscribers` counts callers still interested: the underlying
 * request is only aborted once every subscriber has walked away, so a caller
 * aborting can never cancel a response another caller still needs.
 */
interface SharedRequest<T> {
  promise: Promise<T | null>;
  controller: AbortController;
  subscribers: number;
  settled: boolean;
}

/** Shape of the /layers/{name} payload consumed by the raster overlay & legend. */
export interface LayerDataPayload {
  status: string;
  source: string;
  layer_name?: string;
  timestamp?: string;
  units?: string;
  bounds: { minLat: number; maxLat: number; minLon: number; maxLon: number };
  grid: {
    latitudes: number[];
    longitudes: number[];
    values?: (number | null)[][];
    u?: number[][];
    v?: number[][];
  };
}

/**
 * Shape of the /model/depth-slice payload (Phase 1A).
 *
 * Wire format is snake_case (pydantic default serialization).
 *
 * A HYCOM model depth slice: values are taken from the single native HYCOM
 * model depth level nearest to the requested depth - depth is NEVER
 * interpolated. `requested_depth_m` and `matched_depth_m` are reported
 * separately so callers can surface the nearest-level semantics.
 * Missing/NaN source values are represented as null.
 */
export interface DepthSlicePayload {
  status: string;
  source: string;
  dataset_file: string;
  variable: string;
  units: string;
  timestamp: string;
  requested_timestamp?: string | null;
  requested_depth_m: number;
  matched_depth_m: number;
  available_depths_m: number[];
  depth_selection: string;
  missing_values: number;
  bounds: { minLat: number; maxLat: number; minLon: number; maxLon: number };
  grid: {
    latitudes: number[];
    longitudes: number[];
    values?: (number | null)[][];
    u?: (number | null)[][];
    v?: (number | null)[][];
  };
  provenance?: ScientificProvenance;
}

/** Variables supported by the Phase 1A depth-slice API (backend DEPTH_VARIABLES, public names). */
export const DEPTH_SLICE_VARIABLES = [
  { id: 'temperature', label: 'Temperature', unit: '°C' },
  { id: 'salinity', label: 'Salinity', unit: 'PSU' },
  { id: 'currents', label: 'Currents (u/v)', unit: 'm/s' },
  { id: 'ssh', label: 'Sea Surface Height', unit: 'm' },
  { id: 'tchp', label: 'TCHP', unit: 'KJ/cm²' },
  { id: 'mld', label: 'Mixed Layer Depth', unit: 'm' },
] as const;

export type DepthSliceVariableId = (typeof DEPTH_SLICE_VARIABLES)[number]['id'];

/** Shape of the /inspect point payload consumed by the Data Inspector. */
export interface InspectPointPayload {
  status?: string;
  dataStatus?: import('../types/oceanlens').DataStatus;
  message?: string;
  timestamp?: string;
  latitude?: number;
  longitude?: number;
  requestedTimestamp?: string;
  availableStart?: string;
  availableEnd?: string;
  source?: string;
  depthM?: number;
  depth_m?: number;
  tempC?: number | null;
  temp_c?: number | null;
  salnPSU?: number | null;
  saln_psu?: number | null;
  uvelMS?: number | null;
  uvel_ms?: number | null;
  vvelMS?: number | null;
  vvel_ms?: number | null;
  currentSpeedMS?: number | null;
  current_speed_ms?: number | null;
  currentDirectionDeg?: number | null;
  current_direction_deg?: number | null;
  sshM?: number | null;
  ssh_m?: number | null;
  tchpKJ?: number | null;
  tchp_kj_cm2?: number | null;
  mldM?: number | null;
  mld_m?: number | null;
}

/** Shape of the /cyclones/inspect payload. */
export interface InspectCyclonePayload {
  status?: string;
  dataStatus?: string;
  observationType?: string;
  timestamp?: string;
  latitude?: number;
  longitude?: number;
  cycloneName?: string;
  maxWindKts?: number;
  centralPressureMb?: number;
  category?: string;
  distanceToCoastKm?: number;
  source?: string;
}

export class ApiProvider implements DataProvider {
  private isBackendAvailable: boolean | null = null;
  private lastCheckTime = 0;
  /** Phase 2B: shared in-flight /health probe (null when no probe is running). */
  private backendCheckInFlight: Promise<boolean> | null = null;

  // Phase 2B shared caches: completed responses + identical in-flight requests.
  private readonly layerDataCache = new BoundedLruCache<LayerDataPayload>(LAYER_DATA_CACHE_MAX_ENTRIES);
  private readonly layerDataInFlight = new Map<string, SharedRequest<LayerDataPayload>>();
  private readonly depthSliceCache = new BoundedLruCache<DepthSlicePayload>(DEPTH_SLICE_CACHE_MAX_ENTRIES);
  private readonly depthSliceInFlight = new Map<string, SharedRequest<DepthSlicePayload>>();

  async getArgoProfiles(): Promise<ArgoProfile[]> {
    if (!(await this.checkBackend())) return [];
    try {
      const res = await fetch(`${API_BASE}/argo/profiles`);
      if (!res.ok) return [];
      return await res.json();
    } catch {
      return [];
    }
  }

  async getArgoProfileById(id: string): Promise<ArgoProfile | null> {
    if (!(await this.checkBackend())) return null;
    try {
      const res = await fetch(`${API_BASE}/argo/profiles/${id}`);
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  /**
   * Fetch the Argo/HYCOM matchup for one profile.
   *
   * `matchMode` selects the vertical sub-sampling ('interpolated' default,
   * 'native' for the previous nearest-level-within-tolerance rule) and
   * `spatialMode` the horizontal one ('bilinear' default, 'nearest' for the
   * previous closest-cell-only rule). Omitted values leave the backend at its
   * documented defaults.
   */
  async getArgoMatchup(
    profileId: string,
    signal?: AbortSignal,
    matchMode?: MatchupMode,
    spatialMode?: MatchupSpatialMode
  ): Promise<ArgoMatchupResponse | null> {
    if (!(await this.checkBackend())) return null;
    const query = new URLSearchParams();
    if (matchMode) query.set('matchMode', matchMode);
    if (spatialMode) query.set('spatialMode', spatialMode);
    const suffix = query.toString() ? `?${query.toString()}` : '';
    try {
      const res = await fetch(`${API_BASE}/argo/${profileId}/matchup${suffix}`, { signal });
      if (!res.ok) return null;
      return await res.json();
    } catch (err: unknown) {
      if (isAbortError(err)) { perfMonitor.recordRequestAborted(); return null; }
      return null;
    }
  }

  /**
   * Fetch the regional model-vs-observation summary across all ingested
   * profiles, aggregated per model depth level. Returns null on any error and
   * never falls back to synthetic data.
   */
  async getArgoMatchupSummary(signal?: AbortSignal): Promise<ArgoMatchupSummary | null> {
    if (!(await this.checkBackend())) return null;
    try {
      const res = await fetch(`${API_BASE}/argo/matchup/summary`, { signal });
      if (!res.ok) return null;
      const data = await res.json();
      return Array.isArray(data?.byModelDepth) ? data : null;
    } catch (err: unknown) {
      if (isAbortError(err)) { perfMonitor.recordRequestAborted(); return null; }
      return null;
    }
  }

  /**
   * Fetch the raw in-situ observation list for a single Argo profile
   * (Phase 1D data source for the observation depth-profile charts).
   * Returns null on any error; never falls back to synthetic data.
   */
  async getArgoObservations(profileId: string, signal?: AbortSignal): Promise<ArgoObservationPoint[] | null> {
    if (!(await this.checkBackend())) return null;
    try {
      const res = await fetch(`${API_BASE}/argo/${profileId}/observations`, { signal });
      if (!res.ok) return null;
      const data = await res.json();
      if (!Array.isArray(data)) return null;
      return data;
    } catch (err: unknown) {
      if (isAbortError(err)) { perfMonitor.recordRequestAborted(); return null; }
      return null;
    }
  }


  private async checkBackend(): Promise<boolean> {
    const now = Date.now();
    // Cache true for 10 seconds, but retry failed checks every 2 seconds
    if (this.isBackendAvailable === true && now - this.lastCheckTime < 10000) {
      return true;
    }

    // Phase 2B: concurrent callers (e.g. the legend bounds effect and the
    // Cesium raster effect both requesting the same layer) must share ONE
    // /health probe instead of each issuing their own. Negative results are
    // not cached here — the 2 s retry window above still applies — and the
    // in-flight entry is always cleared once the probe settles.
    if (this.backendCheckInFlight) return this.backendCheckInFlight;

    const probe = this.probeBackend(now);
    this.backendCheckInFlight = probe;
    try {
      return await probe;
    } finally {
      if (this.backendCheckInFlight === probe) this.backendCheckInFlight = null;
    }
  }

  /** Performs the actual /health probe. Never throws; resolves the reachability flag. */
  private async probeBackend(now: number): Promise<boolean> {
    try {
      console.log(`[ApiProvider] Pinging API backend at ${API_BASE}/health...`);
      const res = await fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(2500) });
      this.isBackendAvailable = res.ok;
      this.lastCheckTime = now;
      if (res.ok) {
        console.log(`%c[ApiProvider] DATA PROVIDER: API / REAL BACKEND (${API_BASE})`, 'color: #10b981; font-weight: bold;');
      } else {
        console.warn(`[ApiProvider] DATA PROVIDER: DEMO FALLBACK (Health status: ${res.status})`);
      }
    } catch (err) {
      this.isBackendAvailable = false;
      this.lastCheckTime = now;
      console.warn(`[ApiProvider] DATA PROVIDER: DEMO FALLBACK (Backend unreachable at ${API_BASE}):`, err);
    }
    return this.isBackendAvailable;
  }

  async getCyclones(): Promise<Cyclone[]> {
    if (!(await this.checkBackend())) return demoProvider.getCyclones();
    try {
      const res = await fetch(`${API_BASE}/cyclones`);
      if (!res.ok) return demoProvider.getCyclones();
      const data = await res.json();
      return data && data.length > 0 ? data : demoProvider.getCyclones();
    } catch {
      return demoProvider.getCyclones();
    }
  }

  async getCycloneById(id: string): Promise<Cyclone | null> {
    if (!(await this.checkBackend())) return demoProvider.getCycloneById(id);
    try {
      const res = await fetch(`${API_BASE}/cyclones/${id}`);
      if (!res.ok) return demoProvider.getCycloneById(id);
      return await res.json();
    } catch {
      return demoProvider.getCycloneById(id);
    }
  }

  async getHazards(): Promise<Hazard[]> {
    if (!(await this.checkBackend())) return demoProvider.getHazards();
    try {
      const res = await fetch(`${API_BASE}/hazards`);
      if (!res.ok) return demoProvider.getHazards();
      return await res.json();
    } catch {
      return demoProvider.getHazards();
    }
  }

  async getHazardById(id: string): Promise<Hazard | null> {
    if (!(await this.checkBackend())) return demoProvider.getHazardById(id);
    try {
      const res = await fetch(`${API_BASE}/risk/${id}`);
      if (!res.ok) return demoProvider.getHazardById(id);
      return await res.json();
    } catch {
      return demoProvider.getHazardById(id);
    }
  }

  async getRiskAssessment(
    cycloneId: string,
    index?: number,
    signal?: AbortSignal
  ): Promise<RiskAssessment | null> {
    if (!(await this.checkBackend())) return demoProvider.getRiskAssessment(cycloneId, index);
    try {
      const qs = new URLSearchParams();
      if (typeof index === 'number') qs.set('index', String(index));
      const suffix = qs.toString() ? `?${qs.toString()}` : '';
      const res = await fetch(`${API_BASE}/risk/${encodeURIComponent(cycloneId)}${suffix}`, { signal });
      // 404 means the cyclone id is unknown — that is a real answer, not an
      // error to be papered over with demo data.
      if (res.status === 404) return null;
      if (!res.ok) return demoProvider.getRiskAssessment(cycloneId, index);
      return await res.json();
    } catch {
      return demoProvider.getRiskAssessment(cycloneId, index);
    }
  }

  async getLayers(): Promise<GISLayer[]> {
    if (!(await this.checkBackend())) return [];
    try {
      const res = await fetch(`${API_BASE}/layers`);
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  async getKPIMetrics(): Promise<KPIMetrics | null> {
    // No authoritative backend KPI contract exists; never substitute demo metrics.
    return null;
  }

  /**
   * Phase 3: Returns data mode info including explicit dataMode and datasetSynthetic.
   *   dataMode:        "REAL" | "FIXTURE" — from OCEANX_DATA_MODE backend setting.
   *   datasetSynthetic: true when serving committed synthetic fixtures.
   * Falls back to SIMULATED/FIXTURE=false on backend unavailability.
   */
  async getDataStatus(): Promise<{ mode: DataStatus; backendConnected: boolean; dataMode: DataModeType; datasetSynthetic: boolean; datasetLoaded?: boolean }> {
    if (!(await this.checkBackend())) {
      return { mode: 'SIMULATED', backendConnected: false, dataMode: 'REAL', datasetSynthetic: false, datasetLoaded: false };
    }
    try {
      const res = await fetch(`${API_BASE}/status`);
      if (!res.ok) return { mode: 'SIMULATED', backendConnected: false, dataMode: 'REAL', datasetSynthetic: false, datasetLoaded: false };
      const data = await res.json();
      const dataMode: DataModeType = data.dataMode === 'FIXTURE' ? 'FIXTURE' : 'REAL';
      const datasetSynthetic: boolean = Boolean(data.datasetSynthetic);
      return {
        mode: data.mode === 'REAL' ? 'REAL' : 'SIMULATED',
        backendConnected: true,
        dataMode,
        datasetSynthetic,
        datasetLoaded: Boolean(data.datasetLoaded),
      };
    } catch {
      return { mode: 'SIMULATED', backendConnected: false, dataMode: 'REAL', datasetSynthetic: false, datasetLoaded: false };
    }
  }

  async inspectPoint(lat: number, lon: number, timestamp?: string, signal?: AbortSignal): Promise<InspectPointPayload | null> {
    if (!(await this.checkBackend())) return null;
    try {
      const url = timestamp
        ? `${API_BASE}/inspect?lat=${lat}&lon=${lon}&timestamp=${encodeURIComponent(timestamp)}`
        : `${API_BASE}/inspect?lat=${lat}&lon=${lon}`;
      const res = await fetch(url, { signal });
      if (!res.ok) return null;
      return await res.json();
    } catch (err: unknown) {
      if (isAbortError(err)) { perfMonitor.recordRequestAborted(); return null; }
      return null;
    }
  }

  async inspectCyclone(lat?: number, lon?: number, timestamp?: string, cycloneId?: string, signal?: AbortSignal): Promise<InspectCyclonePayload | null> {
    if (!(await this.checkBackend())) return null;
    try {
      const params = new URLSearchParams();
      if (lat !== undefined) params.append('lat', lat.toString());
      if (lon !== undefined) params.append('lon', lon.toString());
      if (timestamp) params.append('timestamp', timestamp);
      if (cycloneId) params.append('cyclone_id', cycloneId);

      const res = await fetch(`${API_BASE}/cyclones/inspect?${params.toString()}`, { signal });
      if (!res.ok) return null;
      return await res.json();
    } catch (err: unknown) {
      if (isAbortError(err)) { perfMonitor.recordRequestAborted(); return null; }
      return null;
    }
  }

  /**
   * Phase 2B — cache + in-flight de-duplication for one layer-shaped GET.
   *
   * `cacheKey` MUST include every parameter that affects the response
   * (variable/layer, timestamp, depth, stride, ...). An incomplete key would
   * silently serve the wrong scientific data, so keys are built by the public
   * accessors only.
   *
   * - Success → cached (bounded LRU).
   * - Failure / abort / non-OK / null → never cached.
   * - Concurrent identical calls share ONE HTTP request and one Promise.
   * - A caller's AbortSignal only detaches that caller; the shared request is
   *   aborted only when every subscriber has aborted (preserves the pre-2B
   *   cancellation behavior when there is a single consumer).
   */
  private async fetchWithCache<T>(
    cacheKey: string,
    cache: BoundedLruCache<T>,
    inFlight: Map<string, SharedRequest<T>>,
    request: (signal: AbortSignal) => Promise<T | null>,
    signal?: AbortSignal
  ): Promise<T | null> {
    // An already-aborted consumer must never receive data (same as before 2B).
    if (signal?.aborted) return null;

    const cached = cache.get(cacheKey);
    if (cached !== undefined) {
      perfMonitor.recordApiLayerDataCacheHit();
      return cached;
    }
    perfMonitor.recordApiLayerDataCacheMiss();

    let shared = inFlight.get(cacheKey);
    if (shared) {
      perfMonitor.recordApiLayerDataDedupHit();
    } else {
      const controller = new AbortController();
      const entry: SharedRequest<T> = {
        controller,
        subscribers: 0,
        settled: false,
        promise: Promise.resolve(null),
      };
      perfMonitor.recordApiLayerDataRequest();
      entry.promise = request(controller.signal)
        .then((value) => {
          // Only real responses are cached — failures are never permanent.
          if (value !== null && value !== undefined) cache.set(cacheKey, value);
          return value;
        })
        .catch(() => null)
        .then((value) => {
          entry.settled = true;
          inFlight.delete(cacheKey);
          return value;
        });
      inFlight.set(cacheKey, entry);
      shared = entry;
    }

    return this.awaitSharedRequest(shared, signal);
  }

  /**
   * Awaits a shared request. When `signal` aborts, only this caller detaches
   * (resolving null); the shared request itself is cancelled once no
   * subscriber remains and it has not settled yet.
   */
  private async awaitSharedRequest<T>(shared: SharedRequest<T>, signal?: AbortSignal): Promise<T | null> {
    if (signal?.aborted) return null;

    shared.subscribers++;
    if (!signal) {
      try {
        return await shared.promise;
      } finally {
        shared.subscribers--;
      }
    }

    // Always callable (the Promise executor below runs synchronously and
    // replaces it), so no `null` narrowing is needed in the finally block.
    let removeAbortListener: () => void = () => {};
    const aborted = new Promise<null>((resolve) => {
      const onAbort = () => resolve(null);
      signal.addEventListener('abort', onAbort, { once: true });
      removeAbortListener = () => signal.removeEventListener('abort', onAbort);
    });

    try {
      return await Promise.race([shared.promise, aborted]);
    } finally {
      removeAbortListener();
      shared.subscribers--;
      if (shared.subscribers <= 0 && !shared.settled) {
        shared.controller.abort();
      }
    }
  }

  /**
   * Drop every cached layer/depth-slice response (and nothing else).
   * Test/debug hook: the cache is otherwise bounded and self-evicting.
   */
  clearLayerDataCache(): void {
    this.layerDataCache.clear();
    this.depthSliceCache.clear();
  }

  async getLayerData(layerName: string, timestamp?: string, stride = 3, signal?: AbortSignal): Promise<LayerDataPayload | null> {
    // Cache key covers every response-affecting request parameter.
    const cacheKey = `layer|${layerName}|${timestamp ?? 'latest'}|${stride}`;

    return this.fetchWithCache(
      cacheKey,
      this.layerDataCache,
      this.layerDataInFlight,
      async (requestSignal) => {
        if (!(await this.checkBackend())) return null;
        try {
          const url = timestamp
            ? `${API_BASE}/layers/${layerName}?timestamp=${encodeURIComponent(timestamp)}&stride=${stride}`
            : `${API_BASE}/layers/${layerName}?stride=${stride}`;
          const res = await fetch(url, { signal: requestSignal });
          if (!res.ok) return null;
          return await res.json();
        } catch (err: unknown) {
          if (isAbortError(err)) { perfMonitor.recordRequestAborted(); return null; }
          return null;
        }
      },
      signal
    );
  }

  /**
   * Fetch a HYCOM model depth slice at the nearest native model depth
   * (Phase 1A data-contract foundation for depth-aware visualization).
   * Returns null on any error; never falls back to synthetic data.
   *
   * Phase 2B: cached + de-duplicated per (variable, depth, timestamp, stride),
   * so the depth-slice instrument and the current-field particles share one
   * request when they select the same slice.
   */
  async getDepthSlice(
    variable: string,
    depthM: number,
    timestamp?: string,
    stride = 3,
    signal?: AbortSignal
  ): Promise<DepthSlicePayload | null> {
    // Cache key covers every response-affecting request parameter.
    const cacheKey = `depthslice|${variable}|${depthM}|${timestamp ?? 'latest'}|${stride}`;

    return this.fetchWithCache(
      cacheKey,
      this.depthSliceCache,
      this.depthSliceInFlight,
      async (requestSignal) => {
        if (!(await this.checkBackend())) return null;
        try {
          const params = new URLSearchParams({ variable, depth: depthM.toString(), stride: stride.toString() });
          if (timestamp) params.append('timestamp', timestamp);
          const res = await fetch(`${API_BASE}/model/depth-slice?${params.toString()}`, { signal: requestSignal });
          if (!res.ok) return null;
          return await res.json();
        } catch (err: unknown) {
          if (isAbortError(err)) { perfMonitor.recordRequestAborted(); return null; }
          return null;
        }
      },
      signal
    );
  }

  /**
   * Fetch the REAL HYCOM UVEL/VVEL current field (Phase 1E).
   *
   * Uses the existing Phase 1A depth-slice endpoint (variable=currents):
   * nearest native model depth, timestamp-correspondent, NaN cells as null.
   * Returns the raw payload for the FlowFieldProvider normalizer; null on
   * any error or unavailability. NEVER falls back to synthetic data and
   * NEVER relabels another source as HYCOM.
   */
  async getRealCurrentFieldPayload(
    depthM: number,
    timestamp?: string,
    stride = 3,
    signal?: AbortSignal
  ): Promise<DepthSlicePayload | null> {
    return this.getDepthSlice('currents', depthM, timestamp, stride, signal);
  }
}

export const apiProvider = new ApiProvider();
