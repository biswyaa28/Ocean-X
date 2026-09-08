"""Provenance construction (STEP 3B §18).

Provenance is a first-class scientific output: it must carry enough information
to reproduce the reasoning behind a comparison. Unavailable metadata is reported
as ``None`` — never invented, never defaulted to a plausible-looking value (§18).
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from app.science.argo_profile import ProcessedArgoProfile
from app.science.colocation import SpatioTemporalMatch
from app.science.depth import DEPTH_CONVENTION, DEPTH_REFERENCE
from app.science.qc import QCPolicy
from app.science.residuals import RESIDUAL_DEFINITION, RESIDUAL_LABEL
from app.science.vertical import AlignedProfiles

# Display labels for canonical unit tokens. Only used for presentation; the
# authoritative value is always ``variable_units``, resolved from the data source.
_UNIT_DISPLAY = {
    "degC": "°C (ITS-90)",
    "psu": "PSU (PSS-78)",
    "K": "K",
    "unknown": "unknown",
}

# Compact symbols for the ``unit`` field of the comparison payload.
_UNIT_SYMBOL = {
    "degC": "°C",
    "psu": "PSU",
    "K": "K",
    "unknown": "unknown",
}

MAX_EXCLUSIONS_REPORTED = 50


def unit_display_label(units: Optional[str]) -> str:
    """Verbose unit label including the scale convention, for provenance."""
    if units is None:
        return "unknown"
    return _UNIT_DISPLAY.get(units, units)


def unit_symbol(units: Optional[str]) -> str:
    """Compact unit symbol for API display fields."""
    if units is None:
        return "unknown"
    return _UNIT_SYMBOL.get(units, units)


def _iso(value) -> Optional[str]:
    return value.isoformat() if value is not None else None


def build_provenance(
    *,
    processed: ProcessedArgoProfile,
    match: SpatioTemporalMatch,
    aligned: Optional[AlignedProfiles],
    grid_info,
    model_variable,
    qc_policy: QCPolicy,
    variable: str,
    variable_units: Optional[str],
    extra_notes: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """Assemble the provenance record for one profile comparison."""
    raw = processed.raw
    notes: List[str] = []
    notes.extend(processed.notes)
    if aligned is not None:
        notes.extend(aligned.notes)
    if match.rejection_detail:
        notes.append(f"co-location rejected: {match.rejection_detail}")
    if grid_info.is_fixture or raw.is_fixture:
        notes.append(
            "FIXTURE RUN: model and/or observation values are synthetic development "
            "fixtures, not real GLORYS12V1 output or real Argo measurements"
        )
    if extra_notes:
        notes.extend(extra_notes)

    exclusions = [
        {
            "level_index": exc.level_index,
            "pressure_dbar": exc.pressure_dbar,
            "reason": exc.reason,
            "detail": exc.detail,
        }
        for exc in processed.exclusions[:MAX_EXCLUSIONS_REPORTED]
    ]
    if len(processed.exclusions) > MAX_EXCLUSIONS_REPORTED:
        notes.append(
            f"{len(processed.exclusions)} exclusions recorded; first "
            f"{MAX_EXCLUSIONS_REPORTED} listed"
        )

    selection = processed.selection
    if variable == "temperature":
        qc_source = raw.temp_adjusted_qc if selection.used_adjusted else raw.temp_qc
    else:
        qc_source = raw.psal_adjusted_qc if selection.used_adjusted else raw.psal_qc

    return {
        # -- dataset identity ------------------------------------------
        "dataset_id": grid_info.dataset_id,
        "dataset_version": grid_info.model_version,
        "model": grid_info.model,
        "model_version": grid_info.model_version,
        "data_tier": grid_info.data_tier,
        "dataset_source": grid_info.source,
        # -- variable identity ----------------------------------------
        "variable": variable,
        "model_variable_name": getattr(model_variable, "actual_name", None),
        "model_variable_long_name": getattr(model_variable, "long_name", None),
        "model_variable_candidates_tried": list(
            getattr(model_variable, "candidates_tried", []) or []
        ),
        # -- observation identity --------------------------------------
        "observation_id": raw.profile_id,
        "observation_platform": raw.platform_type,
        "observation_cycle_number": raw.cycle_number,
        "observation_data_centre": raw.data_centre,
        "observation_time": _iso(match.observation_time),
        "model_time": _iso(match.model_time),
        "latitude": match.observation_latitude,
        "longitude": match.observation_longitude,
        "model_latitude": match.model_latitude,
        "model_longitude": match.model_longitude,
        "model_grid_lat_index": match.model_lat_index,
        "model_grid_lon_index": match.model_lon_index,
        # -- co-location ----------------------------------------------
        "spatial_match_method": match.spatial_match_method,
        "spatial_distance_km": match.spatial_distance_km,
        "temporal_match_method": match.temporal_match_method,
        "temporal_difference_hours": match.temporal_difference_hours,
        "temporal_tolerance_hours": match.temporal_tolerance_hours,
        "match_valid": match.is_valid,
        "match_rejection_reason": match.rejection_reason,
        "match_rejection_detail": match.rejection_detail,
        # -- vertical --------------------------------------------------
        "vertical_alignment_method": (
            aligned.method if aligned is not None else None
        ),
        "depth_reference": DEPTH_REFERENCE,
        "depth_reference_note": (
            "depth is metres positive downwards from the sea surface; "
            f"{DEPTH_CONVENTION}"
        ),
        "depth_conversion_method": "TEOS-10 / GSW gsw.z_from_p",
        "n_candidate_comparison_depths": (
            aligned.n_candidate_depths if aligned is not None else 0
        ),
        "n_comparison_depths": aligned.n_depths if aligned is not None else 0,
        # -- field selection (§8) --------------------------------------
        "source_value_field": selection.source_field,
        "source_temperature_field": (
            selection.source_field if variable == "temperature" else None
        ),
        "source_pressure_field": processed.pressure_field,
        "adjusted_selection": "adjusted" if selection.used_adjusted else "unadjusted",
        "adjustment_fallback_reason": selection.fallback_reason,
        "value_qc_field": selection.qc_field,
        # -- DATA_MODE (§9) -------------------------------------------
        "argo_data_mode": raw.data_mode_label,
        "argo_data_mode_code": raw.data_mode,
        # -- QC handling (§7) -----------------------------------------
        "argo_qc": qc_policy.description,
        "qc_policy": qc_policy.as_metadata(),
        "qc_flag_histogram": qc_policy.summarise(qc_source),
        "qc_flags_available": qc_source is not None,
        "n_observations_before_qc": processed.n_levels_before_qc,
        "n_observations_after_qc": processed.n_levels_after_qc,
        "n_excluded_observations": processed.n_excluded,
        "excluded_observations": exclusions,
        "exclusion_summary": processed.exclusion_summary(),
        # -- units (§19) ----------------------------------------------
        "variable_units": variable_units,
        "temperature_units": unit_display_label(
            variable_units if variable == "temperature" else "degC"
        ),
        "observation_units_declared": (raw.units or {}).get(variable),
        # -- residual definition --------------------------------------
        "residual_label": RESIDUAL_LABEL,
        "residual_definition": RESIDUAL_DEFINITION,
        # -- notes -----------------------------------------------------
        "processing_notes": " | ".join(notes) if notes else "no processing notes",
        "processing_notes_detail": notes,
    }
