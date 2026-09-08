"""Comparison Service for OCEAN-X (STEP 3B §22).

Thin adapter between the HTTP layer and the scientific pipeline. It contains no
scientific logic: it fetches the profile, runs
:func:`app.science.pipeline.compare_profile`, and maps the result onto the stable
API schema. All co-location, QC, depth conversion, alignment, residual and metric
work happens in ``app.science.*``.
"""
from __future__ import annotations

import math
from typing import List, Optional

import numpy as np

from app.data.argo_repository import argo_repository
from app.datasources import get_model_data_source
from app.models.schemas import (
    ComparisonLevel,
    ComparisonMetrics,
    ModelMatch,
    ProfileComparison,
    Provenance,
)
from app.science.colocation import SPATIAL_MATCH_METHOD, TEMPORAL_MATCH_METHOD
from app.science.pipeline import ComparisonResult, compare_profile
from app.science.provenance import unit_display_label, unit_symbol
from app.science.residuals import RESIDUAL_DEFINITION, RESIDUAL_LABEL

SUPPORTED_VARIABLES = ("temperature", "salinity")


def _round_opt(value: Optional[float], digits: int) -> Optional[float]:
    """Round for presentation, preserving ``None`` and rejecting non-finite values."""
    if value is None:
        return None
    v = float(value)
    if not math.isfinite(v):
        return None
    return round(v, digits)


def _jsonable(values) -> List[Optional[float]]:
    """NaN/Inf are not valid JSON numbers; emit ``null`` rather than a fake value."""
    return [None if not np.isfinite(v) else float(v) for v in np.asarray(values, dtype="float64")]


class ComparisonService:
    """API-facing comparison orchestration."""

    def __init__(self, repository=None, source_factory=get_model_data_source) -> None:
        self._repository = repository or argo_repository
        self._source_factory = source_factory

    # ------------------------------------------------------------------
    def get_comparison(
        self, profile_id: str, variable: str = "temperature"
    ) -> Optional[ProfileComparison]:
        """Run the scientific pipeline and map it to the API schema.

        Returns ``None`` only when the profile does not exist (HTTP 404). A
        scientifically impossible comparison returns a payload with
        ``valid=False`` and provenance explaining why — never a fabricated result.
        """
        if variable not in SUPPORTED_VARIABLES:
            variable = "temperature"

        raw = self._repository.get_raw_profile(profile_id)
        if raw is None:
            return None

        source = self._source_factory()
        result = compare_profile(raw, source, variable=variable)
        return self._to_schema(result, variable)

    # ------------------------------------------------------------------
    def _to_schema(self, result: ComparisonResult, variable: str) -> ProfileComparison:
        prov_dict = dict(result.provenance)
        match = result.match

        # ``depth_reference`` is "meters" per §14; the descriptive text lives in
        # ``depth_reference_note``. Only identity fields are defaulted, and only
        # to an explicit "unknown" — never to a plausible-looking value.
        prov_dict.setdefault("dataset_id", "unknown")
        prov_dict.setdefault("dataset_version", "unknown")
        prov_dict.setdefault("model", "unknown")
        prov_dict.setdefault("model_version", "unknown")
        prov_dict.setdefault("spatial_match_method", SPATIAL_MATCH_METHOD)
        prov_dict.setdefault("temporal_match_method", TEMPORAL_MATCH_METHOD)
        prov_dict.setdefault("depth_reference", "meters")
        prov_dict.setdefault("temperature_units", unit_display_label(result.units))
        prov_dict.setdefault("argo_data_mode", "unknown")
        prov_dict.setdefault("argo_qc", "unknown")
        prov_dict.setdefault("processing_notes", "")
        provenance = Provenance(**prov_dict)

        if match is not None:
            match_model = ModelMatch(
                time_index=match.model_time_index,
                time_utc=match.model_time.isoformat() if match.model_time else None,
                grid_latitude=_round_opt(match.model_latitude, 6),
                grid_longitude=_round_opt(match.model_longitude, 6),
                # grid_i is the longitude index, grid_j the latitude index —
                # preserving the STEP 3A field meanings.
                grid_i=match.model_lon_index,
                grid_j=match.model_lat_index,
                distance_km=_round_opt(match.spatial_distance_km, 3),
                time_difference_hours=_round_opt(match.temporal_difference_hours, 3),
                valid=match.is_valid,
                spatial_match_method=match.spatial_match_method,
                temporal_match_method=match.temporal_match_method,
                temporal_tolerance_hours=match.temporal_tolerance_hours,
                rejection_reason=match.rejection_reason,
                rejection_detail=match.rejection_detail,
            )
        else:
            match_model = ModelMatch(
                valid=False,
                spatial_match_method=SPATIAL_MATCH_METHOD,
                temporal_match_method=TEMPORAL_MATCH_METHOD,
                rejection_reason=result.failure_reason,
                rejection_detail=result.failure_detail,
            )

        m = result.metrics
        metrics = ComparisonMetrics(
            n=m.n,
            bias=_round_opt(m.bias, 4),
            mae=_round_opt(m.mae, 4),
            rmse=_round_opt(m.rmse, 4),
            max_abs_residual=_round_opt(m.max_abs_residual, 4),
            max_residual_depth_m=_round_opt(m.max_residual_depth_m, 4),
            definitions=m.definitions,
        )

        if result.residuals is not None:
            depths = [round(float(z), 4) for z in result.residuals.depths_m]
            obs_values = [float(v) for v in result.residuals.observation_values]
            model_values = [float(v) for v in result.residuals.model_values]
            residuals = [float(v) for v in result.residuals.residuals]
            levels = [
                ComparisonLevel(
                    depth_m=round(float(r["depth_m"]), 4),
                    model=float(r["model"]),
                    observation=float(r["observation"]),
                    residual=float(r["residual"]),
                )
                for r in result.residuals.records()
            ]
            unpaired = result.residuals.n_unpaired_discarded
        else:
            depths, obs_values, model_values, residuals, levels = [], [], [], [], []
            unpaired = 0

        excluded_count = result.processed.n_excluded if result.processed is not None else 0
        if result.aligned is not None:
            unpaired += result.aligned.n_candidate_depths - result.aligned.n_depths

        return ProfileComparison(
            profile_id=result.profile_id,
            variable=variable,
            unit=unit_symbol(result.units),
            match=match_model,
            obs_depths=depths,
            obs_values=obs_values,
            model_values=model_values,
            residuals=residuals,
            residual_label=RESIDUAL_LABEL,
            residual_definition=RESIDUAL_DEFINITION,
            excluded_count=excluded_count,
            metrics=metrics,
            provenance=provenance,
            valid=result.is_valid,
            failure_reason=result.failure_reason,
            failure_detail=result.failure_detail,
            levels=levels or None,
            comparison_depths=depths or None,
            unpaired_discarded_count=max(0, unpaired),
            model_depths_native=(
                [float(z) for z in result.model_sample.depths_m]
                if result.model_sample is not None
                else None
            ),
            model_values_native=(
                _jsonable(result.model_sample.values)
                if result.model_sample is not None
                else None
            ),
            is_fixture=bool(
                (result.processed.raw.is_fixture if result.processed else True)
                or (result.model_sample.is_fixture if result.model_sample else True)
            ),
        )


comparison_service = ComparisonService()
