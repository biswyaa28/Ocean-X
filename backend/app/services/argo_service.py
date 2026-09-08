"""Argo Service for OCEAN-X (STEP 3B §6, §7, §8, §9, §10).

Serves the observation endpoints. Depth is always derived from pressure with
TEOS-10, and the exposed value/QC pair is the one the comparison pipeline would
actually use (adjusted where valid), so the observation endpoint and the
comparison endpoint can never disagree about which field was read.

``/api/argo/{id}`` deliberately returns **all** levels, including QC-rejected
ones, with their flags visible. Filtering is the comparison stage's job; hiding
rejected levels here would make QC exclusions untraceable (§20).
"""
from __future__ import annotations

from typing import List, Optional

import numpy as np

from app.core.config import settings
from app.data.argo_repository import argo_repository
from app.datasources import get_model_data_source
from app.models.schemas import (
    ArgoObservationLevel,
    ArgoProfile,
    ArgoProfileMeta,
    ArgoSummary,
)
from app.science.argo_profile import RawArgoProfile, _field_attr, _qc_attr
from app.science.colocation import colocate
from app.science.depth import DEPTH_CONVENTION, depth_from_pressure
from app.science.profile_processing import select_field, select_pressure
from app.science.qc import default_policy


def _opt_float(value) -> Optional[float]:
    v = float(value)
    return None if not np.isfinite(v) else round(v, 6)


class ArgoService:
    def __init__(self, repository=None, source_factory=get_model_data_source) -> None:
        self._repository = repository or argo_repository
        self._source_factory = source_factory

    # ------------------------------------------------------------------
    def list_profiles(self) -> List[ArgoSummary]:
        summaries: List[ArgoSummary] = []
        for spec in self._repository.list_specs():
            raw = self._repository.get_raw_profile(str(spec["id"]))
            summaries.append(
                ArgoSummary(
                    id=str(spec["id"]),
                    platform=spec["platform"],
                    cycle=int(spec["cycle"]),
                    time=spec["time"],
                    latitude=float(spec["latitude"]),
                    longitude=float(spec["longitude"]),
                    mode=spec["mode"],
                    data_mode=spec["data_mode"],
                    qc_summary=spec["qc_summary"],
                    n_levels=raw.n_levels if raw is not None else None,
                    is_fixture=bool(raw.is_fixture) if raw is not None else True,
                )
            )
        return summaries

    # ------------------------------------------------------------------
    def get_raw_profile(self, profile_id: str) -> Optional[RawArgoProfile]:
        return self._repository.get_raw_profile(profile_id)

    def get_profile(self, profile_id: str) -> Optional[ArgoProfile]:
        raw = self._repository.get_raw_profile(profile_id)
        if raw is None:
            return None
        spec = self._repository.get_spec(profile_id) or {}

        policy = default_policy()

        # Field selection is performed per variable so the endpoint reports the
        # same fields the pipeline consumes.
        t_values, t_qc, t_sel = select_field(raw, "temperature", policy)
        try:
            s_values, s_qc, s_sel = select_field(raw, "salinity", policy)
        except ValueError:
            s_values, s_qc, s_sel = None, None, None

        pressure, pres_qc, pressure_field = select_pressure(raw, t_sel.used_adjusted)
        depth = depth_from_pressure(pressure, raw.latitude)

        levels: List[ArgoObservationLevel] = []
        for i in range(raw.n_levels):
            t_flag = int(t_qc[i]) if t_qc is not None else None
            s_flag = int(s_qc[i]) if s_qc is not None else None
            p_flag = int(pres_qc[i]) if pres_qc is not None else None
            depth_i = float(depth[i])
            levels.append(
                ArgoObservationLevel(
                    # NaN depth cannot be represented; such a level is reported
                    # with its pressure so the gap remains visible.
                    depth_m=round(depth_i, 4) if np.isfinite(depth_i) else float("-1"),
                    temperature=_opt_float(t_values[i]),
                    salinity=_opt_float(s_values[i]) if s_values is not None else None,
                    # Legacy STEP 3A field: the QC flag of the compared
                    # temperature field. 9 ("missing") when unavailable.
                    qc=t_flag if t_flag is not None else 9,
                    pressure_dbar=_opt_float(pressure[i]),
                    pres_qc=p_flag,
                    temp_qc=t_flag,
                    psal_qc=s_flag,
                    temperature_source_field=t_sel.source_field,
                    salinity_source_field=s_sel.source_field if s_sel else None,
                    qc_accepted=bool(
                        policy.is_acceptable(t_flag)
                        and policy.is_acceptable(p_flag)
                        and np.isfinite(t_values[i])
                        and np.isfinite(depth_i)
                    ),
                )
            )

        # Temporal/spatial co-location against the active model source so the
        # metadata reports the real matched timestamp and tolerance outcome.
        source = self._source_factory()
        grid = source.grid_info()
        match = colocate(
            observation_time=raw.time,
            latitude=raw.latitude,
            longitude=raw.longitude,
            model_times=grid.times,
            model_latitudes=grid.latitudes,
            model_longitudes=grid.longitudes,
        )

        meta = ArgoProfileMeta(
            id=raw.profile_id,
            platform=raw.platform_type or spec.get("platform", "unknown"),
            cycle=raw.cycle_number,
            time=spec.get("time", raw.time.isoformat()),
            latitude=raw.latitude,
            longitude=raw.longitude,
            mode=raw.data_mode,
            data_mode=raw.data_mode_label,
            matched_time_index=(
                match.model_time_index if match.model_time_index is not None else -1
            ),
            matched_model_time=(
                match.model_time.isoformat() if match.model_time is not None else ""
            ),
            qc=spec.get("qc_flag", "UNKNOWN"),
            qc_detail=spec.get("qc_detail", policy.description),
            temporal_difference_hours=(
                round(match.temporal_difference_hours, 3)
                if match.temporal_difference_hours is not None
                else None
            ),
            temporal_tolerance_hours=settings.TEMPORAL_TOLERANCE_HOURS,
            match_valid=match.is_valid,
            match_rejection_reason=match.rejection_reason,
            depth_conversion_method=DEPTH_CONVENTION,
            temperature_source_field=t_sel.source_field,
            salinity_source_field=s_sel.source_field if s_sel else None,
            n_levels=raw.n_levels,
            is_fixture=raw.is_fixture,
        )

        return ArgoProfile(meta=meta, levels=levels)


argo_service = ArgoService()
