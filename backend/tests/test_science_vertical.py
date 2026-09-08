"""Test I: vertical linear interpolation and alignment (STEP 3B §14, §15; §24.I)."""
import numpy as np
import pytest

from app.science.vertical import (
    DEPTH_REFERENCE,
    VERTICAL_ALIGNMENT_METHOD,
    align_profiles,
    build_comparison_depths,
    interpolate_to_depths,
)

MODEL_D = [0.0, 10.0, 50.0, 100.0, 500.0]
MODEL_V = [28.0, 27.0, 20.0, 15.0, 5.0]


# ================================================ linear interpolation


def test_interpolation_is_exact_at_source_levels():
    out, _ = interpolate_to_depths(MODEL_D, MODEL_V, MODEL_D)
    np.testing.assert_allclose(out, MODEL_V)


def test_midpoint_is_the_linear_average():
    out, _ = interpolate_to_depths([0.0, 100.0], [20.0, 10.0], [50.0])
    assert out[0] == pytest.approx(15.0)


def test_interpolation_is_linear_between_levels():
    out, _ = interpolate_to_depths([0.0, 10.0], [28.0, 27.0], [2.5, 5.0, 7.5])
    np.testing.assert_allclose(out, [27.75, 27.5, 27.25])


def test_method_is_labelled_linear_interpolation():
    assert VERTICAL_ALIGNMENT_METHOD == "linear_interpolation"
    a = align_profiles([0.0, 10.0], [28.0, 27.0], MODEL_D, MODEL_V)
    assert a.method == "linear_interpolation"
    assert a.depth_reference == DEPTH_REFERENCE == "meters"


# ================================================ no extrapolation


def test_target_below_the_source_range_is_nan_not_clamped():
    """Observation deeper than the model: the deep level must not be invented."""
    out, notes = interpolate_to_depths([0.0, 100.0], [20.0, 10.0], [50.0, 500.0])
    assert out[0] == pytest.approx(15.0)
    assert np.isnan(out[1])
    assert out[1] != 10.0
    assert any("no extrapolation" in n for n in notes)


def test_target_above_the_source_range_is_nan_not_clamped():
    """Observation shallower than the model's shallowest level."""
    out, _ = interpolate_to_depths([10.0, 100.0], [27.0, 15.0], [0.0, 50.0])
    assert np.isnan(out[0])
    assert np.isfinite(out[1])


def test_extrapolation_can_be_explicitly_enabled():
    out, notes = interpolate_to_depths(
        [0.0, 100.0], [20.0, 10.0], [500.0], allow_extrapolation=True
    )
    assert out[0] == pytest.approx(10.0)
    assert any("extrapolation explicitly enabled" in n for n in notes)


def test_boundary_depths_are_inside_the_range():
    out, _ = interpolate_to_depths([0.0, 100.0], [20.0, 10.0], [0.0, 100.0])
    assert np.all(np.isfinite(out))


def test_float_roundoff_at_the_boundary_does_not_discard_a_valid_level():
    """A depth 2e-13 m beyond the deepest level is at that level, not outside it.

    This is the TEOS-10 round-trip artefact; excluding it would be a numerical
    bug reported as a scientific exclusion.
    """
    out, _ = interpolate_to_depths([0.0, 1000.0], [20.0, 4.0], [1000.0000000000002])
    assert np.isfinite(out[0])
    assert out[0] == pytest.approx(4.0)


def test_tolerance_cannot_mask_a_genuinely_out_of_range_depth():
    out, _ = interpolate_to_depths([0.0, 1000.0], [20.0, 4.0], [1000.01, 1001.0])
    assert np.all(np.isnan(out))


# ================================================ missing values


def test_nan_source_values_do_not_poison_neighbouring_interpolation():
    out, notes = interpolate_to_depths(
        [0.0, 10.0, 50.0, 100.0], [28.0, np.nan, 20.0, 15.0], [5.0, 75.0]
    )
    assert np.all(np.isfinite(out))
    assert any("non-finite" in n for n in notes)


def test_max_gap_refuses_to_interpolate_across_a_removed_level():
    """A QC-rejected level leaves a hole; interpolating across it must be refusable."""
    out, notes = interpolate_to_depths(
        [0.0, 10.0, 500.0], [28.0, 27.0, 5.0], [5.0, 250.0], max_gap_m=100.0
    )
    assert np.isfinite(out[0])       # inside a 10 m gap
    assert np.isnan(out[1])          # inside a 490 m gap
    assert any("gap wider" in n for n in notes)


def test_exact_hits_survive_the_gap_guard():
    out, _ = interpolate_to_depths(
        [0.0, 10.0, 500.0], [28.0, 27.0, 5.0], [500.0], max_gap_m=100.0
    )
    assert out[0] == pytest.approx(5.0)


def test_no_usable_source_levels_yields_all_nan():
    out, notes = interpolate_to_depths([np.nan, np.nan], [1.0, 2.0], [0.0, 10.0])
    assert np.all(np.isnan(out))
    assert any("no usable source levels" in n for n in notes)


def test_single_source_level_resolves_only_exact_hits():
    out, notes = interpolate_to_depths([10.0], [27.0], [10.0, 20.0])
    assert out[0] == pytest.approx(27.0)
    assert np.isnan(out[1])
    assert any("single source level" in n for n in notes)


def test_nan_target_depth_yields_nan():
    out, _ = interpolate_to_depths(MODEL_D, MODEL_V, [10.0, np.nan])
    assert np.isfinite(out[0]) and np.isnan(out[1])


# ================================================ duplicate depths


def test_duplicate_source_depths_are_averaged_and_reported():
    out, notes = interpolate_to_depths(
        [0.0, 10.0, 10.0, 50.0], [28.0, 26.0, 28.0, 20.0], [10.0]
    )
    assert out[0] == pytest.approx(27.0)
    assert any("duplicate source depth" in n for n in notes)


def test_unsorted_source_depths_are_handled():
    out, _ = interpolate_to_depths([100.0, 0.0, 50.0], [15.0, 28.0, 20.0], [25.0])
    assert out[0] == pytest.approx(24.0)


def test_duplicate_target_depths_collapse_to_one_comparison_depth():
    depths, _ = build_comparison_depths([10.0, 10.0, 50.0], MODEL_D)
    np.testing.assert_allclose(depths, [10.0, 50.0])


def test_mismatched_source_lengths_are_rejected():
    with pytest.raises(ValueError, match="mismatch"):
        interpolate_to_depths([0.0, 10.0], [1.0], [5.0])


# ================================================ comparison depth grid


def test_default_grid_is_the_observation_depths():
    depths, notes = build_comparison_depths([0.0, 10.0, 50.0], MODEL_D)
    np.testing.assert_allclose(depths, [0.0, 10.0, 50.0])
    assert any("QC-passed observation depths" in n for n in notes)


def test_grid_is_restricted_to_the_model_observation_overlap():
    depths, notes = build_comparison_depths([0.0, 10.0, 900.0], MODEL_D)
    np.testing.assert_allclose(depths, [0.0, 10.0])
    assert any("outside the observation/model overlap" in n for n in notes)


def test_explicit_grid_is_supported_and_recorded():
    depths, notes = build_comparison_depths([0.0, 100.0], MODEL_D, explicit_depths=[25.0, 75.0])
    np.testing.assert_allclose(depths, [25.0, 75.0])
    assert any("supplied explicitly" in n for n in notes)


def test_non_overlapping_ranges_produce_no_comparison_depths():
    depths, notes = build_comparison_depths([2000.0, 3000.0], MODEL_D)
    assert depths.size == 0
    assert any("does not" in n and "overlap" in n for n in notes)


def test_empty_observation_depths_produce_no_comparison_depths():
    depths, _ = build_comparison_depths([], MODEL_D)
    assert depths.size == 0


# ================================================ alignment


def test_alignment_returns_only_depths_valid_on_both_sides():
    aligned = align_profiles(
        observation_depths=[0.0, 10.0, 50.0, 900.0],
        observation_values=[28.1, 27.2, 20.4, 4.0],
        model_depths=MODEL_D,
        model_values=MODEL_V,
    )
    np.testing.assert_allclose(aligned.depths_m, [0.0, 10.0, 50.0])
    assert aligned.n_depths == 3
    assert np.all(np.isfinite(aligned.model_values))
    assert np.all(np.isfinite(aligned.observation_values))


def test_observation_values_are_used_at_their_own_depths():
    obs_d, obs_v = [5.0, 25.0], [27.5, 23.5]
    aligned = align_profiles(obs_d, obs_v, MODEL_D, MODEL_V)
    np.testing.assert_allclose(aligned.observation_values, obs_v)


def test_model_is_interpolated_from_its_native_grid_to_the_comparison_depths():
    """Model native depths differ from observation depths; interpolation must run."""
    aligned = align_profiles([5.0], [27.5], [0.0, 10.0], [28.0, 27.0])
    assert aligned.model_values[0] == pytest.approx(27.5)
    assert 5.0 not in [0.0, 10.0]


def test_alignment_reports_candidate_and_final_depth_counts():
    aligned = align_profiles([0.0, 10.0, 900.0], [28.0, 27.0, 4.0], MODEL_D, MODEL_V)
    assert aligned.n_candidate_depths == 2
    assert aligned.n_depths == 2


def test_alignment_notes_explain_every_discard():
    aligned = align_profiles([0.0, 900.0], [28.0, 4.0], MODEL_D, MODEL_V)
    assert aligned.notes
    assert any("overlap" in n for n in aligned.notes)


def test_alignment_with_no_common_depths_returns_empty_not_zeros():
    aligned = align_profiles([2000.0], [4.0], MODEL_D, MODEL_V)
    assert aligned.n_depths == 0
    assert aligned.model_values.size == 0
    assert aligned.observation_values.size == 0


def test_alignment_never_pairs_a_value_against_a_missing_one():
    aligned = align_profiles(
        [0.0, 10.0, 50.0], [28.0, np.nan, 20.0], MODEL_D, MODEL_V
    )
    assert aligned.n_depths == 2
    np.testing.assert_allclose(aligned.depths_m, [0.0, 50.0])


def test_missing_observation_is_not_reconstructed_by_interpolation():
    """Regression: a depth whose observation is missing must leave the grid.

    Otherwise the interpolator fills the hole from the neighbouring levels
    (0 m and 50 m here would synthesise 24.0 at 10 m) and that invented value
    gets paired against the model as though it were measured.
    """
    aligned = align_profiles(
        [0.0, 10.0, 50.0], [28.0, np.nan, 20.0], MODEL_D, MODEL_V
    )
    assert 10.0 not in aligned.depths_m.tolist()
    assert 24.0 not in aligned.observation_values.tolist()
    assert any("no interpolation" in n for n in aligned.notes)


def test_grid_builder_rejects_mismatched_value_length():
    with pytest.raises(ValueError, match="mismatch"):
        build_comparison_depths([0.0, 10.0], MODEL_D, observation_values=[1.0])


def test_model_gap_leaves_depths_unpaired_rather_than_guessed():
    aligned = align_profiles([0.0, 300.0], [28.0, 8.0], [0.0, 10.0], [28.0, 27.0])
    np.testing.assert_allclose(aligned.depths_m, [0.0])
