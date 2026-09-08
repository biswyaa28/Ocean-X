"""Fixture model data source (STEP 3B §23).

Wraps the deterministic analytic field in ``app.data.fixtures`` behind the same
:class:`~app.datasources.base.ModelDataSource` interface used by the real NetCDF
source, so tests and offline demos exercise the identical service code path.

Every object returned carries ``is_fixture=True``.
"""
from __future__ import annotations

from datetime import datetime
from typing import List, Optional, Sequence

import numpy as np

from app.core.config import settings
from app.data.fixtures import (
    FIXTURE_DEPTHS,
    FIXTURE_LATITUDES,
    FIXTURE_LONGITUDES,
    FIXTURE_NOTICE,
    FIXTURE_TIMES,
    FIXTURE_VARIABLE_LONG_NAMES,
    FIXTURE_VARIABLE_NAMES,
    FIXTURE_VARIABLE_UNITS,
    mock_sal,
    mock_temp,
)
from app.datasources.base import (
    ModelDataSource,
    ModelGridInfo,
    ModelProfileSample,
    ModelRegionSlice,
    VariableNotFoundError,
    VariableResolution,
)
from app.datasources.variables import candidates_for, resolve_name

DATA_TIER = "local_deterministic_fixture"


class FixtureModelDataSource(ModelDataSource):
    """Deterministic synthetic model source. No files, no network."""

    def __init__(self) -> None:
        self._open = False
        self._lats = np.asarray(FIXTURE_LATITUDES, dtype="float64")
        self._lons = np.asarray(FIXTURE_LONGITUDES, dtype="float64")
        self._depths = np.asarray(FIXTURE_DEPTHS, dtype="float64")
        self._times = list(FIXTURE_TIMES)

    # -- lifecycle -----------------------------------------------------
    def open(self) -> "FixtureModelDataSource":
        self._open = True
        return self

    def close(self) -> None:
        self._open = False

    # -- metadata ------------------------------------------------------
    def resolve_variable(self, logical_name: str) -> VariableResolution:
        available = list(FIXTURE_VARIABLE_NAMES.values())
        actual, tried = resolve_name(logical_name, available, candidates_for(logical_name))
        return VariableResolution(
            logical_name=logical_name,
            actual_name=actual,
            units=FIXTURE_VARIABLE_UNITS.get(actual),
            long_name=FIXTURE_VARIABLE_LONG_NAMES.get(actual),
            standard_name=None,
            candidates_tried=tried,
        )

    def grid_info(self) -> ModelGridInfo:
        resolved = {}
        for logical in FIXTURE_VARIABLE_NAMES:
            try:
                resolved[logical] = self.resolve_variable(logical)
            except VariableNotFoundError:
                continue
        return ModelGridInfo(
            dataset_id=settings.TARGET_DATASET_ID,
            dataset_name=settings.TARGET_DATASET_NAME,
            model=settings.TARGET_MODEL_NAME,
            model_version=settings.TARGET_MODEL_VERSION,
            source=(
                "Deterministic synthetic fixture (development). Structurally "
                "mirrors Copernicus Marine GLORYS12V1; contains no GLORYS data."
            ),
            data_tier=DATA_TIER,
            latitudes=self._lats,
            longitudes=self._lons,
            depths_m=self._depths,
            times=list(self._times),
            available_variables=resolved,
            spatial_resolution=(
                f"{settings.LON_MIN:g}–{settings.LON_MAX:g}°E at 1.0° (fixture); "
                "target product is ≈1/12°"
            ),
            temporal_resolution="daily · 00:00 UTC (fixture); target product is daily/monthly",
            region=(
                f"{settings.REGION_NAME} ({settings.LON_MIN:g}°E–{settings.LON_MAX:g}°E, "
                f"{abs(settings.LAT_MIN):g}°S–{settings.LAT_MAX:g}°N)"
            ),
            notes=FIXTURE_NOTICE,
            is_fixture=True,
        )

    def available_times(self) -> List[datetime]:
        return list(self._times)

    def depth_coordinates(self) -> np.ndarray:
        return self._depths.copy()

    # -- internals -----------------------------------------------------
    def _value(self, logical: str, lon: float, lat: float, depth: float, time_index: int) -> float:
        if logical == "temperature":
            return mock_temp(lon, lat, depth, time_index)
        if logical == "salinity":
            return mock_sal(lon, lat, depth, time_index)
        raise VariableNotFoundError(f"fixture source cannot evaluate '{logical}'")

    def _check_indices(
        self,
        time_index: Optional[int] = None,
        depth_index: Optional[int] = None,
        lat_index: Optional[int] = None,
        lon_index: Optional[int] = None,
    ) -> None:
        if time_index is not None and not 0 <= time_index < len(self._times):
            raise IndexError(f"time_index {time_index} out of range [0, {len(self._times) - 1}]")
        if depth_index is not None and not 0 <= depth_index < self._depths.size:
            raise IndexError(f"depth_index {depth_index} out of range [0, {self._depths.size - 1}]")
        if lat_index is not None and not 0 <= lat_index < self._lats.size:
            raise IndexError(f"lat_index {lat_index} out of range [0, {self._lats.size - 1}]")
        if lon_index is not None and not 0 <= lon_index < self._lons.size:
            raise IndexError(f"lon_index {lon_index} out of range [0, {self._lons.size - 1}]")

    # -- data retrieval ------------------------------------------------
    def region_slice(
        self,
        variable: str,
        time_index: int,
        depth_index: int,
        bbox: Optional[Sequence[float]] = None,
    ) -> ModelRegionSlice:
        resolution = self.resolve_variable(variable)
        self._check_indices(time_index=time_index, depth_index=depth_index)

        lats, lons = self._lats, self._lons
        if bbox is not None:
            lon_min, lat_min, lon_max, lat_max = (float(v) for v in bbox)
            # Slice before computing: only the requested subset is evaluated.
            lat_mask = (lats >= lat_min) & (lats <= lat_max)
            lon_mask = (lons >= lon_min) & (lons <= lon_max)
            lats, lons = lats[lat_mask], lons[lon_mask]

        depth = float(self._depths[depth_index])
        values = np.empty((lats.size, lons.size), dtype="float64")
        for j, lat in enumerate(lats):
            for i, lon in enumerate(lons):
                values[j, i] = self._value(variable, float(lon), float(lat), depth, time_index)

        return ModelRegionSlice(
            variable=resolution,
            time=self._times[time_index],
            time_index=time_index,
            depth_m=depth,
            depth_index=depth_index,
            latitudes=lats.copy(),
            longitudes=lons.copy(),
            values=values,
            units=resolution.units,
            is_fixture=True,
        )

    def profile_at(
        self,
        variable: str,
        time_index: int,
        lat_index: int,
        lon_index: int,
    ) -> ModelProfileSample:
        resolution = self.resolve_variable(variable)
        self._check_indices(time_index=time_index, lat_index=lat_index, lon_index=lon_index)

        lat = float(self._lats[lat_index])
        lon = float(self._lons[lon_index])
        values = np.asarray(
            [self._value(variable, lon, lat, float(z), time_index) for z in self._depths],
            dtype="float64",
        )
        return ModelProfileSample(
            variable=resolution,
            time=self._times[time_index],
            time_index=time_index,
            latitude=lat,
            longitude=lon,
            lat_index=lat_index,
            lon_index=lon_index,
            depths_m=self._depths.copy(),
            values=values,
            units=resolution.units,
            is_fixture=True,
            notes=[FIXTURE_NOTICE],
        )
