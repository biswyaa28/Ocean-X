"""Tests E, F, G, H: spatial matching, geodesic distance, temporal matching and
the ±12 h tolerance (STEP 3B §11, §12, §13; §24.E–H)."""
import math

import numpy as np
import pytest

from app.core.config import settings
from app.science.colocation import (
    REJECT_NO_GRID,
    REJECT_NO_MODEL_TIMES,
    REJECT_SPATIAL_TOLERANCE,
    REJECT_TEMPORAL_TOLERANCE,
    SPATIAL_MATCH_METHOD,
    TEMPORAL_MATCH_METHOD,
    colocate,
    geodesic_distance_km,
    haversine_km,
    match_nearest_grid_cell,
    match_nearest_time,
)
from tests.conftest import utc

LATS = [0.0, 5.0, 10.0, 15.0]
LONS = [60.0, 65.0, 70.0, 75.0]
TIMES = [utc(2023, 7, d) for d in range(1, 8)]


# ================================================ F. geodesic distance


def test_geodesic_distance_is_zero_for_coincident_points():
    assert geodesic_distance_km(10.0, 70.0, 10.0, 70.0) == pytest.approx(0.0, abs=1e-9)


def test_one_degree_of_latitude_is_about_111km():
    d = geodesic_distance_km(0.0, 70.0, 1.0, 70.0)
    assert d == pytest.approx(110.57, abs=0.5)


def test_longitude_degree_shrinks_with_latitude():
    """A degree-difference metric cannot reproduce this; a real one must."""
    at_equator = geodesic_distance_km(0.0, 70.0, 0.0, 71.0)
    at_60 = geodesic_distance_km(60.0, 70.0, 60.0, 71.0)
    assert at_equator == pytest.approx(111.32, abs=0.5)
    assert at_60 == pytest.approx(at_equator * math.cos(math.radians(60.0)), rel=0.02)


def test_degree_difference_would_be_wrong_and_is_not_used():
    """Equal degree offsets in lat and lon give unequal distances away from the equator."""
    lat_step = geodesic_distance_km(45.0, 70.0, 46.0, 70.0)
    lon_step = geodesic_distance_km(45.0, 70.0, 45.0, 71.0)
    assert abs(lat_step - lon_step) > 20.0


def test_geodesic_is_ellipsoidal_and_differs_from_spherical():
    """WGS-84 and a sphere disagree by ~0.1-0.5 %, which confirms the ellipsoid is used."""
    a = geodesic_distance_km(10.0, 70.0, 40.0, 90.0)
    b = haversine_km(10.0, 70.0, 40.0, 90.0)
    assert a != b
    assert abs(a - b) / a < 0.01


def test_distance_is_symmetric():
    a = geodesic_distance_km(8.45, 68.2, 15.3, 89.15)
    b = geodesic_distance_km(15.3, 89.15, 8.45, 68.2)
    assert a == pytest.approx(b, rel=1e-9)


def test_distance_across_the_dateline_is_short_not_wrapped():
    d = geodesic_distance_km(0.0, 179.5, 0.0, -179.5)
    assert d == pytest.approx(111.32, abs=1.0)


# ================================================ E. nearest spatial match


def test_nearest_grid_cell_selects_the_closest_centre():
    j, i, glat, glon, dist = match_nearest_grid_cell(9.4, 69.2, LATS, LONS)
    assert (j, i) == (2, 2)
    assert (glat, glon) == (10.0, 70.0)
    assert dist > 0.0


def test_exact_grid_point_gives_zero_distance():
    j, i, glat, glon, dist = match_nearest_grid_cell(10.0, 70.0, LATS, LONS)
    assert (glat, glon) == (10.0, 70.0)
    assert dist == pytest.approx(0.0, abs=1e-9)


def test_midpoint_resolves_deterministically_to_the_lower_index():
    j, i, _, _, _ = match_nearest_grid_cell(2.5, 62.5, LATS, LONS)
    assert (j, i) == (0, 0)


def test_reported_indices_and_coordinates_are_consistent():
    j, i, glat, glon, _ = match_nearest_grid_cell(4.9, 74.4, LATS, LONS)
    assert LATS[j] == glat and LONS[i] == glon


def test_returned_distance_is_the_geodesic_to_the_selected_cell():
    j, i, glat, glon, dist = match_nearest_grid_cell(9.4, 69.2, LATS, LONS)
    assert dist == pytest.approx(geodesic_distance_km(9.4, 69.2, glat, glon), rel=1e-12)


def test_longitude_conventions_0_360_and_minus180_180_both_match():
    j1, i1, *_ = match_nearest_grid_cell(0.0, 359.6, [0.0], [-0.5, 0.0, 0.5])
    j2, i2, *_ = match_nearest_grid_cell(0.0, -0.4, [0.0], [-0.5, 0.0, 0.5])
    assert i1 == i2


def test_empty_grid_returns_no_match():
    assert match_nearest_grid_cell(0.0, 0.0, [], [])[0] is None


def test_spatial_method_is_labelled_nearest_grid_cell_not_interpolation():
    m = colocate(utc(2023, 7, 2, 12), 9.4, 69.2, TIMES, LATS, LONS)
    assert m.spatial_match_method == SPATIAL_MATCH_METHOD == "nearest_grid_cell"
    assert "interpol" not in m.spatial_match_method


# ================================================ G. nearest temporal match


def test_nearest_timestamp_is_selected():
    idx, dt = match_nearest_time(utc(2023, 7, 2, 14, 30), TIMES)
    assert idx == 2  # 2023-07-03T00:00 is 9.5 h away; 07-02T00:00 is 14.5 h
    assert dt == pytest.approx(9.5)


def test_temporal_difference_sign_is_model_minus_observation():
    _, later = match_nearest_time(utc(2023, 7, 2, 20), TIMES)
    _, earlier = match_nearest_time(utc(2023, 7, 2, 4), TIMES)
    assert later > 0  # model timestamp is after the observation
    assert earlier < 0


def test_exact_timestamp_match_gives_zero_difference():
    idx, dt = match_nearest_time(utc(2023, 7, 4), TIMES)
    assert idx == 3 and dt == pytest.approx(0.0)


def test_naive_observation_time_is_interpreted_as_utc():
    from datetime import datetime

    idx, dt = match_nearest_time(datetime(2023, 7, 4, 0, 0), TIMES)
    assert idx == 3 and dt == pytest.approx(0.0)


def test_no_model_timestamps_is_rejected_not_defaulted():
    idx, dt = match_nearest_time(utc(2023, 7, 2), [])
    assert idx is None and dt is None
    m = colocate(utc(2023, 7, 2), 10.0, 70.0, [], LATS, LONS)
    assert m.is_valid is False
    assert m.rejection_reason == REJECT_NO_MODEL_TIMES


def test_temporal_method_is_labelled_nearest_timestamp():
    m = colocate(utc(2023, 7, 2, 12), 10.0, 70.0, TIMES, LATS, LONS)
    assert m.temporal_match_method == TEMPORAL_MATCH_METHOD == "nearest_timestamp"


# ================================================ H. ±12 h tolerance


def test_default_tolerance_is_the_project_value_of_12_hours():
    assert settings.TEMPORAL_TOLERANCE_HOURS == 12.0
    m = colocate(utc(2023, 7, 2, 12), 10.0, 70.0, TIMES, LATS, LONS)
    assert m.temporal_tolerance_hours == 12.0


def test_observation_inside_tolerance_is_valid():
    m = colocate(utc(2023, 7, 2, 14, 30), 10.0, 70.0, TIMES, LATS, LONS)
    assert m.is_valid is True
    assert abs(m.temporal_difference_hours) <= 12.0
    assert m.rejection_reason is None


def test_observation_outside_tolerance_is_rejected_with_a_reason():
    """Only one model timestamp, 20 h away: no false comparison may be created."""
    m = colocate(utc(2023, 7, 2, 20), 10.0, 70.0, [utc(2023, 7, 2, 0)], LATS, LONS)
    assert m.is_valid is False
    assert m.rejection_reason == REJECT_TEMPORAL_TOLERANCE
    assert "exceeding the ±12 h tolerance" in m.rejection_detail
    assert m.temporal_difference_hours == pytest.approx(-20.0)


def test_exactly_at_the_tolerance_boundary_is_accepted():
    m = colocate(utc(2023, 7, 2, 12), 10.0, 70.0, [utc(2023, 7, 3, 0)], LATS, LONS)
    assert m.temporal_difference_hours == pytest.approx(12.0)
    assert m.is_valid is True


def test_just_beyond_the_boundary_is_rejected():
    m = colocate(utc(2023, 7, 2, 11, 59), 10.0, 70.0, [utc(2023, 7, 3, 0)], LATS, LONS)
    assert m.temporal_difference_hours > 12.0
    assert m.is_valid is False


def test_tolerance_is_configurable_per_call():
    obs, times = utc(2023, 7, 2, 20), [utc(2023, 7, 2, 0)]
    assert colocate(obs, 10.0, 70.0, times, LATS, LONS, temporal_tolerance_hours=24.0).is_valid
    assert not colocate(obs, 10.0, 70.0, times, LATS, LONS, temporal_tolerance_hours=1.0).is_valid


def test_rejected_match_still_reports_what_was_found():
    """A rejection must remain diagnosable, so the nearest candidate is reported."""
    m = colocate(utc(2023, 7, 2, 20), 9.4, 69.2, [utc(2023, 7, 2, 0)], LATS, LONS)
    assert m.is_valid is False
    assert m.model_time is not None
    assert m.model_latitude == 10.0 and m.model_longitude == 70.0
    assert m.spatial_distance_km is not None


def test_optional_spatial_tolerance_can_reject_a_distant_cell():
    m = colocate(
        utc(2023, 7, 2, 12), 2.4, 62.4, TIMES, LATS, LONS, spatial_tolerance_km=10.0
    )
    assert m.is_valid is False
    assert m.rejection_reason == REJECT_SPATIAL_TOLERANCE


def test_no_grid_coordinates_is_rejected():
    m = colocate(utc(2023, 7, 2), 10.0, 70.0, TIMES, [], [])
    assert m.is_valid is False
    assert m.rejection_reason == REJECT_NO_GRID


def test_match_object_carries_every_field_the_comparison_needs():
    m = colocate(utc(2023, 7, 2, 14, 30), 9.4, 69.2, TIMES, LATS, LONS)
    for attr in (
        "observation_time", "observation_latitude", "observation_longitude",
        "model_time", "model_time_index", "model_latitude", "model_longitude",
        "model_lat_index", "model_lon_index", "temporal_difference_hours",
        "spatial_distance_km", "is_valid", "spatial_match_method",
        "temporal_match_method", "temporal_tolerance_hours",
    ):
        assert getattr(m, attr) is not None, f"{attr} missing from match object"
