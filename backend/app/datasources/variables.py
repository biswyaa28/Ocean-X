"""NetCDF variable discovery and unit handling (STEP 3B §5, §19).

Variable names differ between model products (GLORYS12V1 uses ``thetao`` and
``so``; other products use ``temperature``/``temp``, ``salinity``/``psal``).
Nothing here guesses: candidates come from configuration, the first present
candidate wins, the resolved name is reported, and an unresolvable required
variable raises.
"""
from __future__ import annotations

from typing import Dict, Iterable, List, Optional, Sequence, Tuple

import numpy as np

from app.core.config import settings
from app.datasources.base import VariableNotFoundError, VariableResolution

UNITS_UNKNOWN = "unknown"


def candidates_for(logical_name: str) -> List[str]:
    """Configured candidate dataset names for a logical variable."""
    try:
        return list(settings.VARIABLE_CANDIDATES[logical_name])
    except KeyError as exc:
        raise VariableNotFoundError(
            f"no candidate names configured for logical variable '{logical_name}'; "
            f"configured: {sorted(settings.VARIABLE_CANDIDATES)}"
        ) from exc


def coordinate_candidates_for(axis: str) -> List[str]:
    """Configured candidate coordinate names for an axis."""
    try:
        return list(settings.COORD_CANDIDATES[axis])
    except KeyError as exc:
        raise VariableNotFoundError(
            f"no candidate names configured for coordinate axis '{axis}'"
        ) from exc


def resolve_name(
    logical_name: str,
    available: Iterable[str],
    candidates: Optional[Sequence[str]] = None,
) -> Tuple[str, List[str]]:
    """Resolve a logical variable to a concrete dataset name.

    Matching is exact first, then case-insensitive. Returns
    ``(actual_name, candidates_tried)``.

    Raises
    ------
    VariableNotFoundError
        With the full candidate list and the dataset's actual variables, so the
        failure is diagnosable rather than a silent wrong mapping.
    """
    tried = list(candidates) if candidates is not None else candidates_for(logical_name)
    available_list = list(available)
    lookup = {str(name).lower(): str(name) for name in available_list}

    for cand in tried:
        if cand in available_list:
            return cand, tried
    for cand in tried:
        hit = lookup.get(cand.lower())
        if hit is not None:
            return hit, tried

    raise VariableNotFoundError(
        f"required variable '{logical_name}' not found. Tried {tried}; "
        f"dataset provides {sorted(str(a) for a in available_list)}"
    )


def canonical_units(raw_units: Optional[str]) -> str:
    """Map a units string onto a canonical token, or ``'unknown'``.

    An unrecognised or absent units attribute yields ``'unknown'``. Celsius is
    never assumed (§19).
    """
    if raw_units is None:
        return UNITS_UNKNOWN
    text = str(raw_units).strip()
    if not text:
        return UNITS_UNKNOWN
    lowered = text.lower()
    for canonical, aliases in settings.UNIT_ALIASES.items():
        if lowered == canonical.lower() or lowered in [a.lower() for a in aliases]:
            return canonical
    return UNITS_UNKNOWN


def normalise_values(
    values: np.ndarray,
    logical_name: str,
    raw_units: Optional[str],
) -> Tuple[np.ndarray, str, Optional[str]]:
    """Normalise values to the expected unit where a conversion is well defined.

    Returns ``(values, final_units, conversion_note)``. Only conversions that are
    unambiguous are applied — currently Kelvin to degrees Celsius. When the source
    unit is unknown the values are passed through untouched, the final unit is
    reported as ``'unknown'``, and a note records that no assumption was made.
    """
    expected = settings.EXPECTED_UNITS.get(logical_name)
    source = canonical_units(raw_units)
    arr = np.asarray(values, dtype="float64")

    if source == UNITS_UNKNOWN:
        return (
            arr,
            UNITS_UNKNOWN,
            (
                f"source units for '{logical_name}' are absent or unrecognised "
                f"(raw attribute: {raw_units!r}); values passed through without "
                "conversion and no unit was assumed"
            ),
        )

    if expected is None or source == expected:
        return arr, source, None

    if source == "K" and expected == "degC":
        return arr - 273.15, "degC", "converted from K to degC by subtracting 273.15"

    return (
        arr,
        source,
        (
            f"source units '{source}' differ from expected '{expected}' for "
            f"'{logical_name}' and no unambiguous conversion is defined; values "
            "passed through unconverted"
        ),
    )


def describe_variable(
    logical_name: str,
    actual_name: str,
    attrs: Optional[Dict[str, object]] = None,
    candidates_tried: Optional[Sequence[str]] = None,
) -> VariableResolution:
    """Build a :class:`VariableResolution` from dataset attributes."""
    attrs = attrs or {}
    raw_units = attrs.get("units")
    return VariableResolution(
        logical_name=logical_name,
        actual_name=actual_name,
        units=canonical_units(raw_units) if raw_units is not None else None,
        long_name=str(attrs["long_name"]) if attrs.get("long_name") is not None else None,
        standard_name=str(attrs["standard_name"]) if attrs.get("standard_name") is not None else None,
        candidates_tried=list(candidates_tried) if candidates_tried else [],
    )
