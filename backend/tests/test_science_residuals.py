"""Tests K, L, M, N: residual calculation and metrics
(STEP 3B §16, §17; §24.K–N)."""
import math

import numpy as np
import pytest

from app.science.residuals import (
    RESIDUAL_DEFINITION,
    RESIDUAL_LABEL,
    calculate_metrics,
    calculate_residuals,
)

DEPTHS = [0.0, 10.0, 50.0, 100.0]
MODEL = [28.5, 27.5, 20.5, 15.5]
OBS = [28.0, 27.0, 20.0, 15.0]


# ================================================ K. residual calculation


def test_residual_is_model_minus_observation():
    r = calculate_residuals(DEPTHS, MODEL, OBS)
    np.testing.assert_allclose(r.residuals, [0.5, 0.5, 0.5, 0.5])


def test_residual_sign_convention_model_colder_gives_negative():
    r = calculate_residuals([0.0], [19.0], [20.0])
    assert r.residuals[0] == pytest.approx(-1.0)


def test_residual_sign_convention_model_warmer_gives_positive():
    r = calculate_residuals([0.0], [21.0], [20.0])
    assert r.residuals[0] == pytest.approx(1.0)


def test_residual_is_not_observation_minus_model():
    """Guards against the sign convention being flipped."""
    r = calculate_residuals([0.0], [25.0], [20.0])
    assert r.residuals[0] == pytest.approx(5.0)
    assert r.residuals[0] != pytest.approx(-5.0)


def test_residual_label_is_analysis_observation_residual():
    r = calculate_residuals(DEPTHS, MODEL, OBS)
    assert r.label == RESIDUAL_LABEL == "Analysis–Observation Residual"
    assert r.definition == RESIDUAL_DEFINITION


def test_residual_terminology_is_never_model_error():
    for text in (RESIDUAL_LABEL, RESIDUAL_DEFINITION):
        assert "model error" not in text.lower()
        assert "error" not in text.lower()


def test_one_record_per_valid_comparison_depth():
    records = calculate_residuals(DEPTHS, MODEL, OBS).records()
    assert len(records) == 4
    for rec in records:
        assert set(rec) == {"depth_m", "model", "observation", "residual"}
        assert rec["residual"] == pytest.approx(rec["model"] - rec["observation"])


def test_missing_model_value_is_dropped_not_zero_filled():
    r = calculate_residuals([0.0, 10.0], [np.nan, 27.5], [28.0, 27.0])
    assert r.n == 1
    assert r.n_unpaired_discarded == 1
    np.testing.assert_allclose(r.depths_m, [10.0])
    assert 0.0 not in r.residuals.tolist()


def test_missing_observation_value_is_dropped_not_zero_filled():
    r = calculate_residuals([0.0, 10.0], [28.5, 27.5], [np.nan, 27.0])
    assert r.n == 1
    np.testing.assert_allclose(r.residuals, [0.5])


def test_no_residual_is_created_against_a_missing_observation():
    r = calculate_residuals([0.0], [28.5], [np.nan])
    assert r.n == 0
    assert r.residuals.size == 0


def test_nan_is_never_converted_to_zero_anywhere():
    r = calculate_residuals([0.0, 10.0, 50.0], [np.nan, 27.5, np.nan], [28.0, 27.0, 20.0])
    assert r.n == 1
    assert not np.any(r.residuals == 0.0)
    assert np.all(np.isfinite(r.residuals))


def test_discards_are_reported_in_notes():
    r = calculate_residuals([0.0, 10.0], [np.nan, 27.5], [28.0, 27.0])
    assert any("missing" in n for n in r.notes)


def test_length_mismatch_is_rejected():
    with pytest.raises(ValueError, match="mismatch"):
        calculate_residuals([0.0, 10.0], [1.0], [1.0, 2.0])


def test_empty_input_produces_no_residuals():
    r = calculate_residuals([], [], [])
    assert r.n == 0


# ================================================ L, M, N. metrics


def test_bias_is_the_mean_residual():
    m = calculate_metrics([1.0, -1.0, 2.0, 0.0])
    assert m.bias == pytest.approx(0.5)


def test_bias_can_be_negative():
    assert calculate_metrics([-1.0, -3.0]).bias == pytest.approx(-2.0)


def test_mae_is_the_mean_absolute_residual():
    m = calculate_metrics([1.0, -1.0, 2.0, 0.0])
    assert m.mae == pytest.approx(1.0)


def test_mae_is_never_negative():
    assert calculate_metrics([-5.0, -3.0]).mae == pytest.approx(4.0)


def test_rmse_matches_the_closed_form():
    residuals = [1.0, -1.0, 2.0, 0.0]
    expected = math.sqrt(sum(r * r for r in residuals) / len(residuals))
    assert calculate_metrics(residuals).rmse == pytest.approx(expected)


def test_rmse_is_greater_than_or_equal_to_mae():
    m = calculate_metrics([0.5, -2.0, 3.0, 1.0])
    assert m.rmse >= m.mae


def test_rmse_equals_mae_for_constant_magnitude_residuals():
    m = calculate_metrics([2.0, -2.0, 2.0])
    assert m.rmse == pytest.approx(m.mae)


def test_metrics_are_exactly_zero_for_perfect_agreement():
    """Zero here is a real measurement of agreement, not a placeholder."""
    m = calculate_metrics([0.0, 0.0, 0.0])
    assert m.n == 3
    assert m.bias == 0.0 and m.mae == 0.0 and m.rmse == 0.0


def test_max_absolute_residual_and_its_depth():
    m = calculate_metrics([0.5, -3.5, 1.0], [0.0, 50.0, 100.0])
    assert m.max_abs_residual == pytest.approx(3.5)
    assert m.max_residual_depth_m == pytest.approx(50.0)


def test_max_uses_absolute_value_so_negatives_can_win():
    m = calculate_metrics([1.0, -9.0], [0.0, 10.0])
    assert m.max_abs_residual == pytest.approx(9.0)
    assert m.max_residual_depth_m == pytest.approx(10.0)


def test_sample_count_is_returned():
    assert calculate_metrics([1.0, 2.0, 3.0]).n == 3


def test_no_valid_pairs_gives_null_metrics_not_zero():
    """Zero would assert perfect agreement where there is no evidence at all."""
    m = calculate_metrics([])
    assert m.n == 0
    assert m.bias is None
    assert m.mae is None
    assert m.rmse is None
    assert m.max_abs_residual is None
    assert m.max_residual_depth_m is None


def test_all_nan_residuals_give_null_metrics():
    m = calculate_metrics([np.nan, np.nan])
    assert m.n == 0 and m.bias is None and m.rmse is None


def test_nan_residuals_are_excluded_from_statistics():
    m = calculate_metrics([2.0, np.nan, 4.0])
    assert m.n == 2
    assert m.bias == pytest.approx(3.0)


def test_depths_stay_aligned_when_nan_residuals_are_dropped():
    m = calculate_metrics([1.0, np.nan, 5.0], [0.0, 50.0, 100.0])
    assert m.max_residual_depth_m == pytest.approx(100.0)


def test_very_small_sample_size_of_one_is_valid():
    m = calculate_metrics([2.0], [10.0])
    assert m.n == 1
    assert m.bias == pytest.approx(2.0)
    assert m.mae == pytest.approx(2.0)
    assert m.rmse == pytest.approx(2.0)
    assert m.max_residual_depth_m == pytest.approx(10.0)


def test_metric_definitions_are_published_with_the_result():
    d = calculate_metrics([1.0]).definitions
    assert d["bias"] == "mean(M - O)"
    assert d["mae"] == "mean(|M - O|)"
    assert d["rmse"] == "sqrt(mean((M - O)^2))"
    assert d["residual"] == RESIDUAL_DEFINITION


def test_metrics_length_mismatch_is_rejected():
    with pytest.raises(ValueError, match="mismatch"):
        calculate_metrics([1.0, 2.0], [0.0])


def test_depths_are_optional():
    m = calculate_metrics([1.0, 2.0])
    assert m.max_abs_residual == pytest.approx(2.0)
    assert m.max_residual_depth_m is None


def test_metrics_over_a_full_residual_series_match_manual_computation():
    r = calculate_residuals(DEPTHS, [28.5, 26.0, 21.0, 15.0], OBS)
    m = calculate_metrics(r.residuals, r.depths_m)
    expected = np.array([0.5, -1.0, 1.0, 0.0])
    assert m.n == 4
    assert m.bias == pytest.approx(expected.mean())
    assert m.mae == pytest.approx(np.abs(expected).mean())
    assert m.rmse == pytest.approx(math.sqrt((expected**2).mean()))
