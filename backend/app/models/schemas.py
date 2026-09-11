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

AppMode = Literal['OPERATIONS', 'RESEARCH']

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
    values: Optional[List[List[float]]] = None
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
    data_status: DataStatus = "REAL"
    institution: str
    observations_count: int
    observations: List[ArgoObservationPoint]

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

class ArgoMatchupResponse(BaseModel):
    argoProfileId: str
    floatId: str
    observationTimestamp: str
    observationLat: float
    observationLon: float
    modelDataset: str = "INCOIS HYCOM"
    modelTimestamp: str
    matchedModelLat: float
    matchedModelLon: float
    timeDifferenceHours: float
    distanceKm: float
    matchedDepths: List[float]
    comparisons: List[DepthComparison]
    dataStatus: DataStatus = "REAL"
    source: str = "Argo Global Data (GDAC) + INCOIS RSMC HYCOM"
    residualConvention: str = "ΔT = HYCOM - Argo, ΔS = HYCOM - Argo"
    statusMessage: Optional[str] = None

