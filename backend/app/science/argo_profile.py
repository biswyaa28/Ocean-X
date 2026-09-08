"""Argo profile data model (STEP 3B §6).

Two distinct representations:

``RawArgoProfile``
    Faithful, immutable description of the source profile as it arrives from the
    GDAC/fixture. Optional variables are genuinely optional — a profile with no
    salinity, no adjusted fields or no QC arrays is representable without
    inventing values.

``ProcessedArgoProfile``
    Derived from a raw profile by the processing pipeline. Carries depth,
    selected values, the provenance of the field selection, and per-level
    exclusion records. The raw profile is never mutated (§7).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import List, Optional, Sequence

import numpy as np

# Argo DATA_MODE codes (§9)
DATA_MODE_REAL_TIME = "R"
DATA_MODE_ADJUSTED = "A"
DATA_MODE_DELAYED = "D"

DATA_MODE_LABELS = {
    DATA_MODE_REAL_TIME: "Real-Time (R)",
    DATA_MODE_ADJUSTED: "Real-Time Adjusted (A)",
    DATA_MODE_DELAYED: "Delayed Mode (D)",
}


def _as_float_array(values: Optional[Sequence[float]], n: int, name: str) -> Optional[np.ndarray]:
    """Coerce an optional sequence to a float64 array of length ``n``.

    ``None`` (variable absent) is distinct from an array of NaN (variable
    present but missing at some levels). That distinction is preserved.
    """
    if values is None:
        return None
    arr = np.asarray(values, dtype="float64")
    if arr.ndim != 1:
        raise ValueError(f"{name} must be one-dimensional, got shape {arr.shape}")
    if arr.size != n:
        raise ValueError(f"{name} length {arr.size} does not match pressure length {n}")
    return arr


def _as_qc_array(values: Optional[Sequence], n: int, name: str) -> Optional[np.ndarray]:
    """Coerce optional QC flags to an int array of length ``n``.

    Argo QC flags arrive as byte characters (b'1') or strings ('1') in NetCDF and
    as integers in fixtures. Unparseable or blank flags become 9 ("missing"),
    which the QC policy treats as unacceptable rather than as good data.
    """
    if values is None:
        return None
    out: List[int] = []
    for v in values:
        if isinstance(v, bytes):
            v = v.decode("ascii", errors="ignore")
        if isinstance(v, str):
            v = v.strip()
            out.append(int(v) if v.isdigit() else 9)
        elif v is None:
            out.append(9)
        elif isinstance(v, float) and not np.isfinite(v):
            out.append(9)
        else:
            out.append(int(v))
    arr = np.asarray(out, dtype="int64")
    if arr.size != n:
        raise ValueError(f"{name} length {arr.size} does not match pressure length {n}")
    return arr


@dataclass(frozen=True)
class RawArgoProfile:
    """Immutable source Argo profile.

    Only ``platform_number``, ``cycle_number``, ``time``, ``latitude``,
    ``longitude`` and ``pressure`` are mandatory. Everything else is optional and
    explicitly absent when the source does not provide it (§6).
    """

    platform_number: str
    cycle_number: int
    time: datetime
    latitude: float
    longitude: float
    pressure: np.ndarray

    temperature: Optional[np.ndarray] = None
    salinity: Optional[np.ndarray] = None
    temperature_adjusted: Optional[np.ndarray] = None
    salinity_adjusted: Optional[np.ndarray] = None
    pressure_adjusted: Optional[np.ndarray] = None

    pres_qc: Optional[np.ndarray] = None
    temp_qc: Optional[np.ndarray] = None
    psal_qc: Optional[np.ndarray] = None
    temp_adjusted_qc: Optional[np.ndarray] = None
    psal_adjusted_qc: Optional[np.ndarray] = None
    pres_adjusted_qc: Optional[np.ndarray] = None

    temperature_adjusted_error: Optional[np.ndarray] = None
    salinity_adjusted_error: Optional[np.ndarray] = None

    data_mode: str = DATA_MODE_REAL_TIME
    platform_type: Optional[str] = None
    data_centre: Optional[str] = None
    units: Optional[dict] = None
    # True only for synthetic/development profiles. Propagated to provenance so
    # fixture-derived values are never mistaken for real observations (§25).
    is_fixture: bool = False
    fixture_note: Optional[str] = None

    @property
    def n_levels(self) -> int:
        return int(self.pressure.size)

    @property
    def profile_id(self) -> str:
        return str(self.platform_number)

    @property
    def data_mode_label(self) -> str:
        return DATA_MODE_LABELS.get(self.data_mode, f"Unknown ({self.data_mode})")

    def has_variable(self, variable: str, adjusted: bool = False) -> bool:
        """Whether the requested field is present (not whether it is valid)."""
        attr = _field_attr(variable, adjusted)
        return getattr(self, attr, None) is not None


def _field_attr(variable: str, adjusted: bool) -> str:
    if variable == "temperature":
        return "temperature_adjusted" if adjusted else "temperature"
    if variable == "salinity":
        return "salinity_adjusted" if adjusted else "salinity"
    raise ValueError(f"unsupported variable '{variable}'")


def _qc_attr(variable: str, adjusted: bool) -> str:
    if variable == "temperature":
        return "temp_adjusted_qc" if adjusted else "temp_qc"
    if variable == "salinity":
        return "psal_adjusted_qc" if adjusted else "psal_qc"
    raise ValueError(f"unsupported variable '{variable}'")


def build_raw_profile(
    *,
    platform_number: str,
    cycle_number: int,
    time: datetime,
    latitude: float,
    longitude: float,
    pressure: Sequence[float],
    temperature: Optional[Sequence[float]] = None,
    salinity: Optional[Sequence[float]] = None,
    temperature_adjusted: Optional[Sequence[float]] = None,
    salinity_adjusted: Optional[Sequence[float]] = None,
    pressure_adjusted: Optional[Sequence[float]] = None,
    pres_qc: Optional[Sequence] = None,
    temp_qc: Optional[Sequence] = None,
    psal_qc: Optional[Sequence] = None,
    temp_adjusted_qc: Optional[Sequence] = None,
    psal_adjusted_qc: Optional[Sequence] = None,
    pres_adjusted_qc: Optional[Sequence] = None,
    temperature_adjusted_error: Optional[Sequence[float]] = None,
    salinity_adjusted_error: Optional[Sequence[float]] = None,
    data_mode: str = DATA_MODE_REAL_TIME,
    platform_type: Optional[str] = None,
    data_centre: Optional[str] = None,
    units: Optional[dict] = None,
    is_fixture: bool = False,
    fixture_note: Optional[str] = None,
) -> RawArgoProfile:
    """Validate and construct a :class:`RawArgoProfile`.

    Array lengths are validated against the pressure axis so a malformed source
    profile fails immediately instead of producing a misaligned comparison.
    """
    pres = np.asarray(pressure, dtype="float64")
    if pres.ndim != 1:
        raise ValueError(f"pressure must be one-dimensional, got shape {pres.shape}")
    if pres.size == 0:
        raise ValueError("pressure array is empty; profile carries no levels")
    n = pres.size

    if not np.isfinite(latitude) or not (-90.0 <= float(latitude) <= 90.0):
        raise ValueError(f"latitude {latitude} is not a finite value in [-90, 90]")
    if not np.isfinite(longitude) or not (-180.0 <= float(longitude) <= 360.0):
        raise ValueError(f"longitude {longitude} is not a finite value in [-180, 360]")

    mode = (data_mode or "").strip().upper()
    if mode not in DATA_MODE_LABELS:
        raise ValueError(
            f"unknown DATA_MODE '{data_mode}'; expected one of {sorted(DATA_MODE_LABELS)}"
        )

    return RawArgoProfile(
        platform_number=str(platform_number),
        cycle_number=int(cycle_number),
        time=time,
        latitude=float(latitude),
        longitude=float(longitude),
        pressure=pres,
        temperature=_as_float_array(temperature, n, "temperature"),
        salinity=_as_float_array(salinity, n, "salinity"),
        temperature_adjusted=_as_float_array(temperature_adjusted, n, "temperature_adjusted"),
        salinity_adjusted=_as_float_array(salinity_adjusted, n, "salinity_adjusted"),
        pressure_adjusted=_as_float_array(pressure_adjusted, n, "pressure_adjusted"),
        pres_qc=_as_qc_array(pres_qc, n, "pres_qc"),
        temp_qc=_as_qc_array(temp_qc, n, "temp_qc"),
        psal_qc=_as_qc_array(psal_qc, n, "psal_qc"),
        temp_adjusted_qc=_as_qc_array(temp_adjusted_qc, n, "temp_adjusted_qc"),
        psal_adjusted_qc=_as_qc_array(psal_adjusted_qc, n, "psal_adjusted_qc"),
        pres_adjusted_qc=_as_qc_array(pres_adjusted_qc, n, "pres_adjusted_qc"),
        temperature_adjusted_error=_as_float_array(
            temperature_adjusted_error, n, "temperature_adjusted_error"
        ),
        salinity_adjusted_error=_as_float_array(
            salinity_adjusted_error, n, "salinity_adjusted_error"
        ),
        data_mode=mode,
        platform_type=platform_type,
        data_centre=data_centre,
        units=dict(units) if units else None,
        is_fixture=bool(is_fixture),
        fixture_note=fixture_note,
    )


@dataclass(frozen=True)
class LevelExclusion:
    """Why one level was dropped. Every exclusion is traceable (§20)."""

    level_index: int
    pressure_dbar: Optional[float]
    reason: str
    detail: Optional[str] = None


@dataclass(frozen=True)
class FieldSelection:
    """Outcome of adjusted-vs-unadjusted field selection (§8)."""

    variable: str
    source_field: str
    used_adjusted: bool
    data_mode: str
    fallback_reason: Optional[str] = None
    qc_field: Optional[str] = None
    units: Optional[str] = None


@dataclass(frozen=True)
class ProcessedArgoProfile:
    """QC-filtered, depth-converted profile derived from a raw profile."""

    raw: RawArgoProfile
    variable: str
    depth_m: np.ndarray
    values: np.ndarray
    pressure_dbar: np.ndarray
    qc_flags: Optional[np.ndarray]
    selection: FieldSelection
    n_levels_before_qc: int
    pressure_field: str = "PRES"
    exclusions: List[LevelExclusion] = field(default_factory=list)
    notes: List[str] = field(default_factory=list)

    @property
    def n_levels_after_qc(self) -> int:
        return int(self.depth_m.size)

    @property
    def n_excluded(self) -> int:
        return len(self.exclusions)

    @property
    def is_empty(self) -> bool:
        return self.n_levels_after_qc == 0

    def exclusion_summary(self) -> dict:
        """Counts keyed by reason, for compact provenance reporting."""
        summary: dict = {}
        for exc in self.exclusions:
            summary[exc.reason] = summary.get(exc.reason, 0) + 1
        return summary
