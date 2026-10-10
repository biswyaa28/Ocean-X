"""Unit tests for HYCOM model depth axis resolution and provenance.

Tests:
1. NCSS-style depths [0, 17.5, 52.5, 125, 275, 500] + bounds -> "native" recovers
   producer nodes [0, 10, 50, 100, 250, 500] with rule "native_from_bounds".
2. Raw-style dataset (DEPTH [0, 10, 50, 100, 250, 500] + same bounds) -> "native"
   returns stored values with rule "native_file".
3. Missing bounds variable -> falls back to stored DEPTH with rule "native_file_no_bounds".
4. Legacy mode "ncss_file" and deprecated aliases "file" / "bounds_nodes".
5. Round-trip test: deriving bounds from native depths reproduces file bounds exactly.
"""

import numpy as np
import pytest
import xarray as xr

from app.services.matchup_interpolation import nodes_from_cell_bounds
from app.services.model_depth_axis import (
    NATIVE_HYCOM_DEPTHS_REFERENCE,
    derive_bounds_from_nodes,
    resolve_model_depths,
    resolve_model_depth_details,
)


@pytest.fixture
def hycom_bounds():
    return np.array(
        [
            [-5.0, 5.0],
            [5.0, 30.0],
            [30.0, 75.0],
            [75.0, 175.0],
            [175.0, 375.0],
            [375.0, 625.0],
        ],
        dtype=float,
    )


def test_native_axis_from_ncss_subset_with_bounds(hycom_bounds):
    """With NCSS-style midpoint depths and bounds, 'native' recovers producer nodes."""
    dataset = xr.Dataset(
        {"DEPTH_bounds": (("DEPTH", "nv"), hycom_bounds)},
        coords={"DEPTH": [0.0, 17.5, 52.5, 125.0, 275.0, 500.0]},
    )
    depths, rule = resolve_model_depths(dataset, "native")
    assert rule == "native_from_bounds"
    assert np.allclose(depths, [0.0, 10.0, 50.0, 100.0, 250.0, 500.0])

    # Also test with default (None) which defaults to native
    depths_def, rule_def = resolve_model_depths(dataset)
    assert rule_def == "native_from_bounds"
    assert np.allclose(depths_def, [0.0, 10.0, 50.0, 100.0, 250.0, 500.0])

    # Also test with DEPTH_bnds naming convention
    dataset_bnds = xr.Dataset(
        {"DEPTH_bnds": (("DEPTH", "nv"), hycom_bounds)},
        coords={"DEPTH": [0.0, 17.5, 52.5, 125.0, 275.0, 500.0]},
    )
    depths_bnds, rule_bnds = resolve_model_depths(dataset_bnds, "native")
    assert rule_bnds == "native_from_bounds"
    assert np.allclose(depths_bnds, [0.0, 10.0, 50.0, 100.0, 250.0, 500.0])


def test_native_axis_from_raw_dataset_with_bounds(hycom_bounds):
    """With raw depths [0, 10, 50, 100, 250, 500] and the same bounds, 'native' returns stored values with rule native_file."""
    raw_depths = [0.0, 10.0, 50.0, 100.0, 250.0, 500.0]
    dataset = xr.Dataset(
        {"DEPTH_bounds": (("DEPTH", "nv"), hycom_bounds)},
        coords={"DEPTH": raw_depths},
    )
    depths, rule = resolve_model_depths(dataset, "native")
    assert rule == "native_file"
    assert np.allclose(depths, raw_depths)


def test_native_axis_fallback_when_bounds_missing():
    """No bounds variable -> falls back to stored DEPTH with rule native_file_no_bounds."""
    stored_depths = [0.0, 15.0, 45.0, 120.0]
    dataset = xr.Dataset(
        {"TEMP": (("DEPTH",), [28.0, 26.0, 24.0, 20.0])},
        coords={"DEPTH": stored_depths},
    )
    depths, rule = resolve_model_depths(dataset, "native")
    assert rule == "native_file_no_bounds"
    assert np.allclose(depths, stored_depths)


def test_legacy_ncss_file_and_aliases(hycom_bounds):
    """Test legacy 'ncss_file' and deprecated aliases 'file' / 'bounds_nodes'."""
    ncss_depths = [0.0, 17.5, 52.5, 125.0, 275.0, 500.0]
    dataset = xr.Dataset(
        {"DEPTH_bounds": (("DEPTH", "nv"), hycom_bounds)},
        coords={"DEPTH": ncss_depths},
    )

    # Legacy ncss_file
    depths_legacy, rule_legacy = resolve_model_depths(dataset, "ncss_file")
    assert rule_legacy == "ncss_file"
    assert np.allclose(depths_legacy, ncss_depths)

    # Alias 'file' -> 'ncss_file'
    depths_file, rule_file = resolve_model_depths(dataset, "file")
    assert rule_file == "ncss_file"
    assert np.allclose(depths_file, ncss_depths)

    # Alias 'bounds_nodes' -> 'native'
    depths_bn, rule_bn = resolve_model_depths(dataset, "bounds_nodes")
    assert rule_bn == "native_from_bounds"
    assert np.allclose(depths_bn, [0.0, 10.0, 50.0, 100.0, 250.0, 500.0])


def test_bounds_derivation_round_trip(hycom_bounds):
    """Round-trip test: derive bounds from native depths -> reproduces file bounds exactly."""
    native_depths = [0.0, 10.0, 50.0, 100.0, 250.0, 500.0]
    derived = derive_bounds_from_nodes(native_depths)
    assert np.allclose(derived, hycom_bounds)

    # Invert back from bounds
    recovered = nodes_from_cell_bounds(hycom_bounds)
    assert recovered is not None
    assert np.allclose(recovered, native_depths)


def test_details_helper(hycom_bounds):
    """resolve_model_depth_details returns depths, rule, and storedFileDepths."""
    dataset = xr.Dataset(
        {"DEPTH_bounds": (("DEPTH", "nv"), hycom_bounds)},
        coords={"DEPTH": [0.0, 17.5, 52.5, 125.0, 275.0, 500.0]},
    )
    details = resolve_model_depth_details(dataset, "native")
    assert details["rule"] == "native_from_bounds"
    assert details["depths"] == [0.0, 10.0, 50.0, 100.0, 250.0, 500.0]
    assert details["storedFileDepths"] == [0.0, 17.5, 52.5, 125.0, 275.0, 500.0]
    assert details["depths"] == NATIVE_HYCOM_DEPTHS_REFERENCE
