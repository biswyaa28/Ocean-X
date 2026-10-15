"""Model TCHP / MLD versus float-derived TCHP / D26.

Covers the contract the API depends on:

* the 2D model fields are sampled through the SAME horizontal (bilinear, land
  renormalised) and temporal path as TEMP/SALN, so the residual is not
  confounded by different sampling;
* a missing measurement and a measurement of zero are reported differently;
* the time-gap guard withholds the TCHP residual exactly as it withholds the
  temperature residual;
* an unavailable matchup returns honest nulls rather than zeros.
"""

import pytest

from app.services.matchup_summary import summarize_matches
from app.services.model_observation_matchup import (
    _sample_2d_field,
    _unavailable_matchup,
    match_argo_with_hycom,
)
from app.services.ocean_heat_metrics import TCHP_DEFINITION_STATUS


def _some_profiles():
    from app.providers.argo_provider import argo_provider

    return argo_provider.get_profiles()


# --- 2D field sampling ------------------------------------------------------

def test_2d_fields_are_sampled_through_the_same_stencil_path():
    """TCHP and MLD must resolve like TEMP, using the same helper chain."""
    import xarray as xr

    from app.core.config import settings
    from app.services.matchup_interpolation import (
        bilinear_stencil,
        nearest_cell_index,
        time_bracket_weights,
    )

    runs = [p for p in settings.HYCOM_RAW_CANDIDATES if p.is_file()]
    if not runs:
        pytest.skip("no model files installed")
    dataset = xr.open_dataset(runs[0], engine="netcdf4", chunks={})
    try:
        for field in ("TCHP", "MLD"):
            assert field in dataset.variables, f"{field} missing from the model file"
            # Real files carry these with no vertical axis. A synthetic fixture
            # may repeat a 2D product along DEPTH, which the reader handles by
            # taking the surface level, so both shapes are accepted here.
            assert set(dataset[field].dims) <= {"TIME", "DEPTH", "LAT", "LON"}

        lats = dataset["LAT"].values
        lons = dataset["LON"].values
        lat = float(lats[len(lats) // 2])
        lon = float(lons[len(lons) // 2])
        stencil = bilinear_stencil(lats, lons, lat, lon)
        brackets = time_bracket_weights(dataset["TIME"].values, dataset["TIME"].values[0])

        for field in ("TCHP", "MLD"):
            value = _sample_2d_field(dataset, field, stencil, brackets)
            assert value is not None and value == value, f"{field} did not sample"

        # An absent field must return None rather than raising or guessing.
        assert _sample_2d_field(dataset, "NOT_A_FIELD", stencil, brackets) is None
    finally:
        dataset.close()


def test_live_matchup_returns_model_tchp_and_mld():
    matched = 0
    for profile in _some_profiles():
        matchup = match_argo_with_hycom(profile["profile_id"])
        if matchup is None or matchup.get("statusMessage"):
            continue
        assert "tchpModelKjCm2" in matchup
        assert "mldModelM" in matchup
        assert matchup["tchpIsothermC"] == 26.0
        if matchup["tchpModelKjCm2"] is not None:
            assert matchup["tchpModelKjCm2"] >= 0.0
            matched += 1
    assert matched > 0, "no live profile produced a model TCHP"


# --- zero vs missing -------------------------------------------------------

def test_surface_below_26c_gives_zero_tchp_not_a_missing_value():
    """A float with no warm layer has a REAL TCHP of zero."""
    from app.services.ocean_heat_metrics import compute_ocean_heat_metrics

    result = compute_ocean_heat_metrics([
        {"depth_m": 1.0, "temperature_c": 24.0},
        {"depth_m": 10.0, "temperature_c": 23.0},
    ])
    assert result["tchpKjCm2"] == 0.0
    assert result["status"] == "SURFACE_BELOW_ISOTHERM"


def test_unavailable_matchup_reports_null_not_zero_for_every_heat_field():
    """The honest-zero rule must not be turned into an honest-zero bug.

    An unavailable matchup has no model value, so nothing may read as 0.0: a
    reader would subtract a real number from nothing.
    """
    result = _unavailable_matchup(
        "profile", {"float_id": "float"}, 0, "t", 1.0, 2.0, "UNAVAILABLE", "no match"
    )
    for field in (
        "tchpFloatKjCm2", "tchpModelKjCm2", "tchpResidualKjCm2",
        "tchpResidualPercent", "d26FloatM", "mldModelM",
    ):
        assert result[field] is None, f"{field} must be None, not 0"
    assert result["metricsStatus"] == "MODEL_DATA_UNAVAILABLE"
    assert result["metricsReason"]


def test_a_real_matchup_is_not_silently_nulled():
    """Regression guard.

    The unavailable response and the real response share most of their keys.
    A careless edit that leaves the null block in the real path would report
    "no heat metric available" for every float while the temperature comparison
    still worked, which is exactly the sort of quiet failure this asserts
    against.
    """
    checked = 0
    for profile in _some_profiles():
        matchup = match_argo_with_hycom(profile["profile_id"])
        if matchup is None or matchup.get("statusMessage"):
            continue
        if matchup["tchpModelKjCm2"] is None:
            continue
        # A matched profile must never wear the unavailable status.
        assert matchup["metricsStatus"] != "MODEL_DATA_UNAVAILABLE", (
            "a matched profile must not report the unavailable metrics status"
        )
        # The float side may legitimately be absent (no warm layer, shallowest
        # sample too deep, no finite temperature). When it IS present the
        # residual must be present too, unless the model field itself is absent.
        if matchup["tchpFloatKjCm2"] is None:
            # The time-gap guard takes precedence over the float-side reason,
            # because it is the primary reason no residual can be produced; the
            # float reason is appended to the message rather than discarded.
            assert matchup["metricsStatus"] in (
                "FLOAT_METRICS_UNAVAILABLE", "TIME_GAP_TOO_LARGE"
            ), f"unexpected status {matchup['metricsStatus']}"
            assert matchup["metricsReason"], "a refused float metric must say why"
            continue
        if matchup["metricsStatus"] == "MODEL_FIELD_UNAVAILABLE":
            assert matchup["tchpResidualKjCm2"] is None
            assert matchup["metricsReason"]
            continue
        # The time-gap guard withholds the heat residual exactly as it withholds
        # the temperature residual, so a real float TCHP may legitimately sit
        # beside a null residual.
        if matchup["metricsStatus"] == "TIME_GAP_TOO_LARGE":
            assert matchup["statisticsSuppressed"] is True
            assert matchup["tchpResidualKjCm2"] is None
            continue
        assert matchup["tchpResidualKjCm2"] is not None
        checked += 1
    if checked == 0:
        # The offline fixture window is 7 time steps and does not cover these
        # float times, so every profile lands in TIME_GAP_TOO_LARGE and the
        # guard cannot be exercised. That is the guard working, not a failure.
        pytest.skip("no profile in this data set has both a float and a model TCHP")


def test_residual_percent_is_never_computed_against_zero():
    """A float TCHP of 0.0 is a real measurement, so the percent is withheld."""
    from app.api.endpoints import get_argo_matchup_summary

    summary = get_argo_matchup_summary()
    for row in summary.get("tchpProfiles", []):
        if row["tchpFloatKjCm2"] == 0.0:
            assert row["tchpResidualPercent"] is None


# --- the time-gap guard ----------------------------------------------------

def test_time_gap_guard_withholds_the_tchp_residual():
    """A residual across two different ocean states is not model error."""
    from app.core.config import settings

    if not [p for p in settings.HYCOM_RAW_CANDIDATES if p.is_file()]:
        pytest.skip("no model files installed")

    # The curated offline fallback profiles sit a month from the archived runs,
    # so they are the natural "too_large" case when installed.
    results = [
        match_argo_with_hycom(profile["profile_id"])
        for profile in _some_profiles()
    ]
    results = [r for r in results if r and not r.get("statusMessage")]
    too_large = [r for r in results if r["timeGapStatus"] == "too_large"]
    for result in too_large:
        assert result["statisticsSuppressed"] is True
        assert result["tchpResidualKjCm2"] is None
        assert result["tchpResidualPercent"] is None
        assert result["metricsStatus"] == "TIME_GAP_TOO_LARGE"
    if not too_large:
        pytest.skip("no profile in this data set has a too_large time gap")


# --- regional summary ------------------------------------------------------

def test_summary_reports_tchp_counts_mean_median_and_rmse():
    from app.api.endpoints import get_argo_matchup_summary

    summary = get_argo_matchup_summary()
    tchp = summary["tchp"]
    assert "n" in tchp and "bias" in tchp and "rmse" in tchp
    assert "medianBias" in tchp
    if tchp["n"] == 0:
        assert tchp["bias"] is None and tchp["medianBias"] is None
        assert summary["tchpScatter"] == []
    else:
        assert tchp["bias"] is not None
        assert tchp["medianBias"] is not None
        # A median must lie between the minimum and maximum residual.
        residuals = [row["residualKjCm2"] for row in summary["tchpScatter"]]
        assert min(residuals) <= tchp["medianBias"] <= max(residuals)
        # Every scatter point needs both sides to be a real point on a plot.
        for point in summary["tchpScatter"]:
            assert point["tchpFloatKjCm2"] is not None
            assert point["tchpModelKjCm2"] is not None


def test_scatter_has_at_most_one_point_per_profile():
    """One profile must not appear twice on the scatter."""
    from app.api.endpoints import get_argo_matchup_summary

    summary = get_argo_matchup_summary()
    ids = [point["profileId"] for point in summary["tchpScatter"]]
    assert len(ids) == len(set(ids))


def test_summary_passes_the_unpublished_definition_to_the_client():
    from app.api.endpoints import get_argo_matchup_summary

    summary = get_argo_matchup_summary()
    assert summary["tchpDefinitionStatus"] == TCHP_DEFINITION_STATUS
    assert summary["tchpIsothermC"] == 26.0
    assert summary["tchpRuleOfThumbKJPerCm2"] > 0


def test_summarize_matches_never_invents_a_tchp():
    """A match with no heat fields must yield no heat statistics."""
    summary = summarize_matches([{"profileId": "p", "comparisons": []}])
    assert summary["tchp"]["n"] == 0
    assert summary["tchp"]["bias"] is None
    assert summary["tchp"]["medianBias"] is None
    assert summary["tchpScatter"] == []