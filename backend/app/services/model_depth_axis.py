"""Which vertical axis the HYCOM model values are assigned to.

Kept apart from the matchup and the provider (which both need it) so neither
has to import the other. Matches the producer's raw file.
"""

import logging
from typing import Any, Dict, List, Optional, Sequence, Tuple

import numpy as np
import xarray as xr

from app.core.config import settings
from app.services.matchup_interpolation import nodes_from_cell_bounds

logger = logging.getLogger(__name__)

# Observed from INCOIS raw OPeNDAP on 2026-10-08..2026-10-10. Used only as a consistency warning, never to override data.
NATIVE_HYCOM_DEPTHS_REFERENCE: List[float] = [0.0, 10.0, 50.0, 100.0, 250.0, 500.0]


def derive_bounds_from_nodes(nodes: Sequence[float]) -> np.ndarray:
    """Derive cell bounds from node depths using interior midpoints and mirrored ends.

    Cell 0 lower: d0 - (d1 - d0) / 2
    Interior edges: (d_{k-1} + d_k) / 2
    Cell N-1 upper: d_{N-1} + (d_{N-1} - d_{N-2}) / 2
    """
    arr = np.asarray(nodes, dtype=float)
    n = len(arr)
    if n == 0:
        return np.empty((0, 2), dtype=float)
    if n == 1:
        return np.array([[arr[0], arr[0]]], dtype=float)
    bounds = np.zeros((n, 2), dtype=float)
    bounds[0, 0] = arr[0] - (arr[1] - arr[0]) / 2.0
    bounds[0, 1] = (arr[0] + arr[1]) / 2.0
    for i in range(1, n - 1):
        bounds[i, 0] = (arr[i - 1] + arr[i]) / 2.0
        bounds[i, 1] = (arr[i] + arr[i + 1]) / 2.0
    bounds[-1, 0] = (arr[-2] + arr[-1]) / 2.0
    bounds[-1, 1] = arr[-1] + (arr[-1] - arr[-2]) / 2.0
    return bounds


def _find_bounds_variable(dataset: xr.Dataset) -> Optional[str]:
    """Find the bounds variable name in dataset, if present."""
    if "DEPTH" in dataset.coords:
        bounds_attr = dataset["DEPTH"].attrs.get("bounds")
        if bounds_attr and bounds_attr in dataset.variables:
            return bounds_attr
    for candidate in ("DEPTH_bounds", "DEPTH_bnds", "depth_bounds", "depth_bnds"):
        if candidate in dataset.variables:
            return candidate
    return None


def resolve_model_depths(dataset: xr.Dataset, axis_mode: Optional[str] = None) -> Tuple[np.ndarray, str]:
    """The model depth axis to compare against, and which rule produced it.

    ``settings.MODEL_DEPTH_AXIS`` selects the rule:

    * ``"native"`` (default) - matches the producer's raw file.
      If stored DEPTH is an exact midpoint of its own bounds variable
      (DEPTH_bounds or DEPTH_bnds) AND the bounds are exactly reproduced by
      deriving them from reconstructed nodes (nodes_from_cell_bounds ->
      midpoints/mirrored ends), returns the reconstructed nodes with rule
      ``"native_from_bounds"``. Otherwise (e.g. raw files whose DEPTH already
      differs from the bounds midpoints), returns stored DEPTH with rule
      ``"native_file"``. If bounds are missing, falls back to stored DEPTH with
      rule ``"native_file_no_bounds"``.
    * ``"ncss_file"`` (legacy) - use the file's DEPTH variable exactly as stored.
    * ``"file"`` - deprecated alias for ``"ncss_file"``.
    * ``"bounds_nodes"`` - deprecated alias for ``"native"``.
    """
    raw_mode = (axis_mode or settings.MODEL_DEPTH_AXIS or "native").strip().lower()
    if raw_mode == "file":
        logger.warning("OCEANX_MODEL_DEPTH_AXIS='file' is deprecated, alias for 'ncss_file'")
        mode = "ncss_file"
    elif raw_mode == "bounds_nodes":
        logger.warning("OCEANX_MODEL_DEPTH_AXIS='bounds_nodes' is deprecated, alias for 'native'")
        mode = "native"
    else:
        mode = raw_mode

    file_depths = (
        np.atleast_1d(dataset["DEPTH"].values).astype(float)
        if "DEPTH" in dataset.coords
        else np.array([0.0])
    )

    if mode == "ncss_file":
        return file_depths, "ncss_file"

    # Default / "native" mode
    bounds_var = _find_bounds_variable(dataset)
    if bounds_var is None:
        resolved = file_depths
        rule = "native_file_no_bounds"
    else:
        bounds = np.asarray(dataset[bounds_var].values, dtype=float)
        if bounds.ndim != 2 or bounds.shape[1] != 2 or bounds.shape[0] != file_depths.size:
            resolved = file_depths
            rule = "native_file_no_bounds"
        else:
            bounds_midpoints = 0.5 * (bounds[:, 0] + bounds[:, 1])
            depth_is_midpoint = bool(np.allclose(file_depths, bounds_midpoints, atol=1e-5))

            nodes = nodes_from_cell_bounds(bounds)
            if nodes is not None:
                derived_bounds = derive_bounds_from_nodes(nodes)
                bounds_reproduced = bool(np.allclose(derived_bounds, bounds, atol=1e-5))
            else:
                bounds_reproduced = False

            if depth_is_midpoint and bounds_reproduced:
                resolved = np.asarray(nodes, dtype=float)
                rule = "native_from_bounds"
            else:
                resolved = file_depths
                rule = "native_file"

    # Pinned sanity check: consistency warning only, never override data
    if mode == "native":
        if not (
            len(resolved) == len(NATIVE_HYCOM_DEPTHS_REFERENCE)
            and np.allclose(resolved, NATIVE_HYCOM_DEPTHS_REFERENCE, atol=1e-5)
        ):
            logger.warning(
                "Resolved native depths %s differ from reference %s",
                resolved.tolist(),
                NATIVE_HYCOM_DEPTHS_REFERENCE,
            )

    return resolved, rule


def resolve_model_depth_details(dataset: xr.Dataset, axis_mode: Optional[str] = None) -> Dict[str, Any]:
    """Helper returning resolved depths, rule, and stored file depths."""
    depths, rule = resolve_model_depths(dataset, axis_mode=axis_mode)
    file_depths = (
        np.atleast_1d(dataset["DEPTH"].values).astype(float).tolist()
        if "DEPTH" in dataset.coords
        else [0.0]
    )
    return {
        "depths": depths.tolist(),
        "rule": rule,
        "storedFileDepths": file_depths,
    }


def apply_model_depth_axis(dataset: xr.Dataset) -> Tuple[xr.Dataset, str]:
    """Return ``dataset`` with its DEPTH coordinate replaced by the resolved axis."""
    depths, rule = resolve_model_depths(dataset)
    if "DEPTH" not in dataset.coords:
        return dataset, rule
    attrs = dict(dataset["DEPTH"].attrs)
    attrs["oceanx_depth_axis"] = rule
    return dataset.assign_coords(DEPTH=("DEPTH", depths, attrs)), rule
