"""Tests B, C, D: QC filtering, adjusted-variable selection, DATA_MODE
(STEP 3B §7, §8, §9; §24.B–D, §24.J)."""
import numpy as np
import pytest

from app.science.argo_profile import DATA_MODE_LABELS
from app.science.profile_processing import (
    EXCLUSION_MISSING_DEPTH,
    EXCLUSION_MISSING_PRESSURE,
    EXCLUSION_MISSING_VALUE,
    EXCLUSION_PRESSURE_QC,
    EXCLUSION_VALUE_QC,
    UnsupportedDataModeError,
    VariableUnavailableError,
    process_argo_profile,
    select_field,
)
from app.science.qc import QCPolicy, default_policy
from tests.conftest import make_profile

# ============================================================ B. QC filtering


def test_default_policy_accepts_only_good_and_probably_good():
    policy = default_policy()
    assert policy.acceptable_flags == (1, 2)
    assert policy.is_acceptable(1) and policy.is_acceptable(2)
    for bad in (0, 3, 4, 5, 8, 9):
        assert not policy.is_acceptable(bad), f"flag {bad} must not be accepted"


def test_missing_flag_is_not_treated_as_good_data():
    assert default_policy().is_acceptable(None) is False


def test_qc_flag_9_can_never_be_configured_as_acceptable():
    with pytest.raises(ValueError, match="9"):
        QCPolicy(acceptable_flags=(1, 9))


def test_bad_qc_levels_are_excluded_with_a_recorded_reason():
    prof = make_profile(
        depths_m=[0.0, 10.0, 50.0, 100.0],
        temperature=[28.0, 27.0, 20.0, 15.0],
        temp_qc=[1, 4, 1, 3],
        pres_qc=[1, 1, 1, 1],
    )
    p = process_argo_profile(prof, "temperature")
    assert p.n_levels_before_qc == 4
    assert p.n_levels_after_qc == 2
    assert p.exclusion_summary() == {EXCLUSION_VALUE_QC: 2}
    assert [e.level_index for e in p.exclusions] == [1, 3]
    assert "bad data" in p.exclusions[0].detail


def test_pressure_qc_rejection_is_distinguished_from_value_qc():
    prof = make_profile(
        depths_m=[0.0, 10.0, 50.0],
        temperature=[28.0, 27.0, 20.0],
        temp_qc=[1, 1, 1],
        pres_qc=[1, 4, 1],
    )
    p = process_argo_profile(prof, "temperature")
    assert p.exclusion_summary() == {EXCLUSION_PRESSURE_QC: 1}


def test_qc_policy_is_configurable_not_hardcoded():
    prof = make_profile(
        depths_m=[0.0, 10.0, 50.0],
        temperature=[28.0, 27.0, 20.0],
        temp_qc=[1, 2, 3],
        pres_qc=[1, 1, 1],
    )
    strict = process_argo_profile(prof, "temperature", policy=QCPolicy(acceptable_flags=(1,)))
    lenient = process_argo_profile(prof, "temperature", policy=QCPolicy(acceptable_flags=(1, 2, 3)))
    assert strict.n_levels_after_qc == 1
    assert lenient.n_levels_after_qc == 3


def test_raw_profile_is_never_mutated_by_processing():
    prof = make_profile(
        depths_m=[0.0, 10.0, 50.0],
        temperature=[28.0, 27.0, 20.0],
        temp_qc=[1, 4, 1],
    )
    before_t = prof.temperature.copy()
    before_p = prof.pressure.copy()
    process_argo_profile(prof, "temperature")
    np.testing.assert_array_equal(prof.temperature, before_t)
    np.testing.assert_array_equal(prof.pressure, before_p)


def test_original_qc_information_is_preserved():
    prof = make_profile(
        depths_m=[0.0, 10.0, 50.0], temperature=[28.0, 27.0, 20.0], temp_qc=[1, 4, 2]
    )
    assert default_policy().summarise(prof.temp_qc) == {"1": 1, "2": 1, "4": 1}


def test_absent_qc_arrays_do_not_silently_pass_as_good():
    """No QC variable means acceptance is unevaluated, and that must be visible."""
    prof = make_profile(depths_m=[0.0, 10.0], temperature=[28.0, 27.0])
    p = process_argo_profile(prof, "temperature")
    assert p.n_levels_after_qc == 2
    assert any("QC flags unavailable" in n for n in p.notes)


def test_all_observations_rejected_yields_empty_profile_not_zeros():
    prof = make_profile(
        depths_m=[0.0, 10.0, 50.0], temperature=[28.0, 27.0, 20.0], temp_qc=[4, 4, 4]
    )
    p = process_argo_profile(prof, "temperature")
    assert p.is_empty and p.n_levels_after_qc == 0
    assert p.values.size == 0 and p.depth_m.size == 0


# ================================================= J. missing-value handling


def test_nan_temperature_is_excluded_and_never_becomes_zero():
    prof = make_profile(
        depths_m=[0.0, 10.0, 50.0],
        temperature=[28.0, np.nan, 20.0],
        temp_qc=[1, 1, 1],
    )
    p = process_argo_profile(prof, "temperature")
    assert p.exclusion_summary() == {EXCLUSION_MISSING_VALUE: 1}
    assert 0.0 not in p.values.tolist()
    np.testing.assert_allclose(p.values, [28.0, 20.0])


def test_nan_pressure_is_excluded_with_its_own_reason():
    prof = make_profile(
        pressure=[0.0, np.nan, 50.0], temperature=[28.0, 27.0, 20.0], temp_qc=[1, 1, 1]
    )
    p = process_argo_profile(prof, "temperature")
    assert p.exclusion_summary() == {EXCLUSION_MISSING_PRESSURE: 1}
    assert np.all(np.isfinite(p.depth_m))


def test_missing_pressure_and_missing_value_are_reported_separately():
    prof = make_profile(
        pressure=[0.0, np.nan, 50.0, 100.0],
        temperature=[28.0, 27.0, np.nan, 15.0],
        temp_qc=[1, 1, 1, 1],
    )
    p = process_argo_profile(prof, "temperature")
    assert p.exclusion_summary() == {
        EXCLUSION_MISSING_PRESSURE: 1,
        EXCLUSION_MISSING_VALUE: 1,
    }


def test_every_exclusion_is_individually_traceable():
    prof = make_profile(
        depths_m=[0.0, 10.0, 50.0, 100.0],
        temperature=[28.0, np.nan, 20.0, 15.0],
        temp_qc=[1, 1, 4, 1],
    )
    p = process_argo_profile(prof, "temperature")
    assert p.n_excluded == 2
    for exc in p.exclusions:
        assert exc.reason and exc.detail
        assert exc.level_index is not None


# ================================= C. adjusted-variable selection


def test_delayed_mode_prefers_adjusted_field():
    prof = make_profile(
        depths_m=[0.0, 10.0],
        temperature=[28.0, 27.0],
        temperature_adjusted=[28.05, 27.04],
        temp_qc=[1, 1],
        temp_adjusted_qc=[1, 1],
        data_mode="D",
    )
    values, _, sel = select_field(prof, "temperature")
    assert sel.used_adjusted is True
    assert sel.source_field == "TEMPERATURE_ADJUSTED"
    assert sel.fallback_reason is None
    np.testing.assert_allclose(values, [28.05, 27.04])


def test_falls_back_when_adjusted_field_is_absent_and_says_why():
    """Adjustment must never be claimed when the source has no adjusted array."""
    prof = make_profile(
        depths_m=[0.0, 10.0], temperature=[28.0, 27.0], temp_qc=[1, 1], data_mode="D"
    )
    values, _, sel = select_field(prof, "temperature")
    assert sel.used_adjusted is False
    assert sel.source_field == "TEMPERATURE"
    assert "absent from the source profile" in sel.fallback_reason
    np.testing.assert_allclose(values, [28.0, 27.0])


def test_falls_back_when_adjusted_field_exists_but_all_qc_is_bad():
    prof = make_profile(
        depths_m=[0.0, 10.0],
        temperature=[28.0, 27.0],
        temperature_adjusted=[28.05, 27.04],
        temp_qc=[1, 1],
        temp_adjusted_qc=[4, 4],
        data_mode="D",
    )
    _, _, sel = select_field(prof, "temperature")
    assert sel.used_adjusted is False
    assert "acceptable QC flag" in sel.fallback_reason


def test_falls_back_when_adjusted_field_is_all_nan():
    prof = make_profile(
        depths_m=[0.0, 10.0],
        temperature=[28.0, 27.0],
        temperature_adjusted=[np.nan, np.nan],
        temp_qc=[1, 1],
        temp_adjusted_qc=[1, 1],
        data_mode="D",
    )
    _, _, sel = select_field(prof, "temperature")
    assert sel.used_adjusted is False
    assert sel.fallback_reason is not None


def test_adjusted_pressure_is_used_consistently_with_adjusted_values():
    prof = make_profile(
        depths_m=[0.0, 10.0, 50.0],
        temperature=[28.0, 27.0, 20.0],
        temperature_adjusted=[28.1, 27.1, 20.1],
        pressure_adjusted=[0.0, 10.5, 50.5],
        temp_qc=[1, 1, 1],
        temp_adjusted_qc=[1, 1, 1],
        data_mode="D",
    )
    p = process_argo_profile(prof, "temperature")
    assert p.pressure_field == "PRES_ADJUSTED"
    np.testing.assert_allclose(p.pressure_dbar, [0.0, 10.5, 50.5])


def test_missing_variable_entirely_raises_rather_than_inventing_data():
    prof = make_profile(depths_m=[0.0, 10.0], temperature=[28.0, 27.0])
    with pytest.raises(VariableUnavailableError, match="salinity"):
        select_field(prof, "salinity")


def test_selection_records_the_field_actually_used():
    prof = make_profile(
        depths_m=[0.0], temperature=[28.0], temperature_adjusted=[28.1],
        temp_qc=[1], temp_adjusted_qc=[1], data_mode="D",
    )
    p = process_argo_profile(prof, "temperature")
    assert p.selection.source_field == "TEMPERATURE_ADJUSTED"
    assert p.selection.qc_field == "TEMP_ADJUSTED_QC"


# ============================================================ D. DATA_MODE


@pytest.mark.parametrize("mode", ["R", "A", "D"])
def test_all_three_argo_data_modes_are_supported(mode):
    prof = make_profile(depths_m=[0.0, 10.0], temperature=[28.0, 27.0], data_mode=mode)
    p = process_argo_profile(prof, "temperature")
    assert p.selection.data_mode == mode
    assert p.raw.data_mode_label == DATA_MODE_LABELS[mode]


def test_real_time_mode_does_not_use_adjusted_data():
    """DATA_MODE R data are unadjusted by definition; adjustment is not invented."""
    prof = make_profile(
        depths_m=[0.0, 10.0],
        temperature=[28.0, 27.0],
        temperature_adjusted=[28.5, 27.5],
        temp_qc=[1, 1],
        temp_adjusted_qc=[1, 1],
        data_mode="R",
    )
    values, _, sel = select_field(prof, "temperature")
    assert sel.used_adjusted is False
    assert "real-time" in sel.fallback_reason
    np.testing.assert_allclose(values, [28.0, 27.0])


def test_data_mode_is_exposed_on_the_processed_profile():
    prof = make_profile(depths_m=[0.0], temperature=[28.0], data_mode="A")
    p = process_argo_profile(prof, "temperature")
    assert p.raw.data_mode == "A"
    assert any("DATA_MODE: A" in n for n in p.notes)


def test_unknown_data_mode_is_rejected_at_construction():
    with pytest.raises(ValueError, match="DATA_MODE"):
        make_profile(depths_m=[0.0], temperature=[28.0], data_mode="X")


def test_data_mode_excluded_by_configuration_is_reported(monkeypatch):
    from app.core import config

    monkeypatch.setattr(config.settings, "ACCEPTED_DATA_MODES", ("D",))
    prof = make_profile(depths_m=[0.0], temperature=[28.0], data_mode="R")
    with pytest.raises(UnsupportedDataModeError, match="not accepted"):
        process_argo_profile(prof, "temperature")


def test_qc_flags_accept_bytes_and_strings_like_real_netcdf():
    prof = make_profile(
        depths_m=[0.0, 10.0, 50.0],
        temperature=[28.0, 27.0, 20.0],
        temp_qc=[b"1", "4", 1],
    )
    p = process_argo_profile(prof, "temperature")
    assert p.n_levels_after_qc == 2


def test_blank_qc_character_is_treated_as_missing_not_good():
    prof = make_profile(
        depths_m=[0.0, 10.0], temperature=[28.0, 27.0], temp_qc=[b" ", b"1"]
    )
    p = process_argo_profile(prof, "temperature")
    assert p.n_levels_after_qc == 1


def test_mismatched_array_length_is_rejected():
    with pytest.raises(ValueError, match="length"):
        make_profile(depths_m=[0.0, 10.0], temperature=[28.0, 27.0], temp_qc=[1])
