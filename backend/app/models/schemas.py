from typing import List, Optional, Literal, Dict, Any
from pydantic import BaseModel, Field

DataStatus = Literal[
    'REAL',
    'REAL DATASET — TIMESTAMP UNAVAILABLE',
    'REAL SOURCE — INGESTION PENDING',
    'DERIVED ANALYTICS',
    'SIMULATED',
    'NOT CURRENTLY INTEGRATED',
    'DEMO',
    'OBSERVATION',
    'FORECAST'
]

ScientificDataStatus = Literal['REAL', 'SIMULATED', 'DEMO', 'UNAVAILABLE']

class ScientificProvenance(BaseModel):
    """Compact provenance contract shared by scientific visualization payloads."""
    source: Optional[str] = None
    provider: Optional[str] = None
    dataset: Optional[str] = None
    variable: Optional[str] = None
    units: Optional[str] = None
    timestamp: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    requested_depth_m: Optional[float] = None
    matched_depth_m: Optional[float] = None
    processing_status: Optional[str] = None
    data_status: ScientificDataStatus
    asset_id: Optional[str] = None
    source_url: Optional[str] = None

AppMode = Literal['OPERATIONS', 'RESEARCH']

DataModeType = Literal['REAL', 'FIXTURE']


class StatusResponse(BaseModel):
    """Typed response for /api/status.

    dataMode: the explicitly configured data mode — "REAL" (production
        HYCOM datasets) or "FIXTURE" (committed synthetic schema-compatible
        test fixtures).  This is determined by OCEANX_DATA_MODE and is
        never inferred silently.
    datasetLoaded: True when a HYCOM dataset file is reachable at the
        configured path (production file in REAL mode; fixture file in
        FIXTURE mode).
    datasetSynthetic: True when the backend is serving synthetic fixture
        data, not real production ocean measurements.
    mode: backward-compatible field.  "REAL" only when DATA_MODE==REAL
        and the production file is present; "SIMULATED" otherwise.
    """
    mode: str
    backendConnected: bool = True
    datasetLoaded: bool
    provider: str
    dataMode: DataModeType
    datasetSynthetic: bool



class CycloneTrackPoint(BaseModel):
    id: str
    timestamp: str
    latitude: float
    longitude: float
    maxWindKts: float
    centralPressureMb: float
    category: str
    status: Literal['OBSERVATION', 'FORECAST']
    distanceToCoastKm: float
    stormSpeedKts: float
    stormDirDeg: float
    forecastConfidencePct: Optional[float] = None

class WindRadius(BaseModel):
    r34ktsKm: float
    r50ktsKm: float
    r64ktsKm: float

class ForecastConePoint(BaseModel):
    latitude: float
    longitude: float
    radiusKm: float
    timestamp: str

class Cyclone(BaseModel):
    id: str
    name: str
    basin: str
    dataStatus: DataStatus
    currentTrackIndex: int
    track: List[CycloneTrackPoint]
    forecastCone: List[ForecastConePoint]
    windRadius: WindRadius
    sourceAttribution: str
    isHistorical: bool = True

class Evidence(BaseModel):
    variable: str
    value: str
    unit: str
    trend: Literal['increasing', 'decreasing', 'neutral']
    relevance: str
    status: DataStatus

class Explanation(BaseModel):
    summary: str
    keyFactors: List[str]
    limitations: str
    generatedAt: str

class RiskAssessment(BaseModel):
    score: int
    category: Literal['LOW', 'ELEVATED', 'MODERATE', 'HIGH', 'CRITICAL']
    modelType: str = 'prototype_rule_based'
    evidence: List[Evidence]
    explanation: Explanation
    affectedRegions: List[str]

class Hazard(BaseModel):
    id: str
    title: str
    type: Literal['cyclone', 'high_wave', 'strong_wind', 'storm_surge', 'coastal_erosion']
    severity: Literal['LOW', 'ELEVATED', 'MODERATE', 'HIGH', 'CRITICAL']
    location: str
    dataStatus: DataStatus
    riskAssessment: RiskAssessment

class Station(BaseModel):
    id: str
    name: str
    latitude: float
    longitude: float
    region: str
    status: Literal['active', 'offline']
    type: Literal['buoy', 'coastal_radar', 'tide_gauge']
    dataStatus: DataStatus
    currentMeasurements: Dict[str, Any]

class GISLayer(BaseModel):
    id: str
    name: str
    category: Literal['hazard', 'physical', 'infrastructure']
    active: bool
    status: DataStatus
    description: str
    unit: Optional[str] = None

class KPIMetrics(BaseModel):
    activeCyclones: int
    maxWindKts: float
    maxWaveHeightM: float
    avgSSTC: float
    coastalRiskLevel: Literal['LOW', 'ELEVATED', 'MODERATE', 'HIGH', 'CRITICAL']
    dataConfidencePct: float
    forecastConfidencePct: float

class LayerGridData(BaseModel):
    latitudes: List[float]
    longitudes: List[float]
    values: Optional[List[List[Optional[float]]]] = None
    u: Optional[List[List[float]]] = None
    v: Optional[List[List[float]]] = None

class LayerDataResponse(BaseModel):
    status: DataStatus
    source: str
    layer_name: str
    timestamp: str
    units: str
    bounds: Dict[str, float]
    grid: LayerGridData
    provenance: Optional[ScientificProvenance] = None

class DepthSliceGridData(BaseModel):
    """Grid payload of a HYCOM model depth slice.

    Missing/NaN source values are represented as null (never as 0.0).
    """
    latitudes: List[float]
    longitudes: List[float]
    values: Optional[List[List[Optional[float]]]] = None
    u: Optional[List[List[Optional[float]]]] = None
    v: Optional[List[List[Optional[float]]]] = None

class DepthSliceResponse(BaseModel):
    """A HYCOM model depth slice at the nearest native model depth level.

    The requested depth and the matched native model depth are reported
    separately: values are taken from the matched level only - depth is
    never interpolated.
    """
    status: DataStatus
    source: str
    dataset_file: str
    variable: str
    units: str
    timestamp: str
    requested_timestamp: Optional[str] = None
    requested_depth_m: float
    matched_depth_m: float
    available_depths_m: List[float]
    depth_selection: str = "nearest native HYCOM model depth (no interpolation)"
    missing_values: int = 0
    bounds: Dict[str, float]
    grid: DepthSliceGridData
    provenance: ScientificProvenance

class DatasetInfo(BaseModel):
    dataset_name: str
    provider: str
    status: DataStatus
    source: str
    region: Dict[str, Any]
    time_range: Dict[str, str]
    time_steps_count: int
    variables: Dict[str, Any]

class ArgoObservationPoint(BaseModel):
    depth_m: float
    pressure_dbar: float
    temperature_c: Optional[float] = None
    salinity_psu: Optional[float] = None
    temp_qc: int = 1
    psal_qc: int = 1

class ArgoProfile(BaseModel):
    profile_id: str
    float_id: str
    platform_type: str
    cycle_number: int
    latitude: float
    longitude: float
    observation_time: str
    data_status: DataStatus = "REAL SOURCE — INGESTION PENDING"
    institution: str
    observations_count: int
    observations: List[ArgoObservationPoint]
    provenance: ScientificProvenance

class ArgoFloat(BaseModel):
    float_id: str
    platform_type: str
    institution: str
    last_latitude: float
    last_longitude: float
    last_observation_time: str
    data_status: DataStatus = "REAL"
    profile_count: int

class DepthComparison(BaseModel):
    depthM: float
    argoTemperatureC: Optional[float] = None
    modelTemperatureC: Optional[float] = None
    temperatureResidualC: Optional[float] = None
    argoSalinityPSU: Optional[float] = None
    modelSalinityPSU: Optional[float] = None
    salinityResidualPSU: Optional[float] = None
    matchedModelDepthM: Optional[float] = None

class MatchupStatistics(BaseModel):
    n: int
    meanResidual: Optional[float] = None
    mae: Optional[float] = None
    rmse: Optional[float] = None

class MatchupStatisticsByVariable(BaseModel):
    temperature: Optional[MatchupStatistics] = None
    salinity: Optional[MatchupStatistics] = None

class MatchupDiagnostics(BaseModel):
    """Neutral diagnostic context of an existing matchup.

    Counts and matching metadata only - never a matchup quality score, grade
    or validation metric. ``matchedObservationCount`` counts backend
    comparison rows (one per depth-matched Argo observation); valid
    temperature/salinity statistical pairs are reported separately by
    ``MatchupStatisticsByVariable`` and may be smaller.
    """
    totalArgoObservations: int = 0
    matchedObservationCount: int = 0
    unmatchedObservationCount: int = 0
    matchedPercentage: Optional[float] = None
    deepestMatchedObservationDepthM: Optional[float] = None
    deepestMatchedModelDepthM: Optional[float] = None
    repeatedNativeDepthMatchCount: int = 0
    interpolationApplied: bool = False

class ArgoMatchupResponse(BaseModel):
    argoProfileId: str
    floatId: str
    observationTimestamp: str
    observationLat: float
    observationLon: float
    modelDataset: str = "INCOIS HYCOM"
    modelDataStatus: ScientificDataStatus = "UNAVAILABLE"
    modelTimestamp: str
    matchedModelLat: float
    matchedModelLon: float
    timeDifferenceHours: float
    distanceKm: float
    matchedDepths: List[float]
    matchedPointCount: int = 0
    matchingToleranceM: float = 15.0
    modelDepthSelection: str = "nearest native HYCOM model depth (no interpolation)"
    comparisons: List[DepthComparison]
    dataStatus: DataStatus = "REAL"
    source: str = "Argo Global Data (GDAC) + INCOIS RSMC HYCOM"
    residualConvention: str = "ΔT = HYCOM - Argo, ΔS = HYCOM - Argo"
    statusMessage: Optional[str] = None
    statistics: Optional[MatchupStatisticsByVariable] = None
    diagnostics: Optional[MatchupDiagnostics] = None
