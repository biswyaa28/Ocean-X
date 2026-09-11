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

export interface DataProvider {
  getCyclones(): Promise<Cyclone[]>;
  getCycloneById(id: string): Promise<Cyclone | null>;
  getHazards(): Promise<Hazard[]>;
  getHazardById(id: string): Promise<Hazard | null>;
  getStations(): Promise<Station[]>;
  getLayers(): Promise<GISLayer[]>;
  getKPIMetrics(timestepIndex?: number): Promise<KPIMetrics>;
  getDataStatus(): Promise<{ mode: DataStatus; backendConnected: boolean }>;
  getArgoProfiles(): Promise<ArgoProfile[]>;
  getArgoProfileById(id: string): Promise<ArgoProfile | null>;
  getArgoMatchup(profileId: string): Promise<ArgoMatchupResponse | null>;
}

