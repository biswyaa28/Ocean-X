"""TEOS-10 pressure to depth conversion (STEP 3B §10).

Reference convention
--------------------
TEOS-10 / Gibbs SeaWater (GSW) defines height ``z`` as positive upwards with
``z = 0`` at the sea surface, therefore ``z`` is *negative* beneath the surface.
Oceanographic depth is positive downwards, so:

    depth = -gsw.z_from_p(p, latitude)

``gsw.z_from_p`` accepts sea pressure in decibars (dbar), i.e. absolute pressure
minus 10.1325 dbar of atmospheric pressure — which is exactly the convention of
the Argo ``PRES`` variable. Latitude is required because the conversion accounts
for the latitudinal variation of gravity, and the result includes the small
correction for the geopotential anomaly.

The returned depth is in metres, positive downwards, with ``depth = 0`` at the
sea surface. NaNs propagate: a missing pressure yields a missing depth and is
never silently coerced to zero (§20).
"""
from __future__ import annotations

from typing import Sequence

import gsw
import numpy as np

# Physical plausibility bounds for Argo sea pressure in dbar. The deepest ocean
# point is ~11 000 m; Argo floats profile to ~2 000 dbar. Small negative sea
# pressures occur legitimately near the surface from sensor noise.
MIN_VALID_PRESSURE_DBAR = -10.0
MAX_VALID_PRESSURE_DBAR = 12000.0

DEPTH_REFERENCE = "meters"
DEPTH_CONVENTION = (
    "TEOS-10 / GSW: depth = -gsw.z_from_p(pressure_dbar, latitude); "
    "metres positive downwards from the sea surface"
)


def depth_from_pressure(
    pressure_dbar: Sequence[float] | np.ndarray | float,
    latitude: float,
) -> np.ndarray:
    """Convert Argo sea pressure (dbar) to depth (m, positive downwards).

    Parameters
    ----------
    pressure_dbar:
        Sea pressure in decibars. Scalars, sequences and arrays are accepted.
        NaN entries are preserved as NaN in the output.
    latitude:
        Latitude of the observation in decimal degrees, from the profile itself.
        Required by TEOS-10 for the gravity correction.

    Returns
    -------
    numpy.ndarray
        Depth in metres, positive downwards, ``float64``. Always an array (a
        scalar input yields a 0-d array) so downstream code has one shape
        contract.

    Raises
    ------
    ValueError
        If latitude is missing, non-finite, or outside [-90, 90]; or if any
        finite pressure lies outside the physically plausible range. Invalid
        input is rejected loudly rather than producing a silently wrong depth.
    """
    if latitude is None:
        raise ValueError("latitude is required for TEOS-10 pressure to depth conversion")

    lat = float(latitude)
    if not np.isfinite(lat):
        raise ValueError("latitude must be finite for TEOS-10 conversion")
    if not (-90.0 <= lat <= 90.0):
        raise ValueError(f"latitude {lat} out of range [-90, 90]")

    p = np.asarray(pressure_dbar, dtype="float64")

    finite = np.isfinite(p)
    if finite.any():
        bad = finite & (
            (p < MIN_VALID_PRESSURE_DBAR) | (p > MAX_VALID_PRESSURE_DBAR)
        )
        if bad.any():
            offenders = np.unique(p[bad])[:5]
            raise ValueError(
                "pressure values outside plausible range "
                f"[{MIN_VALID_PRESSURE_DBAR}, {MAX_VALID_PRESSURE_DBAR}] dbar: "
                f"{offenders.tolist()}"
            )

    # gsw returns negative heights below the surface; negate for depth.
    depth = -gsw.z_from_p(p, lat)
    depth = np.asarray(depth, dtype="float64")

    # Defensive: never emit a non-finite depth where the input was finite.
    corrupted = finite & ~np.isfinite(depth)
    if np.any(corrupted):
        raise ValueError(
            "TEOS-10 conversion produced non-finite depth for finite pressure input"
        )

    return depth


def pressure_from_depth(
    depth_m: Sequence[float] | np.ndarray | float,
    latitude: float,
) -> np.ndarray:
    """Inverse conversion: depth (m, positive down) to sea pressure (dbar).

    Used to synthesise realistic ``PRES`` values for fixture profiles defined on
    nominal depth levels, and to verify round-trip consistency in tests.
    """
    if latitude is None:
        raise ValueError("latitude is required for TEOS-10 depth to pressure conversion")

    lat = float(latitude)
    if not np.isfinite(lat):
        raise ValueError("latitude must be finite for TEOS-10 conversion")
    if not (-90.0 <= lat <= 90.0):
        raise ValueError(f"latitude {lat} out of range [-90, 90]")

    z = -np.asarray(depth_m, dtype="float64")
    return np.asarray(gsw.p_from_z(z, lat), dtype="float64")
