"""Interpolation helpers for the Argo/HYCOM matchup.

These are hand-computed checks against known linear fields, plus the safety
rules: no extrapolation, no bridging a masked cell/slice, and renormalized
weights over land cells.
"""

import numpy as np
import pytest

from datetime import datetime

from app.services.matchup_interpolation import (
    NATIVE_DEPTH_MATCH_TOLERANCE_M,
    bilinear_stencil,
    contiguous_valid_segments,
    interpolate_model_profile,
    nearest_cell_index,
    nearest_time_index,
    time_bracket_weights,
    time_seconds,
    weighted_cells,
    weighted_time_slices,
)

DEPTHS = [0.0, 10.0, 50.0, 100.0, 250.0, 500.0]


# --- vertical interpolation -------------------------------------------------

def test_exact_native_level_is_reported_as_native():
    value, method = interpolate_model_profile(DEPTHS, [30.0, 29.0, 27.0, 21.0, 12.0, 8.0], 100.0)

    assert value == 21.0
    assert method == "native"


def test_level_within_one_metre_of_native_is_still_native():
    value, method = interpolate_model_profile(DEPTHS, [30.0, 29.0, 27.0, 21.0, 12.0, 8.0], 100.5)

    assert value == 21.0
    assert method == "native"
    assert NATIVE_DEPTH_MATCH_TOLERANCE_M == 1.0


def test_known_linear_profile_interpolates_exactly():
    """T = 30 - 0.02 * depth -> T(25) = 29.5."""
    value, method = interpolate_model_profile([0.0, 10.0, 50.0], [30.0, 29.8, 29.0], 25.0)

    assert value == pytest.approx(29.5)
    assert method == "interpolated"


def test_linear_profile_is_exact_at_several_points():
    depths = [0.0, 100.0, 1000.0]
    # T = 28 - 0.005 * depth
    values = [28.0 - 0.005 * d for d in depths]
    # Targets stay > 1 m away from a native level so they are genuinely
    # interpolated rather than snapped to a native value.
    for target in (25.0, 250.0, 550.0, 998.5):
        value, method = interpolate_model_profile(depths, values, target)
        assert value == pytest.approx(28.0 - 0.005 * target)
        assert method == "interpolated"


def test_known_linear_salinity_profile_interpolates_exactly():
    """S = 34.5 - 0.004 * depth -> S(175) = 33.8."""
    depths = [0.0, 100.0, 250.0]
    values = [34.5, 34.1, 33.5]
    value, method = interpolate_model_profile(depths, values, 175.0)

    assert value == pytest.approx(33.8)
    assert method == "interpolated"


def test_float_level_below_the_deepest_model_level_is_never_extrapolated():
    value, method = interpolate_model_profile(DEPTHS, [30.0, 29.0, 27.0, 21.0, 12.0, 8.0], 800.0)

    assert value is None
    assert method is None


def test_float_level_above_the_shallowest_model_level_is_never_extrapolated():
    # Well outside the model range. Inside the 1 m native tolerance the surface
    # level is legitimately reported as native; beyond it nothing is invented.
    assert interpolate_model_profile(DEPTHS, [30.0, 29.0, 27.0, 21.0, 12.0, 8.0], -50.0) == (None, None)


def test_masked_deepest_level_acts_as_the_seafloor_and_is_not_extrapolated_below():
    """Model levels below the seabed are masked (NaN).

    The deepest VALID level is the last usable one: interpolating between it
    and the first masked level would invent values inside the seabed, so
    everything below it must stay unmatched.
    """
    depths = [0.0, 10.0, 50.0, 100.0, 250.0, 500.0]
    values = [30.0, 29.0, 27.0, 21.0, np.nan, np.nan]  # seabed below 100 m

    # The deepest valid level itself still matches.
    assert interpolate_model_profile(depths, values, 100.0) == (21.0, "native")
    # 150 m sits between the last valid level (100 m) and the first masked one
    # (250 m): matching it would interpolate inside the seabed.
    assert interpolate_model_profile(depths, values, 150.0) == (None, None)
    assert interpolate_model_profile(depths, values, 400.0) == (None, None)


def test_masked_level_in_the_middle_is_never_bridged():
    depths = [0.0, 10.0, 50.0, 100.0]
    values = [30.0, np.nan, 20.0, 10.0]

    # The deep segment (50-100 m) interpolates normally...
    assert interpolate_model_profile(depths, values, 75.0)[0] == pytest.approx(15.0)
    # ...but the isolated level at 0 m can reach nothing without extrapolating,
    # and nothing is interpolated ACROSS the masked 10 m level.
    assert interpolate_model_profile(depths, values, 5.0) == (None, None)
    assert interpolate_model_profile(depths, values, 30.0) == (None, None)


def test_all_nan_profile_matches_nothing():
    assert interpolate_model_profile([0.0, 10.0], [np.nan, np.nan], 5.0) == (None, None)


def test_non_numeric_target_matches_nothing():
    assert interpolate_model_profile(DEPTHS, [30.0, 29.0], None) == (None, None)
    assert interpolate_model_profile(DEPTHS, [30.0, 29.0], float("nan")) == (None, None)


def test_single_level_profile_matches_only_that_depth():
    assert interpolate_model_profile([50.0], [27.0], 50.0) == (27.0, "native")
    assert interpolate_model_profile([50.0], [27.0], 75.0) == (None, None)


def test_segments_split_on_masked_levels():
    segments = contiguous_valid_segments([0.0, 10.0, 50.0, 100.0], [1.0, np.nan, 3.0, 4.0])

    assert len(segments) == 2
    assert segments[0][0] == [0.0]
    assert segments[1][0] == [50.0, 100.0]


# --- horizontal bilinear ----------------------------------------------------

LATS = list(range(5, 26))    # 1-degree spacing
LONS = list(range(80, 101))


def test_bilinear_weights_sum_to_one():
    stencil = bilinear_stencil(LATS, LONS, 15.25, 88.42)

    assert sum(weight for _i, _j, weight in stencil) == pytest.approx(1.0)
    assert len(stencil) == 4


def test_bilinear_uses_the_four_surrounding_cells():
    stencil = bilinear_stencil(LATS, LONS, 15.25, 88.42)

    assert {(i, j) for i, j, _w in stencil} == {(10, 8), (10, 9), (11, 8), (11, 9)}


def test_bilinear_weights_are_the_distance_based_fractions():
    """lat 15.25 -> 25 % of the way from 15 to 16; lon 88.42 -> 42 % from 88 to 89."""
    stencil = dict(((i, j), w) for i, j, w in bilinear_stencil(LATS, LONS, 15.25, 88.42))

    assert stencil[(10, 8)] == pytest.approx(0.75 * 0.58)
    assert stencil[(10, 9)] == pytest.approx(0.75 * 0.42)
    assert stencil[(11, 8)] == pytest.approx(0.25 * 0.58)
    assert stencil[(11, 9)] == pytest.approx(0.25 * 0.42)


def test_exact_grid_node_collapses_to_that_single_cell():
    assert bilinear_stencil(LATS, LONS, 15.0, 88.0) == [(10, 8, 1.0)]


def test_exact_latitude_line_stays_on_that_latitude():
    """An exact latitude collapses to one row of cells."""
    stencil = bilinear_stencil(LATS, LONS, 15.0, 88.42)

    assert {i for i, _j, _w in stencil} == {10}
    assert {j for _i, j, _w in stencil} == {8, 9}


def test_target_outside_the_grid_has_no_stencil():
    assert bilinear_stencil(LATS, LONS, 4.0, 88.0) is None
    assert bilinear_stencil(LATS, LONS, 15.0, 101.0) is None
    assert bilinear_stencil(LATS, LONS, math_nan(), 88.0) is None


def math_nan():
    return float("nan")


def test_nearest_cell_index_picks_the_closest_centre():
    assert nearest_cell_index(LATS, 15.25) == 10
    assert nearest_cell_index(LONS, 88.42) == 8
    # Outside the grid the nearest end is still returned (never an error).
    assert nearest_cell_index(LATS, 100.0) == len(LATS) - 1


# --- land / NaN cell handling ----------------------------------------------

def test_weights_are_renormalized_over_valid_cells_only():
    """One of four cells is land (NaN): the other three renormalize to 1."""
    stencil = [(0, 0, 0.25), (0, 1, 0.25), (1, 0, 0.25), (1, 1, 0.25)]
    fields = [np.array([10.0]), np.array([20.0]), np.array([30.0]), np.array([np.nan])]

    result = weighted_cells(fields, stencil, min_valid_cells=2)

    # Mean of the three valid cells, NOT dragged toward 0 by the masked one.
    assert result[0] == pytest.approx(20.0)


def test_renormalization_is_per_depth_level():
    """Land masking is resolved per depth level, not for the whole column."""
    stencil = [(0, 0, 0.25), (0, 1, 0.25), (1, 0, 0.25), (1, 1, 0.25)]
    fields = [
        np.array([10.0, 10.0, 10.0, 10.0]),
        np.array([20.0, 20.0, np.nan, np.nan]),
        np.array([30.0, np.nan, 30.0, np.nan]),
        np.array([np.nan, 40.0, np.nan, np.nan]),
    ]

    result = weighted_cells(fields, stencil, min_valid_cells=2)

    # 0 m: three valid cells.
    assert result[0] == pytest.approx(20.0)
    # 10 m: three valid cells (a different one is land).
    assert result[1] == pytest.approx((10.0 + 20.0 + 40.0) / 3)
    # 20 m: two valid cells - exactly at the minimum.
    assert result[2] == pytest.approx(20.0)
    # 30 m: only one valid cell -> that depth level is left unmatched.
    assert np.isnan(result[3])


def test_fewer_than_two_valid_cells_skips_the_match():
    stencil = [(0, 0, 0.5), (0, 1, 0.5)]
    fields = [np.array([10.0]), np.array([np.nan])]

    assert weighted_cells(fields, stencil, min_valid_cells=2) is None


def test_a_coastal_point_with_one_valid_cell_is_not_matched():
    """3 of 4 cells are land: the single survivor is up to half a cell away."""
    stencil = [(0, 0, 0.4), (0, 1, 0.1), (1, 0, 0.4), (1, 1, 0.1)]
    fields = [np.array([10.0]), np.array([np.nan]), np.array([np.nan]), np.array([np.nan])]

    assert weighted_cells(fields, stencil, min_valid_cells=2) is None


def test_single_cell_stencil_is_accepted_when_that_cell_is_valid():
    """An exact grid-node stencil is nearest-equivalent, not a land failure."""
    result = weighted_cells([np.array([10.0])], [(10, 8, 1.0)], min_valid_cells=2)

    assert result[0] == pytest.approx(10.0)
    assert weighted_cells([np.array([np.nan])], [(10, 8, 1.0)], min_valid_cells=2) is None


def test_all_land_returns_nothing():
    stencil = [(0, 0, 0.5), (0, 1, 0.5)]
    fields = [np.array([np.nan]), np.array([np.nan])]

    assert weighted_cells(fields, stencil, min_valid_cells=2) is None
    assert weighted_cells([], [], min_valid_cells=2) is None


# --- temporal ---------------------------------------------------------------

TIMES = [
    "2026-09-08T00:00",
    "2026-09-08T06:00",
    "2026-09-08T12:00",
]


def test_observation_between_two_slices_brackets_them():
    brackets = time_bracket_weights(TIMES, "2026-09-08T03:00")

    assert brackets == [(0, 0.5), (1, 0.5)]


def test_bracket_weights_sum_to_one():
    brackets = time_bracket_weights(TIMES, "2026-09-08T04:30")

    assert sum(weight for _index, weight in brackets) == pytest.approx(1.0)
    # 4.5 h into the 00:00-06:00 step -> 75 % of the weight on the upper slice.
    assert brackets[0][1] == pytest.approx(0.25)
    assert brackets[1][1] == pytest.approx(0.75)


def test_exact_slice_time_uses_that_single_slice():
    assert time_bracket_weights(TIMES, "2026-09-08T06:00") == [(1, 1.0)]


def test_time_outside_the_window_uses_the_nearest_slice():
    assert time_bracket_weights(TIMES, "2026-09-07T00:00") == [(0, 1.0)]
    assert time_bracket_weights(TIMES, "2026-09-09T00:00") == [(2, 1.0)]


def test_known_linear_time_series_interpolates_exactly():
    """T = 10 at 00:00 and 20 at 06:00 -> T(03:00) = 15."""
    fields = [np.array([10.0]), np.array([20.0])]

    result = weighted_time_slices(fields, [0.5, 0.5])

    assert result[0] == pytest.approx(15.0)


def test_two_slices_blend_linearly():
    fields = [np.array([0.0]), np.array([12.0])]

    result = weighted_time_slices(fields, [0.75, 0.25])

    assert result[0] == pytest.approx(3.0)


def test_a_masked_slice_is_never_blended_away():
    fields = [np.array([10.0]), np.array([np.nan])]

    assert weighted_time_slices(fields, [0.5, 0.5]) is None


def test_single_slice_passes_through():
    assert weighted_time_slices([np.array([10.0])], [1.0])[0] == pytest.approx(10.0)
    assert weighted_time_slices([], []) is None


def test_nearest_time_index_and_hours():
    assert nearest_time_index(TIMES, "2026-09-08T03:00") == 0
    assert nearest_time_index(TIMES, "2026-09-08T04:00") == 1
    assert nearest_time_index(TIMES, "2026-09-08T23:00") == 2
    assert nearest_time_index([], "2026-09-08T04:00") is None


def test_time_seconds_reads_naive_input_as_utc():
    utc = time_seconds("2026-09-08T06:00")
    local = time_seconds(np.datetime64("2026-09-08T06:00"))

    assert utc == local
    expected = (datetime(2026, 9, 8, 6, 0) - datetime(1970, 1, 1)).total_seconds()
    assert utc == pytest.approx(expected)


def test_unparsable_time_is_reported_as_none():
    assert time_seconds("not-a-time") is None
    assert time_seconds(None) is None
    assert time_seconds(np.datetime64("NaT", "s")) is None