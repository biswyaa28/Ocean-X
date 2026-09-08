"""Argo profile processing: field selection, QC filtering, depth conversion.

Implements STEP 3B §7 (QC), §8 (adjusted variables), §9 (DATA_MODE), §10 (depth)
as one explicit, ordered stage that never mutates the raw profile.

Order of operations
-------------------
1. Select the value field (adjusted preferred where valid) and its QC array.
2. Convert pressure to depth with TEOS-10, using the profile's own latitude.
3. Exclude levels failing pressure QC, value QC, or having missing
   pressure/depth/value — recording a reason for each exclusion.
4. Return an immutable :class:`ProcessedArgoProfile`.
"""
from __future__ import annotations

from typing import List, Optional, Tuple

import numpy as np

from app.core.config import settings
from app.science.argo_profile import (
    DATA_MODE_REAL_TIME,
    FieldSelection,
    LevelExclusion,
    ProcessedArgoProfile,
    RawArgoProfile,
    _field_attr,
    _qc_attr,
)
from app.science.depth import depth_from_pressure
from app.science.qc import QCPolicy, default_policy

EXCLUSION_MISSING_PRESSURE = "missing_pressure"
EXCLUSION_MISSING_VALUE = "missing_value"
EXCLUSION_MISSING_DEPTH = "missing_depth"
EXCLUSION_PRESSURE_QC = "pressure_qc_rejected"
EXCLUSION_VALUE_QC = "value_qc_rejected"


class UnsupportedDataModeError(ValueError):
    """Raised when a profile's DATA_MODE is not accepted by configuration (§9)."""


class VariableUnavailableError(ValueError):
    """Raised when neither adjusted nor unadjusted field exists for a variable."""


def select_field(
    profile: RawArgoProfile,
    variable: str,
    policy: Optional[QCPolicy] = None,
) -> Tuple[np.ndarray, Optional[np.ndarray], FieldSelection]:
    """Choose adjusted vs unadjusted values for ``variable`` (§8).

    Adjusted data are preferred when the profile's DATA_MODE indicates adjustment
    is expected (A or D) *and* the adjusted field actually exists *and* it
    contains at least one level with an acceptable QC flag and a finite value.
    Otherwise the raw field is used and the fallback reason is recorded.

    We never claim adjustment occurred when the source has no adjusted array.
    """
    policy = policy or default_policy()
    units = (profile.units or {}).get(variable)

    raw_attr = _field_attr(variable, adjusted=False)
    adj_attr = _field_attr(variable, adjusted=True)
    raw_values = getattr(profile, raw_attr, None)
    adj_values = getattr(profile, adj_attr, None)

    prefer_adjusted = profile.data_mode in settings.PREFER_ADJUSTED_FOR_MODES
    fallback_reason: Optional[str] = None

    if prefer_adjusted:
        if adj_values is None:
            fallback_reason = (
                f"DATA_MODE={profile.data_mode} implies adjustment, but "
                f"{adj_attr.upper()} is absent from the source profile"
            )
        else:
            adj_qc = getattr(profile, _qc_attr(variable, adjusted=True), None)
            qc_ok = policy.acceptable_mask(adj_qc, profile.n_levels)
            usable = qc_ok & np.isfinite(adj_values)
            if not usable.any():
                fallback_reason = (
                    f"{adj_attr.upper()} present but contains no level with both a "
                    f"finite value and an acceptable QC flag "
                    f"{list(policy.acceptable_flags)}"
                )
            else:
                return (
                    adj_values,
                    adj_qc,
                    FieldSelection(
                        variable=variable,
                        source_field=adj_attr.upper(),
                        used_adjusted=True,
                        data_mode=profile.data_mode,
                        fallback_reason=None,
                        qc_field=_qc_attr(variable, adjusted=True).upper()
                        if adj_qc is not None
                        else None,
                        units=units,
                    ),
                )
    else:
        # DATA_MODE R: real-time data are by definition unadjusted. If an
        # adjusted array is nonetheless present we do not use it, and we say so.
        if adj_values is not None:
            fallback_reason = (
                f"DATA_MODE={profile.data_mode} (real-time); adjusted field present "
                "but not preferred under configured policy"
            )

    if raw_values is None:
        raise VariableUnavailableError(
            f"variable '{variable}' unavailable: neither {raw_attr.upper()} nor "
            f"{adj_attr.upper()} present in profile {profile.profile_id}"
        )

    raw_qc = getattr(profile, _qc_attr(variable, adjusted=False), None)
    if fallback_reason is None and prefer_adjusted is False:
        fallback_reason = (
            f"DATA_MODE={profile.data_mode}; unadjusted field used as no adjustment "
            "is expected for this mode"
        )

    return (
        raw_values,
        raw_qc,
        FieldSelection(
            variable=variable,
            source_field=raw_attr.upper(),
            used_adjusted=False,
            data_mode=profile.data_mode,
            fallback_reason=fallback_reason,
            qc_field=_qc_attr(variable, adjusted=False).upper() if raw_qc is not None else None,
            units=units,
        ),
    )


def select_pressure(
    profile: RawArgoProfile, selection_used_adjusted: bool
) -> Tuple[np.ndarray, Optional[np.ndarray], str]:
    """Choose PRES vs PRES_ADJUSTED consistently with the value-field choice."""
    if (
        selection_used_adjusted
        and profile.pressure_adjusted is not None
        and np.isfinite(profile.pressure_adjusted).any()
    ):
        return profile.pressure_adjusted, profile.pres_adjusted_qc, "PRES_ADJUSTED"
    return profile.pressure, profile.pres_qc, "PRES"


def process_argo_profile(
    profile: RawArgoProfile,
    variable: str = "temperature",
    policy: Optional[QCPolicy] = None,
) -> ProcessedArgoProfile:
    """Run field selection, QC filtering and TEOS-10 depth conversion.

    Returns a new object; ``profile`` is never modified.
    """
    if variable not in ("temperature", "salinity"):
        raise ValueError(f"unsupported variable '{variable}'")

    policy = policy or default_policy()

    if profile.data_mode not in settings.ACCEPTED_DATA_MODES:
        raise UnsupportedDataModeError(
            f"DATA_MODE '{profile.data_mode}' is not accepted "
            f"(configured: {list(settings.ACCEPTED_DATA_MODES)})"
        )

    values, value_qc, selection = select_field(profile, variable, policy)
    pressure, pressure_qc, pressure_field = select_pressure(profile, selection.used_adjusted)

    n = profile.n_levels
    notes: List[str] = [
        f"pressure field: {pressure_field}",
        f"value field: {selection.source_field}",
        f"DATA_MODE: {profile.data_mode} ({profile.data_mode_label})",
    ]
    if value_qc is None:
        notes.append(
            f"QC flags unavailable for {selection.source_field}; QC acceptance could "
            "not be evaluated for the value field"
        )
    if pressure_qc is None:
        notes.append(f"QC flags unavailable for {pressure_field}")
    if profile.is_fixture:
        notes.append(
            profile.fixture_note
            or "values derived from a development fixture, not a real observation"
        )

    # TEOS-10 conversion on the full profile; NaN pressures yield NaN depths.
    depth_all = depth_from_pressure(pressure, profile.latitude)

    pres_qc_ok = policy.acceptable_mask(pressure_qc, n)
    value_qc_ok = policy.acceptable_mask(value_qc, n)

    keep = np.zeros(n, dtype=bool)
    exclusions: List[LevelExclusion] = []

    for i in range(n):
        p_i = float(pressure[i]) if np.isfinite(pressure[i]) else None

        if not np.isfinite(pressure[i]):
            exclusions.append(
                LevelExclusion(i, None, EXCLUSION_MISSING_PRESSURE, f"{pressure_field} is NaN")
            )
            continue
        if not pres_qc_ok[i]:
            flag = int(pressure_qc[i]) if pressure_qc is not None else None
            exclusions.append(
                LevelExclusion(
                    i,
                    p_i,
                    EXCLUSION_PRESSURE_QC,
                    f"{pressure_field}_QC={flag} ({policy.describe_flag(flag)})",
                )
            )
            continue
        if not np.isfinite(depth_all[i]):
            exclusions.append(
                LevelExclusion(i, p_i, EXCLUSION_MISSING_DEPTH, "TEOS-10 depth is NaN")
            )
            continue
        if not np.isfinite(values[i]):
            exclusions.append(
                LevelExclusion(
                    i, p_i, EXCLUSION_MISSING_VALUE, f"{selection.source_field} is NaN"
                )
            )
            continue
        if not value_qc_ok[i]:
            flag = int(value_qc[i]) if value_qc is not None else None
            exclusions.append(
                LevelExclusion(
                    i,
                    p_i,
                    EXCLUSION_VALUE_QC,
                    f"{selection.qc_field or 'value QC'}={flag} ({policy.describe_flag(flag)})",
                )
            )
            continue
        keep[i] = True

    return ProcessedArgoProfile(
        raw=profile,
        variable=variable,
        depth_m=depth_all[keep].copy(),
        values=np.asarray(values, dtype="float64")[keep].copy(),
        pressure_dbar=np.asarray(pressure, dtype="float64")[keep].copy(),
        qc_flags=np.asarray(value_qc)[keep].copy() if value_qc is not None else None,
        selection=selection,
        n_levels_before_qc=n,
        pressure_field=pressure_field,
        exclusions=exclusions,
        notes=notes,
    )
