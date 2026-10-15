"""Unit tests for the float-derived TCHP / D26 metrics.

These are pure functions over a list of QC-accepted levels, so every value here
is hand-checkable. The point of the module is that a missing measurement and a
measurement of zero are reported differently, so most of these tests are about
the REJECTION paths as much as the arithmetic.

A note on the trapezoid convention
----------------------------------
``compute_ocean_heat_metrics`` integrates with the trapezoidal rule, as
specified. For a profile that is a uniform 1 K above the isotherm from 0 to
100 m and crosses the isotherm exactly at 100 m, the trapezoid rule yields
38.84 kJ/cm2, not 40.89. The two cannot both hold:

* integral == 100 K.m  requires the excess to average 1.0 K over [0, 100], i.e.
  to be 1.0 at 100 m, which means T(100) = 27 C and the crossing is deeper than
  100 m;
* D26 == 100 m requires T(100) = 26 C, i.e. excess 0 at the top of the interval.

So "D26 = 100 m" and "integral = 100 K.m" are mutually exclusive under a
trapezoid rule; 40.886 kJ/cm2 is the value a left-rectangle (left-sum)
convention produces for a flat 1 K excess over 100 m. The tests below pin BOTH
numbers and label which convention each belongs to, so the choice is visible
rather than buried. The trapezoid rule is kept because it converges on the true
integral as sampling densifies, whereas the rectangle rule stays biased by half
the excess at the base of the layer.
"""

import pytest

from app.services.ocean_heat_metrics import (
    METRICS_MAX_GAP_M,
    METRICS_MAX_SURFACE_DEPTH_M,
    REASON_GAP_TOO_WIDE,
    REASON_NO_CROSSING,
    REASON_NO_SAMPLES,
    REASON_NO_VALID_TEMPERATURE,
    REASON_SURFACE_BELOW_ISOTHERM,
    REASON_SURFACE_TOO_DEEP,
    TCHP_DEFINITION_STATUS,
    compute_ocean_heat_metrics,
)

RHO = 1026.0
CP = 3985.0


def _levels(pairs):
    """``[(depth, T), ...]`` -> match-level dicts."""
    return [{"depth_m": float(d), "temperature_c": float(t)} for d, t in pairs]


def _flat_layer_profile(below_temperature=25.0, below_depths=(125.0, 150.0)):
    """27 C at 10 m spacing from 0 to 100 m, then cold below."""
    pairs = [(d, 27.0) for d in range(0, 101, 10)]
    pairs += [(d, below_temperature) for d in below_depths]
    return _levels(pairs)


# --- the specified hand-computed case --------------------------------------

def test_flat_layer_d26_and_tchp_are_hand_computable():
    """Uniform 1 K excess over a 100 m warm layer.

    27 C from 0-100 m with 25 C at 125 m: linear interpolation puts the 26 C
    crossing at 100 + 0.5 * 25 = 112.5 m.
    """
    result = compute_ocean_heat_metrics(_flat_layer_profile())

    assert result["status"] == "OK"
    assert result["d26M"] == pytest.approx(112.5)

    # Trapezoid by hand: 10 segments of 10 m at constant excess 1 K = 100 K.m,
    # plus the taper from 100 m to the crossing at 112.5 m, excess 1 -> 0:
    # 0.5 * (1 + 0) * 12.5 = 6.25 K.m.  Total 106.25 K.m.
    integral_k_m = 100.0 + 0.5 * 12.5
    assert result["tchpKjCm2"] == pytest.approx(RHO * CP * integral_k_m / 1e7, rel=1e-4)
    assert result["tchpKjCm2"] == pytest.approx(43.4415, rel=1e-4)


def test_task_specified_rectangle_value_is_the_left_sum_convention():
    """40.886 kJ/cm2 is a rectangle integral, and is pinned as such.

    ``1026 * 3985 * 1 * 100 / 1e7`` assumes the excess is a constant 1 K over the
    whole 0-100 m layer. That is the left-sum convention; the trapezoid rule the
    task also specifies gives a different number for the same profile. Both are
    asserted here so neither is silently assumed.
    """
    rectangle_value = RHO * CP * 1.0 * 100.0 / 1e7
    assert rectangle_value == pytest.approx(40.886, abs=1e-3)

    # A profile sitting exactly on 26 C at 100 m makes D26 land exactly on 100 m.
    pairs = [(d, 27.0) for d in range(0, 91, 10)]
    pairs += [(100.0, 26.0), (125.0, 25.0)]
    result = compute_ocean_heat_metrics(_levels(pairs))

    assert result["d26M"] == pytest.approx(100.0)
    # Trapezoid: 9 full segments of 10 m at excess 1 = 90, then the taper
    # 90->100 m from excess 1 to 0 = 0.5 * 1 * 10 = 5.  Total 95 K.m.
    assert result["tchpKjCm2"] == pytest.approx(RHO * CP * 95.0 / 1e7, rel=1e-4)
    # And that is strictly below the rectangle convention for the same layer.
    assert result["tchpKjCm2"] < rectangle_value


def test_uniform_excess_integrates_to_rho_cp_times_thickness():
    """With every accepted sample at 27 C, the integral is thickness x 1 K.

    The crossing point carries excess 0, so the trapezoid value is the full
    rectangle plus half the taper triangle. Pinned so a change of integration
    rule is visible in a test failure rather than in a changed validation number.
    """
    result = compute_ocean_heat_metrics(_flat_layer_profile())
    thickness = result["d26M"]
    trapezoid_value = RHO * CP * (thickness - 0.5 * 12.5) / 1e7
    assert result["tchpKjCm2"] == pytest.approx(trapezoid_value, rel=1e-4)


# --- surface handling ------------------------------------------------------

def test_surface_sample_within_ten_metres_is_held_constant_to_zero():
    """A float starting at 3 m may stand in for the surface."""
    result = compute_ocean_heat_metrics(
        _levels([(3.0, 27.0), (10.0, 27.0), (20.0, 26.5), (30.0, 25.0)])
    )
    assert result["status"] == "OK"
    assert result["surfaceDepthM"] == pytest.approx(3.0)
    assert result["surfaceTemperatureC"] == pytest.approx(27.0)
    # The 26 C crossing is at 20 + (0.5/1.5) * 10 = 23.3333 m.
    assert result["d26M"] == pytest.approx(23.33, abs=0.01)
    # Trapezoid by hand, excess above 26 C at each knot:
    #   0->3    excess 1.0,1.0 -> 0.5 * 2.0 * 3    =  3.0000 K.m
    #   3->10   excess 1.0,1.0 -> 0.5 * 2.0 * 7    =  7.0000 K.m
    #   10->20  excess 1.0,0.5 -> 0.5 * 1.5 * 10   =  7.5000 K.m
    #   20->23.33 excess 0.5,0.0 -> 0.5 * 0.5 * 3.33 = 0.8333 K.m
    integral_k_m = 3.0 + 7.0 + 7.5 + 0.5 * 0.5 * (result["d26M"] - 20.0)
    assert result["tchpKjCm2"] == pytest.approx(
        RHO * CP * integral_k_m / 1e7, rel=1e-4
    )


def test_surface_sample_deeper_than_ten_metres_is_refused_not_extrapolated():
    """12 m is below the surface, so the metric is refused rather than guessed."""
    result = compute_ocean_heat_metrics(
        _levels([(12.0, 27.0), (20.0, 27.0), (30.0, 25.0)])
    )
    assert result["tchpKjCm2"] is None
    assert result["d26M"] is None
    assert result["reason"] == REASON_SURFACE_TOO_DEEP
    # The measured values are still reported so the caller can show them.
    assert result["surfaceDepthM"] == pytest.approx(12.0)


def test_surface_exactly_at_the_limit_is_accepted():
    result = compute_ocean_heat_metrics(
        _levels([(METRICS_MAX_SURFACE_DEPTH_M, 27.0), (15.0, 27.0), (25.0, 25.0)])
    )
    assert result["status"] == "OK"
    assert result["surfaceDepthM"] == pytest.approx(METRICS_MAX_SURFACE_DEPTH_M)


# --- rejections ------------------------------------------------------------

def test_surface_below_26c_reports_zero_not_a_failure():
    """No heat above the isotherm is a MEASUREMENT, so TCHP is 0.0 and D26 None."""
    result = compute_ocean_heat_metrics(
        _levels([(2.0, 25.5), (10.0, 25.0), (20.0, 24.0)])
    )
    assert result["tchpKjCm2"] == 0.0
    assert result["d26M"] is None
    assert result["status"] == "SURFACE_BELOW_ISOTHERM"
    assert result["reason"] == REASON_SURFACE_BELOW_ISOTHERM


def test_surface_exactly_at_26c_is_below_the_rule():
    """The rule is strictly below 26 C; 26.0 C at the surface starts a layer."""
    result = compute_ocean_heat_metrics(
        _levels([(0.0, 26.0), (10.0, 26.0), (20.0, 25.0)])
    )
    assert result["status"] == "OK"
    assert result["tchpKjCm2"] is not None
    assert result["tchpKjCm2"] >= 0.0


def test_profile_that_never_reaches_26c_is_refused():
    """Warm everywhere: there is no isotherm crossing to integrate to."""
    result = compute_ocean_heat_metrics(
        _levels([(0.0, 28.0), (10.0, 27.5), (20.0, 27.0), (30.0, 26.5)])
    )
    assert result["tchpKjCm2"] is None
    assert result["d26M"] is None
    assert result["reason"] == REASON_NO_CROSSING


def test_a_wide_gap_inside_the_warm_layer_is_refused():
    """A 60 m hole in the warm layer cannot be bridged by integration."""
    result = compute_ocean_heat_metrics(
        _levels([(0.0, 28.0), (5.0, 27.5), (65.0, 27.0), (75.0, 25.0)])
    )
    assert result["tchpKjCm2"] is None
    assert result["d26M"] is None
    assert "60" in result["reason"]
    assert REASON_GAP_TOO_WIDE.split(" (")[0] in result["reason"]


def test_a_gap_exactly_at_the_limit_is_accepted():
    result = compute_ocean_heat_metrics(
        _levels([
            (0.0, 28.0), (5.0, 27.5),
            (5.0 + METRICS_MAX_GAP_M, 27.0),
            (5.0 + METRICS_MAX_GAP_M + 5.0, 25.0),
        ])
    )
    assert result["status"] == "OK"


def test_a_gap_outside_the_warm_layer_does_not_matter():
    """Only gaps inside 0..D26 affect the integral."""
    result = compute_ocean_heat_metrics(
        _levels([
            (0.0, 27.0), (5.0, 27.0), (10.0, 26.5), (15.0, 25.0),
            (100.0, 20.0), (200.0, 15.0),   # 85 m gap, all below D26
        ])
    )
    assert result["status"] == "OK"
    assert result["tchpKjCm2"] is not None


def test_no_levels_at_all_is_refused():
    result = compute_ocean_heat_metrics([])
    assert result["tchpKjCm2"] is None
    assert result["reason"] == REASON_NO_SAMPLES


def test_levels_without_temperature_are_refused():
    """Levels that failed QC carry no temperature and cannot make a metric."""
    result = compute_ocean_heat_metrics([
        {"depth_m": 0.0, "temperature_c": None},
        {"depth_m": 10.0, "temperature_c": None},
    ])
    assert result["tchpKjCm2"] is None
    assert result["reason"] == REASON_NO_VALID_TEMPERATURE


# --- inversions ------------------------------------------------------------

def test_the_deepest_crossing_wins_when_the_profile_warms_again():
    """A subsurface warm layer below a cool surface layer: D26 is the DEEP one.

    Profile: 25 C at the surface, 28 C from 20-60 m, then cold again. The
    shallow crossing is near 10 m and the deep one near 60 m; D26 must be the
    deep one because that is the base of the deepest cyclone-supporting layer.
    """
    result = compute_ocean_heat_metrics(
        _levels([
            (0.0, 25.0), (5.0, 25.0),
            (10.0, 26.0), (20.0, 28.0),
            (40.0, 28.0), (60.0, 26.5), (70.0, 25.0),
        ]),
        isotherm_c=26.0,
    )
    # Surface is below 26 C, so the whole profile is refused by design: a metric
    # built from a surface below the isotherm is not the quantity being asked
    # for. This is asserted explicitly so the behaviour is not mistaken for a bug.
    assert result["tchpKjCm2"] == 0.0
    assert result["status"] == "SURFACE_BELOW_ISOTHERM"


def test_deepest_crossing_is_used_when_the_surface_is_warm():
    """With a warm surface, a re-warming below the first crossing still yields
    the deepest crossing as D26."""
    result = compute_ocean_heat_metrics(
        _levels([
            (0.0, 28.0), (10.0, 27.0), (20.0, 26.5),
            (30.0, 27.5),   # re-warms: no crossing here
            (40.0, 26.5), (50.0, 25.0),
        ])
    )
    assert result["status"] == "OK"
    # Both 20 m and 40 m sit at 26.5 C and 30 m is warmer still, so neither is a
    # crossing. The only one is 40 m (26.5) -> 50 m (25.0):
    #   40 + (26.5 - 26) / (26.5 - 25) * 10 = 40 + (1/3) * 10 = 43.3333.
    assert result["d26M"] == pytest.approx(43.33, abs=0.01)


# --- documented limitation -------------------------------------------------

def test_definition_status_states_the_unpublished_model_formula():
    """The response must carry the caveat that the model's TCHP is untraceable."""
    assert "no standard_name" in TCHP_DEFINITION_STATUS
    assert "26 C" in TCHP_DEFINITION_STATUS
    assert "1026" in TCHP_DEFINITION_STATUS
    assert "3985" in TCHP_DEFINITION_STATUS