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

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000/api';

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

  async getArgoMatchup(profileId: string): Promise<ArgoMatchupResponse | null> {
    if (!(await this.checkBackend())) return null;
    try {
      const res = await fetch(`${API_BASE}/argo/${profileId}/matchup`);
      if (!res.ok) return null;
      return await res.json();
    } catch {
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

  async inspectPoint(lat: number, lon: number, timestamp?: string): Promise<any | null> {
    if (!(await this.checkBackend())) return null;
    try {
      const url = timestamp
        ? `${API_BASE}/inspect?lat=${lat}&lon=${lon}&timestamp=${encodeURIComponent(timestamp)}`
        : `${API_BASE}/inspect?lat=${lat}&lon=${lon}`;
      const res = await fetch(url);
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  async inspectCyclone(lat?: number, lon?: number, timestamp?: string, cycloneId?: string): Promise<any | null> {
    if (!(await this.checkBackend())) return null;
    try {
      const params = new URLSearchParams();
      if (lat !== undefined) params.append('lat', lat.toString());
      if (lon !== undefined) params.append('lon', lon.toString());
      if (timestamp) params.append('timestamp', timestamp);
      if (cycloneId) params.append('cyclone_id', cycloneId);

      const res = await fetch(`${API_BASE}/cyclones/inspect?${params.toString()}`);
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  async getLayerData(layerName: string, timestamp?: string, stride = 3): Promise<any | null> {
    if (!(await this.checkBackend())) return null;
    try {
      const url = timestamp
        ? `${API_BASE}/layers/${layerName}?timestamp=${encodeURIComponent(timestamp)}&stride=${stride}`
        : `${API_BASE}/layers/${layerName}?stride=${stride}`;
      const res = await fetch(url);
      if (!res.ok) return null;
      return await res.json();
    } catch {
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
