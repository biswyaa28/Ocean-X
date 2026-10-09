"""Numeric interpolation helpers for the Argo/HYCOM matchup.

These functions are pure array math with no NetCDF, no I/O and no settings
lookups, so they can be unit-tested against hand-computed linear fields.

Three interpolations are implemented:

* vertical - the model profile at one location/time is interpolated onto the
  float's depth levels;
* horizontal - the four surrounding grid cells are combined bilinearly;
* temporal - two bracketing model time slices are combined linearly.

All three share the same two safety rules:

* NEVER EXTRAPOLATE. A target outside the sampled range returns None rather
  than an extrapolated guess. For vertical matching this also means a float
  level deeper than the deepest *valid* model level is never matched - which
  is exactly the "do not go below the seafloor" requirement, because model
  levels below the seabed are masked (non-finite).
* NEVER BRIDGE A DATA GAP. Missing (non-finite) samples split the model
  profile into contiguous segments; interpolation is only ever performed
  between two samples inside the SAME segment, so a masked level is never
  jumped over.
"""

from datetime import datetime, timezone
from typing import Any, List, Optional, Sequence, Tuple

import numpy as np

# A float level within this distance of a native model level is reported as
# "native" (the model value is used unchanged). 1 m is far below the ~5 m
# native HYCOM vertical spacing yet comfortably above float depth resolution.
NATIVE_DEPTH_MATCH_TOLERANCE_M = 1.0


def _finite(value) -> Optional[float]:
    try:
        if value is None or isinstance(value, bool):
            return None
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if np.isfinite(result) else None


def interpolate_float_at_depth(
    depths: Sequence[float],
    values: Sequence[float],
    target_depth_m: float,
    max_gap_m: float,
    native_tolerance_m: float = NATIVE_DEPTH_MATCH_TOLERANCE_M,
) -> Tuple[Optional[float], Optional[str], Optional[Tuple[float, float]], Optional[str]]:
    """Interpolate a FLOAT profile onto a target (model) depth.

    Returns ``(value, method, bracket, rejection)`` where ``bracket`` is the
    ``(upper, lower)`` pair of float depths used and ``rejection`` is a short
    machine-readable reason when no value is produced:

    * ``"float_native"``    - a float level lies within ``native_tolerance_m``.
    * ``"float_interpolated"`` - a linear blend of the two bracketing float
      levels, accepted only when their separation is <= ``max_gap_m``.
    * ``None`` with rejection ``"outside_float_range"`` - the target is above
      the shallowest or below the deepest available float level. The float is
      NEVER extrapolated.
    * ``None`` with rejection ``"float_sampling_too_coarse"`` - the bracket
      exists but is wider than ``max_gap_m``.

    ``max_gap_m`` is the caller-supplied sampling-gap limit for this target
    depth (see ``config.FLOAT_BRACKET_MAX_GAP_M``).
    """
    target = _finite(target_depth_m)
    if target is None:
        return None, None, None, "invalid_target_depth"

    usable = [
        (d, v)
        for d, v in (
            (_finite(depth), _finite(value)) for depth, value in zip(depths, values)
        )
        if d is not None and v is not None
    ]
    if not usable:
        return None, None, None, "no_valid_float_levels"
    if len(usable) == 1:
        only_depth = usable[0][0]
        if abs(only_depth - target) <= native_tolerance_m:
            return usable[0][1], "float_native", (only_depth, only_depth), None
        return None, None, None, "outside_float_range"

    usable_depths = [item[0] for item in usable]
    usable_values = [item[1] for item in usable]

    # Never extrapolate past the float's own sampled range.
    if target < usable_depths[0] or target > usable_depths[-1]:
        return None, None, None, "outside_float_range"

    # Exact (or near-exact) hit on a real float level.
    for depth, value in usable:
        if abs(depth - target) <= native_tolerance_m:
            return value, "float_native", (depth, depth), None

    upper_index = int(np.searchsorted(usable_depths, target, side="left"))
    if upper_index == 0:
        upper_index = 1
    upper_depth = usable_depths[upper_index]
    lower_depth = usable_depths[upper_index - 1]
    if upper_depth == lower_depth:
        return usable_values[upper_index - 1], "float_native", (lower_depth, lower_depth), None

    gap = upper_depth - lower_depth
    if gap > max_gap_m:
        # The float did not sample this depth closely enough for a linear
        # estimate to mean anything. Reported rather than interpolated.
        return None, None, (lower_depth, upper_depth), "float_sampling_too_coarse"

    fraction = (target - lower_depth) / gap
    value = usable_values[upper_index - 1] + fraction * (
        usable_values[upper_index] - usable_values[upper_index - 1]
    )
    return float(value), "float_interpolated", (lower_depth, upper_depth), None


def float_bracket_max_gap_m(
    target_depth_m: float,
    shallow_limit_m: float,
    deep_limit_m: float,
    deep_breakpoint_m: float,
) -> float:
    """Sampling-gap limit for a target depth: tighter in the upper ocean."""
    depth = _finite(target_depth_m)
    if depth is None:
        return shallow_limit_m
    return shallow_limit_m if depth <= deep_breakpoint_m else deep_limit_m


def contiguous_valid_segments(
    depths: Sequence[float],
    values: Sequence[float],
) -> List[Tuple[List[float], List[float]]]:
    """Split a model profile into maximal runs of finite (depth, value) pairs."""
    segments: List[Tuple[List[float], List[float]]] = []
    current_depths: List[float] = []
    current_values: List[float] = []

    for depth, value in zip(depths, values):
        d = _finite(depth)
        v = _finite(value)
        if d is None or v is None:
            if current_depths:
                segments.append((current_depths, current_values))
                current_depths, current_values = [], []
            continue
        current_depths.append(d)
        current_values.append(v)

    if current_depths:
        segments.append((current_depths, current_values))
    return segments


def interpolate_model_profile(
    depths: Sequence[float],
    values: Sequence[float],
    target_depth_m: float,
    native_tolerance_m: float = NATIVE_DEPTH_MATCH_TOLERANCE_M,
) -> Tuple[Optional[float], Optional[str]]:
    """Interpolate one model variable onto ``target_depth_m``.

    Returns ``(value, method)`` where method is ``"native"`` when a native
    model level lies within ``native_tolerance_m`` of the target and
    ``"interpolated"`` when the value came from a linear blend of two native
    levels. Returns ``(None, None)`` when the target is outside the model's
    valid range or would require bridging a data gap.

    Assumes ``depths`` is monotonically increasing, which the HYCOM DEPTH
    coordinate is by construction.
    """
    target = _finite(target_depth_m)
    if target is None:
        return None, None

    for segment_depths, segment_values in contiguous_valid_segments(depths, values):
        # Outside this segment's range -> no extrapolation, try the next one.
        if target < segment_depths[0] - native_tolerance_m:
            continue
        if target > segment_depths[-1] + native_tolerance_m:
            continue

        for depth, value in zip(segment_depths, segment_values):
            if abs(depth - target) <= native_tolerance_m:
                return value, "native"

        # Linear blend between the two bracketing native levels. Because the
        # segment has no gap inside it, these two are adjacent in the native
        # depth axis, so this is interpolation and not gap bridging.
        upper_index = int(np.searchsorted(segment_depths, target))
        if upper_index == 0:
            upper_index = 1
        lower_depth = segment_depths[upper_index - 1]
        upper_depth = segment_depths[upper_index]

        if upper_depth == lower_depth:
            return segment_values[upper_index], "native"

        fraction = (target - lower_depth) / (upper_depth - lower_depth)
        value = segment_values[upper_index - 1] + fraction * (
            segment_values[upper_index] - segment_values[upper_index - 1]
        )
        return float(value), "interpolated"

    return None, None


def bilinear_stencil(
    lats: Sequence[float],
    lons: Sequence[float],
    lat: float,
    lon: float,
) -> Optional[List[Tuple[int, int, float]]]:
    """Build the surrounding-cell stencil with bilinear weights.

    Returns a list of ``(lat_index, lon_index, weight)`` whose weights sum to
    1.0, or None when ``(lat, lon)`` lies outside the grid entirely.

    Weights are the fractional position of the target inside the grid cell,
    i.e. the normalised distance to each corner along each axis. On a regular
    latitude/longitude grid this is the standard bilinear product weight, and
    for equally spaced axes it is exactly the distance-based weight.

    When the target sits exactly on a grid node the four corners collapse; the
    duplicated cell is emitted once with weight 1.0, which is the correct
    degenerate limit of bilinear interpolation.
    """
    lat_index = _bracket_index(lats, lat)
    lon_index = _bracket_index(lons, lon)
    if lat_index is None or lon_index is None:
        return None

    i0, i1, lat_fraction = lat_index
    j0, j1, lon_fraction = lon_index

    if i0 == i1 and j0 == j1:
        return [(i0, j0, 1.0)]
    if i0 == i1:
        return [(i0, j0, 1.0 - lon_fraction), (i0, j1, lon_fraction)]
    if j0 == j1:
        return [(i0, j0, 1.0 - lat_fraction), (i1, j0, lat_fraction)]

    return [
        (i0, j0, (1.0 - lat_fraction) * (1.0 - lon_fraction)),
        (i0, j1, (1.0 - lat_fraction) * lon_fraction),
        (i1, j0, lat_fraction * (1.0 - lon_fraction)),
        (i1, j1, lat_fraction * lon_fraction),
    ]


def _bracket_index(
    axis: Sequence[float],
    target: float,
) -> Optional[Tuple[int, int, float]]:
    """Return (lower_index, upper_index, fraction) of ``target`` on ``axis``."""
    value = _finite(target)
    if value is None or len(axis) == 0:
        return None

    values = [_finite(item) for item in axis]
    if any(item is None for item in values):
        return None
    values = [item for item in values if item is not None]

    if value < values[0] or value > values[-1]:
        return None
    if len(values) == 1:
        return 0, 0, 0.0

    index = int(np.searchsorted(values, value, side="left"))
    if index >= len(values):
        return len(values) - 1, len(values) - 1, 0.0
    if values[index] == value:
        # Exactly on a grid node: both corners collapse onto it.
        return index, index, 0.0

    lower = index - 1
    upper = index
    span = values[upper] - values[lower]
    if span == 0:
        return lower, lower, 0.0
    return lower, upper, (value - values[lower]) / span


def nearest_cell_index(
    axis: Sequence[float],
    target: float,
) -> Optional[int]:
    """Index of the grid cell whose centre is closest to ``target``."""
    value = _finite(target)
    if value is None or len(axis) == 0:
        return None
    values = [_finite(item) for item in axis]
    if any(item is None for item in values):
        return None
    array = np.array([item for item in values if item is not None], dtype=float)
    return int(np.abs(array - value).argmin())


def weighted_cells(
    fields: Sequence[np.ndarray],
    stencil: Sequence[Tuple[int, int, float]],
    min_valid_cells: int = 2,
) -> Optional[np.ndarray]:
    """Blend stencil cells into one profile, renormalizing over valid cells.

    ``fields`` holds one array per stencil entry. Cells that are entirely
    non-finite are land / masked seabed / missing data: their weight is dropped
    and the remaining weights are renormalized to sum to 1, so a partially
    masked cell does not bias the result toward zero.

    Returns None when fewer than ``min_valid_cells`` stencil entries carry
    data. A stencil that legitimately has only one entry (the target sits
    exactly on a grid node) is accepted as-is, because dropping it would
    discard a perfectly good nearest-equivalent sample.
    """
    if not stencil:
        return None

    arrays = [np.asarray(field, dtype=float) for field in fields]
    shape = arrays[0].shape
    numerator = np.zeros(shape, dtype=float)
    weight = np.zeros(shape, dtype=float)
    valid_count = np.zeros(shape, dtype=np.int64)

    for array in arrays:
        valid = np.isfinite(array)
        numerator = numerator + np.where(valid, array, 0.0)
        weight = weight + valid
        valid_count = valid_count + valid.astype(np.int64)

    if len(stencil) >= min_valid_cells:
        usable = valid_count >= min_valid_cells
        if not np.any(usable):
            return None
        blended = np.where(weight > 0, numerator / np.where(weight > 0, weight, 1.0), np.nan)
        return np.where(usable, blended, np.nan)

    # Single-entry stencil: accept only where that cell is finite.
    valid = valid_count > 0
    if not np.any(valid):
        return None
    return np.where(valid, np.where(weight > 0, numerator / np.where(weight > 0, weight, 1.0), np.nan), np.nan)


def weighted_time_slices(
    fields: Sequence[np.ndarray],
    weights: Sequence[float],
) -> Optional[np.ndarray]:
    """Linearly blend bracketing model time slices.

    A model field between two time slices is assumed to vary linearly over the
    (typically 6- or 24-hour) step, which is the standard assumption for
    temporal interpolation of ocean model output and is far less defensible to
    break than the 5-100 m horizontal cell spacing. The time analogue of the
    land-cell rule applies too: when two slices are supplied, a level is only
    blended if BOTH slices carry data, so a masked slice is never blended away.
    With a single slice the nearest-time value is used as-is.
    """
    if not fields or not weights:
        return None

    arrays = [np.asarray(field, dtype=float) for field in fields]
    shape = arrays[0].shape
    numerator = np.zeros(shape, dtype=float)
    weight = np.zeros(shape, dtype=float)
    valid_count = np.zeros(shape, dtype=np.int64)

    for array, w in zip(arrays, weights):
        valid = np.isfinite(array)
        numerator = numerator + w * np.where(valid, array, 0.0)
        weight = weight + w * valid
        valid_count = valid_count + valid.astype(np.int64)

    required = 2 if len(arrays) >= 2 else 1
    usable = valid_count >= required
    if not np.any(usable):
        return None
    blended = np.where(weight > 0, numerator / np.where(weight > 0, weight, 1.0), np.nan)
    return np.where(usable, blended, np.nan)


def time_bracket_weights(
    times: Sequence[Any],
    target_time: Any,
) -> Optional[List[Tuple[int, float]]]:
    """Indices and weights of the model time slices bracketing ``target_time``.

    Returns a two-entry list when ``target_time`` lies strictly between two
    slices (linear interpolation), otherwise a single nearest slice with
    weight 1.0. Returns None when no slice is usable.
    """
    if times is None:
        return None

    parsed: List[Tuple[float, int]] = []
    for index, value in enumerate(times):
        seconds = time_seconds(value)
        if seconds is not None:
            parsed.append((seconds, index))
    if not parsed:
        return None

    target_seconds = time_seconds(target_time)
    if target_seconds is None:
        # Unparsable observation time: fall back to the nearest slice.
        return [(parsed[0][1], 1.0)]

    ordered = sorted(parsed, key=lambda item: item[0])
    seconds = [item[0] for item in ordered]
    indices = [item[1] for item in ordered]

    position = int(np.searchsorted(seconds, target_seconds, side="left"))
    if position == 0:
        return [(indices[0], 1.0)]
    if position >= len(seconds):
        return [(indices[-1], 1.0)]

    before, after = seconds[position - 1], seconds[position]
    if before == target_seconds:
        return [(indices[position - 1], 1.0)]
    if after == target_seconds:
        return [(indices[position], 1.0)]

    span = after - before
    upper_weight = (target_seconds - before) / span if span else 0.0
    return [(indices[position - 1], 1.0 - upper_weight), (indices[position], upper_weight)]


def time_seconds(value: Any) -> Optional[float]:
    """Seconds since epoch for a datetime / numpy datetime / ISO string.

    Timezone-naive input is read as UTC: the NetCDF TIME axis and the Argo
    profile timestamp are both UTC, and mixing local-time interpretation into
    the comparison would silently shift the time bracket.
    """
    if value is None:
        return None
    if isinstance(value, datetime):
        moment = value if value.tzinfo is None else value.astimezone(timezone.utc).replace(tzinfo=None)
        return (moment - datetime(1970, 1, 1)).total_seconds()
    if isinstance(value, np.datetime64):
        if np.isnat(value):
            return None
        return float(value.astype("datetime64[s]").astype("int64"))
    if isinstance(value, str):
        try:
            parsed = np.datetime64(value)
        except Exception:
            return None
        if np.isnat(parsed):
            return None
        return float(parsed.astype("datetime64[s]").astype("int64"))
    return None


def nearest_time_index(times: Sequence[Any], target_time: Any) -> Optional[int]:
    """Index of the model time slice closest to ``target_time``."""
    target_seconds = time_seconds(target_time)
    best_index: Optional[int] = None
    best_distance = float("inf")
    for index, value in enumerate(times if times is not None else []):
        seconds = time_seconds(value)
        if seconds is None:
            continue
        if target_seconds is None:
            return index
        distance = abs(seconds - target_seconds)
        if distance < best_distance:
            best_distance = distance
            best_index = index
    return best_index