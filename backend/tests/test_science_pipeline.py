"""Tests O, P: provenance completeness and end-to-end comparison
(STEP 3B §18, §21, §22, §24.O–P, edge cases)."""
import numpy as np
import pytest

from app.data.argo_repository import argo_repository
from app.datasources import get_model_data_source
from app.science.colocation import REJECT_TEMPORAL_TOLERANCE
from app.science.pipeline import (
    FAILURE_NO_COMPARISON_DEPTHS,
    FAILURE_NO_MODEL_MATCH,
    FAILURE_NO_OBSERVATIONS,
    FAILURE_VARIABLE_UNAVAILABLE,
    compare_profile,
    sample_model_profile,
)
from app.science.residuals import RESIDUAL_LABEL
from tests.conftest import StubModelDataSource, make_profile, utc

# Every required provenance field from STEP 3B §18.
REQUIRED_PROVENANCE_FIELDS = [
    "dataset_id",
    "dataset_version",
    "model",
    "model_version",
    "model_variable_name",
    "observation_id",
    "observation_cycle_number",
    "observation_time",
    "model_time",
    "latitude",
    "longitude",
    "model_latitude",
    "model_longitude",
    "spatial_match_method",
    "spatial_distance_km",
    "temporal_match_method",
    "temporal_difference_hours",
    "vertical_alignment_method",
    "depth_reference",
    "source_temperature_field",
    "adjusted_selection",
    "argo_data_mode",
    "argo_qc",
    "n_observations_before_qc",
    "n_observations_after_qc",
    "n_excluded_observations",
    "excluded_observations",
    "n_comparison_depths",
    "variable_units",
    "processing_notes",
]


@pytest.fixture
def real_profile():
    return argo_repository.get_raw_profile("2902641")


@pytest.fixture
def fixture_source():
    return get_model_data_source("fixture")


# ================================================ O. provenance completeness


def test_every_required_provenance_field_is_present(real_profile, fixture_source):
    prov = compare_profile(real_profile, fixture_source, "temperature").provenance
    missing = [f for f in REQUIRED_PROVENANCE_FIELDS if f not in prov]
    assert not missing, f"provenance missing required fields: {missing}"


def test_required_provenance_fields_are_not_none_for_a_valid_comparison(
    real_profile, fixture_source
):
    prov = compare_profile(real_profile, fixture_source, "temperature").provenance
    nulls = [f for f in REQUIRED_PROVENANCE_FIELDS if prov.get(f) is None]
    assert not nulls, f"provenance fields unexpectedly null: {nulls}"


def test_provenance_reports_the_actual_model_variable_name(real_profile, fixture_source):
    prov = compare_profile(real_profile, fixture_source, "temperature").provenance
    assert prov["model_variable_name"] == "thetao"
    assert "thetao" in prov["model_variable_candidates_tried"]


def test_provenance_records_the_matching_methods(real_profile, fixture_source):
    prov = compare_profile(real_profile, fixture_source, "temperature").provenance
    assert prov["spatial_match_method"] == "nearest_grid_cell"
    assert prov["temporal_match_method"] == "nearest_timestamp"
    assert prov["vertical_alignment_method"] == "linear_interpolation"
    assert prov["depth_reference"] == "meters"


def test_provenance_records_teos10_depth_conversion(real_profile, fixture_source):
    prov = compare_profile(real_profile, fixture_source, "temperature").provenance
    assert "z_from_p" in prov["depth_conversion_method"]
    assert "z_from_p" in prov["depth_reference_note"]


def test_provenance_records_adjusted_selection_and_source_field(
    real_profile, fixture_source
):
    prov = compare_profile(real_profile, fixture_source, "temperature").provenance
    assert prov["adjusted_selection"] == "adjusted"
    assert prov["source_temperature_field"] == "TEMPERATURE_ADJUSTED"
    assert prov["source_pressure_field"] in ("PRES", "PRES_ADJUSTED")


def test_provenance_records_data_mode(real_profile, fixture_source):
    prov = compare_profile(real_profile, fixture_source, "temperature").provenance
    assert prov["argo_data_mode_code"] == "D"
    assert "Delayed" in prov["argo_data_mode"]


def test_provenance_records_qc_policy_and_counts(fixture_source):
    raw = argo_repository.get_raw_profile("1901452")
    prov = compare_profile(raw, fixture_source, "temperature").provenance
    assert prov["qc_policy"]["acceptable_flags"] == [1, 2]
    assert prov["n_observations_before_qc"] == 13
    assert prov["n_observations_after_qc"] == 12
    assert prov["n_excluded_observations"] == 1
    assert prov["qc_flag_histogram"] == {"1": 12, "3": 1}


def test_provenance_lists_each_excluded_observation_with_a_reason(fixture_source):
    raw = argo_repository.get_raw_profile("1901452")
    prov = compare_profile(raw, fixture_source, "temperature").provenance
    excluded = prov["excluded_observations"]
    assert len(excluded) == 1
    assert excluded[0]["reason"] == "value_qc_rejected"
    assert "QC=3" in excluded[0]["detail"]
    assert excluded[0]["pressure_dbar"] is not None


def test_provenance_marks_fixture_runs_as_fixture(real_profile, fixture_source):
    prov = compare_profile(real_profile, fixture_source, "temperature").provenance
    assert prov["data_tier"] == "local_deterministic_fixture"
    assert "FIXTURE RUN" in prov["processing_notes"]


def test_provenance_never_uses_model_error_terminology(real_profile, fixture_source):
    prov = compare_profile(real_profile, fixture_source, "temperature").provenance
    blob = " ".join(str(v) for v in prov.values()).lower()
    assert "model error" not in blob
    assert prov["residual_label"] == RESIDUAL_LABEL


def test_provenance_reports_units_explicitly(real_profile, fixture_source):
    prov = compare_profile(real_profile, fixture_source, "temperature").provenance
    assert prov["variable_units"] == "degC"
    assert prov["observation_units_declared"] == "degC"


def test_unavailable_metadata_is_null_not_invented(fixture_source):
    """A profile with no data centre must report null, not a plausible guess."""
    prof = make_profile(depths_m=[0.0, 10.0, 50.0], temperature=[28.0, 27.0, 20.0])
    prov = compare_profile(prof, fixture_source, "temperature").provenance
    assert prov["observation_data_centre"] is None
    assert prov["qc_flags_available"] is False


def test_provenance_records_comparison_depth_counts(real_profile, fixture_source):
    result = compare_profile(real_profile, fixture_source, "temperature")
    prov = result.provenance
    assert prov["n_comparison_depths"] == result.metrics.n
    assert prov["n_candidate_comparison_depths"] >= prov["n_comparison_depths"]


# ================================================ P. end-to-end comparison


def test_end_to_end_comparison_on_fixture_data(real_profile, fixture_source):
    r = compare_profile(real_profile, fixture_source, "temperature")
    assert r.is_valid
    assert r.metrics.n == 13
    assert r.match.is_valid
    assert r.model_sample is not None
    assert r.residuals is not None
    assert r.provenance


def test_end_to_end_residual_equals_model_minus_observation(real_profile, fixture_source):
    r = compare_profile(real_profile, fixture_source, "temperature")
    np.testing.assert_array_equal(
        r.residuals.residuals,
        r.residuals.model_values - r.residuals.observation_values,
    )


def test_end_to_end_uses_the_colocated_model_time_not_a_ui_time(
    real_profile, fixture_source
):
    """§15: the model must be sampled at the temporally matched timestamp."""
    r = compare_profile(real_profile, fixture_source, "temperature")
    assert r.model_sample.time == r.match.model_time
    assert r.model_sample.time_index == r.match.model_time_index
    assert r.provenance["model_time"] == r.match.model_time.isoformat()


def test_end_to_end_samples_the_matched_grid_cell(real_profile, fixture_source):
    r = compare_profile(real_profile, fixture_source, "temperature")
    assert r.model_sample.lat_index == r.match.model_lat_index
    assert r.model_sample.lon_index == r.match.model_lon_index
    assert r.model_sample.latitude == r.match.model_latitude


def test_end_to_end_excludes_the_qc_flagged_spike(fixture_source):
    """The 75 m level carries a +4.8 degC spike and QC=3; it must never be compared."""
    raw = argo_repository.get_raw_profile("1901452")
    r = compare_profile(raw, fixture_source, "temperature")
    assert r.metrics.n == 12
    assert not np.any(np.isclose(r.residuals.depths_m, 75.0, atol=1e-3))
    assert r.metrics.max_abs_residual < 1.0  # the 4.8 spike never reaches statistics


def test_end_to_end_off_grid_observation_depths_exercise_interpolation(fixture_source):
    """Profile 2903388 samples pressures that are off the model native depth grid."""
    raw = argo_repository.get_raw_profile("2903388")
    r = compare_profile(raw, fixture_source, "temperature")
    assert r.is_valid
    native = set(np.round(r.model_sample.depths_m, 6).tolist())
    compared = set(np.round(r.residuals.depths_m, 6).tolist())
    assert not compared.issubset(native), "no off-grid depth: interpolation not exercised"


def test_end_to_end_salinity_comparison_works(real_profile, fixture_source):
    r = compare_profile(real_profile, fixture_source, "salinity")
    assert r.is_valid
    assert r.units == "psu"
    assert r.provenance["model_variable_name"] == "so"


def test_end_to_end_is_deterministic(real_profile, fixture_source):
    a = compare_profile(real_profile, fixture_source, "temperature")
    b = compare_profile(real_profile, fixture_source, "temperature")
    np.testing.assert_array_equal(a.residuals.residuals, b.residuals.residuals)
    assert a.metrics.rmse == b.metrics.rmse


# ================================================ edge cases


def test_all_observations_rejected_yields_invalid_result_with_null_metrics(fixture_source):
    prof = make_profile(
        depths_m=[0.0, 10.0, 50.0], temperature=[28.0, 27.0, 20.0], temp_qc=[4, 4, 4]
    )
    r = compare_profile(prof, fixture_source, "temperature")
    assert r.is_valid is False
    assert r.failure_reason == FAILURE_NO_OBSERVATIONS
    assert r.metrics.n == 0
    assert r.metrics.bias is None and r.metrics.rmse is None
    assert r.residuals is None
    assert "excluded" in r.failure_detail


def test_observation_outside_temporal_tolerance_produces_no_comparison():
    source = StubModelDataSource(times=[utc(2023, 7, 1, 0)]).open()
    prof = make_profile(
        time=utc(2023, 7, 1, 20), depths_m=[0.0, 10.0], temperature=[28.0, 27.0]
    )
    r = compare_profile(prof, source, "temperature")
    assert r.is_valid is False
    assert r.failure_reason == FAILURE_NO_MODEL_MATCH
    assert r.match.rejection_reason == REJECT_TEMPORAL_TOLERANCE
    assert r.metrics.n == 0 and r.metrics.bias is None
    assert r.model_sample is None, "model must not be sampled for a rejected match"


def test_no_model_timestamps_produces_no_comparison():
    source = StubModelDataSource(times=[]).open()
    prof = make_profile(depths_m=[0.0, 10.0], temperature=[28.0, 27.0])
    r = compare_profile(prof, source, "temperature")
    assert r.is_valid is False
    assert r.metrics.bias is None


def test_observation_deeper_than_the_model_drops_only_the_deep_levels():
    source = StubModelDataSource(depths_m=[0.0, 10.0, 50.0]).open()
    prof = make_profile(
        depths_m=[0.0, 10.0, 2000.0], temperature=[28.0, 27.0, 4.0], latitude=0.0
    )
    r = compare_profile(prof, source, "temperature")
    assert r.is_valid
    assert r.metrics.n == 2
    assert max(r.residuals.depths_m) < 100.0


def test_observation_shallower_than_the_model_drops_the_surface_level():
    source = StubModelDataSource(depths_m=[50.0, 100.0, 500.0]).open()
    prof = make_profile(
        depths_m=[0.0, 60.0, 100.0], temperature=[28.0, 20.0, 15.0], latitude=0.0
    )
    r = compare_profile(prof, source, "temperature")
    assert r.is_valid
    assert 0.0 not in r.residuals.depths_m.tolist()
    assert r.metrics.n == 2


def test_observation_entirely_outside_the_model_depth_range_is_rejected():
    source = StubModelDataSource(depths_m=[0.0, 10.0]).open()
    prof = make_profile(depths_m=[500.0, 1000.0], temperature=[8.0, 4.0], latitude=0.0)
    r = compare_profile(prof, source, "temperature")
    assert r.is_valid is False
    assert r.failure_reason == FAILURE_NO_COMPARISON_DEPTHS
    assert r.metrics.bias is None


def test_single_level_profile_produces_a_one_sample_comparison():
    source = StubModelDataSource(depths_m=[0.0, 10.0, 50.0]).open()
    prof = make_profile(depths_m=[10.0], temperature=[27.0], latitude=0.0)
    r = compare_profile(prof, source, "temperature")
    assert r.is_valid
    assert r.metrics.n == 1
    assert r.metrics.rmse == pytest.approx(abs(r.metrics.bias))


def test_duplicate_observation_depths_collapse_to_one_comparison_depth():
    source = StubModelDataSource(depths_m=[0.0, 10.0, 50.0]).open()
    prof = make_profile(
        pressure=[10.0, 10.0, 50.0], temperature=[27.0, 27.2, 20.0], latitude=0.0
    )
    r = compare_profile(prof, source, "temperature")
    assert r.is_valid
    assert len(set(r.residuals.depths_m.tolist())) == r.metrics.n


def test_variable_not_in_the_model_is_reported_not_substituted():
    source = StubModelDataSource(variable_names={"temperature": "thetao"}).open()
    prof = make_profile(depths_m=[0.0, 10.0], temperature=[28.0, 27.0], salinity=[35.0, 35.1])
    r = compare_profile(prof, source, "salinity")
    assert r.is_valid is False
    assert r.failure_reason == FAILURE_VARIABLE_UNAVAILABLE
    assert r.metrics.bias is None


def test_nan_temperature_levels_are_excluded_end_to_end(fixture_source):
    prof = make_profile(
        depths_m=[0.0, 10.0, 50.0, 100.0],
        temperature=[28.0, np.nan, 20.0, 15.0],
        temp_qc=[1, 1, 1, 1],
    )
    r = compare_profile(prof, fixture_source, "temperature")
    assert r.is_valid
    assert r.metrics.n == 3
    assert 10.0 not in np.round(r.residuals.depths_m, 4).tolist()
    assert r.provenance["n_excluded_observations"] == 1


def test_nan_pressure_levels_are_excluded_end_to_end(fixture_source):
    prof = make_profile(
        pressure=[0.0, np.nan, 50.0, 100.0],
        temperature=[28.0, 27.0, 20.0, 15.0],
        temp_qc=[1, 1, 1, 1],
    )
    r = compare_profile(prof, fixture_source, "temperature")
    assert r.is_valid
    assert r.metrics.n == 3


def test_sampling_the_model_for_an_invalid_match_is_a_programming_error():
    source = StubModelDataSource(times=[utc(2023, 7, 1)]).open()
    prof = make_profile(time=utc(2023, 7, 1, 20), depths_m=[0.0], temperature=[28.0])
    from app.science.pipeline import match_model_to_observation

    match = match_model_to_observation(prof, source)
    assert not match.is_valid
    with pytest.raises(ValueError, match="invalid co-location"):
        sample_model_profile(source, "temperature", match)
