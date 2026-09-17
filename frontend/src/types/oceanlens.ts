export type DataStatus =
  | 'REAL'
  | 'REAL DATASET — TIMESTAMP UNAVAILABLE'
  | 'REAL SOURCE — INGESTION PENDING'
  | 'DERIVED ANALYTICS'
  | 'SIMULATED'
  | 'NOT CURRENTLY INTEGRATED'
  | 'DEMO'
  | 'OBSERVATION'
  | 'FORECAST';

export type ScientificDataStatus = 'REAL' | 'SIMULATED' | 'DEMO' | 'UNAVAILABLE';

/**
 * Phase 3 — Explicit data mode types.
 *
 * DataModeType reflects the OCEANX_DATA_MODE backend setting:
 *   "REAL"    — backend is configured with production HYCOM datasets.
 *   "FIXTURE" — backend is serving committed synthetic schema-compatible
 *               fixtures (not scientific evidence).
 *
 * BackendStatus is the typed shape of /api/status including Phase 3 fields.
 */
export type DataModeType = 'REAL' | 'FIXTURE';

export interface BackendStatus {
  /** Backward-compatible mode string. "REAL" only with production data present. */
  mode: string;
  backendConnected: boolean;
  datasetLoaded: boolean;
  provider: string;
  /** Explicit data mode — never inferred silently. */
  dataMode: DataModeType;
  /** True when the backend is serving synthetic fixture data. */
  datasetSynthetic: boolean;
}


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


export type AppMode = 'OPERATIONS' | 'RESEARCH';

export type OceanMode = 'LIVE' | 'HISTORICAL' | 'SCENARIO';

export type CycloneCategory =
  | 'Depression'
  | 'Deep Depression'
  | 'Cyclonic Storm'
  | 'Severe Cyclonic Storm'
  | 'Very Severe Cyclonic Storm'
  | 'Extremely Severe Cyclonic Storm'
  | 'Super Cyclonic Storm';

export interface CycloneTrackPoint {
  id: string;
  timestamp: string; // ISO 8601 string
  latitude: number;
  longitude: number;
  maxWindKts: number;
  centralPressureMb: number;
  category: CycloneCategory;
  status: 'OBSERVATION' | 'FORECAST';
  distanceToCoastKm: number;
  stormSpeedKts: number;
  stormDirDeg: number;
  forecastConfidencePct?: number;
}

export interface WindRadius {
  r34ktsKm: number;
  r50ktsKm: number;
  r64ktsKm: number;
}

export interface ForecastConePoint {
  latitude: number;
  longitude: number;
  radiusKm: number;
  timestamp: string;
}

export interface Cyclone {
  id: string;
  name: string;
  basin: string;
  dataStatus: DataStatus;
  currentTrackIndex: number;
  track: CycloneTrackPoint[];
  forecastCone: ForecastConePoint[];
  windRadius: WindRadius;
  sourceAttribution: string;
  isHistorical?: boolean;
}

export interface Evidence {
  variable: string;
  value: string;
  unit: string;
  trend: 'increasing' | 'decreasing' | 'neutral';
  relevance: string;
  status: DataStatus;
}

export interface Explanation {
  summary: string;
  keyFactors: string[];
  limitations: string;
  generatedAt: string;
}

export interface RiskAssessment {
  score: number; // 0 to 100
  category: 'LOW' | 'ELEVATED' | 'MODERATE' | 'HIGH' | 'CRITICAL';
  modelType: 'prototype_rule_based';
  evidence: Evidence[];
  explanation: Explanation;
  affectedRegions: string[];
}

export interface Hazard {
  id: string;
  title: string;
  type: 'cyclone' | 'high_wave' | 'strong_wind' | 'storm_surge' | 'coastal_erosion';
  severity: 'LOW' | 'ELEVATED' | 'MODERATE' | 'HIGH' | 'CRITICAL';
  location: string;
  dataStatus: DataStatus;
  riskAssessment: RiskAssessment;
}

export interface Station {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  region: string;
  status: 'active' | 'offline';
  type: 'buoy' | 'coastal_radar' | 'tide_gauge';
  dataStatus: DataStatus;
  currentMeasurements: {
    sstC?: number;
    windSpeedKts?: number;
    waveHeightM?: number;
    pressureMb?: number;
    salinityPsu?: number;
  };
}

export interface GISLayer {
  id: string;
  name: string;
  category: 'hazard' | 'physical' | 'infrastructure';
  active: boolean;
  status: DataStatus;
  description: string;
  unit?: string;
}

export interface KPIMetrics {
  activeCyclones: number;
  maxWindKts: number;
  maxWaveHeightM: number;
  avgSSTC: number;
  coastalRiskLevel: 'LOW' | 'ELEVATED' | 'MODERATE' | 'HIGH' | 'CRITICAL';
  dataConfidencePct: number;
  forecastConfidencePct: number;
}

export interface ArgoObservationPoint {
  depth_m: number;
  pressure_dbar: number;
  temperature_c?: number | null;
  salinity_psu?: number | null;
  temp_qc: number;
  psal_qc: number;
}

export interface ArgoProfile {
  profile_id: string;
  float_id: string;
  platform_type: string;
  cycle_number: number;
  latitude: number;
  longitude: number;
  observation_time: string;
  data_status: DataStatus;
  institution: string;
  observations_count: number;
  observations: ArgoObservationPoint[];
  provenance: ScientificProvenance;
}

export interface DepthComparison {
  depthM: number;
  argoTemperatureC?: number | null;
  modelTemperatureC?: number | null;
  temperatureResidualC?: number | null;
  argoSalinityPSU?: number | null;
  modelSalinityPSU?: number | null;
  salinityResidualPSU?: number | null;
  matchedModelDepthM?: number | null;
}

export interface MatchupStatistics {
  n: number;
  meanResidual: number | null;
  mae: number | null;
  rmse: number | null;
}

export interface MatchupStatisticsByVariable {
  temperature?: MatchupStatistics | null;
  salinity?: MatchupStatistics | null;
}

/**
 * Phase 2C neutral diagnostic context of a matchup: counts and matching
 * metadata only — never a quality score, grade or validation metric.
 */
export interface MatchupDiagnostics {
  totalArgoObservations: number;
  matchedObservationCount: number;
  unmatchedObservationCount: number;
  matchedPercentage: number | null;
  deepestMatchedObservationDepthM?: number | null;
  deepestMatchedModelDepthM?: number | null;
  repeatedNativeDepthMatchCount: number;
  interpolationApplied: boolean;
}

export interface ArgoMatchupResponse {
  argoProfileId: string;
  floatId: string;
  observationTimestamp: string;
  observationLat: number;
  observationLon: number;
  modelDataset: string;
  modelDataStatus?: ScientificDataStatus;
  modelTimestamp: string;
  matchedModelLat: number;
  matchedModelLon: number;
  timeDifferenceHours: number;
  distanceKm: number;
  matchedDepths: number[];
  matchedPointCount: number;
  matchingToleranceM: number;
  modelDepthSelection: string;
  comparisons: DepthComparison[];
  dataStatus: DataStatus;
  source: string;
  residualConvention: string;
  statusMessage?: string | null;
  statistics?: MatchupStatisticsByVariable | null;
  diagnostics?: MatchupDiagnostics | null;
}

export interface AstronomicalData {
  sun: {
    elevationDeg: number;
    azimuthDeg: number;
    sunriseUtc: string;
    sunsetUtc: string;
    isDaylight: boolean;
  };
  moon: {
    elevationDeg: number;
    azimuthDeg: number;
    phaseName: string;
    illuminationPercent: number;
  };
  timestamp: string;
  location: {
    lat: number;
    lon: number;
  };
}
