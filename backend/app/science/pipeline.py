"""Scientific pipeline orchestration (STEP 3B §2, §21, §22).

Stage order, matching the OCEAN-X research design:

    Argo profile
    -> quality control
    -> adjusted-variable selection where available
    -> DATA_MODE handling
    -> pressure to depth conversion (TEOS-10)
    -> model spatial co-location (nearest grid cell)
    -> model temporal co-location (nearest timestamp)
    -> tolerance validation (±12 h)
    -> vertical alignment (linear interpolation)
    -> residual calculation (D = M - O)
    -> bias / MAE / RMSE
    -> provenance

Each stage lives in its own module and is independently testable. This module
only sequences them and reports failures without fabricating a comparison.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Sequence

import numpy as np

from app.core.config import settings
from app.datasources.base import ModelDataSource, ModelProfileSample, VariableNotFoundError
from app.science.argo_profile import ProcessedArgoProfile, RawArgoProfile
from app.science.colocation import SpatioTemporalMatch, colocate
from app.science.profile_processing import (
    UnsupportedDataModeError,
    VariableUnavailableError,
    process_argo_profile,
)
from app.science.provenance import build_provenance
from app.science.qc import QCPolicy, default_policy
from app.science.residuals import (
    ComparisonStatistics,
    ResidualSeries,
    calculate_metrics,
    calculate_residuals,
)
from app.science.vertical import AlignedProfiles, align_profiles

FAILURE_NO_OBSERVATIONS = "no_observations_passed_qc"
FAILURE_NO_MODEL_MATCH = "no_valid_model_match"
FAILURE_NO_COMPARISON_DEPTHS = "no_common_comparison_depths"
FAILURE_VARIABLE_UNAVAILABLE = "variable_unavailable"
FAILURE_DATA_MODE_REJECTED = "data_mode_rejected"


@dataclass(frozen=True)
class ComparisonResult:
    """Complete outcome of one profile comparison.

    ``is_valid`` false means no scientifically defensible comparison exists. In
    that case ``residuals`` is empty and every metric is ``None``; provenance
    still explains why (§20).
    """

    profile_id: str
    variable: str
    units: Optional[str]
    processed: Optional[ProcessedArgoProfile]
    match: Optional[SpatioTemporalMatch]
    model_sample: Optional[ModelProfileSample]
    aligned: Optional[AlignedProfiles]
    residuals: Optional[ResidualSeries]
    metrics: ComparisonStatistics
    provenance: Dict[str, Any]
    is_valid: bool
    failure_reason: Optional[str] = None
    failure_detail: Optional[str] = None
    notes: List[str] = field(default_factory=list)


def match_model_to_observation(
    profile: RawArgoProfile,
    source: ModelDataSource,
    temporal_tolerance_hours: Optional[float] = None,
) -> SpatioTemporalMatch:
    """Stage: spatial + temporal co-location against the model grid (§11–§13)."""
    grid = source.grid_info()
    return colocate(
        observation_time=profile.time,
        latitude=profile.latitude,
        longitude=profile.longitude,
        model_times=grid.times,
        model_latitudes=grid.latitudes,
        model_longitudes=grid.longitudes,
        temporal_tolerance_hours=temporal_tolerance_hours,
    )


def sample_model_profile(
    source: ModelDataSource,
    variable: str,
    match: SpatioTemporalMatch,
) -> ModelProfileSample:
    """Stage: read the model vertical profile at the *co-located* time (§15).

    The time index comes from the temporal matching stage, never from a UI
    selection, and is recorded on the returned sample.
    """
    if not match.is_valid:
        raise ValueError("cannot sample the model for an invalid co-location match")
    return source.profile_at(
        variable=variable,
        time_index=match.model_time_index,
        lat_index=match.model_lat_index,
        lon_index=match.model_lon_index,
    )


def _empty_result(
    *,
    profile: RawArgoProfile,
    variable: str,
    units: Optional[str],
    processed: Optional[ProcessedArgoProfile],
    match: Optional[SpatioTemporalMatch],
    aligned: Optional[AlignedProfiles],
    grid_info,
    model_variable,
    qc_policy: QCPolicy,
    failure_reason: str,
    failure_detail: str,
    extra_notes: Optional[List[str]] = None,
) -> ComparisonResult:
    notes = list(extra_notes or [])
    notes.append(f"comparison not produced: {failure_detail}")

    if processed is not None and match is not None:
        provenance = build_provenance(
            processed=processed,
            match=match,
            aligned=aligned,
            grid_info=grid_info,
            model_variable=model_variable,
            qc_policy=qc_policy,
            variable=variable,
            variable_units=units,
            extra_notes=notes,
        )
    else:
        provenance = {
            "dataset_id": getattr(grid_info, "dataset_id", None),
            "model": getattr(grid_info, "model", None),
            "data_tier": getattr(grid_info, "data_tier", None),
            "observation_id": profile.profile_id,
            "observation_platform": profile.platform_type,
            "observation_cycle_number": profile.cycle_number,
            "observation_time": profile.time.isoformat(),
            "latitude": profile.latitude,
            "longitude": profile.longitude,
            "variable": variable,
            "variable_units": units,
            "argo_data_mode": profile.data_mode_label,
            "argo_data_mode_code": profile.data_mode,
            "qc_policy": qc_policy.as_metadata(),
            "match_valid": False,
            "failure_reason": failure_reason,
            "processing_notes": " | ".join(notes),
            "processing_notes_detail": notes,
        }

    provenance["failure_reason"] = failure_reason
    provenance["failure_detail"] = failure_detail

    return ComparisonResult(
        profile_id=profile.profile_id,
        variable=variable,
        units=units,
        processed=processed,
        match=match,
        model_sample=None,
        aligned=aligned,
        residuals=None,
        metrics=ComparisonStatistics(n=0),
        provenance=provenance,
        is_valid=False,
        failure_reason=failure_reason,
        failure_detail=failure_detail,
        notes=notes,
    )


def compare_profile(
    profile: RawArgoProfile,
    source: ModelDataSource,
    variable: str = "temperature",
    qc_policy: Optional[QCPolicy] = None,
    temporal_tolerance_hours: Optional[float] = None,
    comparison_depths: Optional[Sequence[float]] = None,
) -> ComparisonResult:
    """Run the full pipeline for one Argo profile against the model.

    Never raises for scientific reasons: an impossible comparison returns
    ``is_valid=False`` with provenance explaining the rejection. Programming
    errors and unreadable data still raise.
    """
    qc_policy = qc_policy or default_policy()
    grid_info = source.grid_info()

    # -- resolve the model variable (§5) -------------------------------
    try:
        model_variable = source.resolve_variable(variable)
        units = model_variable.units
    except VariableNotFoundError as exc:
        return _empty_result(
            profile=profile,
            variable=variable,
            units=None,
            processed=None,
            match=None,
            aligned=None,
            grid_info=grid_info,
            model_variable=None,
            qc_policy=qc_policy,
            failure_reason=FAILURE_VARIABLE_UNAVAILABLE,
            failure_detail=f"model variable could not be resolved: {exc}",
        )

    # -- stages 1-4: QC, field selection, DATA_MODE, depth -------------
    try:
        processed = process_argo_profile(profile, variable=variable, policy=qc_policy)
    except UnsupportedDataModeError as exc:
        return _empty_result(
            profile=profile, variable=variable, units=units, processed=None, match=None,
            aligned=None, grid_info=grid_info, model_variable=model_variable,
            qc_policy=qc_policy, failure_reason=FAILURE_DATA_MODE_REJECTED,
            failure_detail=str(exc),
        )
    except VariableUnavailableError as exc:
        return _empty_result(
            profile=profile, variable=variable, units=units, processed=None, match=None,
            aligned=None, grid_info=grid_info, model_variable=model_variable,
            qc_policy=qc_policy, failure_reason=FAILURE_VARIABLE_UNAVAILABLE,
            failure_detail=str(exc),
        )

    # -- stages 5-7: co-location and tolerance -------------------------
    match = match_model_to_observation(profile, source, temporal_tolerance_hours)

    if processed.is_empty:
        return _empty_result(
            profile=profile, variable=variable, units=units, processed=processed,
            match=match, aligned=None, grid_info=grid_info, model_variable=model_variable,
            qc_policy=qc_policy, failure_reason=FAILURE_NO_OBSERVATIONS,
            failure_detail=(
                f"all {processed.n_levels_before_qc} observation level(s) were excluded "
                f"by QC or missing-data rules: {processed.exclusion_summary()}"
            ),
        )

    if not match.is_valid:
        return _empty_result(
            profile=profile, variable=variable, units=units, processed=processed,
            match=match, aligned=None, grid_info=grid_info, model_variable=model_variable,
            qc_policy=qc_policy, failure_reason=FAILURE_NO_MODEL_MATCH,
            failure_detail=match.rejection_detail or "co-location rejected",
        )

    # -- stage 8: model vertical sample at the matched time (§15) ------
    model_sample = sample_model_profile(source, variable, match)

    # -- stage 9: vertical alignment (§14) -----------------------------
    aligned = align_profiles(
        observation_depths=processed.depth_m,
        observation_values=processed.values,
        model_depths=model_sample.depths_m,
        model_values=model_sample.values,
        explicit_depths=comparison_depths,
    )

    if aligned.n_depths == 0:
        return _empty_result(
            profile=profile, variable=variable, units=units, processed=processed,
            match=match, aligned=aligned, grid_info=grid_info,
            model_variable=model_variable, qc_policy=qc_policy,
            failure_reason=FAILURE_NO_COMPARISON_DEPTHS,
            failure_detail=(
                "no depth has a valid value on both the model and observation side"
            ),
            extra_notes=list(model_sample.notes),
        )

    # -- stages 10-11: residual and metrics (§16, §17) -----------------
    residuals = calculate_residuals(
        aligned.depths_m, aligned.model_values, aligned.observation_values
    )
    metrics = calculate_metrics(residuals.residuals, residuals.depths_m)

    # -- stage 12: provenance (§18) ------------------------------------
    provenance = build_provenance(
        processed=processed,
        match=match,
        aligned=aligned,
        grid_info=grid_info,
        model_variable=model_variable,
        qc_policy=qc_policy,
        variable=variable,
        variable_units=units,
        extra_notes=list(model_sample.notes) + list(residuals.notes),
    )

    return ComparisonResult(
        profile_id=profile.profile_id,
        variable=variable,
        units=units,
        processed=processed,
        match=match,
        model_sample=model_sample,
        aligned=aligned,
        residuals=residuals,
        metrics=metrics,
        provenance=provenance,
        is_valid=True,
        notes=list(aligned.notes),
    )
