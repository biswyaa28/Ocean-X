"""Test A: TEOS-10 pressure to depth conversion (STEP 3B §10, §24.A)."""
import gsw
import numpy as np
import pytest

from app.science.depth import (
    DEPTH_CONVENTION,
    DEPTH_REFERENCE,
    MAX_VALID_PRESSURE_DBAR,
    depth_from_pressure,
    pressure_from_depth,
)


def test_uses_the_required_teos10_relationship():
    """depth must equal -gsw.z_from_p(p, lat) exactly, not an approximation."""
    p = np.array([0.0, 10.0, 100.0, 1000.0, 2000.0])
    lat = 12.5
    np.testing.assert_array_equal(depth_from_pressure(p, lat), -gsw.z_from_p(p, lat))


def test_returns_depth_in_metres_positive_downwards():
    depth = depth_from_pressure([0.0, 100.0, 1000.0], 0.0)
    assert depth[0] == pytest.approx(0.0, abs=1e-9)
    assert depth[1] > 0.0 and depth[2] > depth[1]


def test_depth_differs_from_naive_pressure_approximation():
    """Guards against a p ~= depth shortcut regressing in.

    At 1000 dbar the TEOS-10 depth is ~0.8 % below the numeric pressure value.
    """
    p = 1000.0
    depth = float(depth_from_pressure([p], 10.0)[0])
    assert abs(depth - p) > 1.0
    assert depth == pytest.approx(992.0, abs=3.0)


def test_latitude_dependence_is_real():
    """Gravity varies with latitude, so equal pressure gives unequal depth."""
    p = [1000.0]
    equator = float(depth_from_pressure(p, 0.0)[0])
    high_lat = float(depth_from_pressure(p, 60.0)[0])
    assert equator != high_lat
    assert equator > high_lat  # weaker gravity at the equator -> greater depth


def test_nan_pressure_is_preserved_as_nan_not_zero():
    depth = depth_from_pressure([0.0, np.nan, 100.0], 8.45)
    assert np.isnan(depth[1])
    assert np.isfinite(depth[0]) and np.isfinite(depth[2])
    assert depth[1] != 0.0 or np.isnan(depth[1])


def test_all_nan_input_yields_all_nan_output():
    assert np.all(np.isnan(depth_from_pressure([np.nan, np.nan], 0.0)))


def test_roundtrip_through_pressure_and_back():
    nominal = np.array([0.0, 10.0, 50.0, 100.0, 500.0, 1000.0, 2000.0])
    for lat in (-30.0, -12.1, 0.0, 8.45, 15.3, 30.0):
        p = pressure_from_depth(nominal, lat)
        np.testing.assert_allclose(depth_from_pressure(p, lat), nominal, atol=1e-9)


def test_scalar_input_is_accepted():
    assert float(depth_from_pressure(100.0, 0.0)) > 0.0


def test_empty_input_is_accepted():
    assert depth_from_pressure([], 0.0).size == 0


@pytest.mark.parametrize("bad_lat", [None, np.nan, 91.0, -91.0, float("inf")])
def test_invalid_latitude_is_rejected(bad_lat):
    with pytest.raises(ValueError):
        depth_from_pressure([100.0], bad_lat)


@pytest.mark.parametrize("bad_p", [-50.0, MAX_VALID_PRESSURE_DBAR + 1.0])
def test_implausible_pressure_is_rejected_loudly(bad_p):
    with pytest.raises(ValueError, match="plausible range"):
        depth_from_pressure([0.0, bad_p], 0.0)


def test_small_negative_surface_pressure_is_tolerated():
    """Real Argo surface data contain small negative pressures from sensor noise."""
    assert np.isfinite(depth_from_pressure([-0.3], 5.0)[0])


def test_reference_convention_is_documented():
    assert DEPTH_REFERENCE == "meters"
    assert "z_from_p" in DEPTH_CONVENTION
    assert "positive downwards" in DEPTH_CONVENTION
