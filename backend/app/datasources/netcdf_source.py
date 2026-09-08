"""Real NetCDF / xarray model data source (STEP 3B §4, §5, §26).

This is the pathway for actual Copernicus Marine ``GLOBAL_MULTIYEAR_PHY_001_030``
(GLORYS12V1) files. It is configured, never automatic: nothing here downloads
data, contacts a network service, or requires credentials. Point
``settings.MODEL_NETCDF_PATH`` at a locally available NetCDF file or glob and set
``settings.MODEL_SOURCE = "netcdf"``.

Performance policy (§26)
------------------------
* ``open_dataset``/``open_mfdataset`` with ``decode_times=True`` and lazy backing.
* ``chunks`` is applied only when a chunk manager (dask) is importable; without
  dask the dataset is still opened lazily by the backend and chunking is skipped
  rather than raising.
* Selection is always index-based (``isel``) so only the requested slice is
  materialised. The global field is never read into memory to serve a profile.
"""
from __future__ import annotations

import glob as _glob
from datetime import datetime, timezone
from typing import Dict, List, Optional, Sequence

import numpy as np
import pandas as pd
import xarray as xr

from app.core.config import settings
from app.datasources.base import (
    ModelDataSource,
    ModelGridInfo,
    ModelProfileSample,
    ModelRegionSlice,
    VariableNotFoundError,
    VariableResolution,
)
from app.datasources.variables import (
    coordinate_candidates_for,
    describe_variable,
    normalise_values,
    resolve_name,
)

DATA_TIER = "netcdf_dataset"

# Preferred xarray engines in order. Availability is probed at open time; the
# development environment may only have the scipy (NetCDF3) backend.
_ENGINE_PREFERENCE = ("netcdf4", "h5netcdf", "scipy")


def _dask_available() -> bool:
    try:
        import dask  # noqa: F401
    except ImportError:
        return False
    return True


def _as_utc(value) -> datetime:
    ts = pd.Timestamp(value)
    if ts.tzinfo is None:
        ts = ts.tz_localize("UTC")
    return ts.tz_convert("UTC").to_pydatetime()


class NetCDFModelDataSource(ModelDataSource):
    """xarray-backed model source for real model output.

    ``depth_sign`` handles products that store the vertical coordinate as a
    negative elevation instead of a positive depth. It is detected from the data
    and recorded, never assumed.
    """

    def __init__(
        self,
        path: Optional[str] = None,
        *,
        chunks: Optional[Dict[str, int]] = None,
        engine: Optional[str] = None,
        dataset_id: Optional[str] = None,
        dataset_name: Optional[str] = None,
        model: Optional[str] = None,
        model_version: Optional[str] = None,
    ) -> None:
        self.path = path if path is not None else settings.MODEL_NETCDF_PATH
        if not self.path:
            raise ValueError(
                "MODEL_NETCDF_PATH is not configured; cannot open a NetCDF model source"
            )
        self._requested_chunks = settings.MODEL_NETCDF_CHUNKS if chunks is None else chunks
        self._engine = engine
        self._ds: Optional[xr.Dataset] = None
        self._coord_names: Dict[str, str] = {}
        self._times: Optional[List[datetime]] = None
        self._depths: Optional[np.ndarray] = None
        self._depth_sign_note: Optional[str] = None
        self._opened_with: Dict[str, object] = {}

        self.dataset_id = dataset_id or settings.TARGET_DATASET_ID
        self.dataset_name = dataset_name or settings.TARGET_DATASET_NAME
        self.model = model or settings.TARGET_MODEL_NAME
        self.model_version = model_version or settings.TARGET_MODEL_VERSION

    # -- lifecycle -----------------------------------------------------
    def open(self) -> "NetCDFModelDataSource":
        if self._ds is not None:
            return self

        paths = sorted(_glob.glob(self.path)) if any(c in self.path for c in "*?[") else [self.path]
        if not paths:
            raise FileNotFoundError(f"no NetCDF file matched '{self.path}'")

        chunks = self._requested_chunks if (self._requested_chunks and _dask_available()) else None
        chunk_note = (
            f"chunks={chunks}"
            if chunks
            else "chunking skipped (no dask chunk manager available); backend lazy loading only"
        )

        engines = (self._engine,) if self._engine else _ENGINE_PREFERENCE
        errors: List[str] = []
        for engine in engines:
            try:
                if len(paths) > 1:
                    ds = xr.open_mfdataset(
                        paths, engine=engine, chunks=chunks or {}, combine="by_coords"
                    )
                else:
                    ds = xr.open_dataset(paths[0], engine=engine, chunks=chunks)
            except Exception as exc:  # engine missing or file unreadable by it
                errors.append(f"{engine}: {type(exc).__name__}: {exc}")
                continue
            self._ds = ds
            self._opened_with = {"engine": engine, "paths": paths, "chunking": chunk_note}
            break
        else:
            raise OSError(
                f"could not open '{self.path}' with any of {list(engines)}. " + " | ".join(errors)
            )

        self._resolve_coordinates()
        return self

    def close(self) -> None:
        if self._ds is not None:
            self._ds.close()
            self._ds = None
        self._times = None
        self._depths = None
        self._coord_names = {}

    @property
    def dataset(self) -> xr.Dataset:
        """The open dataset. Internal use only — never returned across the API."""
        if self._ds is None:
            raise RuntimeError("NetCDF data source is not open; call open() first")
        return self._ds

    # -- coordinate / variable discovery -------------------------------
    def _resolve_coordinates(self) -> None:
        ds = self.dataset
        names = list(ds.variables)
        for axis in ("time", "depth", "latitude", "longitude"):
            try:
                actual, _ = resolve_name(axis, names, coordinate_candidates_for(axis))
            except VariableNotFoundError as exc:
                raise VariableNotFoundError(
                    f"required coordinate axis '{axis}' not found in {self.path}: {exc}"
                ) from exc
            self._coord_names[axis] = actual

        raw_depth = np.asarray(ds[self._coord_names["depth"]].values, dtype="float64")
        finite = raw_depth[np.isfinite(raw_depth)]
        if finite.size and float(np.nanmax(finite)) <= 0.0 and float(np.nanmin(finite)) < 0.0:
            # Stored as elevation (negative down): flip to positive-down depth.
            self._depths = -raw_depth
            self._depth_sign_note = (
                f"vertical coordinate '{self._coord_names['depth']}' stored as negative "
                "elevation; negated to positive-downwards depth in metres"
            )
        else:
            self._depths = raw_depth
            self._depth_sign_note = (
                f"vertical coordinate '{self._coord_names['depth']}' interpreted as "
                "positive-downwards depth in metres"
            )

    def resolve_variable(self, logical_name: str) -> VariableResolution:
        ds = self.dataset
        actual, tried = resolve_name(logical_name, list(ds.data_vars))
        return describe_variable(logical_name, actual, dict(ds[actual].attrs), tried)

    # -- metadata ------------------------------------------------------
    def available_times(self) -> List[datetime]:
        if self._times is None:
            values = self.dataset[self._coord_names["time"]].values
            self._times = [_as_utc(v) for v in np.atleast_1d(values)]
        return list(self._times)

    def depth_coordinates(self) -> np.ndarray:
        if self._depths is None:
            self._resolve_coordinates()
        assert self._depths is not None
        return self._depths.copy()

    def grid_info(self) -> ModelGridInfo:
        ds = self.dataset
        resolved: Dict[str, VariableResolution] = {}
        for logical in settings.VARIABLE_CANDIDATES:
            try:
                resolved[logical] = self.resolve_variable(logical)
            except VariableNotFoundError:
                continue

        lats = np.asarray(ds[self._coord_names["latitude"]].values, dtype="float64")
        lons = np.asarray(ds[self._coord_names["longitude"]].values, dtype="float64")
        times = self.available_times()

        def _spacing(arr: np.ndarray) -> Optional[float]:
            return float(np.median(np.abs(np.diff(arr)))) if arr.size > 1 else None

        dlat, dlon = _spacing(lats), _spacing(lons)
        spatial = (
            f"{dlat:.4g}° lat × {dlon:.4g}° lon (from dataset coordinates)"
            if dlat and dlon
            else "single-point grid"
        )
        if len(times) > 1:
            hours = (times[1] - times[0]).total_seconds() / 3600.0
            temporal = f"≈{hours:g} h between the first two timestamps (from dataset coordinates)"
        else:
            temporal = "single timestamp"

        notes = [f"opened via {self._opened_with}"]
        if self._depth_sign_note:
            notes.append(self._depth_sign_note)
        title = ds.attrs.get("title")

        return ModelGridInfo(
            dataset_id=str(ds.attrs.get("id", self.dataset_id)),
            dataset_name=str(title) if title else self.dataset_name,
            model=self.model,
            model_version=str(ds.attrs.get("product_version", self.model_version)),
            source=str(ds.attrs.get("source", f"NetCDF dataset at {self.path}")),
            data_tier=DATA_TIER,
            latitudes=lats,
            longitudes=lons,
            depths_m=self.depth_coordinates(),
            times=times,
            available_variables=resolved,
            spatial_resolution=spatial,
            temporal_resolution=temporal,
            region=(
                f"lat [{float(lats.min()):.4g}, {float(lats.max()):.4g}], "
                f"lon [{float(lons.min()):.4g}, {float(lons.max()):.4g}]"
            ),
            notes=" | ".join(notes),
            is_fixture=False,
        )

    # -- data retrieval ------------------------------------------------
    def _select(self, actual_name: str, **isel: int) -> xr.DataArray:
        """Index-based selection, dropping any singleton dimension not addressed."""
        da = self.dataset[actual_name]
        valid = {k: v for k, v in isel.items() if k in da.dims}
        return da.isel(**valid)

    def region_slice(
        self,
        variable: str,
        time_index: int,
        depth_index: int,
        bbox: Optional[Sequence[float]] = None,
    ) -> ModelRegionSlice:
        resolution = self.resolve_variable(variable)
        c = self._coord_names
        da = self._select(
            resolution.actual_name,
            **{c["time"]: time_index, c["depth"]: depth_index},
        )

        lats = np.asarray(self.dataset[c["latitude"]].values, dtype="float64")
        lons = np.asarray(self.dataset[c["longitude"]].values, dtype="float64")
        if bbox is not None:
            lon_min, lat_min, lon_max, lat_max = (float(v) for v in bbox)
            lat_idx = np.flatnonzero((lats >= lat_min) & (lats <= lat_max))
            lon_idx = np.flatnonzero((lons >= lon_min) & (lons <= lon_max))
            if lat_idx.size == 0 or lon_idx.size == 0:
                raise ValueError(f"bbox {tuple(bbox)} selects no grid points from {self.path}")
            # Slice before computing so only the region is materialised.
            da = da.isel({c["latitude"]: lat_idx, c["longitude"]: lon_idx})
            lats, lons = lats[lat_idx], lons[lon_idx]

        da = da.transpose(c["latitude"], c["longitude"])
        values, units, note = normalise_values(
            np.asarray(da.values, dtype="float64"), variable, da.attrs.get("units")
        )
        depth = float(self.depth_coordinates()[depth_index])
        return ModelRegionSlice(
            variable=resolution,
            time=self.available_times()[time_index],
            time_index=time_index,
            depth_m=depth,
            depth_index=depth_index,
            latitudes=lats,
            longitudes=lons,
            values=values,
            units=units if note is None else units,
            is_fixture=False,
        )

    def profile_at(
        self,
        variable: str,
        time_index: int,
        lat_index: int,
        lon_index: int,
    ) -> ModelProfileSample:
        resolution = self.resolve_variable(variable)
        c = self._coord_names
        da = self._select(
            resolution.actual_name,
            **{c["time"]: time_index, c["latitude"]: lat_index, c["longitude"]: lon_index},
        )
        raw = np.asarray(np.atleast_1d(da.values), dtype="float64")
        values, units, note = normalise_values(raw, variable, da.attrs.get("units"))

        notes: List[str] = []
        if note:
            notes.append(note)
        if self._depth_sign_note:
            notes.append(self._depth_sign_note)

        lats = np.asarray(self.dataset[c["latitude"]].values, dtype="float64")
        lons = np.asarray(self.dataset[c["longitude"]].values, dtype="float64")
        return ModelProfileSample(
            variable=resolution,
            time=self.available_times()[time_index],
            time_index=time_index,
            latitude=float(lats[lat_index]),
            longitude=float(lons[lon_index]),
            lat_index=lat_index,
            lon_index=lon_index,
            depths_m=self.depth_coordinates(),
            values=values,
            units=units,
            is_fixture=False,
            notes=notes,
        )
