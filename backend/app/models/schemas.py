"""Pydantic schemas for OCEAN-X API contracts.

STEP 3B extends these schemas **additively**: every field present in the STEP 3A
contract is retained with its original name and meaning, and new scientific
fields are optional. Two deliberate changes are documented inline:

1. ``ComparisonMetrics`` statistics became ``Optional``. With no valid observation
   pairs the metrics are ``null``, because ``0.0`` is a physical statement of
   perfect agreement and must never be emitted for absent data (§17, §20).
2. ``Provenance.depth_reference`` now carries ``"meters"`` as required by §14. The
   previous descriptive text is preserved in ``depth_reference_note``.
"""
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class DatasetMetadata(BaseModel):
    dataset_id: str
    dataset_name: str
    model: str
    model_version: str
    variables: List[str]
    spatial_resolution: str
    temporal_resolution: str
    depth_levels: List[float]
    region: str
    units: Dict[str, str]
    source: str
    processing_status: str
    data_tier: str = Field(
        default="local_deterministic_fixture",
        description="Indicates whether data is fixture mock or operational/reanalysis"
    )
    notes: Optional[str] = None
    # STEP 3B additions
    model_source: Optional[str] = Field(
        default=None, description="Active model data source implementation ('fixture' or 'netcdf')"
    )
    resolved_variable_names: Optional[Dict[str, str]] = Field(
        default=None,
        description="Logical variable name -> actual dataset variable name resolved at runtime (§5)"
    )
    is_fixture: bool = Field(
        default=True, description="True when values are synthetic development fixtures (§25)"
    )


class ModelTime(BaseModel):
    index: int
    iso_time: str
    timestamp_utc: str


class ModelDepth(BaseModel):
    index: int
    depth_m: float


class ModelSlice(BaseModel):
    variable: str
    depth: float
    depth_index: int
    time: str
    time_index: int
    lon0: float
    lat0: float
    dlon: float
    dlat: float
    nlons: int
    nlats: int
    values: List[List[Optional[float]]]
    min_value: float
    max_value: float
    unit: str
    # STEP 3B additions
    model_variable_name: Optional[str] = Field(
        default=None, description="Actual dataset variable name used (§5)"
    )
    is_fixture: bool = True


class ArgoSummary(BaseModel):
    id: str
    platform: str
    cycle: int
    time: str
    latitude: float
    longitude: float
    mode: str
    data_mode: str
    qc_summary: str
    # STEP 3B additions
    n_levels: Optional[int] = None
    is_fixture: bool = True


class ArgoObservationLevel(BaseModel):
    depth_m: float
    temperature: Optional[float] = None
    salinity: Optional[float] = None
    qc: int
    # STEP 3B additions
    pressure_dbar: Optional[float] = None
    pres_qc: Optional[int] = None
    temp_qc: Optional[int] = None
    psal_qc: Optional[int] = None
    temperature_source_field: Optional[str] = None
    salinity_source_field: Optional[str] = None
    qc_accepted: Optional[bool] = None


class ArgoProfileMeta(BaseModel):
    id: str
    platform: str
    cycle: int
    time: str
    latitude: float
    longitude: float
    mode: str
    data_mode: str
    matched_time_index: int
    matched_model_time: str
    qc: str
    qc_detail: str
    # STEP 3B additions
    temporal_difference_hours: Optional[float] = None
    temporal_tolerance_hours: Optional[float] = None
    match_valid: Optional[bool] = None
    match_rejection_reason: Optional[str] = None
    depth_conversion_method: Optional[str] = None
    temperature_source_field: Optional[str] = None
    salinity_source_field: Optional[str] = None
    n_levels: Optional[int] = None
    is_fixture: bool = True


class ArgoProfile(BaseModel):
    meta: ArgoProfileMeta
    levels: List[ArgoObservationLevel]


class ModelMatch(BaseModel):
    """Co-location result. Fields are ``null`` when a match could not be formed,
    rather than a placeholder number (§18, §20)."""

    time_index: Optional[int] = None
    time_utc: Optional[str] = None
    grid_latitude: Optional[float] = None
    grid_longitude: Optional[float] = None
    grid_i: Optional[int] = None
    grid_j: Optional[int] = None
    distance_km: Optional[float] = None
    time_difference_hours: Optional[float] = None
    # STEP 3B additions
    valid: bool = True
    spatial_match_method: Optional[str] = None
    temporal_match_method: Optional[str] = None
    temporal_tolerance_hours: Optional[float] = None
    rejection_reason: Optional[str] = None
    rejection_detail: Optional[str] = None


class ComparisonMetrics(BaseModel):
    """Statistics over valid pairs only. All values are ``null`` when ``n == 0``."""

    n: int
    bias: Optional[float] = None
    mae: Optional[float] = None
    rmse: Optional[float] = None
    max_abs_residual: Optional[float] = None
    max_residual_depth_m: Optional[float] = None
    definitions: Optional[Dict[str, str]] = None


class ComparisonLevel(BaseModel):
    """One record per valid comparison depth (§16)."""

    depth_m: float
    model: float
    observation: float
    residual: float


class Provenance(BaseModel):
    """Scientific provenance record (§18). Unavailable metadata is ``null``."""

    # -- dataset identity (STEP 3A) -----------------------------------
    dataset_id: str
    dataset_version: str
    model: str
    model_version: str
    observation_id: str
    observation_time: Optional[str] = None
    model_time: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    spatial_match_method: str
    spatial_distance_km: Optional[float] = None
    temporal_match_method: str
    temporal_difference_hours: Optional[float] = None
    vertical_alignment_method: Optional[str] = None
    depth_reference: str
    temperature_units: str
    argo_data_mode: str
    argo_qc: str
    processing_notes: str

    # -- STEP 3B additions --------------------------------------------
    data_tier: Optional[str] = None
    dataset_source: Optional[str] = None
    variable: Optional[str] = None
    model_variable_name: Optional[str] = None
    model_variable_long_name: Optional[str] = None
    model_variable_candidates_tried: Optional[List[str]] = None

    observation_platform: Optional[str] = None
    observation_cycle_number: Optional[int] = None
    observation_data_centre: Optional[str] = None
    model_latitude: Optional[float] = None
    model_longitude: Optional[float] = None
    model_grid_lat_index: Optional[int] = None
    model_grid_lon_index: Optional[int] = None

    temporal_tolerance_hours: Optional[float] = None
    match_valid: Optional[bool] = None
    match_rejection_reason: Optional[str] = None
    match_rejection_detail: Optional[str] = None

    depth_reference_note: Optional[str] = None
    depth_conversion_method: Optional[str] = None
    n_candidate_comparison_depths: Optional[int] = None
    n_comparison_depths: Optional[int] = None

    source_value_field: Optional[str] = None
    source_temperature_field: Optional[str] = None
    source_pressure_field: Optional[str] = None
    adjusted_selection: Optional[str] = None
    adjustment_fallback_reason: Optional[str] = None
    value_qc_field: Optional[str] = None

    argo_data_mode_code: Optional[str] = None
    qc_policy: Optional[Dict[str, Any]] = None
    qc_flag_histogram: Optional[Dict[str, int]] = None
    qc_flags_available: Optional[bool] = None
    n_observations_before_qc: Optional[int] = None
    n_observations_after_qc: Optional[int] = None
    n_excluded_observations: Optional[int] = None
    excluded_observations: Optional[List[Dict[str, Any]]] = None
    exclusion_summary: Optional[Dict[str, int]] = None

    variable_units: Optional[str] = None
    observation_units_declared: Optional[str] = None

    residual_label: Optional[str] = None
    residual_definition: Optional[str] = None
    processing_notes_detail: Optional[List[str]] = None
    failure_reason: Optional[str] = None
    failure_detail: Optional[str] = None


class ProfileComparison(BaseModel):
    profile_id: str
    variable: str
    unit: str
    match: ModelMatch
    obs_depths: List[float]
    obs_values: List[float]
    model_values: List[float]
    residuals: List[float]
    residual_label: str = Field(
        default="Analysis–Observation Residual",
        description="Formal scientific terminology for assimilative ocean analysis vs in-situ observation residual"
    )
    excluded_count: int
    metrics: ComparisonMetrics
    provenance: Provenance
    # -- STEP 3B additions --------------------------------------------
    residual_definition: str = Field(
        default="D = M - O (model analysis minus observation)",
        description="Explicit residual equation (§16)"
    )
    valid: bool = Field(
        default=True,
        description="False when no scientifically defensible comparison exists (§12, §20)"
    )
    failure_reason: Optional[str] = None
    failure_detail: Optional[str] = None
    levels: Optional[List[ComparisonLevel]] = Field(
        default=None, description="One record per valid comparison depth (§16)"
    )
    comparison_depths: Optional[List[float]] = Field(
        default=None, description="Explicit common comparison depth grid actually used (§14)"
    )
    unpaired_discarded_count: int = Field(
        default=0,
        description="Comparison depths dropped because a value was missing on one side"
    )
    model_depths_native: Optional[List[float]] = Field(
        default=None, description="Model native vertical coordinate the profile was sampled from (§15)"
    )
    model_values_native: Optional[List[Optional[float]]] = Field(
        default=None, description="Model values on the native vertical coordinate before alignment"
    )
    is_fixture: bool = True
