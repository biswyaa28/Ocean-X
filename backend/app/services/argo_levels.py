"""Argo observation-level normalization for the Argo/HYCOM model matchup.

This module turns a raw Argo profile observation list into *match levels*:
finite depth, finite temperature/salinity and an explicit record of where each
value came from. It owns four scientific decisions.

1. Pressure -> depth (TEOS-10 / GSW)
   --------------------------------
   Argo reports pressure, not geometric depth. The HYCOM model depth
   coordinate IS geometric metres below the sea surface, so comparing the two
   requires a pressure-to-depth conversion. ``gsw.z_from_p`` (TEOS-10 / GSW)
   is used with the float's latitude because the conversion is gravity
   dependent: the depth of a given pressure is larger at the equator than at
   the pole (1000 dbar -> ~992 m at 0 deg, ~990 m at 45 deg N). The
   conversion assumes hydrostatic pressure with a latitude-dependent gravity
   term and ignores dynamic pressure (the difference between in-situ and
   potential density); it is therefore exact to roughly 0.1 % in the upper
   ocean and is the standard convention for putting Argo on a geometric-depth
   axis.

   When the source provides no usable pressure on the selected basis, the
   source-provided ``depth_m`` is kept unchanged and the level records
   ``depth_source == "provided"``. No depth is ever invented.

2. Adjusted vs raw is chosen ONCE PER PROFILE, not per value
   ----------------------------------------------------------
   Argo core files carry in-situ (raw) variables alongside the delayed-mode
   *adjusted* variables. The Argo data mode decides which set is authoritative
   for a profile:

     "R"  real-time    adjusted variables do not exist yet -> RAW only
     "A"  adjusted     adjusted variables are authoritative -> ADJUSTED
     "D"  deferred     delayed-mode adjusted                -> ADJUSTED

   If the mode is unknown/absent the basis is auto-detected: adjusted is used
   only when the adjusted arrays actually carry data.

   Two consequences are deliberate:

   * If the mode is "R", or the adjusted arrays are entirely fill/NaN, the
     WHOLE profile falls back to raw. A profile is never half adjusted.
   * TEMP, PSAL and PRES are always taken from the SAME basis. Reading
     adjusted PRES (delayed-mode pressure, corrected against the surface
     reference) together with raw TEMP would put the two sides of a residual
     on different depth/conductivity conventions, which is exactly the kind of
     quiet inconsistency a validation number must not contain. If the adjusted
     basis is selected but carries no PRES, the level simply has no
     pressure-derived depth and uses the source ``depth_m`` instead.

3. Quality-control flag filtering
   -------------------------------
   Argo QC flags (Argo Quality Control Manual for CTD and Trajectory Data):
   1 = good, 2 = probably good, 3 = probably bad, 4 = bad, 5 = value changed,
   6 = value below limit, 7 = value above limit, 8 = value changed
   (interpolated), 9 = missing value.

   RAW (in-situ) values accept only flags 1 and 2.
   ADJUSTED values additionally accept flag 5 ("value changed"): that flag
   exists precisely to mark an adjusted value that legitimately replaced its
   in-situ counterpart.

   Flag 8 is REJECTED even on adjusted values. Flag 8 marks a value that was
   INTERPOLATED between neighbouring measurements rather than measured at all.
   A model matchup compares a measurement with a model field, so an
   interpolated observation contributes no independent information and would
   silently inflate the apparent matched sample. Excluding it makes the
   matched-pair count a count of real measurements.

   A value failing QC is treated as missing - it is never repaired, averaged
   or substituted. A level can therefore carry temperature but no salinity;
   the pair simply does not enter that variable's statistics.

4. Absent QC flags stay lenient, but are counted
   ----------------------------------------------
   Every real Argo CTD record carries QC flags; a source that omits them is
   not trustworthy, but silently discarding an entire profile would be a
   worse failure than using it. An absent flag is therefore still treated as
   1 ("good") so behaviour stays lenient, and the number of levels that relied
   on that assumption is returned as ``missingQcLevelCount`` so the caller can
   disclose it instead of hiding it.
"""

import math
from typing import Any, Dict, Iterable, List, Optional, Tuple

import gsw
import numpy as np

# --- QC flag policy (documented above) -------------------------------------
ACCEPTED_QC_RAW = frozenset({1, 2})
# Flag 5 only. Flag 8 (value interpolated between measurements) is excluded on
# purpose: a matchup needs measured values.
ACCEPTED_QC_ADJUSTED = frozenset({1, 2, 5})

# QC flag assumed when a source record carries no flag at all. See section 4.
DEFAULT_QC_FLAG = 1

QC_FLAGS_USED = {
    "raw": sorted(ACCEPTED_QC_RAW),
    "adjusted": sorted(ACCEPTED_QC_ADJUSTED),
}

# Argo data modes that make the adjusted variables authoritative.
ADJUSTED_DATA_MODES = frozenset({"A", "D"})
# Argo data mode that forces the raw variables (adjusted not yet delivered).
RAW_DATA_MODES = frozenset({"R"})

# --- Source key aliases -----------------------------------------------------
# The committed processed JSON uses lower_snake_case; a raw GDAC NetCDF uses
# the upper-case CF/Argo names. Both are accepted so the same normalisation
# works whichever ingestion path produced the observations. The raw/adjusted
# split is explicit: a profile reads from ONE column family for all variables.
_RAW_PRESSURE_KEYS = ("pressure_dbar", "PRES", "pressure")
_ADJUSTED_PRESSURE_KEYS = (
    "pressure_dbar_adjusted",
    "pres_adjusted",
    "PRES_ADJUSTED",
    "pressure_adjusted",
)
_RAW_TEMP_KEYS = ("temperature_c", "TEMP")
_ADJUSTED_TEMP_KEYS = ("temperature_c_adjusted", "TEMP_ADJUSTED")
_RAW_SAL_KEYS = ("salinity_psu", "PSAL")
_ADJUSTED_SAL_KEYS = ("salinity_psu_adjusted", "PSAL_ADJUSTED")
_RAW_QC_KEYS = ("temp_qc", "TEMP_QC")
_ADJUSTED_QC_KEYS = (
    "temperature_c_adjusted_qc",
    "temp_adjusted_qc",
    "TEMP_ADJUSTED_QC",
)
_RAW_SAL_QC_KEYS = ("psal_qc", "PSAL_QC")
_ADJUSTED_SAL_QC_KEYS = (
    "salinity_psu_adjusted_qc",
    "psal_adjusted_qc",
    "PSAL_ADJUSTED_QC",
)

# Per-basis column families: one entry per scientific variable.
_BASIS_KEYS: Dict[str, Dict[str, Tuple[str, ...]]] = {
    "raw": {
        "pressure": _RAW_PRESSURE_KEYS,
        "temperature": _RAW_TEMP_KEYS,
        "salinity": _RAW_SAL_KEYS,
        "temperature_qc": _RAW_QC_KEYS,
        "salinity_qc": _RAW_SAL_QC_KEYS,
    },
    "adjusted": {
        "pressure": _ADJUSTED_PRESSURE_KEYS,
        "temperature": _ADJUSTED_TEMP_KEYS,
        "salinity": _ADJUSTED_SAL_KEYS,
        "temperature_qc": _ADJUSTED_QC_KEYS,
        "salinity_qc": _ADJUSTED_SAL_QC_KEYS,
    },
}


def _finite(value: Any) -> Optional[float]:
    """Return value as a finite float, or None. Booleans are rejected."""
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value) if math.isfinite(value) else None
    if isinstance(value, (np.floating, np.integer)):
        return float(value) if math.isfinite(float(value)) else None
    return None


def _first_finite(source: Dict[str, Any], keys: Iterable[str]) -> Optional[float]:
    for key in keys:
        if key in source:
            value = _finite(source[key])
            if value is not None:
                return value
    return None


def _has_any_finite(source: Dict[str, Any], keys: Iterable[str]) -> bool:
    return _first_finite(source, keys) is not None


def _qc_flag(source: Dict[str, Any], keys: Iterable[str]) -> Tuple[int, bool]:
    """Return ``(flag, was_present)`` for one QC field.

    An absent flag resolves to ``DEFAULT_QC_FLAG`` (lenient) with
    ``was_present=False`` so the caller can count the assumption.
    """
    value = _first_finite(source, keys)
    if value is None:
        return DEFAULT_QC_FLAG, False
    return int(value), True


def depth_from_pressure(pressure_dbar: float, latitude_deg: float) -> Optional[float]:
    """Convert pressure (dbar) to geometric depth (m, positive downward).

    ``gsw.z_from_p`` returns HEIGHT (negative upward, so a subsurface pressure
    yields a negative number). The sign is negated here to match the model
    depth convention: 0 at the sea surface, growing downward.

    Sanity check: 1000 dbar gives ~992 m at the equator and ~990 m at 45 N -
    the equator value is deeper, which is the expected signature of the
    latitude-dependent gravity term.
    """
    p = _finite(pressure_dbar)
    lat = _finite(latitude_deg)
    if p is None or lat is None:
        return None
    if p < 0:
        return None
    try:
        # Negated: z_from_p is a height, the matchup works in depth.
        return float(-gsw.z_from_p(p, lat))
    except Exception:
        # GSW can reject extreme/garbage latitude input. A pressure level with
        # an unusable latitude falls back to no depth rather than a wrong one.
        return None


def normalize_data_mode(value: Any) -> str:
    """Normalize an Argo data mode to ``"R"``, ``"A"``, ``"D"`` or ``"auto"``."""
    if value is None:
        return "auto"
    normalized = str(value).strip().upper()
    if normalized in ("R", "A", "D"):
        return normalized
    return "auto"


def resolve_variable_basis(
    observations: Iterable[Any],
    data_mode: Any = None,
) -> str:
    """Decide, once per profile, whether to read raw or adjusted variables.

    Returns ``"adjusted"`` or ``"raw"``.

    - mode "R" -> always ``"raw"``: real-time data has no adjusted variables.
    - mode "A"/"D" -> ``"adjusted"``, but only if the adjusted arrays carry
      data; otherwise ``"raw"``.
    - unknown mode -> ``"adjusted"`` iff any adjusted temperature/salinity
      value is finite (auto-detection for sources that omit the mode).
    """
    mode = normalize_data_mode(data_mode)
    if mode in RAW_DATA_MODES:
        return "raw"

    adjusted_present = False
    for observation in (observations if observations is not None else []):
        if not isinstance(observation, dict):
            continue
        if _has_any_finite(observation, _ADJUSTED_TEMP_KEYS) or _has_any_finite(
            observation, _ADJUSTED_SAL_KEYS
        ):
            adjusted_present = True
            break

    if adjusted_present:
        return "adjusted"
    # Mode asked for adjusted but the arrays are entirely fill/NaN: the whole
    # profile falls back to raw rather than being silently half-adjusted.
    return "raw"


def build_matchup_level(
    observation: Dict[str, Any],
    latitude_deg: float,
    basis: str = "raw",
) -> Optional[Dict[str, Any]]:
    """Normalize one raw Argo observation into a match level.

    ``basis`` is ``"raw"`` or ``"adjusted"`` and must be the SAME value for
    every level of a profile (see :func:`resolve_variable_basis`), so that
    temperature, salinity and pressure are never mixed across conventions.

    Returns None when the observation carries no usable depth - a level
    without depth cannot be matched against a model level at all.
    """
    if not isinstance(observation, dict):
        return None

    keys = _BASIS_KEYS.get(basis, _BASIS_KEYS["raw"])

    pressure = _first_finite(observation, keys["pressure"])
    depth_m: Optional[float] = None
    depth_source: Optional[str] = None

    if pressure is not None:
        converted = depth_from_pressure(pressure, latitude_deg)
        if converted is not None:
            depth_m = converted
            depth_source = "pressure_gsw"

    if depth_m is None:
        provided = _finite(observation.get("depth_m"))
        if provided is not None and provided >= 0:
            depth_m = provided
            depth_source = "provided"

    if depth_m is None:
        return None

    temperature_qc, temperature_qc_present = _qc_flag(observation, keys["temperature_qc"])
    salinity_qc, salinity_qc_present = _qc_flag(observation, keys["salinity_qc"])

    temperature = None
    if temperature_qc in (ACCEPTED_QC_ADJUSTED if basis == "adjusted" else ACCEPTED_QC_RAW):
        temperature = _first_finite(observation, keys["temperature"])

    salinity = None
    if salinity_qc in (ACCEPTED_QC_ADJUSTED if basis == "adjusted" else ACCEPTED_QC_RAW):
        salinity = _first_finite(observation, keys["salinity"])

    return {
        "depth_m": depth_m,
        "depth_source": depth_source,
        "pressure_dbar": pressure,
        "temperature_c": temperature,
        "temperature_source": basis if temperature is not None else None,
        "salinity_psu": salinity,
        "salinity_source": basis if salinity is not None else None,
        "temp_qc": temperature_qc,
        "psal_qc": salinity_qc,
        "qc_present": temperature_qc_present and salinity_qc_present,
    }


def build_matchup_levels(
    observations: Iterable[Any],
    latitude_deg: float,
    data_mode: Any = None,
) -> Dict[str, Any]:
    """Normalize a full Argo observation list into match levels.

    Returns the levels plus the response-level metadata:
    ``depthSource`` (a single ``pressure_gsw`` / ``provided`` when every level
    agrees, or ``mixed``), ``variableBasis`` (the raw/adjusted family actually
    read), ``argoDataMode`` (the requested R/A/D, or ``auto``), the accepted
    ``qcFlagsUsed``, ``missingQcLevelCount`` and ``droppedObservationCount``.
    """
    records = list(observations) if observations is not None else []
    mode = normalize_data_mode(data_mode)
    basis = resolve_variable_basis(records, mode)

    levels: List[Dict[str, Any]] = []
    dropped_no_depth = 0
    missing_qc_levels = 0

    for observation in records:
        level = build_matchup_level(observation, latitude_deg, basis)
        if level is None:
            dropped_no_depth += 1
            continue
        if not level.pop("qc_present", True):
            missing_qc_levels += 1
        levels.append(level)

    sources = {level["depth_source"] for level in levels}
    depth_source = next(iter(sources)) if len(sources) == 1 else ("mixed" if sources else "unavailable")

    return {
        "levels": levels,
        "depthSource": depth_source,
        "variableBasis": basis,
        "argoDataMode": mode,
        "qcFlagsUsed": QC_FLAGS_USED,
        "missingQcLevelCount": missing_qc_levels,
        "droppedObservationCount": dropped_no_depth,
    }