"""Spatial and temporal co-location (STEP 3B §11, §12, §13).

Both matchers are nearest-neighbour selections, and are labelled as such. No
interpolation is performed or claimed.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import List, Optional, Sequence, Tuple

import numpy as np

from app.core.config import settings

SPATIAL_MATCH_METHOD = "nearest_grid_cell"
TEMPORAL_MATCH_METHOD = "nearest_timestamp"

# WGS-84 ellipsoid parameters for the geodesic distance.
_WGS84_A = 6378137.0
_WGS84_F = 1.0 / 298.257223563
_WGS84_B = _WGS84_A * (1.0 - _WGS84_F)
# Mean Earth radius, used only by the spherical haversine helper.
EARTH_RADIUS_KM = 6371.0088

REJECT_NO_MODEL_TIMES = "no_model_timestamps_available"
REJECT_TEMPORAL_TOLERANCE = "temporal_difference_exceeds_tolerance"
REJECT_NO_GRID = "no_model_grid_coordinates_available"
REJECT_SPATIAL_TOLERANCE = "spatial_distance_exceeds_tolerance"
REJECT_OUTSIDE_DOMAIN = "observation_outside_model_domain"


def _normalise_longitude(lon: float) -> float:
    """Map longitude to [-180, 180) so 0/360 and -180/180 conventions compare correctly."""
    return ((float(lon) + 180.0) % 360.0) - 180.0


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance on a sphere, in kilometres.

    Retained for fast bulk nearest-cell ranking. The reported scientific distance
    uses :func:`geodesic_distance_km`.
    """
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = p2 - p1
    dlam = math.radians(_normalise_longitude(lon2) - _normalise_longitude(lon1))
    a = math.sin(dphi / 2.0) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlam / 2.0) ** 2
    return 2.0 * EARTH_RADIUS_KM * math.asin(min(1.0, math.sqrt(a)))


def geodesic_distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Vincenty inverse geodesic distance on the WGS-84 ellipsoid, in kilometres.

    Falls back to the spherical haversine result if the iteration fails to
    converge (near-antipodal points), which is far outside any co-location use
    case but keeps the function total. A simple degree-difference metric is never
    used as the reported distance (§11).
    """
    lat1_r, lat2_r = math.radians(lat1), math.radians(lat2)
    dlon = math.radians(_normalise_longitude(lon2) - _normalise_longitude(lon1))

    u1 = math.atan((1.0 - _WGS84_F) * math.tan(lat1_r))
    u2 = math.atan((1.0 - _WGS84_F) * math.tan(lat2_r))
    sin_u1, cos_u1 = math.sin(u1), math.cos(u1)
    sin_u2, cos_u2 = math.sin(u2), math.cos(u2)

    lam = dlon
    for _ in range(200):
        sin_lam, cos_lam = math.sin(lam), math.cos(lam)
        sin_sigma = math.sqrt(
            (cos_u2 * sin_lam) ** 2 + (cos_u1 * sin_u2 - sin_u1 * cos_u2 * cos_lam) ** 2
        )
        if sin_sigma == 0.0:
            return 0.0  # coincident points
        cos_sigma = sin_u1 * sin_u2 + cos_u1 * cos_u2 * cos_lam
        sigma = math.atan2(sin_sigma, cos_sigma)
        sin_alpha = cos_u1 * cos_u2 * sin_lam / sin_sigma
        cos_sq_alpha = 1.0 - sin_alpha * sin_alpha
        if cos_sq_alpha == 0.0:
            cos2_sigma_m = 0.0  # equatorial line
        else:
            cos2_sigma_m = cos_sigma - 2.0 * sin_u1 * sin_u2 / cos_sq_alpha
        c = _WGS84_F / 16.0 * cos_sq_alpha * (4.0 + _WGS84_F * (4.0 - 3.0 * cos_sq_alpha))
        lam_prev = lam
        lam = dlon + (1.0 - c) * _WGS84_F * sin_alpha * (
            sigma
            + c
            * sin_sigma
            * (cos2_sigma_m + c * cos_sigma * (-1.0 + 2.0 * cos2_sigma_m**2))
        )
        if abs(lam - lam_prev) < 1e-12:
            break
    else:
        return haversine_km(lat1, lon1, lat2, lon2)

    u_sq = cos_sq_alpha * (_WGS84_A**2 - _WGS84_B**2) / (_WGS84_B**2)
    a_big = 1.0 + u_sq / 16384.0 * (4096.0 + u_sq * (-768.0 + u_sq * (320.0 - 175.0 * u_sq)))
    b_big = u_sq / 1024.0 * (256.0 + u_sq * (-128.0 + u_sq * (74.0 - 47.0 * u_sq)))
    delta_sigma = (
        b_big
        * sin_sigma
        * (
            cos2_sigma_m
            + b_big
            / 4.0
            * (
                cos_sigma * (-1.0 + 2.0 * cos2_sigma_m**2)
                - b_big
                / 6.0
                * cos2_sigma_m
                * (-3.0 + 4.0 * sin_sigma**2)
                * (-3.0 + 4.0 * cos2_sigma_m**2)
            )
        )
    )
    return (_WGS84_B * a_big * (sigma - delta_sigma)) / 1000.0


@dataclass(frozen=True)
class SpatioTemporalMatch:
    """Result of co-locating one observation with the model grid (§13)."""

    observation_time: datetime
    observation_latitude: float
    observation_longitude: float

    model_time: Optional[datetime] = None
    model_time_index: Optional[int] = None
    model_latitude: Optional[float] = None
    model_longitude: Optional[float] = None
    model_lat_index: Optional[int] = None
    model_lon_index: Optional[int] = None

    temporal_difference_hours: Optional[float] = None
    spatial_distance_km: Optional[float] = None

    is_valid: bool = False
    rejection_reason: Optional[str] = None
    rejection_detail: Optional[str] = None

    spatial_match_method: str = SPATIAL_MATCH_METHOD
    temporal_match_method: str = TEMPORAL_MATCH_METHOD
    temporal_tolerance_hours: float = settings.TEMPORAL_TOLERANCE_HOURS
    notes: List[str] = field(default_factory=list)


def _ensure_utc(dt: datetime) -> datetime:
    """Treat naive datetimes as UTC; convert aware datetimes to UTC."""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def match_nearest_time(
    observation_time: datetime,
    model_times: Sequence[datetime],
) -> Tuple[Optional[int], Optional[float]]:
    """Nearest model timestamp index and signed difference in hours.

    The sign convention is ``model_time - observation_time``: positive means the
    model timestamp is later than the observation.
    """
    if model_times is None or len(model_times) == 0:
        return None, None

    obs = _ensure_utc(observation_time)
    best_index = 0
    best_abs = float("inf")
    best_signed = 0.0
    for i, mt in enumerate(model_times):
        signed = (_ensure_utc(mt) - obs).total_seconds() / 3600.0
        if abs(signed) < best_abs:
            best_abs = abs(signed)
            best_index = i
            best_signed = signed
    return best_index, best_signed


def match_nearest_grid_cell(
    latitude: float,
    longitude: float,
    model_latitudes: Sequence[float],
    model_longitudes: Sequence[float],
) -> Tuple[Optional[int], Optional[int], Optional[float], Optional[float], Optional[float]]:
    """Nearest grid cell on a rectilinear model grid.

    Returns ``(lat_index, lon_index, grid_lat, grid_lon, geodesic_distance_km)``.
    Latitude and longitude axes are searched independently (valid for
    rectilinear grids such as GLORYS12V1), then the true geodesic distance to the
    selected cell centre is computed.
    """
    lats = np.asarray(model_latitudes, dtype="float64")
    lons = np.asarray(model_longitudes, dtype="float64")
    if lats.size == 0 or lons.size == 0:
        return None, None, None, None, None

    j = int(np.argmin(np.abs(lats - float(latitude))))

    obs_lon = _normalise_longitude(longitude)
    grid_lons_norm = np.array([_normalise_longitude(v) for v in lons])
    # Circular difference so a match across the dateline is not distorted.
    dlon = np.abs(((grid_lons_norm - obs_lon + 180.0) % 360.0) - 180.0)
    i = int(np.argmin(dlon))

    grid_lat = float(lats[j])
    grid_lon = float(lons[i])
    distance = geodesic_distance_km(float(latitude), float(longitude), grid_lat, grid_lon)
    return j, i, grid_lat, grid_lon, distance


def colocate(
    observation_time: datetime,
    latitude: float,
    longitude: float,
    model_times: Sequence[datetime],
    model_latitudes: Sequence[float],
    model_longitudes: Sequence[float],
    temporal_tolerance_hours: Optional[float] = None,
    spatial_tolerance_km: Optional[float] = None,
) -> SpatioTemporalMatch:
    """Co-locate an observation with the model in space and time.

    A match that violates the temporal tolerance is returned with
    ``is_valid=False`` and a rejection reason; no comparison is fabricated (§12).
    """
    tol_h = (
        settings.TEMPORAL_TOLERANCE_HOURS
        if temporal_tolerance_hours is None
        else float(temporal_tolerance_hours)
    )
    tol_km = settings.SPATIAL_TOLERANCE_KM if spatial_tolerance_km is None else spatial_tolerance_km

    obs_time = _ensure_utc(observation_time)
    base = dict(
        observation_time=obs_time,
        observation_latitude=float(latitude),
        observation_longitude=float(longitude),
        temporal_tolerance_hours=tol_h,
    )

    j, i, grid_lat, grid_lon, distance_km = match_nearest_grid_cell(
        latitude, longitude, model_latitudes, model_longitudes
    )
    if j is None:
        return SpatioTemporalMatch(
            **base,
            is_valid=False,
            rejection_reason=REJECT_NO_GRID,
            rejection_detail="model grid has no latitude/longitude coordinates",
        )

    t_index, dt_hours = match_nearest_time(obs_time, model_times)
    if t_index is None:
        return SpatioTemporalMatch(
            **base,
            model_latitude=grid_lat,
            model_longitude=grid_lon,
            model_lat_index=j,
            model_lon_index=i,
            spatial_distance_km=distance_km,
            is_valid=False,
            rejection_reason=REJECT_NO_MODEL_TIMES,
            rejection_detail="model dataset exposes no timestamps",
        )

    model_time = _ensure_utc(model_times[t_index])
    common = dict(
        model_time=model_time,
        model_time_index=t_index,
        model_latitude=grid_lat,
        model_longitude=grid_lon,
        model_lat_index=j,
        model_lon_index=i,
        temporal_difference_hours=dt_hours,
        spatial_distance_km=distance_km,
    )

    if abs(dt_hours) > tol_h:
        return SpatioTemporalMatch(
            **base,
            **common,
            is_valid=False,
            rejection_reason=REJECT_TEMPORAL_TOLERANCE,
            rejection_detail=(
                f"nearest model timestamp {model_time.isoformat()} differs from "
                f"observation {obs_time.isoformat()} by {dt_hours:+.2f} h, "
                f"exceeding the ±{tol_h:g} h tolerance"
            ),
        )

    if tol_km is not None and distance_km is not None and distance_km > float(tol_km):
        return SpatioTemporalMatch(
            **base,
            **common,
            is_valid=False,
            rejection_reason=REJECT_SPATIAL_TOLERANCE,
            rejection_detail=(
                f"nearest grid cell is {distance_km:.2f} km away, exceeding the "
                f"{float(tol_km):g} km tolerance"
            ),
        )

    return SpatioTemporalMatch(**base, **common, is_valid=True)
