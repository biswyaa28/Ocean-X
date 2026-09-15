import { DataProvider } from './DataProvider';
import { demoProvider } from './DemoProvider';
import {
  Cyclone,
  Hazard,
  Station,
  GISLayer,
  KPIMetrics,
  DataStatus,
  ArgoProfile,
  ArgoMatchupResponse,
} from '../types/oceanlens';
import { EnvironmentalFlowField } from '../types/flow';
import { perfMonitor } from '../utils/perfMonitor';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000/api';

/** True when a fetch rejected because it was aborted mid-flight. */
function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
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

  async getArgoMatchup(profileId: string, signal?: AbortSignal): Promise<ArgoMatchupResponse | null> {
    if (!(await this.checkBackend())) return null;
    try {
      const res = await fetch(`${API_BASE}/argo/${profileId}/matchup`, { signal });
      if (!res.ok) return null;
      return await res.json();
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

  async getStations(): Promise<Station[]> {
    if (!(await this.checkBackend())) return demoProvider.getStations();
    try {
      const res = await fetch(`${API_BASE}/stations`);
      if (!res.ok) return demoProvider.getStations();
      return await res.json();
    } catch {
      return demoProvider.getStations();
    }
  }

  async getLayers(): Promise<GISLayer[]> {
    return demoProvider.getLayers();
  }

  async getKPIMetrics(timestepIndex = 5): Promise<KPIMetrics> {
    return demoProvider.getKPIMetrics(timestepIndex);
  }

  async getDataStatus(): Promise<{ mode: DataStatus; backendConnected: boolean }> {
    if (!(await this.checkBackend())) {
      return { mode: 'SIMULATED', backendConnected: false };
    }
    try {
      const res = await fetch(`${API_BASE}/status`);
      if (!res.ok) return { mode: 'SIMULATED', backendConnected: false };
      const data = await res.json();
      return {
        mode: data.mode === 'REAL' ? 'REAL' : 'SIMULATED',
        backendConnected: true,
      };
    } catch {
      return { mode: 'SIMULATED', backendConnected: false };
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

  async getLayerData(layerName: string, timestamp?: string, stride = 3, signal?: AbortSignal): Promise<LayerDataPayload | null> {
    if (!(await this.checkBackend())) return null;
    try {
      const url = timestamp
        ? `${API_BASE}/layers/${layerName}?timestamp=${encodeURIComponent(timestamp)}&stride=${stride}`
        : `${API_BASE}/layers/${layerName}?stride=${stride}`;
      const res = await fetch(url, { signal });
      if (!res.ok) return null;
      return await res.json();
    } catch (err: unknown) {
      if (isAbortError(err)) { perfMonitor.recordRequestAborted(); return null; }
      return null;
    }
  }

  /**
   * Fetch a HYCOM model depth slice at the nearest native model depth
   * (Phase 1A data-contract foundation for depth-aware visualization).
   * Returns null on any error; never falls back to synthetic data.
   */
  async getDepthSlice(
    variable: string,
    depthM: number,
    timestamp?: string,
    stride = 3,
    signal?: AbortSignal
  ): Promise<DepthSlicePayload | null> {
    if (!(await this.checkBackend())) return null;
    try {
      const params = new URLSearchParams({ variable, depth: depthM.toString(), stride: stride.toString() });
      if (timestamp) params.append('timestamp', timestamp);
      const res = await fetch(`${API_BASE}/model/depth-slice?${params.toString()}`, { signal });
      if (!res.ok) return null;
      return await res.json();
    } catch (err: unknown) {
      if (isAbortError(err)) { perfMonitor.recordRequestAborted(); return null; }
      return null;
    }
  }

  async getRealFlowField(
    type: 'wind' | 'current',
    timestamp?: string
  ): Promise<EnvironmentalFlowField | null> {

    if (type !== 'current' || !(await this.checkBackend())) return null;

    try {
      const url = timestamp
        ? `${API_BASE}/layers/currents?timestamp=${encodeURIComponent(timestamp)}`
        : `${API_BASE}/layers/currents`;
      const res = await fetch(url);
      if (!res.ok) return null;
      const layerData = await res.json();

      if (!layerData.grid || !layerData.grid.u || !layerData.grid.v) return null;

      return {
        type: 'current',
        timestamp: layerData.timestamp,
        bounds: {
          minLat: layerData.bounds.minLat,
          maxLat: layerData.bounds.maxLat,
          minLon: layerData.bounds.minLon,
          maxLon: layerData.bounds.maxLon,
        },
        grid: {
          latitudes: layerData.grid.latitudes,
          longitudes: layerData.grid.longitudes,
          u: layerData.grid.u,
          v: layerData.grid.v,
        },
        units: layerData.units,
        source: layerData.source,
        status: layerData.status,
      };
    } catch {
      return null;
    }
  }
}

export const apiProvider = new ApiProvider();
