"""Argo observation-level normalization: GSW depth and QC flag policy.

The conversion assertions are physical sanity checks (magnitude, sign,
latitude dependence), NOT validation of the GSW library itself.
"""

import math

import pytest

from app.services.argo_levels import (
    ACCEPTED_QC_ADJUSTED,
    ACCEPTED_QC_RAW,
    QC_FLAGS_USED,
    build_matchup_level,
    build_matchup_levels,
    depth_from_pressure,
    resolve_variable_basis,
)


# --- GSW pressure -> depth --------------------------------------------------

def test_surface_pressure_is_zero_depth():
    assert depth_from_pressure(0.0, 15.25) == pytest.approx(0.0, abs=1e-9)


def test_depth_is_positive_and_just_under_pressure():
    """1 dbar of pressure is ~1 m of depth; depth is always slightly smaller."""
    depth = depth_from_pressure(100.0, 15.25)
    assert 0.0 < depth < 100.0
    # Within 1 % of the pressure value: pressure exceeds depth because seawater
    # is denser than the 1.025 kg/m3 reference the conversion assumes.
    assert depth == pytest.approx(100.0, rel=0.01)


def test_depth_is_deeper_at_the_equator_than_at_mid_latitude():
    """Latitude-dependent gravity: the same pressure is deeper at the equator."""
    equator = depth_from_pressure(1000.0, 0.0)
    mid_latitude = depth_from_pressure(1000.0, 45.0)
    assert equator > mid_latitude
    # The difference is small but real (~3 m at 1000 dbar).
    assert 0.0 < equator - mid_latitude < 10.0


def test_gsw_depth_is_consistent_with_the_floats_provided_depth_m():
    """The committed Argo data: depth_m and pressure_dbar already agree.

    This guards the conversion against a sign or scale error - the GSW depth
    must land within a metre of the provider's own depth_m.
    """
    observation = {"depth_m": 500.0, "pressure_dbar": 504.5}
    level = build_matchup_level(observation, 15.25)
    assert level["depth_source"] == "pressure_gsw"
    assert level["depth_m"] == pytest.approx(500.0, abs=1.0)


@pytest.mark.parametrize("bad", [None, float("nan"), float("inf"), -5.0, "abc"])
def test_unusable_pressure_yields_no_depth(bad):
    assert depth_from_pressure(bad, 15.25) is None


def test_missing_pressure_falls_back_to_the_provided_depth():
    level = build_matchup_level({"depth_m": 120.0, "temperature_c": 20.0}, 15.25)

    assert level["depth_m"] == 120.0
    assert level["depth_source"] == "provided"
    assert level["pressure_dbar"] is None


def test_no_usable_depth_at_all_drops_the_level():
    assert build_matchup_level({"temperature_c": 20.0}, 15.25) is None
    assert build_matchup_level({"depth_m": math.nan, "pressure_dbar": math.nan}, 15.25) is None
    assert build_matchup_level("not-an-observation", 15.25) is None


# --- QC flags ---------------------------------------------------------------

def test_documented_qc_flag_policy():
    assert ACCEPTED_QC_RAW == frozenset({1, 2})
    # Flag 5 (value changed) is accepted on adjusted data; flag 8 (value
    # interpolated between measurements) is NOT accepted anywhere.
    assert ACCEPTED_QC_ADJUSTED == frozenset({1, 2, 5})
    assert QC_FLAGS_USED == {"raw": [1, 2], "adjusted": [1, 2, 5]}


@pytest.mark.parametrize("flag", [3, 4, 6, 7, 9])
def test_rejected_raw_values_are_missing_not_repaired(flag):
    """Flags 3/4/6/7/9 are never accepted on a raw (in-situ) value."""
    level = build_matchup_level(
        {"depth_m": 10.0, "temperature_c": 27.5, "temp_qc": flag}, 15.25
    )

    assert level["temperature_c"] is None
    assert level["temperature_source"] is None


def test_good_and_probably_good_raw_values_are_used():
    for flag in (1, 2):
        level = build_matchup_level(
            {"depth_m": 10.0, "temperature_c": 27.5, "temp_qc": flag}, 15.25
        )
        assert level["temperature_c"] == 27.5
        assert level["temperature_source"] == "raw"


def test_flag_5_value_changed_is_accepted_on_adjusted_values():
    adjusted = build_matchup_level(
        {"depth_m": 10.0, "TEMP": 99.0, "TEMP_ADJUSTED": 27.9, "TEMP_ADJUSTED_QC": 5},
        15.25,
        basis="adjusted",
    )
    assert adjusted["temperature_c"] == 27.9
    assert adjusted["temperature_source"] == "adjusted"

    # On a RAW variable flag 5 still means "the value was replaced", so it is
    # rejected rather than treated as a good measurement.
    raw = build_matchup_level({"depth_m": 10.0, "TEMP": 27.5, "TEMP_QC": 5}, 15.25, basis="raw")
    assert raw["temperature_c"] is None


def test_flag_8_interpolated_value_is_rejected_even_on_adjusted_values():
    """Flag 8 marks a value interpolated between measurements, not measured.

    A model matchup compares measurements, so an interpolated observation must
    not be counted as a matched pair.
    """
    adjusted = build_matchup_level(
        {"depth_m": 10.0, "TEMP": 27.5, "TEMP_ADJUSTED": 27.9, "TEMP_ADJUSTED_QC": 8},
        15.25,
        basis="adjusted",
    )
    assert adjusted["temperature_c"] is None
    assert adjusted["temperature_source"] is None

    salinity = build_matchup_level(
        {"depth_m": 10.0, "PSAL": 34.1, "PSAL_ADJUSTED": 34.2, "PSAL_ADJUSTED_QC": 8},
        15.25,
        basis="adjusted",
    )
    assert salinity["salinity_psu"] is None


def test_adjusted_values_are_used_on_the_adjusted_basis():
    level = build_matchup_level(
        {
            "depth_m": 10.0,
            "temperature_c": 27.5,
            "salinity_psu": 34.1,
            "TEMP_ADJUSTED": 27.9,
            "TEMP_ADJUSTED_QC": 1,
            "PSAL_ADJUSTED": 34.05,
            "PSAL_ADJUSTED_QC": 1,
        },
        15.25,
        basis="adjusted",
    )

    assert level["temperature_c"] == 27.9
    assert level["temperature_source"] == "adjusted"
    assert level["salinity_psu"] == 34.05
    assert level["salinity_source"] == "adjusted"


def test_rejected_adjusted_falls_through_to_missing_not_to_raw():
    """On the adjusted basis a bad adjusted value is missing.

    The basis is a profile-level decision, so a single rejected adjusted value
    does not pull the raw value in behind it - that would silently mix the two
    conventions inside one profile.
    """
    level = build_matchup_level(
        {"depth_m": 10.0, "temperature_c": 27.5, "TEMP_ADJUSTED": 99.0, "TEMP_ADJUSTED_QC": 4},
        15.25,
        basis="adjusted",
    )

    assert level["temperature_c"] is None
    assert level["temperature_source"] is None


def test_zero_is_a_real_value_not_a_missing_marker():
    level = build_matchup_level(
        {"depth_m": 10.0, "temperature_c": 0.0, "salinity_psu": 0.0}, 15.25
    )

    assert level["temperature_c"] == 0.0
    assert level["salinity_psu"] == 0.0


def test_non_finite_values_are_missing():
    level = build_matchup_level(
        {"depth_m": 10.0, "temperature_c": math.nan, "salinity_psu": math.inf}, 15.25
    )

    assert level["temperature_c"] is None
    assert level["salinity_psu"] is None


def test_temperature_and_salinity_qc_are_evaluated_independently():
    level = build_matchup_level(
        {
            "depth_m": 10.0,
            "temperature_c": 27.5,
            "temp_qc": 4,  # rejected
            "salinity_psu": 34.1,
            "psal_qc": 1,  # accepted
        },
        15.25,
    )

    assert level["temperature_c"] is None
    assert level["salinity_psu"] == 34.1


# --- Profile level ----------------------------------------------------------

def test_profile_depth_source_is_mixed_when_origins_differ():
    result = build_matchup_levels(
        [
            {"depth_m": 10.0, "pressure_dbar": 10.1},
            {"depth_m": 200.0},
        ],
        15.25,
    )

    assert result["depthSource"] == "mixed"
    assert [level["depth_source"] for level in result["levels"]] == ["pressure_gsw", "provided"]


def test_profile_depth_source_is_uniform_when_every_level_agrees():
    result = build_matchup_levels(
        [{"depth_m": 10.0, "pressure_dbar": 10.1}, {"depth_m": 20.0, "pressure_dbar": 20.2}],
        15.25,
    )

    assert result["depthSource"] == "pressure_gsw"


def test_levels_without_depth_are_counted_not_silently_dropped():
    result = build_matchup_levels(
        [{"depth_m": 10.0, "pressure_dbar": 10.1}, {"temperature_c": 20.0}, "junk"],
        15.25,
    )

    assert len(result["levels"]) == 1
    assert result["droppedObservationCount"] == 2


def test_empty_profile_reports_no_depth_source():
    result = build_matchup_levels([], 15.25)

    assert result["levels"] == []
    assert result["depthSource"] == "unavailable"
    assert result["qcFlagsUsed"] == QC_FLAGS_USED

# --- raw vs adjusted basis: chosen once per profile -------------------------

def _mixed_profile():
    """One observation carrying BOTH raw and adjusted values."""
    return [
        {
            "depth_m": 10.0,
            "pressure_dbar": 10.1,
            "TEMP": 27.5,
            "PSAL": 34.1,
            "TEMP_QC": 1,
            "PSAL_QC": 1,
            "PRES_ADJUSTED": 10.3,
            "TEMP_ADJUSTED": 27.9,
            "TEMP_ADJUSTED_QC": 1,
            "PSAL_ADJUSTED": 34.05,
            "PSAL_ADJUSTED_QC": 1,
        }
    ]


def test_realtime_mode_R_forces_raw_even_when_adjusted_arrays_exist():
    result = build_matchup_levels(_mixed_profile(), 15.25, data_mode="R")

    assert result["argoDataMode"] == "R"
    assert result["variableBasis"] == "raw"
    level = result["levels"][0]
    assert level["temperature_c"] == 27.5
    assert level["temperature_source"] == "raw"
    assert level["salinity_source"] == "raw"
    # Raw pressure is used: 10.1 dbar, not the adjusted 10.3 dbar.
    assert level["pressure_dbar"] == 10.1


@pytest.mark.parametrize("mode", ["A", "D"])
def test_adjusted_modes_use_the_adjusted_family(mode):
    result = build_matchup_levels(_mixed_profile(), 15.25, data_mode=mode)

    assert result["argoDataMode"] == mode
    assert result["variableBasis"] == "adjusted"
    level = result["levels"][0]
    assert level["temperature_c"] == 27.9
    assert level["salinity_psu"] == 34.05


def test_adjusted_mode_falls_back_to_raw_when_adjusted_arrays_are_fill():
    """A delayed-mode mode with entirely fill/NaN adjusted arrays -> raw."""
    fill = [
        {
            "depth_m": 10.0,
            "pressure_dbar": 10.1,
            "TEMP": 27.5,
            "PSAL": 34.1,
            "TEMP_QC": 1,
            "PSAL_QC": 1,
            "PRES_ADJUSTED": math.nan,
            "TEMP_ADJUSTED": math.nan,
            "TEMP_ADJUSTED_QC": 9,  # missing value
            "PSAL_ADJUSTED": math.nan,
            "PSAL_ADJUSTED_QC": 9,
        }
    ]

    result = build_matchup_levels(fill, 15.25, data_mode="D")

    assert result["variableBasis"] == "raw"
    level = result["levels"][0]
    assert level["temperature_c"] == 27.5
    assert level["salinity_psu"] == 34.1


def test_pressure_never_mixes_adjusted_with_raw_variables():
    """PRES comes from the SAME basis as TEMP/PSAL within one profile."""
    # Adjusted TEMP/PSAL present, adjusted PRES absent: the level must use the
    # source depth_m, never raw PRES mixed in with adjusted variables.
    observations = [
        {
            "depth_m": 42.0,
            "pressure_dbar": 42.4,
            "TEMP": 27.5,
            "PSAL": 34.1,
            "TEMP_QC": 1,
            "PSAL_QC": 1,
            "TEMP_ADJUSTED": 27.9,
            "TEMP_ADJUSTED_QC": 1,
            "PSAL_ADJUSTED": 34.05,
            "PSAL_ADJUSTED_QC": 1,
        }
    ]

    result = build_matchup_levels(observations, 15.25, data_mode="D")
    level = result["levels"][0]

    assert result["variableBasis"] == "adjusted"
    assert level["temperature_source"] == "adjusted"
    # No adjusted pressure on this basis -> the raw pressure is NOT borrowed.
    assert level["pressure_dbar"] is None
    assert level["depth_source"] == "provided"
    assert level["depth_m"] == 42.0
    assert result["depthSource"] == "provided"


def test_unknown_mode_auto_detects_the_basis_from_the_arrays():
    auto_adjusted = build_matchup_levels(_mixed_profile(), 15.25)
    assert auto_adjusted["argoDataMode"] == "auto"
    assert auto_adjusted["variableBasis"] == "adjusted"

    raw_only = build_matchup_levels([{"depth_m": 10.0, "pressure_dbar": 10.1, "TEMP": 27.5}], 15.25)
    assert raw_only["variableBasis"] == "raw"


@pytest.mark.parametrize("mode", ["r", "a", "d", " R ", "A"])
def test_data_mode_letters_are_case_and_space_insensitive(mode):
    assert resolve_variable_basis(_mixed_profile(), mode) in ("raw", "adjusted")
    assert build_matchup_levels(_mixed_profile(), 15.25, data_mode=mode)["argoDataMode"] == mode.strip().upper()


@pytest.mark.parametrize("mode", [None, "", "adjusted", "real-time", 7, "R2"])
def test_unrecognised_data_mode_falls_back_to_auto(mode):
    result = build_matchup_levels(_mixed_profile(), 15.25, data_mode=mode)

    assert result["argoDataMode"] == "auto"
    assert result["variableBasis"] == "adjusted"  # auto-detected from the arrays


# --- absent QC flags: lenient, but counted ---------------------------------

def test_absent_qc_flags_stay_lenient_but_are_counted():
    result = build_matchup_levels(
        [
            {"depth_m": 10.0, "pressure_dbar": 10.1, "temperature_c": 27.5, "salinity_psu": 34.1},
            {"depth_m": 20.0, "pressure_dbar": 20.2, "temperature_c": 27.1, "salinity_psu": 34.2},
        ],
        15.25,
    )

    # Lenient: the values are still used (flag assumed = 1).
    assert all(level["temperature_c"] is not None for level in result["levels"])
    assert all(level["temp_qc"] == 1 for level in result["levels"])
    # ...but every level that relied on the assumption is disclosed.
    assert result["missingQcLevelCount"] == 2


def test_present_qc_flags_are_not_counted_as_missing():
    result = build_matchup_levels(
        [{"depth_m": 10.0, "pressure_dbar": 10.1, "temperature_c": 27.5, "temp_qc": 1, "psal_qc": 2}],
        15.25,
    )

    assert result["missingQcLevelCount"] == 0


def test_a_level_missing_only_one_of_the_two_qc_fields_is_counted():
    result = build_matchup_levels(
        [{"depth_m": 10.0, "pressure_dbar": 10.1, "temperature_c": 27.5, "temp_qc": 1}],
        15.25,
    )

    assert result["missingQcLevelCount"] == 1


def test_levels_dropped_for_missing_depth_do_not_inflate_the_missing_qc_count():
    result = build_matchup_levels(
        [
            {"depth_m": 10.0, "pressure_dbar": 10.1, "temperature_c": 27.5, "temp_qc": 1, "psal_qc": 1},
            {"temperature_c": 27.5},
        ],
        15.25,
    )

    assert result["droppedObservationCount"] == 1
    assert result["missingQcLevelCount"] == 0
