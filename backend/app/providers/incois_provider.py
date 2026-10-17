import json
import logging
from pathlib import Path
from typing import Dict, Any, List, Optional
import numpy as np
import pandas as pd
import xarray as xr

from app.core.config import settings

logger = logging.getLogger(__name__)


def _hycom_data_status(ds=None) -> str:
    """Return the scientific data status for a HYCOM dataset.

    In FIXTURE mode the NetCDF global attributes will contain
    ``synthetic='true'``; this is double-checked against the active DATA_MODE.
    Returns 'SIMULATED' when serving committed fixture data, 'REAL' otherwise.
    """
    if settings.DATA_MODE == 'FIXTURE':
        return 'SIMULATED'
    # Also honour the synthetic attribute written into fixture files
    if ds is not None:
        try:
            if str(ds.attrs.get('synthetic', '')).lower() == 'true':
                return 'SIMULATED'
        except Exception:
            pass
    return 'REAL'
from app.services.model_depth_axis import (
    apply_model_depth_axis,
    stored_file_depths_from_axis,
)
from app.services.model_time_matching import (
    is_time_matched,
    resolve_model_timestamp,
)
from app.models.schemas import (
    LayerDataResponse, LayerGridData, DepthSliceResponse, DepthSliceGridData,
    ScientificProvenance,
)

# Variables exposed by the depth-aware access layer, mapped to their native
# HYCOM variable names. Deliberately excludes derived surface-only variables
# (CURRENT_SPEED, CURRENT_DIRECTION) that do not exist on the raw depth grid.
DEPTH_VARIABLES: Dict[str, Dict[str, str]] = {
    "currents": {"vars": ("UVEL", "VVEL"), "units": "m/s", "source": "INCOIS RSMC HYCOM"},
    "temperature": {"vars": ("TEMP",), "units": "°C", "source": "INCOIS RSMC HYCOM"},
    "temp": {"vars": ("TEMP",), "units": "°C", "source": "INCOIS RSMC HYCOM"},
    "sst": {"vars": ("TEMP",), "units": "°C", "source": "INCOIS RSMC HYCOM"},
    "salinity": {"vars": ("SALN",), "units": "PSU", "source": "INCOIS RSMC HYCOM"},
    "uvel": {"vars": ("UVEL",), "units": "m/s", "source": "INCOIS RSMC HYCOM"},
    "vvel": {"vars": ("VVEL",), "units": "m/s", "source": "INCOIS RSMC HYCOM"},
    "ssh": {"vars": ("SSH",), "units": "m", "source": "INCOIS RSMC HYCOM"},
    "tchp": {"vars": ("TCHP",), "units": "KJ/cm2", "source": "INCOIS RSMC HYCOM"},
    "mld": {"vars": ("MLD",), "units": "m", "source": "INCOIS RSMC HYCOM"},
}


class IncoisDatasetUnreadable(Exception):
    """A HYCOM NetCDF is installed at the configured path but will not open.

    Distinct from a dataset that was never installed: the latter is a normal
    state that the API already reports as NOT CURRENTLY INTEGRATED, so the raise
    below is gated on the path existing.
    """

    def __init__(self, path: Path, cause: Exception):
        self.path = path
        self.cause = cause
        super().__init__(
            f"INCOIS HYCOM NetCDF at {path} could not be opened "
            f"({type(cause).__name__}: {cause}). The file is installed but "
            f"unreadable, so no value from it can be served. This is not the "
            f"same as the dataset being absent."
        )
        # Stored at load time and raised later, so the chain must be attached
        # explicitly or __cause__ is lost.
        self.__cause__ = cause


class InspectPointFailed(Exception):
    """Inspecting a point raised instead of returning a value.

    inspect_point returns NO_REAL_MODEL_DATA for three legitimate reasons (no
    dataset installed, field absent, requested timestamp not in the record).
    An exception escaping the indexing path is none of those: the request could
    not be evaluated, so no claim about the model field has been measured.

    Raised rather than returned as a new status string because the only consumer
    of this payload branches on ``status`` and falls through to a "REAL" badge
    for any value it does not recognise.
    """

    def __init__(self, lat: float, lon: float, timestamp: Optional[str], cause: Exception):
        self.lat = lat
        self.lon = lon
        self.timestamp = timestamp
        self.cause = cause
        super().__init__(
            f"Inspect failed at lat={lat}, lon={lon}"
            + (f" for timestamp {timestamp}" if timestamp else "")
            + f" ({type(cause).__name__}: {cause}). The request could not be "
            f"evaluated, so this is not a statement about the model field."
        )


class DepthSliceError(Exception):
    """Base error for the depth-aware HYCOM access layer.

    Carries a structured detail dict suitable for an HTTP error response.
    """
    def __init__(self, message: str, detail: Optional[Dict[str, Any]] = None):
        super().__init__(message)
        self.message = message
        self.detail = detail or {}


class DepthSliceVariableError(DepthSliceError):
    pass


class DepthSliceTimestampError(DepthSliceError):
    pass


class DepthSliceDepthError(DepthSliceError):
    pass


class DepthSliceDatasetError(DepthSliceError):
    pass


class DepthSliceVariableUnavailableError(DepthSliceError):
    """The dataset lacks the actual variable data required for this slice.

    Raised when e.g. UVEL or VVEL is absent from the dataset so the API can
    return an honest unavailable error instead of fabricating a vector field
    or substituting another variable.
    """


class LayerDataTimestampError(DepthSliceError):
    """A surface-layer request carried a timestamp that cannot be read.

    Distinct from a request for a time simply outside the dataset: an
    unreadable one is a client error and is never answered with another day.
    """


class IncoisProvider:
    def __init__(
        self,
        nc_path: Path = settings.PROCESSED_OCEAN_FILE,
        meta_path: Path = settings.PROCESSED_OCEAN_META,
        depth_nc_path: Optional[Path] = None
    ):
        self.nc_path = nc_path
        self.meta_path = meta_path
        # Depth-aware access uses the RAW HYCOM file (which carries DEPTH);
        # fall back to the processed surface file (scalar DEPTH coord) when
        # the raw file is not installed.
        self._depth_nc_path: Optional[Path] = depth_nc_path or self._resolve_depth_nc_path()
        self._dataset: Optional[xr.Dataset] = None
        self._depth_dataset: Optional[xr.Dataset] = None
        self._metadata: Optional[Dict[str, Any]] = None
        # Stored rather than raised here so importing the app never fails on a
        # bad data file; the accessors below turn them into exceptions.
        self._dataset_error: Optional[IncoisDatasetUnreadable] = None
        self._depth_dataset_error: Optional[IncoisDatasetUnreadable] = None
        # Provenance labels only, like the Argo metadata: recorded, not raised.
        self._metadata_error: Optional[Exception] = None

    def _resolve_depth_nc_path(self) -> Optional[Path]:
        raw = settings.RAW_HYCOM_FILE
        if raw.exists():
            return raw
        if self.nc_path.exists():
            return self.nc_path
        return None

    def _get_dataset(self) -> Optional[xr.Dataset]:
        if self._dataset is None and self.nc_path.exists():
            try:
                self._dataset = xr.open_dataset(self.nc_path, engine="netcdf4", chunks={})
                self._dataset_error = None
            except Exception as e:
                logger.exception(
                    "Failed to open the processed INCOIS NetCDF at %s. The file is "
                    "installed but unreadable, so nothing from it can be served; "
                    "this is not the same as the dataset being absent.",
                    self.nc_path,
                )
                self._dataset_error = IncoisDatasetUnreadable(self.nc_path, e)
                self._dataset = None
        # Only ever non-None when the file exists but will not open.
        if self._dataset_error is not None:
            raise self._dataset_error
        return self._dataset

    def _get_depth_dataset(self) -> Optional[xr.Dataset]:
        """Open (once) and cache the dataset used for depth-aware access.

        The multi-gigabyte raw file is opened lazily a single time and
        reused for every subsequent request; xarray selection stays lazy so
        only the requested time/depth/variable slice is read from disk.
        """
        if self._depth_dataset is None and self._depth_nc_path is not None and self._depth_nc_path.exists():
            try:
                opened = xr.open_dataset(self._depth_nc_path, engine="netcdf4", chunks={})
                # One depth axis for every consumer; see model_depth_axis.
                self._depth_dataset, _rule = apply_model_depth_axis(opened)
                self._depth_dataset_error = None
            except Exception as e:
                logger.exception(
                    "Failed to open the depth-aware INCOIS HYCOM NetCDF at %s. "
                    "The file is installed but unreadable, so no depth layer can "
                    "be served; this is not the same as it being absent.",
                    self._depth_nc_path,
                )
                self._depth_dataset_error = IncoisDatasetUnreadable(
                    self._depth_nc_path, e
                )
                self._depth_dataset = None
        # Only ever non-None when the path was installed but would not open.
        if self._depth_dataset_error is not None:
            raise self._depth_dataset_error
        return self._depth_dataset

    def _require_depth_dataset(self) -> xr.Dataset:
        ds = self._get_depth_dataset()
        if ds is None:
            raise DepthSliceDatasetError(
                "Real INCOIS HYCOM depth dataset is not available.",
                detail={
                    "message": (
                        "The INCOIS RSMC HYCOM NetCDF (raw depth-resolved file) is not installed. "
                        "Install it via scripts/setup-data.py --download and retry."
                    ),
                    "expectedPath": str(self._depth_nc_path) if self._depth_nc_path else str(settings.RAW_HYCOM_FILE),
                    "source": "INCOIS RSMC HYCOM",
                },
            )
        if "DEPTH" not in ds.coords or ds["DEPTH"].size == 0:
            raise DepthSliceDatasetError(
                "The available HYCOM dataset does not expose a DEPTH coordinate.",
                detail={
                    "message": "No DEPTH coordinate found in the HYCOM dataset; depth slices cannot be served.",
                    "datasetFile": str(self._depth_nc_path),
                    "coordinates": [str(c) for c in ds.coords],
                },
            )
        return ds

    def get_metadata(self) -> Dict[str, Any]:
        if self._metadata is None and self._metadata_error is None and self.meta_path.exists():
            try:
                with open(self.meta_path, 'r', encoding='utf-8') as f:
                    self._metadata = json.load(f)
            except Exception as e:
                    logger.exception(
                        "Failed to parse the INCOIS metadata JSON at %s. The model "
                        "field is unaffected, but its provenance labels cannot be "
                        "populated.",
                        self.meta_path,
                    )
                    self._metadata_error = e
                    self._metadata = {}
        return self._metadata or {}

    @property
    def metadata_unavailable(self) -> bool:
        """True when provenance metadata could not be read (not merely absent)."""
        return self._metadata_error is not None

    def get_available_timestamps(self) -> List[str]:
        ds = self._get_dataset()
        if ds is None or "TIME" not in ds.coords:
            return []
        return [str(ts) for ts in ds["TIME"].values]

    # ============================================================
    # Depth-aware access (Phase 1A) — HYCOM model depth slices
    # ============================================================

    def get_available_depths(self) -> List[float]:
        """Native model depth levels (m) available in the depth dataset."""
        ds = self._get_depth_dataset()
        if ds is None or "DEPTH" not in ds.coords:
            return []
        return sorted(float(d) for d in np.atleast_1d(ds["DEPTH"].values))

    def get_available_depth_timestamps(self) -> List[str]:
        """Timestamps available in the depth dataset (raw file when installed)."""
        ds = self._get_depth_dataset()
        if ds is None or "TIME" not in ds.coords:
            return []
        return [str(ts) for ts in ds["TIME"].values]

    def _validate_depth_variable(self, variable: str) -> str:
        key = variable.lower().strip() if variable else ""
        if key not in DEPTH_VARIABLES:
            raise DepthSliceVariableError(
                f"Unsupported variable for HYCOM depth slices: '{variable}'.",
                detail={
                    "message": f"Variable '{variable}' is not available as a HYCOM model depth slice.",
                    "supportedVariables": sorted({v for v in DEPTH_VARIABLES if v not in ("sst", "temp", "uvel", "vvel")}),
                    "source": "INCOIS RSMC HYCOM",
                },
            )
        return key

    def _validate_depth_timestamp(self, timestamp: Optional[str]) -> Optional[pd.Timestamp]:
        if timestamp is None:
            return None
        available = self.get_available_depth_timestamps()
        if not available:
            raise DepthSliceTimestampError(
                "No timestamps available in the HYCOM depth dataset.",
                detail={"message": "Timestamp validation impossible: dataset exposes no TIME coordinate.",
                        "source": "INCOIS RSMC HYCOM"},
            )
        try:
            target = pd.to_datetime(timestamp)
            if hasattr(target, "tz_localize") and target.tzinfo is not None:
                target = target.tz_localize(None)
        except Exception:
            raise DepthSliceTimestampError(
                f"Invalid or unparseable timestamp: {timestamp}.",
                detail={
                    "message": f"Invalid or unparseable timestamp: {timestamp}.",
                    "requestedTimestamp": timestamp,
                    "source": "INCOIS RSMC HYCOM",
                },
            )
        start = pd.to_datetime(available[0]).tz_localize(None) if pd.to_datetime(available[0]).tzinfo else pd.to_datetime(available[0])
        end = pd.to_datetime(available[-1]).tz_localize(None) if pd.to_datetime(available[-1]).tzinfo else pd.to_datetime(available[-1])
        if target < start or target > end:
            raise DepthSliceTimestampError(
                f"No real INCOIS HYCOM model data is available for timestamp {timestamp}.",
                detail={
                    "message": f"No real INCOIS HYCOM model data is available for timestamp {timestamp}.",
                    "requestedTimestamp": timestamp,
                    "availableStart": str(available[0]),
                    "availableEnd": str(available[-1]),
                    "source": "INCOIS RSMC HYCOM",
                },
            )
        return target

    def _select_nearest_depth(self, depth_m: float, depths: List[float]) -> float:
        if depth_m is None or not np.isfinite(depth_m):
            raise DepthSliceDepthError(
                "Invalid depth: value must be a finite number of meters.",
                detail={
                    "message": "Invalid depth: value must be a finite number of meters.",
                    "requestedDepthM": None if depth_m is None else "non-finite",
                    "availableDepthsM": depths,
                    "source": "INCOIS RSMC HYCOM",
                },
            )
        if depth_m < 0.0:
            raise DepthSliceDepthError(
                f"Invalid depth: {depth_m} m. Depth must be >= 0 m.",
                detail={
                    "message": f"Invalid depth: {depth_m} m. Depth must be >= 0 m.",
                    "requestedDepthM": depth_m,
                    "availableDepthsM": depths,
                    "source": "INCOIS RSMC HYCOM",
                },
            )
        if depth_m > max(depths):
            raise DepthSliceDepthError(
                f"Requested depth {depth_m} m exceeds the deepest available HYCOM model level ({max(depths)} m).",
                detail={
                    "message": f"Requested depth {depth_m} m exceeds the deepest available HYCOM model level ({max(depths)} m).",
                    "requestedDepthM": depth_m,
                    "availableDepthsM": depths,
                    "source": "INCOIS RSMC HYCOM",
                },
            )
        # Explicit nearest native level selection (never interpolate).
        return min(depths, key=lambda d: abs(d - depth_m))

    def get_depth_slice(
        self,
        variable: str,
        timestamp: Optional[str],
        requested_depth_m: float,
        stride: int = 3
    ) -> DepthSliceResponse:
        """Return a HYCOM model depth slice at the nearest native model depth.

        The slice is taken from a single native model depth level (nearest to
        the request). Depth is NEVER interpolated. Missing/NaN source values
        are reported as null and counted, never silently replaced.
        """
        ds = self._require_depth_dataset()

        var_key = self._validate_depth_variable(variable)
        target_dt = self._validate_depth_timestamp(timestamp)
        depths = self.get_available_depths()
        if not depths:
            raise DepthSliceDatasetError(
                "The HYCOM dataset exposes no native depth levels.",
                detail={
                    "message": "The HYCOM dataset exposes no native depth levels.",
                    "datasetFile": str(self._depth_nc_path),
                },
            )
        matched_depth = self._select_nearest_depth(requested_depth_m, depths)

        var_spec = DEPTH_VARIABLES[var_key]

        # Lazy selection: time -> depth -> variable(s) -> strided coordinates.
        # xarray keeps this lazy; only the selected slice is read from disk.
        try:
            if target_dt is not None:
                ds_sel = ds.sel(TIME=target_dt, method="nearest")
            else:
                ds_sel = ds.isel(TIME=0)
            ds_sel = ds_sel.sel(DEPTH=matched_depth, method="nearest")
            matched_time = str(ds_sel["TIME"].values)
        except KeyError as e:
            raise DepthSliceDatasetError(
                f"Dataset coordinate selection failed: {e}",
                detail={"message": f"Dataset coordinate selection failed: {e}",
                        "datasetFile": str(self._depth_nc_path)},
            )

        # Honest availability check BEFORE touching the data: a current
        # vector slice requires BOTH native components. If either is absent
        # from the dataset the request fails as unavailable - never a silent
        # substitution of another variable or a fabricated vector pair.
        required_vars = var_spec["vars"]
        missing_vars = [v for v in required_vars if v not in ds_sel.data_vars]
        if missing_vars:
            raise DepthSliceVariableUnavailableError(
                f"The HYCOM dataset does not provide {', '.join(missing_vars)} "
                f"for variable '{var_key}'; the request cannot be served.",
                detail={
                    "message": (
                        f"The HYCOM dataset does not provide "
                        f"{', '.join(missing_vars)}; no substitute variable is used, "
                        f"so this {'vector pair is' if len(missing_vars) > 1 else 'component is'} unavailable."
                    ),
                    "variable": var_key,
                    "missingVariables": missing_vars,
                    "datasetFile": str(self._depth_nc_path),
                    "source": var_spec["source"],
                },
            )

        lats = [float(lat) for lat in ds_sel["LAT"].values[::stride]]
        lons = [float(lon) for lon in ds_sel["LON"].values[::stride]]

        bounds = {
            "minLat": float(np.min(lats)),
            "maxLat": float(np.max(lats)),
            "minLon": float(np.min(lons)),
            "maxLon": float(np.max(lons))
        }

        def _grid_lists(arr: np.ndarray) -> List[List[Optional[float]]]:
            """Round, keep NaN as None (null), count missing values."""
            nonlocal missing
            out: List[List[Optional[float]]] = []
            for row in arr[::stride, ::stride]:
                out_row: List[Optional[float]] = []
                for v in row:
                    fv = float(v)
                    if not np.isfinite(fv):
                        out_row.append(None)
                        missing += 1
                    else:
                        out_row.append(round(fv, 3))
                out.append(out_row)
            return out

        missing = 0

        if var_key == "currents":
            u_arr = ds_sel["UVEL"].values
            v_arr = ds_sel["VVEL"].values
            u_list = _grid_lists(u_arr)
            v_list = _grid_lists(v_arr)
            grid = DepthSliceGridData(latitudes=lats, longitudes=lons, u=u_list, v=v_list)
        else:
            native_var = var_spec["vars"][0]
            val_arr = ds_sel[native_var].values
            val_list = _grid_lists(val_arr)
            grid = DepthSliceGridData(latitudes=lats, longitudes=lons, values=val_list)

        _ds_status = _hycom_data_status(ds)
        return DepthSliceResponse(
            status=_ds_status,
            source=var_spec["source"],
            dataset_file=str(self._depth_nc_path),
            variable=var_key,
            units=var_spec["units"],
            timestamp=matched_time,
            requested_timestamp=timestamp,
            requested_depth_m=float(requested_depth_m),
            matched_depth_m=float(matched_depth),
            available_depths_m=depths,
            stored_file_depths_m=stored_file_depths_from_axis(ds),
            missing_values=missing,
            bounds=bounds,
            grid=grid,
            provenance=ScientificProvenance(
                source=var_spec["source"],
                provider="INCOIS",
                dataset=str(self._depth_nc_path.name) if self._depth_nc_path else None,
                variable=var_key,
                units=var_spec["units"],
                timestamp=matched_time,
                requested_depth_m=float(requested_depth_m),
                matched_depth_m=float(matched_depth),
                processing_status="native depth selection; no interpolation",
                data_status=_ds_status,
                asset_id=str(self._depth_nc_path) if self._depth_nc_path else None,
            ),
        )

    def get_layer_data(
        self,
        layer_name: str,
        timestamp: Optional[str] = None,
        stride: int = 3
    ) -> Optional[LayerDataResponse]:
        ds = self._get_dataset()
        if ds is None:
            return None

        timestamps = self.get_available_timestamps()
        if not timestamps:
            return None

        # Resolve the requested time against the model's own times. This is an
        # EXPLICIT resolution, reported back as ``timestamp``: the response
        # always states which day it holds. The previous behaviour — a raw
        # string membership test that fell through to ``timestamps[0]`` — was
        # a silent clamp: it answered 2020 replay requests with the first
        # October 2026 slice, and it also missed requests that were in the
        # dataset but written with a different ISO spelling.
        selected_ts = resolve_model_timestamp(timestamp, timestamps)
        if selected_ts is None:
            if timestamp and str(timestamp).strip():
                # A request we cannot read must never be answered with some
                # other day: raise a client error instead.
                raise LayerDataTimestampError(
                    f"Invalid or unparseable timestamp: {timestamp}.",
                    detail={
                        "message": f"Invalid or unparseable timestamp: {timestamp}.",
                        "requestedTimestamp": timestamp,
                        "source": "INCOIS RSMC HYCOM",
                    },
                )
            return None

        # "Matched" here means: matches the time THIS REQUEST asked for. Whether
        # that model time corresponds to the cyclone being replayed is a
        # separate question, answered by /risk and by the UI badge.
        resolved_time_matched = (
            True if not (timestamp and str(timestamp).strip())
            else is_time_matched(selected_ts, timestamp)
        )

        # Subset time slice
        try:
            ds_time = ds.sel(TIME=selected_ts, method="nearest")
        except Exception:
            ds_time = ds.isel(TIME=0)

        # Downsample spatial grid using stride for payload optimization (Req #7)
        lats = [float(lat) for lat in ds_time["LAT"].values[::stride]]
        lons = [float(lon) for lon in ds_time["LON"].values[::stride]]

        bounds = {
            "minLat": float(np.min(lats)),
            "maxLat": float(np.max(lats)),
            "minLon": float(np.min(lons)),
            "maxLon": float(np.max(lons))
        }

        layer_name_lower = layer_name.lower()

        def _grid_lists(arr: np.ndarray, decimals: int) -> tuple:
            """Round a grid, keeping masked cells as None and counting coverage.

            A masked cell (land, or a point outside the model domain) is NaN in
            the source. It is carried through as ``None`` so it cannot be
            mistaken for a genuine zero-valued measurement: previously
            ``np.nan_to_num(..., nan=0.0)`` turned land into a physically
            plausible 0 °C / 0 m/s / 0 KJ·cm⁻² reading.
            """
            out = []
            valid = 0
            missing = 0
            for row in arr[::stride, ::stride]:
                out_row: List[Optional[float]] = []
                for raw in row:
                    fv = float(raw)
                    if not np.isfinite(fv):
                        out_row.append(None)
                        missing += 1
                    else:
                        out_row.append(round(fv, decimals))
                        valid += 1
                out.append(out_row)
            return out, valid, missing

        if layer_name_lower == "currents":
            u_list, u_valid, u_missing = _grid_lists(
                ds_time["UVEL"].values, 3
            )
            v_list, v_valid, v_missing = _grid_lists(
                ds_time["VVEL"].values, 3
            )

            _c_status = _hycom_data_status(ds)
            _c_source = "INCOIS HYCOM — SYNTHETIC FIXTURE" if _c_status == "SIMULATED" else "INCOIS HYCOM — REAL VECTOR FIELD"
            return LayerDataResponse(
                status=_c_status,
                source=_c_source,
                layer_name="currents",
                timestamp=selected_ts,
                requestedTimestamp=timestamp,
                timeMatched=resolved_time_matched,
                units="m/s",
                bounds=bounds,
                # A vector cell is only usable when BOTH components are valid.
                validCellCount=min(u_valid, v_valid),
                missingCellCount=max(u_missing, v_missing),
                grid=LayerGridData(
                    latitudes=lats,
                    longitudes=lons,
                    u=u_list,
                    v=v_list
                )
            )

        elif layer_name_lower in ["sst", "temperature", "temp"]:
            var_name = "TEMP"
            units = "°C"
            decimals = 2
            source_label = "INCOIS RSMC HYCOM"
        elif layer_name_lower == "salinity":
            var_name = "SALN"
            units = "PSU"
            decimals = 2
            source_label = "INCOIS RSMC HYCOM"
        elif layer_name_lower == "tchp":
            var_name = "TCHP"
            units = "KJ/cm2"
            decimals = 2
            source_label = "INCOIS RSMC HYCOM"
        elif layer_name_lower == "ssh":
            var_name = "SSH"
            units = "m"
            decimals = 2
            source_label = "INCOIS RSMC HYCOM"
        elif layer_name_lower == "mld":
            var_name = "MLD"
            units = "m"
            decimals = 1
            source_label = "INCOIS RSMC HYCOM"
        else:
            return None

        if var_name not in ds_time:
            return None

        val_list, valid_count, missing_count = _grid_lists(
            ds_time[var_name].values, decimals
        )

        _l_status = _hycom_data_status(ds)
        return LayerDataResponse(
            status=_l_status,
            source=source_label,
            layer_name=layer_name_lower,
            timestamp=selected_ts,
            requestedTimestamp=timestamp,
            timeMatched=resolved_time_matched,
            units=units,
            bounds=bounds,
            validCellCount=valid_count,
            missingCellCount=missing_count,
            grid=LayerGridData(
                latitudes=lats,
                longitudes=lons,
                values=val_list
            )
        )

    def inspect_point(self, lat: float, lon: float, timestamp: Optional[str] = None) -> Dict[str, Any]:
        ds = self._get_dataset()
        timestamps = self.get_available_timestamps()

        if ds is None or not timestamps:
            return {
                "status": "NO_REAL_MODEL_DATA",
                # No dataset was read at all, so this is NOT a "real dataset
                # with a bad timestamp" situation — say what actually happened.
                "dataStatus": (
                    "SIMULATED" if settings.DATA_MODE == 'FIXTURE'
                    else "NOT CURRENTLY INTEGRATED"
                ),
                "dataMode": settings.DATA_MODE,
                "message": "No INCOIS HYCOM dataset is installed at the configured path.",
                "requestedTimestamp": timestamp or "",
                "availableStart": "",
                "availableEnd": "",
                "source": "INCOIS RSMC HYCOM"
            }

        import pandas as pd
        import math

        available_start = timestamps[0]
        available_end = timestamps[-1]

        # Timestamp bounds validation (Requirement #2 & #4)
        if timestamp:
            try:
                target_dt = pd.to_datetime(timestamp).tz_localize(None)
                start_dt = pd.to_datetime(available_start).tz_localize(None)
                end_dt = pd.to_datetime(available_end).tz_localize(None)

                if target_dt < start_dt or target_dt > end_dt:
                    return {
                        "status": "NO_REAL_MODEL_DATA",
                        "dataStatus": (
                            "SIMULATED DATASET — TIMESTAMP UNAVAILABLE"
                            if settings.DATA_MODE == 'FIXTURE'
                            else "REAL DATASET — TIMESTAMP UNAVAILABLE"
                        ),
                        "message": f"No real INCOIS HYCOM model data is available for timestamp {timestamp}.",
                        "requestedTimestamp": timestamp,
                        "availableStart": str(available_start),
                        "availableEnd": str(available_end),
                        "source": "INCOIS RSMC HYCOM"
                    }
                ds_sel = ds.sel(TIME=target_dt, method="nearest")
            except Exception:
                return {
                    "status": "NO_REAL_MODEL_DATA",
                    "dataStatus": (
                        "SIMULATED DATASET — TIMESTAMP UNAVAILABLE"
                        if settings.DATA_MODE == 'FIXTURE'
                        else "REAL DATASET — TIMESTAMP UNAVAILABLE"
                    ),
                    "message": f"Invalid or unparseable timestamp: {timestamp}.",
                    "requestedTimestamp": timestamp,
                    "availableStart": str(available_start),
                    "availableEnd": str(available_end),
                    "source": "INCOIS RSMC HYCOM"
                }
        else:
            ds_sel = ds.isel(TIME=0)

        try:
            pt = ds_sel.sel(LAT=lat, LON=lon, method="nearest")

            # A point inspection reports the SEA SURFACE. Real RSMC HYCOM files
            # carry a full DEPTH dimension, so after selecting LAT/LON the field
            # is still an array along DEPTH; the surface level must be chosen
            # explicitly. Selecting the SHALLOWEST level (rather than assuming
            # index 0) keeps this correct whichever way DEPTH is ordered. On a
            # depth-less processed surface file this is a no-op.
            if "DEPTH" in pt.dims:
                depth_values = np.atleast_1d(pt["DEPTH"].values)
                pt = pt.isel(DEPTH=int(np.argmin(depth_values)))

            matched_lat = float(pt["LAT"].values)
            matched_lon = float(pt["LON"].values)
            matched_time = str(pt["TIME"].values)

            temp = float(pt["TEMP"].values) if "TEMP" in pt else None
            saln = float(pt["SALN"].values) if "SALN" in pt else None
            uvel = float(pt["UVEL"].values) if "UVEL" in pt else None
            vvel = float(pt["VVEL"].values) if "VVEL" in pt else None
            ssh = float(pt["SSH"].values) if "SSH" in pt else None
            tchp = float(pt["TCHP"].values) if "TCHP" in pt else None
            mld = float(pt["MLD"].values) if "MLD" in pt else None

            temp_val = round(temp, 2) if (temp is not None and not np.isnan(temp)) else None
            saln_val = round(saln, 2) if (saln is not None and not np.isnan(saln)) else None
            uvel_val = round(uvel, 3) if (uvel is not None and not np.isnan(uvel)) else None
            vvel_val = round(vvel, 3) if (vvel is not None and not np.isnan(vvel)) else None
            ssh_val = round(ssh, 2) if (ssh is not None and not np.isnan(ssh)) else None
            tchp_val = round(tchp, 2) if (tchp is not None and not np.isnan(tchp)) else None
            mld_val = round(mld, 1) if (mld is not None and not np.isnan(mld)) else None

            speed = round(math.sqrt(uvel**2 + vvel**2), 2) if (uvel_val is not None and vvel_val is not None) else None
            direction = round((math.degrees(math.atan2(uvel, vvel)) + 360.0) % 360.0, 1) if (uvel_val is not None and vvel_val is not None) else None

            return {
                "status": "OK",
                # Derived from the dataset actually opened, never hardcoded:
                # FIXTURE files carry synthetic='true' so this resolves to
                # SIMULATED even if DATA_MODE were somehow misconfigured.
                "dataStatus": _hycom_data_status(ds_sel),
                "dataMode": settings.DATA_MODE,
                "source": (
                    "INCOIS RSMC HYCOM (synthetic fixture)"
                    if _hycom_data_status(ds_sel) == 'SIMULATED'
                    else "INCOIS RSMC HYCOM"
                ),
                "timestamp": matched_time,
                "latitude": matched_lat,
                "longitude": matched_lon,
                "depth_m": 0.0,
                "depthM": 0.0,
                "temp_c": temp_val,
                "tempC": temp_val,
                "saln_psu": saln_val,
                "salnPSU": saln_val,
                "uvel_ms": uvel_val,
                "uvelMS": uvel_val,
                "vvel_ms": vvel_val,
                "vvelMS": vvel_val,
                "current_speed_ms": speed,
                "currentSpeedMS": speed,
                "current_direction_deg": direction,
                "currentDirectionDeg": direction,
                "ssh_m": ssh_val,
                "sshM": ssh_val,
                "tchp_kj_cm2": tchp_val,
                "tchpKJ": tchp_val,
                "mld_m": mld_val,
                "mldM": mld_val,
                "provider": "Indian National Centre for Ocean Information Services (INCOIS)"
            }
        except Exception as e:
            # A crash while indexing the field is not the same finding as "this
            # timestamp is not in the record", which is what NO_REAL_MODEL_DATA
            # means elsewhere in this method. Returning it here made the API
            # assert something about the ocean that was never measured.
            logger.exception(
                "Inspect failed at lat=%s, lon=%s. The request could not be "
                "evaluated, so no statement about the model field can be made.",
                lat,
                lon,
            )
            raise InspectPointFailed(lat, lon, timestamp, e) from e

incois_provider = IncoisProvider()
