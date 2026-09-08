"""Vertical alignment onto a common comparison depth grid (STEP 3B §14, §15).

Design decisions
----------------
* The default comparison depth grid is the set of **QC-passed observation
  depths** that lie inside the model's valid vertical range. The observation is
  therefore used at its own depths (an identity interpolation) and only the
  model is resampled from its native vertical coordinate. This avoids smearing
  observations across levels that QC removed.
* Extrapolation is refused by default. A target depth outside the source depth
  range yields NaN, never a clamped edge value.
* ``max_gap_m`` refuses interpolation across a source interval wider than the
  given threshold. This is how "do not interpolate across invalid observations"
  is enforced when a QC-rejected level leaves a hole in the profile.
* Missing values are preserved as NaN and are never filled.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Optional, Sequence, Tuple

import numpy as np

from app.core.config import settings

VERTICAL_ALIGNMENT_METHOD = "linear_interpolation"
DEPTH_REFERENCE = "meters"

# Numerical tolerance for depth-range membership, in metres.
#
# Depths reach this stage through the TEOS-10 round trip, which introduces
# float64 round-off of order 1e-13 m at 1000 m. A target that is 2e-13 m beyond
# the deepest model level is *at* that level, not outside the model. Without a
# tolerance such a level would be silently discarded — a numerical artefact
# masquerading as a scientific exclusion.
#
# 1e-6 m (one micrometre) is ~7 orders of magnitude above the round-off being
# absorbed and ~6 orders below the finest realistic model level spacing, so it
# cannot mask a genuine out-of-range depth. Values admitted by the tolerance are
# evaluated at the nearest edge level, an error bounded by the local gradient
# times 1e-6 m.
DEPTH_TOLERANCE_M = 1e-6


def _clean_monotonic(
    depths: Sequence[float], values: Sequence[float]
) -> Tuple[np.ndarray, np.ndarray, List[str]]:
    """Sort by depth, drop non-finite pairs, and average exact duplicate depths.

    ``numpy.interp`` requires a strictly increasing abscissa. Duplicate depths
    (two samples reported at the same level) are averaged, and the fact is
    recorded as a note rather than silently resolved.
    """
    notes: List[str] = []
    d = np.asarray(depths, dtype="float64")
    v = np.asarray(values, dtype="float64")
    if d.size != v.size:
        raise ValueError(f"depth/value length mismatch: {d.size} vs {v.size}")

    finite = np.isfinite(d) & np.isfinite(v)
    n_dropped = int(d.size - finite.sum())
    if n_dropped:
        notes.append(f"{n_dropped} source level(s) dropped as non-finite before interpolation")
    d, v = d[finite], v[finite]

    if d.size == 0:
        return d, v, notes

    order = np.argsort(d, kind="stable")
    d, v = d[order], v[order]

    unique_d, inverse, counts = np.unique(d, return_inverse=True, return_counts=True)
    if unique_d.size != d.size:
        summed = np.zeros(unique_d.size, dtype="float64")
        np.add.at(summed, inverse, v)
        v = summed / counts
        d = unique_d
        notes.append(
            f"{int((counts > 1).sum())} duplicate source depth(s) averaged to a single level"
        )
    return d, v, notes


def interpolate_to_depths(
    source_depths: Sequence[float],
    source_values: Sequence[float],
    target_depths: Sequence[float],
    allow_extrapolation: Optional[bool] = None,
    max_gap_m: Optional[float] = None,
) -> Tuple[np.ndarray, List[str]]:
    """Linearly interpolate ``source_values`` onto ``target_depths``.

    Returns ``(values, notes)``. Targets that cannot be resolved are NaN:

    * outside the source depth range (unless ``allow_extrapolation``),
    * inside a source gap wider than ``max_gap_m``,
    * when fewer than two usable source levels exist.
    """
    allow_extrap = (
        settings.ALLOW_VERTICAL_EXTRAPOLATION if allow_extrapolation is None else bool(allow_extrapolation)
    )
    d, v, notes = _clean_monotonic(source_depths, source_values)
    t = np.asarray(target_depths, dtype="float64")
    out = np.full(t.shape, np.nan, dtype="float64")

    if d.size == 0:
        notes.append("no usable source levels; all targets unresolved")
        return out, notes
    if d.size == 1:
        # A single level supports no linear interpolation. Only an exact depth
        # hit is resolvable; nothing is extrapolated from one point.
        exact = np.isclose(t, d[0], rtol=0.0, atol=1e-9)
        out[exact] = v[0]
        notes.append("single source level: only exact depth matches resolved")
        return out, notes

    finite_t = np.isfinite(t)
    interp = np.interp(t, d, v)

    if allow_extrap:
        # np.interp already clamps to edge values; make the behaviour explicit.
        out = np.where(finite_t, interp, np.nan)
        notes.append("extrapolation explicitly enabled: out-of-range targets clamped to edge values")
    else:
        # DEPTH_TOLERANCE_M absorbs TEOS-10 float64 round-off at the range edges.
        in_range = (
            finite_t
            & (t >= d[0] - DEPTH_TOLERANCE_M)
            & (t <= d[-1] + DEPTH_TOLERANCE_M)
        )
        out = np.where(in_range, interp, np.nan)
        n_out = int(finite_t.sum() - in_range.sum())
        if n_out:
            notes.append(
                f"{n_out} target depth(s) outside source range "
                f"[{d[0]:.4f}, {d[-1]:.4f}] m left unresolved (no extrapolation)"
            )

    if max_gap_m is not None:
        gaps = np.diff(d)
        idx = np.clip(np.searchsorted(d, t, side="right") - 1, 0, d.size - 2)
        spans = gaps[idx]
        # Exact hits on a source level are always fine regardless of gap width.
        exact_hit = np.isin(t, d)
        too_wide = np.isfinite(out) & ~exact_hit & (spans > float(max_gap_m))
        if too_wide.any():
            out = np.where(too_wide, np.nan, out)
            notes.append(
                f"{int(too_wide.sum())} target depth(s) fell inside a source gap wider "
                f"than {float(max_gap_m):g} m and were not interpolated"
            )

    return out, notes


def build_comparison_depths(
    observation_depths: Sequence[float],
    model_depths: Sequence[float],
    explicit_depths: Optional[Sequence[float]] = None,
    allow_extrapolation: Optional[bool] = None,
    observation_values: Optional[Sequence[float]] = None,
) -> Tuple[np.ndarray, List[str]]:
    """Construct the explicit, traceable common comparison depth grid.

    Defaults to the observation depths restricted to the overlap of the
    observation and model vertical ranges. ``explicit_depths`` overrides this
    with a caller-supplied grid, still restricted to the valid overlap unless
    extrapolation is enabled.

    When ``observation_values`` is supplied, depths whose observation value is
    missing are dropped from the default grid. Keeping them would let the
    interpolator synthesise an observation across the hole from its neighbours
    and pair that invention against the model — interpolating across invalid
    observation data, which §14/§20 forbid.
    """
    allow_extrap = (
        settings.ALLOW_VERTICAL_EXTRAPOLATION if allow_extrapolation is None else bool(allow_extrapolation)
    )
    notes: List[str] = []

    obs_d = np.asarray(observation_depths, dtype="float64")
    obs_valid = np.isfinite(obs_d)
    if observation_values is not None:
        obs_v = np.asarray(observation_values, dtype="float64")
        if obs_v.size != obs_d.size:
            raise ValueError(
                f"observation depth/value length mismatch: {obs_d.size} vs {obs_v.size}"
            )
        n_missing = int(np.sum(obs_valid & ~np.isfinite(obs_v)))
        if n_missing:
            notes.append(
                f"{n_missing} observation depth(s) excluded from the comparison grid "
                "because the observation value is missing there (no interpolation "
                "across invalid observations)"
            )
        obs_valid = obs_valid & np.isfinite(obs_v)
    obs_d = obs_d[obs_valid]
    mod_d = np.asarray(model_depths, dtype="float64")
    mod_d = mod_d[np.isfinite(mod_d)]

    candidate = (
        np.unique(np.asarray(explicit_depths, dtype="float64"))
        if explicit_depths is not None
        else np.unique(obs_d)
    )
    if explicit_depths is not None:
        notes.append("comparison depths supplied explicitly by caller")
    else:
        notes.append("comparison depths taken from QC-passed observation depths")

    if candidate.size == 0 or mod_d.size == 0 or obs_d.size == 0:
        notes.append("no overlapping depth range: observation or model vertical axis is empty")
        return np.asarray([], dtype="float64"), notes

    if allow_extrap:
        notes.append("depth range restriction skipped: extrapolation explicitly enabled")
        return candidate, notes

    lo = max(float(obs_d.min()), float(mod_d.min()))
    hi = min(float(obs_d.max()), float(mod_d.max()))
    if lo > hi:
        notes.append(
            f"observation depth range [{obs_d.min():.2f}, {obs_d.max():.2f}] m does not "
            f"overlap model range [{mod_d.min():.2f}, {mod_d.max():.2f}] m"
        )
        return np.asarray([], dtype="float64"), notes

    inside = (candidate >= lo - DEPTH_TOLERANCE_M) & (candidate <= hi + DEPTH_TOLERANCE_M)
    n_drop = int(candidate.size - inside.sum())
    if n_drop:
        notes.append(
            f"{n_drop} candidate depth(s) outside the observation/model overlap "
            f"[{lo:.4f}, {hi:.4f}] m excluded (no extrapolation)"
        )
    return candidate[inside], notes


@dataclass(frozen=True)
class AlignedProfiles:
    """Model and observation values on the common comparison depth grid."""

    depths_m: np.ndarray
    model_values: np.ndarray
    observation_values: np.ndarray
    method: str = VERTICAL_ALIGNMENT_METHOD
    depth_reference: str = DEPTH_REFERENCE
    n_candidate_depths: int = 0
    notes: List[str] = field(default_factory=list)

    @property
    def n_depths(self) -> int:
        return int(self.depths_m.size)


def align_profiles(
    observation_depths: Sequence[float],
    observation_values: Sequence[float],
    model_depths: Sequence[float],
    model_values: Sequence[float],
    explicit_depths: Optional[Sequence[float]] = None,
    allow_extrapolation: Optional[bool] = None,
    max_observation_gap_m: Optional[float] = None,
) -> AlignedProfiles:
    """Align both profiles onto a common comparison depth grid (§14).

    Only depths where *both* sides resolve to a finite value are returned, so the
    residual stage never sees a half-populated pair.
    """
    targets, notes = build_comparison_depths(
        observation_depths,
        model_depths,
        explicit_depths,
        allow_extrapolation,
        observation_values=observation_values,
    )
    n_candidate = int(targets.size)

    if n_candidate == 0:
        return AlignedProfiles(
            depths_m=np.asarray([], dtype="float64"),
            model_values=np.asarray([], dtype="float64"),
            observation_values=np.asarray([], dtype="float64"),
            n_candidate_depths=0,
            notes=notes,
        )

    obs_on_grid, obs_notes = interpolate_to_depths(
        observation_depths,
        observation_values,
        targets,
        allow_extrapolation=allow_extrapolation,
        max_gap_m=max_observation_gap_m,
    )
    mod_on_grid, mod_notes = interpolate_to_depths(
        model_depths,
        model_values,
        targets,
        allow_extrapolation=allow_extrapolation,
    )
    notes.extend(f"observation: {n}" for n in obs_notes)
    notes.extend(f"model: {n}" for n in mod_notes)

    both = np.isfinite(obs_on_grid) & np.isfinite(mod_on_grid)
    n_unpaired = int(targets.size - both.sum())
    if n_unpaired:
        notes.append(
            f"{n_unpaired} comparison depth(s) discarded: value unavailable on one side "
            "(missing data is never paired against a value)"
        )

    return AlignedProfiles(
        depths_m=targets[both].copy(),
        model_values=mod_on_grid[both].copy(),
        observation_values=obs_on_grid[both].copy(),
        n_candidate_depths=n_candidate,
        notes=notes,
    )
