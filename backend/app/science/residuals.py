"""Analysis–Observation Residual and comparison metrics (STEP 3B §16, §17).

Definition
----------
The comparison quantity is the **Analysis–Observation Residual**

    D = M - O

where ``M`` is the model *analysis* value and ``O`` is the observation value.
GLORYS12V1 is an assimilative reanalysis: the Argo observations being compared
against are themselves assimilated into it. A non-zero residual therefore
describes the analysis increment relative to the observation, not the error of a
free-running forecast. This quantity is never called "model error".

Metrics, over the ``n`` valid pairs only:

    bias = mean(M - O)
    MAE  = mean(|M - O|)
    RMSE = sqrt(mean((M - O)^2))

With no valid pairs (``n == 0``) every metric is ``None``. Zero is a physical
statement of perfect agreement and is never emitted for absent data (§17, §20).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Optional, Sequence

import numpy as np

RESIDUAL_LABEL = "Analysis–Observation Residual"
RESIDUAL_DEFINITION = "D = M - O (model analysis minus observation)"


@dataclass(frozen=True)
class ResidualSeries:
    """Paired residuals on the common comparison depth grid."""

    depths_m: np.ndarray
    model_values: np.ndarray
    observation_values: np.ndarray
    residuals: np.ndarray
    label: str = RESIDUAL_LABEL
    definition: str = RESIDUAL_DEFINITION
    n_unpaired_discarded: int = 0
    notes: List[str] = field(default_factory=list)

    @property
    def n(self) -> int:
        return int(self.residuals.size)

    def records(self) -> List[dict]:
        """One record per valid comparison depth (§16)."""
        return [
            {
                "depth_m": float(z),
                "model": float(m),
                "observation": float(o),
                "residual": float(r),
            }
            for z, m, o, r in zip(
                self.depths_m, self.model_values, self.observation_values, self.residuals
            )
        ]


def calculate_residuals(
    depths_m: Sequence[float],
    model_values: Sequence[float],
    observation_values: Sequence[float],
) -> ResidualSeries:
    """Compute ``D = M - O`` at every depth where both sides are finite.

    Pairs with a missing value on either side are discarded, not zero-filled and
    not treated as disagreement.
    """
    z = np.asarray(depths_m, dtype="float64")
    m = np.asarray(model_values, dtype="float64")
    o = np.asarray(observation_values, dtype="float64")
    if not (z.size == m.size == o.size):
        raise ValueError(
            f"length mismatch: depths={z.size}, model={m.size}, observation={o.size}"
        )

    valid = np.isfinite(z) & np.isfinite(m) & np.isfinite(o)
    n_discarded = int(z.size - valid.sum())
    notes: List[str] = []
    if n_discarded:
        notes.append(
            f"{n_discarded} depth(s) discarded: model and/or observation value missing"
        )

    z, m, o = z[valid], m[valid], o[valid]
    return ResidualSeries(
        depths_m=z,
        model_values=m,
        observation_values=o,
        residuals=m - o,
        n_unpaired_discarded=n_discarded,
        notes=notes,
    )


@dataclass(frozen=True)
class ComparisonStatistics:
    """Summary statistics. All metrics are ``None`` when ``n == 0``."""

    n: int
    bias: Optional[float] = None
    mae: Optional[float] = None
    rmse: Optional[float] = None
    max_abs_residual: Optional[float] = None
    max_residual_depth_m: Optional[float] = None
    definitions: dict = field(
        default_factory=lambda: {
            "residual": RESIDUAL_DEFINITION,
            "bias": "mean(M - O)",
            "mae": "mean(|M - O|)",
            "rmse": "sqrt(mean((M - O)^2))",
        }
    )


def calculate_metrics(
    residuals: Sequence[float],
    depths_m: Optional[Sequence[float]] = None,
) -> ComparisonStatistics:
    """Bias, MAE, RMSE and the maximum absolute residual with its depth (§17)."""
    r = np.asarray(residuals, dtype="float64")
    z = None if depths_m is None else np.asarray(depths_m, dtype="float64")

    if z is not None and z.size != r.size:
        raise ValueError(f"length mismatch: residuals={r.size}, depths={z.size}")

    # Guard against any non-finite residual reaching the statistics.
    finite = np.isfinite(r)
    r = r[finite]
    if z is not None:
        z = z[finite]

    n = int(r.size)
    if n == 0:
        return ComparisonStatistics(n=0)

    abs_r = np.abs(r)
    k = int(np.argmax(abs_r))
    return ComparisonStatistics(
        n=n,
        bias=float(np.mean(r)),
        mae=float(np.mean(abs_r)),
        rmse=float(np.sqrt(np.mean(r**2))),
        max_abs_residual=float(abs_r[k]),
        max_residual_depth_m=None if z is None else float(z[k]),
    )
