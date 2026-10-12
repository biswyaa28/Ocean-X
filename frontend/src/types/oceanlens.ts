export type DataStatus =
  | 'REAL'
  | 'REAL DATASET — TIMESTAMP UNAVAILABLE'
  | 'REAL SOURCE — INGESTION PENDING'
  | 'DERIVED ANALYTICS'
  | 'SIMULATED'
  | 'NOT CURRENTLY INTEGRATED'
  | 'DEMO'
  | 'UNAVAILABLE'
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

/** Which agency a best-track value was actually read from. */
export type ObservationSource = 'WMO' | 'IMD';

export interface CycloneTrackPoint {
  id: string;
  timestamp: string; // ISO 8601 string
  latitude: number;
  longitude: number;
  /**
   * Observable fields are nullable: the backend reports absence rather than
   * substituting a plausible constant. Every consumer must handle `null`.
   */
  maxWindKts: number | null;
  centralPressureMb: number | null;
  category: CycloneCategory | null;
  windSource?: ObservationSource | null;
  pressureSource?: ObservationSource | null;
  status: 'OBSERVATION' | 'FORECAST';
  distanceToCoastKm: number | null;
  stormSpeedKts: number | null;
  stormDirDeg: number | null;
  forecastConfidencePct?: number | null;
}

export interface WindRadius {
  r34ktsKm: number | null;
  r50ktsKm: number | null;
  r64ktsKm: number | null;
  source?: string | null;
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
  /** Always empty: IBTrACS holds best-track history, not forecasts. */
  forecastCone: ForecastConePoint[];
  windRadius: WindRadius;
  dataCompleteness?: {
    trackPoints: number;
    withWind: number;
    withPressure: number;
  } | null;
  sourceAttribution: string;
  isHistorical?: boolean;
}

export interface Evidence {
  variable: string;
  /** Null when the underlying observation is genuinely absent. */
  value: string | null;
  unit: string;
  trend: 'increasing' | 'decreasing' | 'neutral' | 'unknown';
  relevance: string;
  status: DataStatus;
}

export interface Explanation {
  summary: string;
  keyFactors: string[];
  limitations: string;
  generatedAt: string;
}

/**
 * An UNVALIDATED demo heuristic. `status` is authoritative: when it is
 * 'UNAVAILABLE' the score is null and `unavailableReason` says why. Never
 * present this number as a forecast or an official warning.
 */
export interface RiskAssessment {
  status: 'OK' | 'UNAVAILABLE';
  unavailableReason?: string | null;
  heuristicDemoScore: number | null; // 0 to 100, demo only
  category: 'LOW' | 'ELEVATED' | 'MODERATE' | 'HIGH' | 'CRITICAL' | null;
  modelType: 'prototype_rule_based';
  validated: false;
  operationalUse: string;
  disclaimer: string;
  weights: Record<string, number>;
  evidence: Evidence[];
  explanation: Explanation | null;
  affectedRegions: string[];
}

export interface Hazard {
  id: string;
  title: string;
  type: 'cyclone' | 'high_wave' | 'strong_wind' | 'storm_surge' | 'coastal_erosion';
  severity: 'LOW' | 'ELEVATED' | 'MODERATE' | 'HIGH' | 'CRITICAL' | null;
  location: string;
  dataStatus: DataStatus;
  riskAssessment: RiskAssessment;
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
  /** Null when the observation is genuinely absent from the source. */
  maxWindKts: number | null;
  maxWaveHeightM: number | null;
  avgSSTC: number | null;
  /** Null when the unvalidated demo heuristic declined to score. */
  coastalRiskLevel: 'LOW' | 'ELEVATED' | 'MODERATE' | 'HIGH' | 'CRITICAL' | null;
  /** The backend's heuristicDemoScore, or null when unavailable. */
  coastalRiskScore?: number | null;
  coastalRiskUnavailableReason?: string | null;
  /** Hand-tuned weights returned by the backend, for display in a tooltip. */
  coastalRiskWeights?: Record<string, number> | null;
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

/** How a matched level's model value was obtained (backend-reported). */
export type MatchupMethod = 'native' | 'interpolated';

/**
 * Observation-model time-separation classification. "too_large" means both
 * profiles are returned but residual statistics are withheld.
 */
export type MatchupTimeGapStatus = 'good' | 'marginal' | 'too_large';

/** Horizontal sub-sampling applied by the backend. */
export type MatchupSpatialMode = 'bilinear' | 'nearest';

/**
 * Vertical comparison mode applied by the backend.
 * - 'model_levels' (default): compare at the model's own depth levels; the
 *   float is interpolated onto each of them. Pairs are independent and the
 *   residual excludes model interpolation error.
 * - 'float_levels': interpolate the model onto every float depth. Includes
 *   model interpolation error across the model's sparse depth levels.
 * - 'native': nearest native model level within the matching tolerance.
 */
export type MatchupMode = 'model_levels' | 'float_levels' | 'native';

/** Per-level method reported by the backend. */
export type MatchupLevelMethod =
  | 'native'
  | 'interpolated'
  | 'float_native'
  | 'float_interpolated';

/**
 * How the float depth was obtained: "pressure_gsw" (TEOS-10 pressure-to-depth
 * conversion at the float latitude) or "provided" (source depth_m unchanged).
 * The profile-level summary may also be "mixed" or "unavailable".
 */
export type MatchupDepthSource = 'pressure_gsw' | 'provided' | 'mixed' | 'unavailable';

export interface DepthComparison {
  depthM: number;
  depthSource?: MatchupDepthSource | 'model_level' | null;
  method?: MatchupLevelMethod | null;
  /** model_levels mode only: the float levels bracketing this model level. */
  modelDepthM?: number | null;
  floatBracketTopM?: number | null;
  floatBracketBottomM?: number | null;
  floatBracketGapM?: number | null;
  floatBracketMaxGapM?: number | null;
  floatTemperatureMethod?: string | null;
  floatSalinityMethod?: string | null;
  floatTemperatureRejected?: string | null;
  floatSalinityRejected?: string | null;
  argoVariableSource?: 'adjusted' | 'raw' | null;
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
  interpolatedLevelCount: number;
  nativeLevelCount: number;
  /** What matchedPercentage is measured against. */
  matchedPercentageBasis?: 'model_levels' | 'argo_observations';
  totalModelLevels?: number | null;
  /** Surface levels that borrowed a shallow float sample (not native, not interpolated). */
  nearSurfaceSubstitutionCount?: number;
  interpolationApplied: boolean;
  /**
   * Levels whose Argo QC flags were absent from the source and were therefore
   * accepted on the documented lenient assumption. A count above zero means
   * part of the sample has no quality-control provenance.
   */
  missingQcLevelCount: number;
  timeDifferenceHours?: number | null;
  timeGapStatus?: MatchupTimeGapStatus | null;
}

/** Per-model-depth row of the regional summary. */
export interface MatchupSummaryDepthRow {
  modelDepthM: number;
  temperature: { n: number; bias: number | null; mae: number | null; rmse: number | null };
  salinity: { n: number; bias: number | null; mae: number | null; rmse: number | null };
}

export interface ArgoMatchupSummary {
  matchMode: MatchupMode;
  modelDataset: string;
  modelDataStatus?: ScientificDataStatus;
  modelRuns: string[];
  modelDepthAxis?: string;
  modelDepthAxisRule?: string;
  modelDepths?: number[];
  storedFileDepths?: number[];
  floatBracketMaxGapM: number;
  floatBracketMaxGapDeepM: number;
  floatBracketDeepBreakpointM: number;
  totalProfileCount: number;
  includedProfileCount: number;
  excludedProfileCount: number;
  excludedProfileReasons: Record<string, number>;
  excludedProfiles: { profileId: string; reason: string; excludedModelLevels?: string[] }[];
  byModelDepth: MatchupSummaryDepthRow[];
  /** Regional TCHP residual statistics, reduced per profile. */
  tchp: {
    n: number;
    bias: number | null;
    mae: number | null;
    rmse: number | null;
    medianBias: number | null;
    meanModelMinusFloat: number | null;
    meanFloat: number | null;
    meanModel: number | null;
  };
  tchpScatter: TchpScatterPoint[];
  tchpProfiles: {
    profileId: string;
    floatId: string;
    tchpFloatKjCm2: number | null;
    tchpModelKjCm2: number | null;
    tchpResidualKjCm2: number | null;
    tchpResidualPercent: number | null;
    d26FloatM: number | null;
    mldModelM: number | null;
    metricsStatus?: string | null;
    metricsReason?: string | null;
  }[];
  tchpIsothermC: number;
  tchpDefinitionStatus?: string | null;
  /** Widely quoted screening threshold, drawn as a reference line only. */
  tchpRuleOfThumbKJPerCm2: number;
  overall: {
    temperature: { n: number; bias: number | null; mae: number | null; rmse: number | null };
    salinity: { n: number; bias: number | null; mae: number | null; rmse: number | null };
  };
  profiles: {
    profileId: string;
    floatId: string;
    observationTimestamp: string;
    timeDifferenceHours: number | null;
    timeGapStatus: MatchupTimeGapStatus | null;
    modelRun?: string | null;
    pairCount: number;
    temperaturePairCount: number;
    salinityPairCount: number;
    temperature: { n: number; bias: number | null; mae: number | null; rmse: number | null };
    salinity: { n: number; bias: number | null; mae: number | null; rmse: number | null };
  }[];
}

/**
 * Float-derived cyclone heat content against the model's own products.
 *
 * TCHP is in kJ/cm2 (the unit the model's field carries) and the residual is
 * `model - float`, matching the temperature convention: positive means the
 * model carries more heat than the float measured.
 *
 * `metricsStatus`/`metricsReason` explain a missing value. A missing
 * measurement and a measurement of zero are different claims and are never
 * conflated - `tchpFloatKjCm2` is 0 only when the float's surface really is
 * below the isotherm.
 */
export interface ArgoOceanHeat {
  tchpFloatKjCm2: number | null;
  tchpModelKjCm2: number | null;
  tchpResidualKjCm2: number | null;
  tchpResidualPercent: number | null;
  d26FloatM: number | null;
  mldModelM: number | null;
  metricsStatus?: string | null;
  metricsReason?: string | null;
  metricsSurfaceDepthM?: number | null;
  metricsSurfaceTemperatureC?: number | null;
  /** Why the model's own TCHP may not be directly comparable. */
  tchpDefinitionStatus?: string | null;
  tchpIsothermC: number;
  tchpMetricsMaxGapM: number;
}

/** One point of the regional float-vs-model TCHP scatter. */
export interface TchpScatterPoint {
  profileId: string;
  floatId: string;
  tchpFloatKjCm2: number;
  tchpModelKjCm2: number;
  residualKjCm2: number | null;
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
  timeInterpolationApplied?: boolean;
  timeGapStatus?: MatchupTimeGapStatus;
  timeGapReason?: string | null;
  statisticsSuppressed?: boolean;
  modelRun?: string | null;
  availableModelRuns?: { run: string; timeGapHours: number; leadHours: number; dataStatus?: string }[];
  distanceKm: number;
  spatialMode?: MatchupSpatialMode;
  matchedDepths: number[];
  matchedPointCount: number;
  matchingToleranceM: number;
  matchMode?: MatchupMode;
  modelDepthSelection: string;
  modelDepthAxis?: string;
  modelDepthAxisRule?: string;
  modelDepths?: number[];
  storedFileDepths?: number[];
  depthSource?: MatchupDepthSource;
  /** Variable family actually read for the whole profile: "raw" | "adjusted". */
  variableBasis?: 'raw' | 'adjusted';
  /** Requested Argo data mode ("R"/"A"/"D") or "auto" when auto-detected. */
  argoDataMode?: 'R' | 'A' | 'D' | 'auto';
  missingQcLevelCount?: number;
  qcFlagsUsed?: { raw?: number[]; adjusted?: number[] };
  /** model_levels mode: model levels that produced no pair, with the reason. */
  excludedModelLevels?: { modelDepthM: number; reason: string }[];
  floatBracketMaxGapM?: number;
  floatBracketMaxGapDeepM?: number;
  floatBracketDeepBreakpointM?: number;
  comparisons: DepthComparison[];
  dataStatus: DataStatus;
  source: string;
  residualConvention: string;
  statusMessage?: string | null;
  statistics?: MatchupStatisticsByVariable | null;
  diagnostics?: MatchupDiagnostics | null;
  /**
   * Cyclone-relevant heat content: float-derived TCHP/D26 against the model's
   * own 2D TCHP and MLD products at the same location and time. See
   * `ArgoOceanHeat` for the zero-versus-missing contract.
   */
  heat?: ArgoOceanHeat;
  tchpFloatKjCm2?: number | null;
  tchpModelKjCm2?: number | null;
  tchpResidualKjCm2?: number | null;
  tchpResidualPercent?: number | null;
  d26FloatM?: number | null;
  mldModelM?: number | null;
  metricsStatus?: string | null;
  metricsReason?: string | null;
  metricsSurfaceDepthM?: number | null;
  metricsSurfaceTemperatureC?: number | null;
  tchpDefinitionStatus?: string | null;
  tchpIsothermC?: number;
  tchpMetricsMaxGapM?: number;
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
