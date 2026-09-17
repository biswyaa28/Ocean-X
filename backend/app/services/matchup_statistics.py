"""Descriptive statistics for backend-produced Argo/HYCOM matched pairs."""

import math
from typing import Any, Iterable, Literal, Optional, TypedDict


Variable = Literal["temperature", "salinity"]


class MatchupStatistics(TypedDict):
    n: int
    meanResidual: Optional[float]
    mae: Optional[float]
    rmse: Optional[float]


_VALUE_KEYS: dict[Variable, tuple[str, str, str]] = {
    "temperature": ("argoTemperatureC", "modelTemperatureC", "_temperatureResidualRaw"),
    "salinity": ("argoSalinityPSU", "modelSalinityPSU", "_salinityResidualRaw"),
}


def calculate_matchup_statistics(
    comparisons: Iterable[dict[str, Any]],
    variable: Variable,
) -> MatchupStatistics:
    """Reduce valid matched observation/model pairs using residual = HYCOM - Argo."""
    observation_key, model_key, raw_residual_key = _VALUE_KEYS[variable]
    residuals: list[float] = []

    for comparison in comparisons:
        observation = comparison.get(observation_key)
        model = comparison.get(model_key)
        raw_residual = comparison.get(raw_residual_key)
        if isinstance(raw_residual, (int, float)) and math.isfinite(raw_residual):
            residuals.append(raw_residual)
        elif (
            isinstance(observation, (int, float))
            and isinstance(model, (int, float))
            and math.isfinite(observation)
            and math.isfinite(model)
        ):
            residuals.append(model - observation)

    n = len(residuals)
    if n == 0:
        return {"n": 0, "meanResidual": None, "mae": None, "rmse": None}

    mean_residual = sum(residuals) / n
    mae = sum(abs(residual) for residual in residuals) / n
    rmse = math.sqrt(sum(residual * residual for residual in residuals) / n)
    return {
        "n": n,
        "meanResidual": mean_residual,
        "mae": mae,
        "rmse": rmse,
    }
