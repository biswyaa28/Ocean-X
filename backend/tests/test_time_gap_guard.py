"""Observation-model time-gap guard.

A residual is only meaningful when the observation and the model sample are
close in time. This suite pins the three classifications, their boundaries, the
suppression of residual statistics when the gap is too large, and the
multi-run selection that keeps the gap small in the first place.
"""

import numpy as np
import pytest
import xarray as xr

from app.core.config import settings
from app.providers.argo_provider import argo_provider
from app.services.model_observation_matchup import (
    _run_time_gap_hours,
    classify_time_gap,
    match_argo_with_hycom,
)

GOOD_H = settings.MATCHUP_TIME_GAP_GOOD_H
MAX_H = settings.MATCHUP_TIME_GAP_MAX_H


# --- documented configuration ----------------------------------------------

def test_time_gap_thresholds_are_configurable_and_default_to_24_and_72():
    assert GOOD_H == 24.0
    assert MAX_H == 72.0


# --- classification ---------------------------------------------------------

@pytest.mark.parametrize("gap", [0.0, 0.5, 6.0, 23.99, 24.0])
def test_good_up_to_and_including_the_good_threshold(gap):
    status, reason = classify_time_gap(gap)
    assert status == "good"
    assert reason is None


@pytest.mark.parametrize("gap", [24.01, 30.0, 71.99, 72.0])
def test_marginal_above_good_and_up_to_the_maximum(gap):
    status, reason = classify_time_gap(gap)
    assert status == "marginal"
    assert reason is None


@pytest.mark.parametrize("gap", [72.01, 100.0, 698.75, 8760.0])
def test_too_large_beyond_the_maximum_with_a_reason(gap):
    status, reason = classify_time_gap(gap)
    assert status == "too_large"
    # A reason string is mandatory: the caller must be able to explain why no
    # residual statistic was produced.
    assert isinstance(reason, str) and "Time gap too large" in reason


def test_boundaries_are_inclusive_at_exactly_the_thresholds():
    assert classify_time_gap(GOOD_H)[0] == "good"
    assert classify_time_gap(MAX_H)[0] == "marginal"
    assert classify_time_gap(np.nextafter(GOOD_H, np.inf))[0] == "marginal"
    assert classify_time_gap(np.nextafter(MAX_H, np.inf))[0] == "too_large"


def test_negative_gap_is_treated_by_magnitude():
    assert classify_time_gap(-3.0)[0] == "good"
    assert classify_time_gap(-100.0)[0] == "too_large"


@pytest.mark.parametrize("gap", [None, float("nan"), float("inf")])
def test_unknown_gap_is_never_treated_as_valid(gap):
    status, reason = classify_time_gap(gap)
    assert status == "too_large"
    assert reason


# --- run scoring ------------------------------------------------------------

def _dataset(times):
    return xr.Dataset(coords={"TIME": np.array(times, dtype="datetime64[ns]")})


def test_observation_inside_the_window_scores_zero_gap():
    ds = _dataset(["2026-10-07T00:00", "2026-10-08T00:00", "2026-10-09T00:00"])
    gap, lead = _run_time_gap_hours(ds, np.datetime64("2026-10-08T06:00"))
    assert gap == 0.0
    assert lead == pytest.approx(30.0)


def test_observation_outside_the_window_scores_the_distance_to_the_nearer_edge():
    ds = _dataset(["2026-10-07T00:00", "2026-10-08T00:00"])
    gap, _ = _run_time_gap_hours(ds, np.datetime64("2026-10-08T12:00"))
    assert gap == pytest.approx(12.0)


def test_shorter_lead_time_wins_a_tie():
    """Consecutive daily runs all cover an observation; the freshest wins."""
    older = _dataset(["2026-10-03T06:00", "2026-10-04T06:00"])
    newer = _dataset(["2026-10-07T06:00", "2026-10-08T06:00"])
    target = np.datetime64("2026-10-07T20:00")
    assert _run_time_gap_hours(newer, target)[1] < _run_time_gap_hours(older, target)[1]


def test_missing_time_coordinate_is_unscoreable():
    gap, lead = _run_time_gap_hours(xr.Dataset(), np.datetime64("2026-10-07T20:00"))
    assert gap == float("inf") and lead == float("inf")


# --- end-to-end suppression -------------------------------------------------

def _profile_ids():
    return [profile["profile_id"] for profile in argo_provider.get_profiles()]


def test_too_large_gap_returns_profiles_but_no_residual_statistics(monkeypatch):
    profile_id = _profile_ids()[0]
    original = match_argo_with_hycom

    matchup = original(profile_id)
    assert matchup is not None

    # Force the guard by classifying a large gap on a real matchup.
    monkeypatch.setattr(
        "app.services.model_observation_matchup.classify_time_gap",
        lambda gap: classify_time_gap(900.0),
    )
    suppressed = original(profile_id)

    assert suppressed["timeGapStatus"] == "too_large"
    assert suppressed["statisticsSuppressed"] is True
    assert "Time gap too large" in suppressed["timeGapReason"]
    # Profiles are still returned - only the statistics are withheld.
    assert suppressed["comparisons"], "profiles must still be returned"
    assert suppressed["matchedPointCount"] > 0
    for variable in ("temperature", "salinity"):
        stats = suppressed["statistics"][variable]
        assert stats["n"] == 0
        assert stats["meanResidual"] is None
        assert stats["mae"] is None
        assert stats["rmse"] is None


def test_real_ingested_profiles_have_a_small_time_gap():
    """The archived runs and the re-fetched Argo window must actually overlap."""
    from conftest import real_hycom_available

    if not real_hycom_available():
        pytest.skip(
            "Real HYCOM data is not under test: the synthetic fixture is dated "
            "September 2026 while the ingested Argo profiles are October 2026, so "
            "the time-gap guard legitimately reports 'too_large'."
        )
    statuses = set()
    for profile_id in _profile_ids()[:5]:
        matchup = match_argo_with_hycom(profile_id)
        assert matchup is not None
        assert matchup["modelRun"], "a model run must be selected"
        statuses.add(matchup["timeGapStatus"])
        assert matchup["timeGapStatus"] in ("good", "marginal")

    # At least one profile must fall inside the routine window.
    assert "good" in statuses


def test_every_candidate_run_is_reported_with_its_gap_and_lead():
    matchup = match_argo_with_hycom(_profile_ids()[0])
    runs = matchup["availableModelRuns"]
    assert runs
    for entry in runs:
        assert {"run", "timeGapHours", "leadHours"} <= set(entry)
    # The selected run must be the best-scoring one.
    selected = next(r for r in runs if r["run"] == matchup["modelRun"])
    best = min(runs, key=lambda r: (r["timeGapHours"], r["leadHours"]))
    assert selected["run"] == best["run"]
