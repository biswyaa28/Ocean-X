import math

import pytest

from app.services.matchup_statistics import calculate_matchup_statistics


def test_calculates_temperature_statistics_from_finite_pairs():
    comparisons = [
        {"argoTemperatureC": 10.0, "modelTemperatureC": 12.0},
        {"argoTemperatureC": 11.0, "modelTemperatureC": 10.0},
        {"argoTemperatureC": 7.0, "modelTemperatureC": 10.0},
    ]

    result = calculate_matchup_statistics(comparisons, "temperature")

    assert result == {
        "n": 3,
        "meanResidual": pytest.approx(4 / 3),
        "mae": pytest.approx(2.0),
        "rmse": pytest.approx(math.sqrt(14 / 3)),
    }


def test_calculates_salinity_statistics_with_signed_residuals():
    comparisons = [
        {"argoSalinityPSU": 34.0, "modelSalinityPSU": 35.0},
        {"argoSalinityPSU": 35.0, "modelSalinityPSU": 33.0},
    ]

    result = calculate_matchup_statistics(comparisons, "salinity")

    assert result["n"] == 2
    assert result["meanResidual"] == pytest.approx(-0.5)
    assert result["mae"] == pytest.approx(1.5)
    assert result["rmse"] == pytest.approx(math.sqrt(2.5))


@pytest.mark.parametrize(
    ("argo_key", "model_key"),
    [
        ("argoTemperatureC", "modelTemperatureC"),
        ("argoSalinityPSU", "modelSalinityPSU"),
    ],
)
def test_excludes_null_nan_and_infinite_pairs(argo_key, model_key):
    comparisons = [
        {argo_key: 1.0, model_key: 3.0},
        {argo_key: None, model_key: 4.0},
        {argo_key: 2.0, model_key: None},
        {argo_key: math.nan, model_key: 4.0},
        {argo_key: 2.0, model_key: math.inf},
    ]

    result = calculate_matchup_statistics(
        comparisons,
        "temperature" if "Temperature" in argo_key else "salinity",
    )

    assert result["n"] == 1
    assert result["meanResidual"] == pytest.approx(2.0)
    assert result["mae"] == pytest.approx(2.0)
    assert result["rmse"] == pytest.approx(2.0)


def test_duplicate_model_depths_remain_separate_pairs():
    comparisons = [
        {
            "argoTemperatureC": 10.0,
            "modelTemperatureC": 12.0,
            "matchedModelDepthM": 10.0,
        },
        {
            "argoTemperatureC": 11.0,
            "modelTemperatureC": 12.0,
            "matchedModelDepthM": 10.0,
        },
    ]

    assert calculate_matchup_statistics(comparisons, "temperature")["n"] == 2


def test_prefers_unrounded_backend_residual_when_available():
    result = calculate_matchup_statistics(
        [
            {
                "argoTemperatureC": 10.12,
                "modelTemperatureC": 10.46,
                "_temperatureResidualRaw": 0.341234,
            }
        ],
        "temperature",
    )

    assert result["meanResidual"] == pytest.approx(0.341234)


def test_empty_and_single_pair_statistics_are_explicit():
    empty = calculate_matchup_statistics([], "temperature")
    single = calculate_matchup_statistics(
        [{"argoTemperatureC": 10.0, "modelTemperatureC": 12.5}],
        "temperature",
    )

    assert empty == {"n": 0, "meanResidual": None, "mae": None, "rmse": None}
    assert single == {
        "n": 1,
        "meanResidual": pytest.approx(2.5),
        "mae": pytest.approx(2.5),
        "rmse": pytest.approx(2.5),
    }
