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
    'UNAVAILABLE',
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



# Provenance of a best-track value: which agency's column it was actually read
# from. ``None`` means the value is genuinely absent from the source — it is
# never back-filled with a plausible-looking constant.
ObservationSource = Literal['WMO', 'IMD']


class CycloneTrackPoint(BaseModel):
    id: str
    timestamp: str
    latitude: float
    longitude: float
    # Observational fields are Optional on purpose: when the IBTrACS columns are
    # blank for a point we report ``None`` rather than substituting a default.
    # Downstream consumers must handle absence explicitly.
    maxWindKts: Optional[float] = None
    centralPressureMb: Optional[float] = None
    category: Optional[str] = None
    windSource: Optional[ObservationSource] = None
    pressureSource: Optional[ObservationSource] = None
    status: Literal['OBSERVATION', 'FORECAST']
    distanceToCoastKm: Optional[float] = None
    stormSpeedKts: Optional[float] = None
    stormDirDeg: Optional[float] = None
    forecastConfidencePct: Optional[float] = None


class DataCompleteness(BaseModel):
    """Per-cyclone fraction of track points that actually carry an observation.

    Exposed so a reader can tell at a glance how much of a storm's intensity
    record is real data versus missing, before trusting any derived number.
    """

    trackPoints: int
    withWind: float
    withPressure: float

class WindRadius(BaseModel):
    """34/50/64 kt wind radii. Each field is Optional: IBTrACS only carries
    quadrant radii (USA_R34_NE ...) for a subset of track points, and we report
    the real observed radii where present and ``None`` where they are absent.
    """

    r34ktsKm: Optional[float] = None
    r50ktsKm: Optional[float] = None
    r64ktsKm: Optional[float] = None
    source: Optional[str] = None

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
    # Always empty. IBTrACS holds *historical best-track* points, not forecasts,
    # so there is no real uncertainty cone to draw; a synthetic ramp over past
    # observations would misrepresent them as forecasts.
    forecastCone: List[ForecastConePoint] = []
    windRadius: WindRadius = WindRadius()
    dataCompleteness: Optional[DataCompleteness] = None
    # Why `currentTrackIndex` points where it does. The client may scrub to any
    # other index; this only explains the default.
    defaultPointReason: Optional[str] = None
    defaultPointWindKts: Optional[float] = None
    sourceAttribution: str
    isHistorical: bool = True

class Evidence(BaseModel):
    variable: str
    # ``None`` when the underlying observation is genuinely absent. We never
    # render a substituted constant as if it were measured.
    value: Optional[str] = None
    unit: str
    trend: Literal['increasing', 'decreasing', 'neutral', 'unknown']
    relevance: str
    status: DataStatus

class Explanation(BaseModel):
    summary: str
    keyFactors: List[str]
    limitations: str
    generatedAt: str

# Scoring constants used by the demo heuristic. They are exposed in the API
# response so no consumer can mistake them for a published scale.
RISK_HEURISTIC_WEIGHTS: Dict[str, float] = {
    'windMaxPoints': 45.0,
    'windSaturatesAtKts': 140.0,
    'distanceMaxPoints': 30.0,
    'distanceFloorPoints': 5.0,
    'distanceScaleKm': 800.0,
    'tchpMaxPoints': 15.0,
    'tchpSaturatesAtKJPerCm2': 100.0,
    'sstMaxPoints': 10.0,
    'sstThresholdC': 26.0,
    'sstSpanC': 5.0,
    'scoreClampMin': 10.0,
    'scoreClampMax': 98.0,
}

RISK_DISCLAIMER = (
    'NOT VALIDATED, NOT FOR OPERATIONAL USE. These weights are hand-tuned '
    'demo constants with no published basis, no calibration and no '
    'verification against historical landfall damage. They are exposed above '
    'so they cannot be mistaken for a scientific scale.'
)


class RiskAssessment(BaseModel):
    # ``status`` is the authoritative field. ``heuristicDemoScore`` is only
    # populated when status == 'OK'.
    status: Literal['OK', 'UNAVAILABLE'] = 'OK'
    unavailableReason: Optional[str] = None
    heuristicDemoScore: Optional[int] = None
    category: Optional[Literal['LOW', 'ELEVATED', 'MODERATE', 'HIGH', 'CRITICAL']] = None
    #: The HYCOM model time the TCHP/SST means were read from. The score is a
    #: function of the ocean state at THIS time, not of the storm's date, so it
    #: is reported rather than left implicit. None when no score was produced.
    modelTimestamp: Optional[str] = None
    #: True only when ``modelTimestamp`` is within the match tolerance of the
    #: cyclone point that was scored. False means the ocean state is from a
    #: different day than the storm — the score stands, but it is not this
    #: storm's own ocean state.
    timeMatched: bool = False
    modelType: str = 'prototype_rule_based'
    validated: bool = False
    operationalUse: str = 'NOT FOR OPERATIONAL USE'
    disclaimer: str = RISK_DISCLAIMER
    weights: Dict[str, float] = RISK_HEURISTIC_WEIGHTS
    evidence: List[Evidence] = []
    explanation: Optional[Explanation] = None
    affectedRegions: List[str] = []

class Hazard(BaseModel):
    id: str
    title: str
    type: Literal['cyclone', 'high_wave', 'strong_wind', 'storm_surge', 'coastal_erosion']
    severity: Optional[Literal['LOW', 'ELEVATED', 'MODERATE', 'HIGH', 'CRITICAL']] = None
    location: str
    dataStatus: DataStatus
    riskAssessment: RiskAssessment

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
    """Grid payload of a raster layer.

    Missing/masked cells (land, or points outside the model domain) are
    represented as ``null`` — never as ``0.0``. A masked cell and a genuine
    zero-valued measurement are different things, and collapsing them makes
    land render as a real colour and biases any mean computed over the grid.
    """

    latitudes: List[float]
    longitudes: List[float]
    values: Optional[List[List[Optional[float]]]] = None
    u: Optional[List[List[Optional[float]]]] = None
    v: Optional[List[List[Optional[float]]]] = None

class LayerDataResponse(BaseModel):
    status: DataStatus
    source: str
    layer_name: str
    #: The model time this grid ACTUALLY holds. When the requested time is not
    #: in the dataset this is the nearest time the model does have, and
    #: ``timeMatched`` is False — a response must never be readable as if it
    #: described the requested date.
    timestamp: str
    #: The time the caller asked for, when it sent one. Retained so a mismatch
    #: is visible on the wire, not only in the resolved label.
    requestedTimestamp: Optional[str] = None
    #: True only when ``timestamp`` is within the match tolerance of
    #: ``requestedTimestamp``.
    timeMatched: bool = True
    units: str
    bounds: Dict[str, float]
    grid: LayerGridData
    # Coverage accounting so a consumer can tell how much of the returned
    # rectangle is real ocean versus masked land.
    validCellCount: Optional[int] = None
    missingCellCount: Optional[int] = None
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
    # Delayed-mode (adjusted) values, present only when the source supplies
    # them. The matchup reads exactly one basis per profile according to the
    # Argo data mode (R -> raw, A/D -> adjusted); see services/argo_levels.py.
    pressure_dbar_adjusted: Optional[float] = None
    pressure_dbar_adjusted_qc: Optional[int] = None
    depth_m_adjusted: Optional[float] = None
    temperature_c_adjusted: Optional[float] = None
    temperature_c_adjusted_qc: Optional[int] = None
    salinity_psu_adjusted: Optional[float] = None
    salinity_psu_adjusted_qc: Optional[int] = None

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
    # How the float depth was obtained: "pressure_gsw" (TEOS-10 conversion of
    # Argo pressure) or "provided" (source depth_m used unchanged).
    depthSource: Optional[str] = None
    # How the model value was obtained: "native" (one native HYCOM level) or
    # "interpolated" (linear blend of two native levels).
    method: Optional[str] = None
    # "adjusted" (delayed-mode value used) or "raw" (in-situ fallback).
    argoVariableSource: Optional[str] = None
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
    ``interpolatedLevelCount`` + ``nativeLevelCount`` split those rows by how
    the model value was obtained.
    """
    totalArgoObservations: int = 0
    matchedObservationCount: int = 0
    unmatchedObservationCount: int = 0
    matchedPercentage: Optional[float] = None
    deepestMatchedObservationDepthM: Optional[float] = None
    deepestMatchedModelDepthM: Optional[float] = None
    repeatedNativeDepthMatchCount: int = 0
    interpolatedLevelCount: int = 0
    nativeLevelCount: int = 0
    interpolationApplied: bool = False
    # Levels whose Argo QC flags were absent and were accepted on the lenient
    # assumption documented in argo_levels.
    missingQcLevelCount: int = 0
    # What matchedPercentage / unmatchedObservationCount are measured against:
    # "model_levels" (default matching mode) or "argo_observations".
    matchedPercentageBasis: str = "argo_observations"
    totalModelLevels: Optional[int] = None
    # Surface levels that borrowed a shallow float sample (not native, not
    # interpolated).
    nearSurfaceSubstitutionCount: int = 0
    # Observation-model time separation and its classification. Passed in by
    # the caller because it is a property of the profile/model pair, not of the
    # matched rows.
    timeDifferenceHours: Optional[float] = None
    timeGapStatus: Optional[str] = None

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
    # True when the model field was linearly blended between two model time
    # slices bracketing the observation time.
    timeInterpolationApplied: bool = False
    # Observation-model time separation classification:
    # "good" (<= MATCHUP_TIME_GAP_GOOD_H), "marginal" (<= MATCHUP_TIME_GAP_MAX_H),
    # "too_large" (beyond it). When "too_large" both profiles are returned but
    # `statistics` is empty and `timeGapReason` explains why.
    timeGapStatus: str = "too_large"
    timeGapReason: Optional[str] = None
    statisticsSuppressed: bool = False
    # The archived model run selected, and every run that was considered with
    # its time gap and forecast lead time.
    modelRun: Optional[str] = None
    availableModelRuns: List[Dict[str, Any]] = Field(default_factory=list)
    distanceKm: float
    # Horizontal sub-sampling actually applied: "bilinear" or "nearest".
    spatialMode: str = "bilinear"
    matchedDepths: List[float]
    matchedPointCount: int = 0
    # Only constrains matchMode="native"; interpolation is bounded by the
    # model's valid depth range instead.
    matchingToleranceM: float = 15.0
    # Vertical sub-sampling actually applied: "interpolated" or "native".
    matchMode: str = "model_levels"
    modelDepthSelection: str = (
        "model values at native HYCOM depth levels; float interpolated onto them"
    )
    modelDepthAxis: str = "native"
    modelDepthAxisRule: Optional[str] = None
    modelDepths: List[float] = Field(default_factory=list)
    storedFileDepths: List[float] = Field(default_factory=list)
    # model_levels mode: model levels that produced no pair, with the reason.
    excludedModelLevels: List[Dict[str, Any]] = Field(default_factory=list)
    floatBracketMaxGapM: float = 50.0
    floatBracketMaxGapDeepM: float = 100.0
    floatBracketDeepBreakpointM: float = 150.0
    # --- Cyclone-relevant heat content (float-derived TCHP/D26 vs model TCHP/MLD) ---
    # TCHP is in kJ/cm2, the unit the model's TCHP field carries. The residual is
    # model - float, matching the temperature convention, so a positive value
    # means the model carries more heat than the float measured.
    #
    # ``metricsStatus``/``metricsReason`` explain a missing value. A missing
    # measurement and a measurement of zero are different claims and are never
    # conflated: ``tchpFloatKjCm2`` is 0.0 only when the float's surface is below
    # the isotherm, which is a real observation of no heat above 26 C.
    tchpFloatKjCm2: Optional[float] = None
    tchpModelKjCm2: Optional[float] = None
    tchpResidualKjCm2: Optional[float] = None
    tchpResidualPercent: Optional[float] = None
    d26FloatM: Optional[float] = None
    mldModelM: Optional[float] = None
    metricsStatus: Optional[str] = None
    metricsReason: Optional[str] = None
    metricsSurfaceDepthM: Optional[float] = None
    metricsSurfaceTemperatureC: Optional[float] = None
    # Why the model's own TCHP may not be directly comparable: its formula is
    # not published anywhere in the file.
    tchpDefinitionStatus: Optional[str] = None
    tchpIsothermC: float = 26.0
    tchpMetricsMaxGapM: float = 25.0
    # Depth basis of the float side: "pressure_gsw", "provided", "mixed" or
    # "unavailable".
    depthSource: str = "unavailable"
    # Variable family actually read for the whole profile: "raw" or "adjusted".
    variableBasis: str = "raw"
    # Requested Argo data mode ("R", "A", "D") or "auto" when auto-detected.
    argoDataMode: str = "auto"
    # Levels accepted because their QC flags were absent from the source.
    missingQcLevelCount: int = 0
    # Accepted Argo QC flags for raw and adjusted values.
    qcFlagsUsed: Dict[str, Any] = Field(default_factory=dict)
    comparisons: List[DepthComparison]
    dataStatus: DataStatus = "REAL"
    source: str = "Argo Global Data (GDAC) + INCOIS RSMC HYCOM"
    residualConvention: str = "ΔT = HYCOM - Argo, ΔS = HYCOM - Argo"
    statusMessage: Optional[str] = None
    statistics: Optional[MatchupStatisticsByVariable] = None
    diagnostics: Optional[MatchupDiagnostics] = None
