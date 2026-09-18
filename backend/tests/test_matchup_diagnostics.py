"""Phase 2C: neutral matchup diagnostic-context tests.

These validate counting/metadata reductions over the accepted Phase 2A
comparison rows and the authoritative Argo observation list. They assert that
no quality score, grade, acceptance decision or threshold judgement is
produced - only counts, maxima and matching-methodology flags.
"""

import math

import pytest

from app.services.matchup_diagnostics import build_matchup_diagnostics


def test_matched_observation_count_is_the_comparison_row_count():
    rows = [
        {"depthM": 0.0, "matchedModelDepthM": 0.0},
        {"depthM": 10.0, "matchedModelDepthM": 10.0},
        {"depthM": 25.0, "matchedModelDepthM": 10.0},
    ]

    result = build_matchup_diagnostics(9, rows)

    assert result["matchedObservationCount"] == 3
    assert result["totalArgoObservations"] == 9


def test_unmatched_observation_count_uses_the_authoritative_total():
    result = build_matchup_diagnostics(9, [{"depthM": 0.0, "matchedModelDepthM": 0.0}])

    assert result["totalArgoObservations"] == 9
    assert result["matchedObservationCount"] == 1
    assert result["unmatchedObservationCount"] == 8


def test_matched_percentage_is_matched_over_total():
    result = build_matchup_diagnostics(8, [{"depthM": 0.0, "matchedModelDepthM": 0.0}] * 7)

    assert result["matchedPercentage"] == pytest.approx(87.5)


def test_no_denominator_means_no_invented_percentage():
    result = build_matchup_diagnostics(0, [])

    assert result["totalArgoObservations"] == 0
    assert result["matchedObservationCount"] == 0
    assert result["unmatchedObservationCount"] == 0
    assert result["matchedPercentage"] is None


def test_repeated_native_model_depths_remain_separate_matched_observations():
    rows = [
        {"depthM": 10.0, "matchedModelDepthM": 10.0},
        {"depthM": 25.0, "matchedModelDepthM": 10.0},
        {"depthM": 50.0, "matchedModelDepthM": 50.0},
    ]

    result = build_matchup_diagnostics(3, rows)

    # Two observations matched the same native HYCOM level: counted separately.
    assert result["matchedObservationCount"] == 3
    assert result["repeatedNativeDepthMatchCount"] == 1
    assert [row["matchedModelDepthM"] for row in rows] == [10.0, 10.0, 50.0]


def test_deepest_depths_are_maxima_of_matched_rows_only():
    rows = [
        {"depthM": 100.0, "matchedModelDepthM": 100.0},
        {"depthM": 250.0, "matchedModelDepthM": 250.0},
    ]

    result = build_matchup_diagnostics(9, rows)

    assert result["deepestMatchedObservationDepthM"] == 250.0
    assert result["deepestMatchedModelDepthM"] == 250.0


def test_missing_depths_report_none_and_never_zero():
    result = build_matchup_diagnostics(3, [])

    assert result["deepestMatchedObservationDepthM"] is None
    assert result["deepestMatchedModelDepthM"] is None
    assert result["repeatedNativeDepthMatchCount"] == 0
    assert result["matchedObservationCount"] == 0
    assert result["unmatchedObservationCount"] == 3


@pytest.mark.parametrize("unavailable", [None, math.nan, math.inf, "10.0"])
def test_non_finite_or_non_numeric_depths_are_not_counted(unavailable):
    result = build_matchup_diagnostics(1, [{"depthM": unavailable, "matchedModelDepthM": unavailable}])

    assert result["deepestMatchedObservationDepthM"] is None
    assert result["deepestMatchedModelDepthM"] is None
    assert result["repeatedNativeDepthMatchCount"] == 0


def test_no_interpolation_is_reported_and_no_quality_score_is_produced():
    result = build_matchup_diagnostics(2, [{"depthM": 0.0, "matchedModelDepthM": 0.0}])

    assert result["interpolationApplied"] is False
    # The payload is counts/metadata only: no score, grade or verdict field.
    assert set(result) == {
        "totalArgoObservations",
        "matchedObservationCount",
        "unmatchedObservationCount",
        "matchedPercentage",
        "deepestMatchedObservationDepthM",
        "deepestMatchedModelDepthM",
        "repeatedNativeDepthMatchCount",
        "interpolationApplied",
    }
