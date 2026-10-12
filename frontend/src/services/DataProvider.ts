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
} from '../types/oceanlens';

export interface DataProvider {
  getCyclones(): Promise<Cyclone[]>;
  getCycloneById(id: string): Promise<Cyclone | null>;
  getHazards(): Promise<Hazard[]>;
  getHazardById(id: string): Promise<Hazard | null>;
  /**
   * Authoritative unvalidated heuristic score for a cyclone, optionally at a
   * specific track index. The BACKEND is the scorer — the client never
   * recomputes it, because doing so previously produced a score from invented
   * defaults whenever model data was absent.
   *
   * Returns null only when the request itself fails; an assessment the engine
   * declined to score comes back as `{status:'UNAVAILABLE', ...}`.
   */
  getRiskAssessment(cycloneId: string, index?: number): Promise<RiskAssessment | null>;
  getLayers(): Promise<GISLayer[]>;
  getKPIMetrics(timestepIndex?: number): Promise<KPIMetrics | null>;
  getDataStatus(): Promise<{ mode: DataStatus; backendConnected: boolean; dataMode: DataModeType; datasetSynthetic: boolean; datasetLoaded?: boolean }>;
  getArgoProfiles(): Promise<ArgoProfile[]>;
  getArgoProfileById(id: string): Promise<ArgoProfile | null>;
  getArgoMatchup(profileId: string, signal?: AbortSignal): Promise<ArgoMatchupResponse | null>;
  getArgoObservations(profileId: string, signal?: AbortSignal): Promise<ArgoObservationPoint[] | null>;
}
