"""Model Service for OCEAN-X (STEP 3B §4).

Serves model metadata, timestamps, depth levels and 2-D field slices by
delegating to a :class:`~app.datasources.base.ModelDataSource`. This service
never touches xarray, NetCDF files or fixture internals directly — swapping
``settings.MODEL_SOURCE`` between ``"fixture"`` and ``"netcdf"`` changes nothing
here and nothing in the API contract.
"""
from __future__ import annotations

from typing import List, Optional

import numpy as np

from app.core.config import settings
from app.datasources import get_model_data_source
from app.datasources.base import ModelDataSource, VariableNotFoundError
from app.models.schemas import DatasetMetadata, ModelDepth, ModelSlice, ModelTime
from app.science.provenance import unit_symbol

SUPPORTED_VARIABLES = ("temperature", "salinity")


class ModelService:
    def __init__(self, source_factory=get_model_data_source) -> None:
        self._source_factory = source_factory

    @property
    def source(self) -> ModelDataSource:
        return self._source_factory()

    # ------------------------------------------------------------------
    def get_metadata(self) -> DatasetMetadata:
        grid = self.source.grid_info()
        resolved = {
            logical: res.actual_name for logical, res in grid.available_variables.items()
        }
        units = {
            logical: (res.units or "unknown")
            for logical, res in grid.available_variables.items()
        }
        status = (
            "Development / Local Fixture Mode"
            if grid.is_fixture
            else "NetCDF dataset mode (real model output)"
        )
        return DatasetMetadata(
            dataset_id=grid.dataset_id,
            dataset_name=grid.dataset_name,
            model=grid.model,
            model_version=grid.model_version,
            variables=list(grid.available_variables.keys()),
            spatial_resolution=grid.spatial_resolution or "unknown",
            temporal_resolution=grid.temporal_resolution or "unknown",
            depth_levels=[float(z) for z in grid.depths_m],
            region=grid.region or settings.REGION_NAME,
            units=units,
            source=grid.source,
            processing_status=status,
            data_tier=grid.data_tier,
            notes=grid.notes,
            model_source=settings.MODEL_SOURCE,
            resolved_variable_names=resolved,
            is_fixture=grid.is_fixture,
        )

    def get_times(self) -> List[ModelTime]:
        return [
            ModelTime(
                index=i,
                iso_time=t.isoformat(),
                timestamp_utc=t.strftime("%Y-%m-%d %H:%M UTC"),
            )
            for i, t in enumerate(self.source.available_times())
        ]

    def get_depths(self) -> List[ModelDepth]:
        return [
            ModelDepth(index=i, depth_m=float(z))
            for i, z in enumerate(self.source.depth_coordinates())
        ]

    # ------------------------------------------------------------------
    def get_slice(
        self,
        time_index: Optional[int] = 0,
        depth_index: Optional[int] = 0,
        variable: Optional[str] = "temperature",
    ) -> ModelSlice:
        """2-D horizontal field slice at a time/depth index.

        Out-of-range indices are clamped to 0 to preserve the STEP 3A behaviour of
        this presentation endpoint. This endpoint is for visualisation only; the
        scientific comparison never reads a UI-selected index (§15).
        """
        source = self.source
        times = source.available_times()
        depths = source.depth_coordinates()

        if variable not in SUPPORTED_VARIABLES:
            variable = "temperature"
        if time_index is None or not 0 <= time_index < len(times):
            time_index = 0
        if depth_index is None or not 0 <= depth_index < depths.size:
            depth_index = 0

        try:
            sl = source.region_slice(
                variable=variable,
                time_index=time_index,
                depth_index=depth_index,
                bbox=settings.REGION_BBOX,
            )
        except VariableNotFoundError as exc:
            raise VariableNotFoundError(
                f"cannot serve slice: {exc}"
            ) from exc

        values = np.asarray(sl.values, dtype="float64")
        finite = values[np.isfinite(values)]
        # NaN is not valid JSON: land/masked cells are emitted as null, never 0.
        rows: List[List[Optional[float]]] = [
            [None if not np.isfinite(v) else float(v) for v in row] for row in values
        ]

        lats, lons = sl.latitudes, sl.longitudes
        dlat = float(np.median(np.diff(lats))) if lats.size > 1 else 0.0
        dlon = float(np.median(np.diff(lons))) if lons.size > 1 else 0.0

        return ModelSlice(
            variable=variable,
            depth=float(sl.depth_m),
            depth_index=sl.depth_index,
            time=sl.time.isoformat(),
            time_index=sl.time_index,
            lon0=float(lons[0]) if lons.size else 0.0,
            lat0=float(lats[0]) if lats.size else 0.0,
            dlon=dlon,
            dlat=dlat,
            nlons=int(lons.size),
            nlats=int(lats.size),
            values=rows,
            min_value=float(finite.min()) if finite.size else 0.0,
            max_value=float(finite.max()) if finite.size else 0.0,
            unit=unit_symbol(sl.units),
            model_variable_name=sl.variable.actual_name,
            is_fixture=sl.is_fixture,
        )


model_service = ModelService()
