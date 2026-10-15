"""Unit tests for the model-side TCHP and the 2D-vs-3D definition check.

The point of these tests is not the arithmetic (that is
``test_ocean_heat_metrics``, and this module reuses it unchanged) but the
CLAIMS the Regional Summary now makes:

* the model's own profile is measured with the float's formula, so a difference
  between the two numbers cannot be blamed on two different integrals;
* the 2D-vs-3D ratio is computed from whatever data arrived, never remembered;
* when the backend cannot compute one, it says so instead of emitting a number,
  because a confident wrong ratio is worse than a missing one.
"""

import pytest

from app.services.ocean_heat_metrics import (
    MODEL_PROFILE_MAX_GAP_M,
    REFERENCE_ISOTHERM_CANDIDATES_C,
    TCHP_ISOTHERM_C,
    compute_model_profile_tchp,
    summarize_model_tchp_definition,
)

# A six-level model profile on the shape the resolved native axis actually has:
# coarse near the surface, 150 m between 100 and 250 m. Values chosen so the
# 26 C crossing lands inside that widest gap, which is the case that decides
# whether the model's own gap guard is usable at all.
MODEL_DEPTHS = [0.0, 10.0, 50.0, 100.0, 250.0, 500.0]
MODEL_TEMPS = [29.0, 29.0, 28.5, 27.0, 20.0, 12.0]


class TestComputeModelProfileTchp:
    def test_uses_the_same_formula_as_the_float_side(self):
        """The same integral, so a difference is water, not convention.

        The integral stops at the 26 C crossing, which this profile puts at
        121.43 m (between the 27 C level at 100 m and the 20 C level at
        250 m). Excess above 26 C is 3, 3, 2.5, 1 K at the levels inside the
        warm layer, plus 0 at the crossing itself.
        """
        model = compute_model_profile_tchp(MODEL_DEPTHS, MODEL_TEMPS)
        assert model["d26M"] == pytest.approx(121.43, abs=0.01)

        crossing = 100 + (1.0 / 7.0) * 150
        integral_k_m = (
            (3.0 + 3.0) / 2 * 10
            + (3.0 + 2.5) / 2 * 40
            + (2.5 + 1.0) / 2 * 50
            + (1.0 + 0.0) / 2 * (crossing - 100)
        )
        expected = integral_k_m * 1026 * 3985 / 1e7
        assert model["tchpKjCm2"] == pytest.approx(expected, rel=1e-6)

    def test_non_finite_levels_are_dropped_not_fatal(self):
        model = compute_model_profile_tchp(
            [0.0, 10.0, float("nan"), 50.0], [29.0, 29.0, 29.0, 25.0]
        )
        assert model["tchpKjCm2"] is not None
        assert model["status"] == "OK"

    def test_a_profile_entirely_below_the_isotherm_is_a_measured_zero(self):
        """0.0 means "no heat here", never "could not measure"."""
        model = compute_model_profile_tchp([0.0, 50.0], [24.0, 22.0])
        assert model["tchpKjCm2"] == 0.0
        assert model["status"] == "SURFACE_BELOW_ISOTHERM"

    def test_refuses_a_profile_with_fewer_than_two_levels(self):
        model = compute_model_profile_tchp([0.0], [29.0])
        assert model["tchpKjCm2"] is None
        assert model["reason"]

    def test_handles_none_input_without_raising(self):
        assert compute_model_profile_tchp(None, None)["tchpKjCm2"] is None

    def test_the_model_gap_guard_is_wider_than_the_float_one(self):
        """The float's 25 m guard would reject every model profile outright."""
        assert MODEL_PROFILE_MAX_GAP_M > 150.0
        # The widest gap in a realistic six-level profile is 150 m.
        result = compute_model_profile_tchp(MODEL_DEPTHS, MODEL_TEMPS)
        assert result["status"] == "OK"


class TestSummarizeModelTchpDefinition:
    def _entry(self, field):
        return {
            "fieldKjCm2": field,
            "depthsM": MODEL_DEPTHS,
            "temperaturesC": MODEL_TEMPS,
        }

    def test_ratio_at_the_float_isotherm_exceeds_one(self):
        """A field larger than the same formula on the model's own profile."""
        field = 200.0
        summary = summarize_model_tchp_definition([self._entry(field)])
        assert summary["status"] == "OK"
        # The published ratio is rounded to 4 dp like every other summary figure.
        assert summary["ratioAtFloatIsothermMedian"] == pytest.approx(
            field / summary["modelProfileMeanKjCm2"], abs=5e-4
        )
        assert summary["ratioAtFloatIsothermMedian"] > 1.0

    def test_finds_the_reference_isotherm_that_reproduces_the_field(self):
        """A field that IS the model's own value must fit at ratio ~1."""
        profile_value = compute_model_profile_tchp(MODEL_DEPTHS, MODEL_TEMPS)["tchpKjCm2"]
        summary = summarize_model_tchp_definition([self._entry(profile_value)])
        assert summary["status"] == "OK"
        assert summary["referenceIsothermC"] is not None
        # At the fitted isotherm the field is reproduced, which is the whole
        # evidence that the two numbers differ by convention and not by error.
        assert summary["referenceRatio"] == pytest.approx(1.0, abs=0.02)

    def test_reference_isotherm_is_scanned_not_assumed(self):
        """Moving the field must move the fitted isotherm with it."""
        shallow = summarize_model_tchp_definition([self._entry(400.0)])
        deep = summarize_model_tchp_definition([self._entry(60.0)])
        # TCHP falls as the reference isotherm deepens, so a smaller field must
        # be reproduced by a DEEPER isotherm.
        assert shallow["referenceIsothermC"] < deep["referenceIsothermC"]
        assert shallow["referenceIsothermC"] in REFERENCE_ISOTHERM_CANDIDATES_C
        assert deep["referenceIsothermC"] in REFERENCE_ISOTHERM_CANDIDATES_C

    def test_no_usable_profiles_returns_unavailable_not_a_guess(self):
        summary = summarize_model_tchp_definition([])
        assert summary["status"] == "UNAVAILABLE"
        assert summary["profileCount"] == 0
        assert summary["ratioAtFloatIsothermMedian"] is None
        assert summary["referenceIsothermC"] is None

    def test_a_field_of_zero_is_excluded_rather_than_dividing_by_it(self):
        summary = summarize_model_tchp_definition([self._entry(0.0)])
        assert summary["status"] == "UNAVAILABLE"

    def test_reports_the_profile_count_it_actually_used(self):
        summary = summarize_model_tchp_definition(
            [self._entry(120.0), self._entry(0.0), self._entry(90.0)]
        )
        assert summary["profileCount"] == 2
        assert summary["floatIsothermC"] == TCHP_ISOTHERM_C