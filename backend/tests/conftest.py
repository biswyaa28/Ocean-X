"""Shared fixtures and builders for OCEAN-X scientific tests.

Everything here is offline: no network, no external files (§24).
"""
from datetime import datetime, timezone
from typing import List, Optional, Sequence

import numpy as np
import pytest

from app.datasources.base import (
    ModelDataSource,
    ModelGridInfo,
    ModelProfileSample,
    ModelRegionSlice,
    VariableNotFoundError,
    VariableResolution,
)
from app.science.argo_profile import build_raw_profile
from app.science.depth import pressure_from_depth


def utc(y, m, d, h=0, mi=0) -> datetime:
    return datetime(y, m, d, h, mi, tzinfo=timezone.utc)


def make_profile(
    *,
    platform_number: str = "9999999",
    cycle_number: int = 1,
    time: Optional[datetime] = None,
    latitude: float = 10.0,
    longitude: float = 70.0,
    depths_m: Optional[Sequence[float]] = None,
    pressure: Optional[Sequence[float]] = None,
    temperature: Optional[Sequence[float]] = None,
    **kwargs,
):
    """Build a RawArgoProfile from nominal depths or explicit pressures.

    Depths are converted to pressure with TEOS-10 so the profile is expressed in
    the same coordinate a real float reports.
    """
    time = time or utc(2023, 7, 2, 12)
    if pressure is None:
        depths = np.asarray(
            depths_m if depths_m is not None else [0.0, 10.0, 50.0, 100.0], dtype="float64"
        )
        pressure = pressure_from_depth(depths, latitude)
    pressure = np.asarray(pressure, dtype="float64")
    if temperature is None:
        temperature = np.linspace(28.0, 10.0, pressure.size)
    return build_raw_profile(
        platform_number=platform_number,
        cycle_number=cycle_number,
        time=time,
        latitude=latitude,
        longitude=longitude,
        pressure=pressure,
        temperature=temperature,
        **kwargs,
    )


class StubModelDataSource(ModelDataSource):
    """In-memory model source with fully controllable grid and values.

    Used to test co-location and alignment against exactly known geometry.
    """

    def __init__(
        self,
        *,
        times: Optional[List[datetime]] = None,
        latitudes: Sequence[float] = (0.0, 5.0, 10.0, 15.0),
        longitudes: Sequence[float] = (60.0, 65.0, 70.0, 75.0),
        depths_m: Sequence[float] = (0.0, 10.0, 50.0, 100.0, 500.0),
        values: Optional[np.ndarray] = None,
        variable_names: Optional[dict] = None,
        units: str = "degC",
        is_fixture: bool = True,
    ) -> None:
        self._times = list(times) if times is not None else [utc(2023, 7, 2, 12)]
        self._lats = np.asarray(latitudes, dtype="float64")
        self._lons = np.asarray(longitudes, dtype="float64")
        self._depths = np.asarray(depths_m, dtype="float64")
        self._names = variable_names or {"temperature": "thetao", "salinity": "so"}
        self._units = units
        self._is_fixture = is_fixture
        self.closed = False
        if values is None:
            shape = (len(self._times), self._depths.size, self._lats.size, self._lons.size)
            base = np.linspace(25.0, 5.0, self._depths.size)
            values = np.broadcast_to(
                base[None, :, None, None], shape
            ).astype("float64").copy()
        self._values = np.asarray(values, dtype="float64")

    def open(self):
        self.closed = False
        return self

    def close(self) -> None:
        self.closed = True

    def resolve_variable(self, logical_name: str) -> VariableResolution:
        if logical_name not in self._names:
            raise VariableNotFoundError(
                f"'{logical_name}' not available; have {sorted(self._names)}"
            )
        return VariableResolution(
            logical_name=logical_name,
            actual_name=self._names[logical_name],
            units=self._units,
            candidates_tried=[self._names[logical_name]],
        )

    def grid_info(self) -> ModelGridInfo:
        return ModelGridInfo(
            dataset_id="STUB_DATASET",
            dataset_name="Stub model",
            model="STUB",
            model_version="v0",
            source="in-memory stub",
            data_tier="test_stub",
            latitudes=self._lats,
            longitudes=self._lons,
            depths_m=self._depths,
            times=list(self._times),
            available_variables={
                k: self.resolve_variable(k) for k in self._names
            },
            is_fixture=self._is_fixture,
        )

    def available_times(self) -> List[datetime]:
        return list(self._times)

    def depth_coordinates(self) -> np.ndarray:
        return self._depths.copy()

    def region_slice(
        self, variable: str, time_index: int, depth_index: int, bbox=None
    ) -> ModelRegionSlice:
        res = self.resolve_variable(variable)
        return ModelRegionSlice(
            variable=res,
            time=self._times[time_index],
            time_index=time_index,
            depth_m=float(self._depths[depth_index]),
            depth_index=depth_index,
            latitudes=self._lats.copy(),
            longitudes=self._lons.copy(),
            values=self._values[time_index, depth_index].copy(),
            units=self._units,
            is_fixture=self._is_fixture,
        )

    def profile_at(
        self, variable: str, time_index: int, lat_index: int, lon_index: int
    ) -> ModelProfileSample:
        res = self.resolve_variable(variable)
        return ModelProfileSample(
            variable=res,
            time=self._times[time_index],
            time_index=time_index,
            latitude=float(self._lats[lat_index]),
            longitude=float(self._lons[lon_index]),
            lat_index=lat_index,
            lon_index=lon_index,
            depths_m=self._depths.copy(),
            values=self._values[time_index, :, lat_index, lon_index].copy(),
            units=self._units,
            is_fixture=self._is_fixture,
        )


@pytest.fixture
def stub_source():
    return StubModelDataSource().open()


@pytest.fixture(autouse=True)
def _reset_model_source():
    """Keep the cached process-wide data source from leaking between tests."""
    from app.datasources import reset_model_data_source

    reset_model_data_source()
    yield
    reset_model_data_source()
