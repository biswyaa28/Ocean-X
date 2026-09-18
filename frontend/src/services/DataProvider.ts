import {
  Cyclone,
  Hazard,
  Station,
  GISLayer,
  KPIMetrics,
  DataStatus,
  DataModeType,
  ArgoProfile,
  ArgoMatchupResponse,
  ArgoObservationPoint,
} from '../types/oceanlens';

export interface DataProvider {
  getCyclones(): Promise<Cyclone[]>;
  getCycloneById(id: string): Promise<Cyclone | null>;
  getHazards(): Promise<Hazard[]>;
  getHazardById(id: string): Promise<Hazard | null>;
  getStations(): Promise<Station[]>;
  getLayers(): Promise<GISLayer[]>;
  getKPIMetrics(timestepIndex?: number): Promise<KPIMetrics | null>;
  getDataStatus(): Promise<{ mode: DataStatus; backendConnected: boolean; dataMode: DataModeType; datasetSynthetic: boolean; datasetLoaded?: boolean }>;
  getArgoProfiles(): Promise<ArgoProfile[]>;
  getArgoProfileById(id: string): Promise<ArgoProfile | null>;
  getArgoMatchup(profileId: string, signal?: AbortSignal): Promise<ArgoMatchupResponse | null>;
  getArgoObservations(profileId: string, signal?: AbortSignal): Promise<ArgoObservationPoint[] | null>;
}
