"""Abstract model data source interface (STEP 3B §4).

Contract for every model backend, fixture or real NetCDF:

* open / close with deterministic resource release
* expose metadata, available times, and depth coordinates
* return a regional slice
* return a vertical profile at selected grid coordinates
* resolve and *report* the actual variable name used (§5)

Implementations must not leak xarray objects across this boundary. Returned
values are plain NumPy arrays and dataclasses.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from types import TracebackType
from typing import Dict, List, Optional, Sequence, Type

import numpy as np


class VariableNotFoundError(KeyError):
    """Raised when a required variable cannot be resolved in the dataset (§5).

    Failing loudly is mandatory: silently mapping the wrong variable would
    produce a scientifically invalid comparison.
    """


@dataclass(frozen=True)
class VariableResolution:
    """How a logical variable name resolved to a concrete dataset variable."""

    logical_name: str
    actual_name: str
    units: Optional[str] = None
    long_name: Optional[str] = None
    standard_name: Optional[str] = None
    candidates_tried: List[str] = field(default_factory=list)


@dataclass(frozen=True)
class ModelGridInfo:
    """Static description of the model grid and provenance-relevant identity."""

    dataset_id: str
    dataset_name: str
    model: str
    model_version: str
    source: str
    data_tier: str
    latitudes: np.ndarray
    longitudes: np.ndarray
    depths_m: np.ndarray
    times: List[datetime]
    available_variables: Dict[str, VariableResolution] = field(default_factory=dict)
    spatial_resolution: Optional[str] = None
    temporal_resolution: Optional[str] = None
    region: Optional[str] = None
    notes: Optional[str] = None
    # True when values are synthetic. Propagated into provenance (§25).
    is_fixture: bool = False


@dataclass(frozen=True)
class ModelRegionSlice:
    """A 2-D horizontal field at one time and one depth."""

    variable: VariableResolution
    time: datetime
    time_index: int
    depth_m: float
    depth_index: int
    latitudes: np.ndarray
    longitudes: np.ndarray
    values: np.ndarray  # shape (n_lat, n_lon)
    units: Optional[str] = None
    is_fixture: bool = False


@dataclass(frozen=True)
class ModelProfileSample:
    """A vertical profile on the model's native depth coordinate.

    ``time`` and ``time_index`` record exactly which model timestamp the values
    came from, so the comparison can never silently mix a UI-selected time with a
    co-located time (§15).
    """

    variable: VariableResolution
    time: datetime
    time_index: int
    latitude: float
    longitude: float
    lat_index: int
    lon_index: int
    depths_m: np.ndarray
    values: np.ndarray
    units: Optional[str] = None
    is_fixture: bool = False
    notes: List[str] = field(default_factory=list)


class ModelDataSource(ABC):
    """Abstract access layer for numerical ocean model output."""

    # -- lifecycle -----------------------------------------------------
    @abstractmethod
    def open(self) -> "ModelDataSource":
        """Open underlying resources. Must be idempotent."""

    @abstractmethod
    def close(self) -> None:
        """Release underlying resources. Must be safe to call repeatedly."""

    def __enter__(self) -> "ModelDataSource":
        return self.open()

    def __exit__(
        self,
        exc_type: Optional[Type[BaseException]],
        exc: Optional[BaseException],
        tb: Optional[TracebackType],
    ) -> None:
        self.close()

    # -- metadata ------------------------------------------------------
    @abstractmethod
    def grid_info(self) -> ModelGridInfo:
        """Grid geometry, coordinates and dataset identity."""

    @abstractmethod
    def available_times(self) -> List[datetime]:
        """Timestamps in ascending order, timezone-aware UTC."""

    @abstractmethod
    def depth_coordinates(self) -> np.ndarray:
        """Native depth levels in metres, positive downwards, ascending."""

    @abstractmethod
    def resolve_variable(self, logical_name: str) -> VariableResolution:
        """Resolve a logical variable name against the dataset (§5).

        Raises
        ------
        VariableNotFoundError
            If no configured candidate is present in the dataset.
        """

    # -- data retrieval ------------------------------------------------
    @abstractmethod
    def region_slice(
        self,
        variable: str,
        time_index: int,
        depth_index: int,
        bbox: Optional[Sequence[float]] = None,
    ) -> ModelRegionSlice:
        """2-D field at one time/depth, optionally restricted to ``bbox``."""

    @abstractmethod
    def profile_at(
        self,
        variable: str,
        time_index: int,
        lat_index: int,
        lon_index: int,
    ) -> ModelProfileSample:
        """Vertical profile at explicit grid indices and one model timestamp."""
