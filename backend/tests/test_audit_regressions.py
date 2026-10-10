"""Regression tests for defects found in the numerical audit."""

import math

import numpy as np
import pytest

from app.services.argo_levels import build_matchup_levels
from app.services.matchup_interpolation import (
    interpolate_float_at_depth,
    interpolate_model_profile,
    weighted_cells,
)
from app.services.matchup_summary import summarize_matches
from app.services.model_observation_matchup import haversine_km


def test_weighted_cells_applies_unequal_bilinear_weights():
    # Target at 25% of the way along one axis: T = 0.75 * 10 + 0.25 * 20 = 12.5.
    stencil = [(0, 0, 0.75), (0, 1, 0.25)]
    result = weighted_cells([np.array([10.0]), np.array([20.0])], stencil)
    assert result[0] == pytest.approx(12.5)


def test_weighted_cells_renormalizes_unequal_weights_over_valid_cells():
    stencil = [(0, 0, 0.5), (0, 1, 0.3), (1, 0, 0.2)]
    fields = [np.array([10.0]), np.array([20.0]), np.array([np.nan])]
    # (0.5 * 10 + 0.3 * 20) / 0.8
    assert weighted_cells(fields, stencil)[0] == pytest.approx(13.75)


def test_weighted_cells_rejects_field_stencil_mismatch():
    with pytest.raises(ValueError):
        weighted_cells([np.array([1.0])], [(0, 0, 0.5), (0, 1, 0.5)])


def test_float_levels_listed_out_of_order_are_still_bracketed():
    depths = [100.0, 0.0, 50.0]
    temps = [10.0, 30.0, 20.0]
    value, method, bracket, reject = interpolate_float_at_depth(depths, temps, 25.0, 60.0)
    assert reject is None and method == "float_interpolated"
    assert bracket == (0.0, 50.0)
    assert value == pytest.approx(25.0)


def test_native_match_uses_the_closest_level_not_the_first():
    value, method, bracket, _ = interpolate_float_at_depth(
        [16.6, 17.4, 30.0], [1.0, 2.0, 3.0], 17.5, 50.0, native_tolerance_m=1.0
    )
    assert method == "float_native" and bracket == (17.4, 17.4) and value == 2.0

    model_value, model_method = interpolate_model_profile(
        [16.6, 17.4], [1.0, 2.0], 17.5, native_tolerance_m=1.0
    )
    assert model_method == "native" and model_value == 2.0


def test_string_qc_flag_for_a_bad_value_is_rejected():
    observations = [
        {"pressure_dbar": 10.0, "temperature_c": 28.0, "temp_qc": "4"},
        {"pressure_dbar": 20.0, "temperature_c": 27.0, "temp_qc": "1"},
    ]
    result = build_matchup_levels(observations, 10.0)
    temps = [level["temperature_c"] for level in result["levels"]]
    assert temps == [None, 27.0]
    assert result["missingQcLevelCount"] == 2  # salinity flags are absent


def test_levels_are_sorted_by_depth():
    observations = [
        {"pressure_dbar": 50.0, "temperature_c": 20.0},
        {"pressure_dbar": 5.0, "temperature_c": 29.0},
    ]
    depths = [level["depth_m"] for level in build_matchup_levels(observations, 10.0)["levels"]]
    assert depths == sorted(depths)


def test_overall_error_does_not_cancel_within_a_profile():
    def match(residuals):
        return {
            "profileId": "p", "floatId": "f",
            "comparisons": [
                {"modelDepthM": float(i), "_temperatureResidualRaw": r}
                for i, r in enumerate(residuals)
            ],
        }

    summary = summarize_matches([match([3.0, -3.0])])
    overall = summary["overall"]["temperature"]
    assert overall["bias"] == pytest.approx(0.0)
    assert overall["mae"] == pytest.approx(3.0)
    assert overall["rmse"] == pytest.approx(3.0)


def test_haversine_handles_antipodal_points():
    assert haversine_km(0.0, 0.0, 0.0, 180.0) == pytest.approx(math.pi * 6371.0, abs=0.01)


def test_nodes_are_recovered_from_midpoint_built_bounds():
    from app.services.matchup_interpolation import nodes_from_cell_bounds

    bounds = [[-5, 5], [5, 30], [30, 75], [75, 175], [175, 375], [375, 625]]
    assert nodes_from_cell_bounds(bounds) == [0.0, 10.0, 50.0, 100.0, 250.0, 500.0]
    assert nodes_from_cell_bounds([[0, 5], [6, 10]]) is None  # not contiguous
    assert nodes_from_cell_bounds([[0, 10], [10, 11], [11, 12]]) is None  # non-monotonic


def test_depth_axis_switch(tmp_path):
    import xarray as xr
    from app.services.model_observation_matchup import resolve_model_depths

    bounds = np.array([[-5, 5], [5, 30], [30, 75], [75, 175], [175, 375], [375, 625]], float)
    dataset = xr.Dataset(
        {"DEPTH_bounds": (("DEPTH", "nv"), bounds)},
        coords={"DEPTH": [0.0, 17.5, 52.5, 125.0, 275.0, 500.0]},
    )
    assert resolve_model_depths(dataset, "file")[1] == "ncss_file"
    assert resolve_model_depths(dataset, "ncss_file")[1] == "ncss_file"
    depths, rule = resolve_model_depths(dataset, "bounds_nodes")
    assert rule == "native_from_bounds"
    assert list(depths) == [0.0, 10.0, 50.0, 100.0, 250.0, 500.0]
    depths_native, rule_native = resolve_model_depths(dataset, "native")
    assert rule_native == "native_from_bounds"
    assert list(depths_native) == [0.0, 10.0, 50.0, 100.0, 250.0, 500.0]


# --- proofs against independent mathematics ---------------------------------

def test_bilinear_pipeline_reproduces_a_linear_field_exactly():
    """Bilinear interpolation is exact for f = a + b*lat + c*lon.

    Independent of any hand-picked weights: build the stencil, sample the field
    at the four corners, blend with weighted_cells, compare with the formula.
    """
    from app.services.matchup_interpolation import bilinear_stencil

    lats = [10.0, 10.25, 10.5, 10.75]
    lons = [85.0, 85.25, 85.5, 85.75]
    a, b, c = 3.0, -1.7, 0.9

    def field(i, j):
        return np.array([a + b * lats[i] + c * lons[j]])

    rng = np.random.default_rng(1)
    for _ in range(200):
        lat = rng.uniform(lats[0], lats[-1])
        lon = rng.uniform(lons[0], lons[-1])
        stencil = bilinear_stencil(lats, lons, lat, lon)
        assert sum(w for _i, _j, w in stencil) == pytest.approx(1.0)
        blended = weighted_cells([field(i, j) for i, j, _w in stencil], stencil)
        assert blended[0] == pytest.approx(a + b * lat + c * lon, abs=1e-9)


def test_bilinear_matches_scipy_reference():
    scipy_interp = pytest.importorskip("scipy.interpolate")
    from app.services.matchup_interpolation import bilinear_stencil

    lats = np.array([10.0, 10.25, 10.5, 10.75])
    lons = np.array([85.0, 85.25, 85.5, 85.75])
    rng = np.random.default_rng(2)
    grid = rng.normal(size=(4, 4))  # not linear: tests the weights, not just exactness
    reference = scipy_interp.RegularGridInterpolator((lats, lons), grid)
    for _ in range(200):
        lat, lon = rng.uniform(10.0, 10.75), rng.uniform(85.0, 85.75)
        stencil = bilinear_stencil(lats, lons, lat, lon)
        ours = weighted_cells([np.array([grid[i, j]]) for i, j, _w in stencil], stencil)[0]
        assert ours == pytest.approx(float(reference([[lat, lon]])[0]), abs=1e-9)


def test_node_recovery_round_trips_for_random_axes():
    from app.services.matchup_interpolation import nodes_from_cell_bounds

    rng = np.random.default_rng(3)
    for _ in range(100):
        nodes = np.concatenate([[0.0], np.cumsum(rng.uniform(1.0, 200.0, size=5))])
        edges = 0.5 * (nodes[:-1] + nodes[1:])
        first = [nodes[0] - (edges[0] - nodes[0])]
        last = [nodes[-1] + (nodes[-1] - edges[-1])]
        lowers = first + list(edges)
        uppers = list(edges) + last
        recovered = nodes_from_cell_bounds(list(zip(lowers, uppers)))
        assert recovered == pytest.approx(list(nodes), abs=1e-9)


def test_overall_rmse_equals_equal_weight_rms_of_profile_mse():
    rng = np.random.default_rng(4)
    profiles = [rng.normal(size=n) for n in (3, 5, 8)]
    matches = [
        {"profileId": str(i), "floatId": str(i),
         "comparisons": [{"modelDepthM": float(k), "_temperatureResidualRaw": float(r)}
                         for k, r in enumerate(res)]}
        for i, res in enumerate(profiles)
    ]
    overall = summarize_matches(matches)["overall"]["temperature"]
    expected_rmse = math.sqrt(np.mean([np.mean(r ** 2) for r in profiles]))
    expected_mae = np.mean([np.mean(np.abs(r)) for r in profiles])
    assert overall["rmse"] == pytest.approx(expected_rmse, abs=1e-3)
    assert overall["mae"] == pytest.approx(expected_mae, abs=1e-3)


def test_float_interpolation_reproduces_a_linear_profile():
    depths = [0.0, 7.0, 30.0, 61.0, 120.0]
    temps = [30.0 - 0.05 * d for d in depths]
    for target in (3.3, 20.0, 45.5, 100.1):
        value, method, _b, reject = interpolate_float_at_depth(
            depths, temps, target, 200.0, native_tolerance_m=0.0
        )
        assert reject is None and method == "float_interpolated"
        assert value == pytest.approx(30.0 - 0.05 * target, abs=1e-9)
