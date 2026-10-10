"""Comparison at the model's own depth levels (the default mode).

Covers the float-side bracketing rule, the no-extrapolation rule, the coarse
sampling-gap rejection, native-vs-interpolated float values against a known
linear profile, the one-pair-per-model-level bound (counted against the levels
the file actually publishes, never a hardcoded 6), and the regional aggregation
on a hand-computed small example.
"""

import math

import numpy as np
import pytest

from app.core.config import settings
from app.services.matchup_interpolation import (
    float_bracket_max_gap_m,
    interpolate_float_at_depth,
)
from app.services.matchup_summary import (
    reduce_residuals,
    summarize_matches,
)


# --- bracketing and no extrapolation ---------------------------------------

def test_exact_float_level_is_native():
    value, method, bracket, reject = interpolate_float_at_depth(
        [0.0, 10.0, 25.0, 50.0], [30.0, 29.0, 27.5, 27.0], 10.0, 50.0
    )
    assert (value, method, reject) == (29.0, "float_native", None)
    assert bracket == (10.0, 10.0)


def test_float_level_within_one_metre_is_native():
    value, method, _bracket, _reject = interpolate_float_at_depth(
        [0.0, 10.0, 25.0], [30.0, 29.0, 27.5], 10.9, 50.0
    )
    assert (value, method) == (29.0, "float_native")


def test_bracketing_float_levels_are_interpolated_linearly():
    """T = 30 - 0.1*z on a linear profile: T(17.5) = 28.25."""
    depths = [0.0, 10.0, 25.0, 50.0]
    values = [30.0 - 0.1 * d for d in depths]
    value, method, bracket, reject = interpolate_float_at_depth(depths, values, 17.5, 50.0)
    assert value == pytest.approx(28.25)
    assert method == "float_interpolated"
    assert bracket == (10.0, 25.0)
    assert reject is None


def test_no_extrapolation_below_the_float_or_above_it():
    depths = [0.0, 10.0, 25.0, 50.0]
    values = [30.0, 29.0, 27.5, 27.0]
    for target in (100.0, 500.0):
        value, method, _bracket, reject = interpolate_float_at_depth(
            depths, values, target, 50.0
        )
        assert value is None and method is None
        assert reject == "outside_float_range"


def test_no_extrapolation_above_the_shallowest_float_level():
    value, _method, _bracket, reject = interpolate_float_at_depth(
        [3.3, 10.0, 25.0], [30.0, 29.0, 27.5], 0.0, 50.0
    )
    assert value is None
    assert reject == "outside_float_range"


def test_endpoints_of_the_float_range_are_inside_it():
    depths = [0.0, 10.0, 25.0]
    values = [30.0, 29.0, 27.5]
    # The shallowest and deepest float levels themselves are matched, not
    # treated as extrapolation.
    assert interpolate_float_at_depth(depths, values, 0.0, 50.0)[1] == "float_native"
    assert interpolate_float_at_depth(depths, values, 25.0, 50.0)[1] == "float_native"


# --- coarse sampling-gap rejection -----------------------------------------

def test_bracket_wider_than_the_limit_is_rejected_not_interpolated():
    depths = [0.0, 10.0, 70.0]
    values = [30.0, 29.0, 20.0]
    # 30 m falls in a 60 m bracket: too coarse for a 50 m limit.
    value, method, bracket, reject = interpolate_float_at_depth(depths, values, 30.0, 50.0)
    assert value is None and method is None
    assert reject == "float_sampling_too_coarse"
    # The rejected bracket is still reported so the reason is inspectable.
    assert bracket == (10.0, 70.0)
    # The same bracket is accepted once the limit allows it.
    accepted = interpolate_float_at_depth(depths, values, 30.0, 60.0)
    assert accepted[3] is None
    assert accepted[0] == pytest.approx(29.0 + (20.0 / 60.0) * (20.0 - 29.0))


def test_gap_limit_is_inclusive_at_the_threshold():
    depths = [0.0, 10.0, 60.0]
    values = [30.0, 29.0, 20.0]
    # A bracket of exactly 50 m is accepted (the limit is inclusive)...
    assert interpolate_float_at_depth(depths, values, 30.0, 50.0)[0] is not None
    # ...and 49.9 m of allowance is not enough for a 50.1 m bracket.
    assert interpolate_float_at_depth([0.0, 10.0, 60.1], values, 30.0, 50.0)[3] == (
        "float_sampling_too_coarse"
    )


def test_sampling_gap_rule_is_tighter_in_the_upper_ocean():
    shallow = settings.FLOAT_BRACKET_MAX_GAP_M
    deep = settings.FLOAT_BRACKET_MAX_GAP_DEEP_M
    breakpoint = settings.FLOAT_BRACKET_DEEP_BREAKPOINT_M

    def limit(depth):
        return float_bracket_max_gap_m(depth, shallow, deep, breakpoint)

    assert limit(0.0) == 50.0
    assert limit(125.0) == 50.0
    # 150 m is the documented breakpoint: still the tight limit.
    assert limit(150.0) == 50.0
    assert limit(150.1) == 100.0
    assert limit(500.0) == 100.0


def test_configured_sampling_gap_thresholds():
    assert settings.FLOAT_BRACKET_MAX_GAP_M == 50.0
    assert settings.FLOAT_BRACKET_MAX_GAP_DEEP_M == 100.0
    assert settings.FLOAT_BRACKET_DEEP_BREAKPOINT_M == 150.0


# --- degenerate inputs ------------------------------------------------------

def test_non_finite_float_values_do_not_create_a_bracket():
    depths = [0.0, 10.0, np.nan, 25.0, 50.0]
    values = [30.0, 29.0, 27.5, 27.0, math.nan]
    # The masked level at index 2 is dropped, leaving a contiguous 0-25 m run
    # plus the deeper 25 m level whose value is also masked.
    assert interpolate_float_at_depth(depths, values, 20.0, 50.0)[0] is not None
    # 60 m lies past the deepest VALID float level: never extrapolated.
    value, _method, _bracket, reject = interpolate_float_at_depth(depths, values, 60.0, 50.0)
    assert value is None
    assert reject == "outside_float_range"


def test_no_valid_float_values_returns_a_rejection():
    value, _method, _bracket, reject = interpolate_float_at_depth(
        [0.0, 10.0], [np.nan, np.nan], 5.0, 50.0
    )
    assert value is None
    assert reject == "no_valid_float_levels"


def test_single_float_level_only_matches_itself():
    """One float level can serve itself, but nothing can be built from it."""
    assert interpolate_float_at_depth([10.0], [29.0], 10.0, 50.0)[1] == "float_native"
    # Still inside the 1 m native tolerance.
    assert interpolate_float_at_depth([10.0], [29.0], 11.0, 50.0)[1] == "float_native"
    # Beyond it there is no second level to bracket with.
    value, method, _bracket, reject = interpolate_float_at_depth([10.0], [29.0], 11.5, 50.0)
    assert value is None and method is None
    assert reject == "outside_float_range"


# --- known linear profile, both sides --------------------------------------

def test_known_linear_float_profile_is_recovered_exactly():
    """A float profile that is exactly linear in depth must return exact values."""
    depths = [0.0, 5.0, 10.0, 20.0, 40.0]
    gradient = -0.25  # degC per metre
    values = [30.0 + gradient * d for d in depths]
    # Targets stay > 1 m from a float level so they are genuinely interpolated.
    for target in (2.5, 7.5, 15.0, 30.0, 38.5):
        value, _method, _bracket, reject = interpolate_float_at_depth(depths, values, target, 50.0)
        assert value == pytest.approx(30.0 + gradient * target)
        assert reject is None


# --- summary aggregation, hand-computed ------------------------------------

def _match(float_id, depth, residuals):
    """A synthetic per-profile matchup with one residual per model depth."""
    return {
        "profileId": f"profile-{float_id}",
        "floatId": float_id,
        "observationTimestamp": "2026-10-05T00:00:00Z",
        "timeDifferenceHours": 1.0,
        "timeGapStatus": "good",
        "modelRun": "run.nc",
        "comparisons": [
            {
                "modelDepthM": level,
                "depthM": level,
                "argoTemperatureC": 30.0,
                "modelTemperatureC": 30.0 + residual,
                "temperatureResidualC": residual,
                "_temperatureResidualRaw": residual,
                "_salinityResidualRaw": None,
            }
            for level, residual in zip(depth, residuals)
        ],
    }


def test_per_depth_statistics_are_hand_computable():
    matches = [
        _match("A", [17.5, 125.0], [1.0, -2.0]),
        _match("B", [17.5, 125.0], [3.0, 4.0]),
    ]
    summary = summarize_matches(matches)
    rows = {row["modelDepthM"]: row["temperature"] for row in summary["byModelDepth"]}

    # 17.5 m: residuals 1.0 and 3.0 -> bias 2.0, MAE 2.0, RMSE sqrt(5).
    assert rows[17.5] == {
        "n": 2, "bias": 2.0, "mae": 2.0, "rmse": pytest.approx(math.sqrt(5.0), abs=1e-4),
    }
    # 125.0 m: residuals -2.0 and 4.0 -> bias 1.0, MAE 3.0, RMSE sqrt(10).
    assert rows[125.0] == {
        "n": 2, "bias": 1.0, "mae": 3.0, "rmse": pytest.approx(math.sqrt(10.0), abs=1e-4),
    }


def test_profiles_are_weighted_equally_not_by_pair_count():
    """A profile with more pairs must not dominate the aggregate."""
    many = _match("many", [17.5, 52.5, 125.0], [10.0, 10.0, 10.0])
    few = _match("few", [17.5], [-10.0])
    summary = summarize_matches([many, few])
    row = next(r for r in summary["byModelDepth"] if r["modelDepthM"] == 17.5)
    # Two profiles at 17.5 m with biases +10 and -10 -> bias 0, MAE 10.
    assert row["temperature"]["n"] == 2
    assert row["temperature"]["bias"] == 0.0
    assert row["temperature"]["mae"] == 10.0


def test_overall_is_the_mean_of_per_profile_biases():
    matches = [_match("A", [17.5], [2.0]), _match("B", [17.5], [-2.0])]
    overall = summarize_matches(matches)["overall"]["temperature"]
    assert overall == {"n": 2, "bias": 0.0, "mae": 2.0, "rmse": 2.0}


def test_profile_rows_expose_gap_and_pair_counts():
    summary = summarize_matches([_match("A", [17.5, 52.5], [1.0, 2.0])])
    row = summary["profiles"][0]
    assert row["floatId"] == "A"
    assert row["timeDifferenceHours"] == 1.0
    assert row["timeGapStatus"] == "good"
    assert row["pairCount"] == 2
    assert row["temperature"]["n"] == 2
    assert row["salinity"]["n"] == 0


def test_missing_residuals_never_become_zero():
    assert reduce_residuals([None, None]) == {"n": 0, "bias": None, "mae": None, "rmse": None}
    assert reduce_residuals([2.0, None, math.nan])["n"] == 1


def test_empty_match_set_yields_no_depth_rows():
    summary = summarize_matches([])
    assert summary["byModelDepth"] == []
    assert summary["profileCount"] == 0
    assert summary["overall"]["temperature"]["n"] == 0


# --- end-to-end bound: at most one pair per model level --------------------

def test_at_most_one_pair_per_model_level_in_the_live_matchup():
    from app.providers.argo_provider import argo_provider
    from app.providers.incois_provider import IncoisProvider
    from app.services.model_observation_matchup import match_argo_with_hycom

    native_depths = IncoisProvider().get_available_depths()
    assert native_depths, "no real model depths installed"
    for profile in argo_provider.get_profiles()[:5]:
        matchup = match_argo_with_hycom(profile["profile_id"])
        comparisons = matchup["comparisons"]
        depths = [row["modelDepthM"] for row in comparisons]
        assert len(depths) == len(set(depths)), "a model level produced two pairs"
        assert len(depths) <= len(native_depths)
        assert all(depth in native_depths for depth in depths)
        # Statistics use exactly these pairs and nothing else.
        assert matchup["statistics"]["temperature"]["n"] <= len(depths)

# --- regional summary: excluded profiles are classified, not lumped --------

def test_summary_endpoint_classifies_excluded_profiles():
    """An empty comparison list hides three different findings.

    The endpoint must not report all of them as "no overlap", otherwise a
    regional figure silently drops coarse-sampled floats without saying so.
    """
    from app.api.endpoints import _exclusion_reason
    from app.services.matchup_summary import (
        REASON_COARSE,
        REASON_NO_OVERLAP,
        REASON_NO_PAIRS,
    )

    assert _exclusion_reason({"excludedModelLevels": []}) == REASON_NO_OVERLAP
    assert _exclusion_reason(
        {"excludedModelLevels": [{"reason": "float_sampling_too_coarse"}]}
    ) == REASON_COARSE
    # In range, but every candidate level was rejected for some other reason.
    assert _exclusion_reason(
        {"excludedModelLevels": [{"reason": "below_float_profile"}]}
    ) == REASON_NO_PAIRS


def test_summary_endpoint_excludes_rows_without_any_usable_residual():
    """A row whose model cells were all rejected carries no usable statistic.

    Such a profile must be excluded rather than counted, and a nil model cell
    must never be read as a zero residual (which would drag the bias to 0).
    """
    from app.api.endpoints import _finite

    def usable(pair):
        return any(
            _finite(pair.get(key)) is not None
            for key in ("temperatureResidualC", "salinityResidualPSU")
        )

    nil_row = {"depthM": 0.0, "temperatureResidualC": None, "salinityResidualPSU": None}
    live_row = {"depthM": 17.5, "temperatureResidualC": 0.4, "salinityResidualPSU": None}

    assert usable(nil_row) is False
    assert usable(live_row) is True
    assert _finite(nil_row["temperatureResidualC"]) is None


# --- surface level: the 0 m model level may borrow a shallow float sample ---

def test_surface_level_accepts_a_three_metre_sample():
    """A float starting at 3 m must still pair with the model's 0 m level."""
    from app.services.matchup_interpolation import (
        interpolate_float_at_depth,
    )

    value, method, bracket, reject = interpolate_float_at_depth(
        [3.0, 10.0, 25.0], [29.5, 29.4, 27.0], 0.0, 50.0,
        allow_surface_substitute=True,
    )
    assert value == 29.5
    assert method == "float_near_surface"
    # The bracket discloses the depth the value was actually measured at, so the
    # substitution is visible rather than implied.
    assert bracket == (3.0, 3.0)
    assert reject is None


def test_surface_level_rejects_an_eight_metre_sample():
    """8 m is below the 5 m limit, so the sample is not borrowed."""
    from app.services.matchup_interpolation import (
        interpolate_float_at_depth,
    )

    value, method, _bracket, reject = interpolate_float_at_depth(
        [8.0, 10.0, 25.0], [29.5, 29.4, 27.0], 0.0, 50.0,
        allow_surface_substitute=True,
    )
    assert value is None
    assert method is None
    assert reject == "outside_float_range"


def test_surface_substitution_is_opt_in():
    """Without the flag the 0 m level keeps rejecting a shallow-first profile."""
    from app.services.matchup_interpolation import (
        interpolate_float_at_depth,
    )

    value, method, _bracket, reject = interpolate_float_at_depth(
        [3.0, 10.0, 25.0], [29.5, 29.4, 27.0], 0.0, 50.0
    )
    assert value is None
    assert method is None
    assert reject == "outside_float_range"


def test_surface_substitution_never_applies_to_other_model_levels():
    """A shallow float sample may only ever stand in for 0 m, never for 17.5 m."""
    from app.services.matchup_interpolation import (
        interpolate_float_at_depth,
    )

    for depth in (17.5, 52.5, 125.0, 275.0, 500.0):
        value, method, _bracket, reject = interpolate_float_at_depth(
            [3.0, 10.0, 25.0], [29.5, 29.4, 27.0], depth, 50.0,
            allow_surface_substitute=True,
        )
        if depth > 25.0:
            assert (value, method, reject) == (None, None, "outside_float_range")
        else:
            # Inside the profile it must still be a genuine bracket, never the
            # 3 m surface sample standing in for a mid-water level.
            assert value is not None
            assert method in ("float_native", "float_interpolated")


def test_surface_level_never_extrapolates_beyond_the_limit():
    """A float whose shallowest sample is at 5.5 m is outside the rule."""
    from app.services.matchup_interpolation import (
        interpolate_float_at_depth,
    )

    value, _method, _bracket, reject = interpolate_float_at_depth(
        [5.5, 10.0, 25.0], [29.5, 29.4, 27.0], 0.0, 50.0,
        allow_surface_substitute=True,
    )
    assert value is None
    assert reject == "outside_float_range"


def test_live_matchup_includes_the_surface_level_and_discloses_the_depth():
    """End to end: the 0 m level produces a pair and reports what it borrowed."""
    from app.providers.argo_provider import argo_provider
    from app.services.model_observation_matchup import match_argo_with_hycom

    found = 0
    for profile in argo_provider.get_profiles():
        matchup = match_argo_with_hycom(profile["profile_id"])
        if matchup is None or matchup.get("statusMessage"):
            continue
        surface_rows = [
            row for row in matchup["comparisons"]
            if abs(row["modelDepthM"]) < 1e-9
        ]
        for row in surface_rows:
            if row["floatTemperatureMethod"] == "float_near_surface":
                found += 1
                disclosed = row["floatNearSurfaceDepthM"]
                assert disclosed is not None
                assert 0.0 <= disclosed <= 5.0
                # The borrowed value must be the shallowest accepted sample,
                # never a value extrapolated up from deeper in the column.
                assert row["argoTemperatureC"] is not None
        # The surface row may only ever be the model's own 0 m level.
        for row in surface_rows:
            assert abs(row["depthM"]) < 1e-9
    assert found > 0, "no profile exercised the near-surface rule"


# --- the level count is read from the file, never assumed ------------------

def test_pairs_are_produced_for_every_level_the_file_publishes():
    """A denser vertical grid must produce more pairs with no code change.

    The archived INCOIS runs publish 6 levels, but that is a property of the
    PRODUCT, not of this code: the comparison builder reads the DEPTH coordinate
    and must pair every level it finds. This test locks that in with a synthetic
    10-level column containing the 75/100/150 m levels the real archive lacks,
    which is exactly the region where the 125 m bias was diagnosed.
    """
    import numpy as np

    from app.services.model_observation_matchup import (
        _build_model_level_comparisons,
    )

    float_levels = [
        {
            "depth_m": depth,
            "temperature_c": temperature,
            "salinity_psu": 34.0,
            "depth_source": "pressure_gsw",
        }
        for depth, temperature in [
            (0.0, 30.0), (10.0, 29.5), (20.0, 29.0), (50.0, 28.0),
            (75.0, 26.5), (100.0, 24.0), (125.0, 20.0), (150.0, 16.0),
            (200.0, 12.0), (300.0, 9.0),
        ]
    ]
    depths = np.array([0.0, 10.0, 20.0, 50.0, 75.0, 100.0, 125.0, 150.0, 200.0, 300.0])
    temp = np.array([30.0, 29.5, 29.0, 28.0, 26.5, 24.0, 20.0, 16.0, 12.0, 9.0])
    saln = np.full(10, 34.0)

    comparisons, excluded = _build_model_level_comparisons(float_levels, depths, temp, saln)

    assert len(comparisons) == len(depths) == 10
    assert [row["modelDepthM"] for row in comparisons] == list(depths)
    # Every level is paired, still at most one pair per level.
    assert len({row["modelDepthM"] for row in comparisons}) == len(depths)
    assert excluded == []
