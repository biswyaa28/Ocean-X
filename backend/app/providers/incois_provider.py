import json
from pathlib import Path
from typing import Dict, Any, List, Optional
import numpy as np
import xarray as xr

from app.core.config import settings
from app.models.schemas import LayerDataResponse, LayerGridData

class IncoisProvider:
    def __init__(
        self,
        nc_path: Path = settings.PROCESSED_OCEAN_FILE,
        meta_path: Path = settings.PROCESSED_OCEAN_META
    ):
        self.nc_path = nc_path
        self.meta_path = meta_path
        self._dataset: Optional[xr.Dataset] = None
        self._metadata: Optional[Dict[str, Any]] = None

    def _get_dataset(self) -> Optional[xr.Dataset]:
        if self._dataset is None and self.nc_path.exists():
            try:
                self._dataset = xr.open_dataset(self.nc_path, engine="netcdf4", chunks={})
            except Exception as e:
                print(f"Error opening processed INCOIS NetCDF: {e}")
                self._dataset = None
        return self._dataset

    def get_metadata(self) -> Dict[str, Any]:
        if self._metadata is None and self.meta_path.exists():
            try:
                with open(self.meta_path, 'r', encoding='utf-8') as f:
                    self._metadata = json.load(f)
            except Exception as e:
                print(f"Error reading INCOIS metadata JSON: {e}")
                self._metadata = {}
        return self._metadata or {}

    def get_available_timestamps(self) -> List[str]:
        ds = self._get_dataset()
        if ds is None or "TIME" not in ds.coords:
            return []
        return [str(ts) for ts in ds["TIME"].values]

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

        # Resolve timestamp
        selected_ts = timestamp if timestamp in timestamps else timestamps[0]

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

        if layer_name_lower == "currents":
            u_arr = np.nan_to_num(ds_time["UVEL"].values[::stride, ::stride], nan=0.0)
            v_arr = np.nan_to_num(ds_time["VVEL"].values[::stride, ::stride], nan=0.0)

            u_list = u_arr.round(3).tolist()
            v_list = v_arr.round(3).tolist()

            return LayerDataResponse(
                status="REAL",
                source="INCOIS HYCOM — REAL VECTOR FIELD",
                layer_name="currents",
                timestamp=selected_ts,
                units="m/s",
                bounds=bounds,
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
            source_label = "INCOIS RSMC HYCOM"
        elif layer_name_lower == "salinity":
            var_name = "SALN"
            units = "PSU"
            source_label = "INCOIS RSMC HYCOM"
        elif layer_name_lower == "tchp":
            var_name = "TCHP"
            units = "KJ/cm2"
            source_label = "INCOIS RSMC HYCOM"
        elif layer_name_lower == "ssh":
            var_name = "SSH"
            units = "m"
            source_label = "INCOIS RSMC HYCOM"
        elif layer_name_lower == "mld":
            var_name = "MLD"
            units = "m"
            source_label = "INCOIS RSMC HYCOM"
        else:
            return None

        val_arr = np.nan_to_num(ds_time[var_name].values[::stride, ::stride], nan=0.0)
        val_list = val_arr.round(2).tolist()

        return LayerDataResponse(
            status="REAL",
            source=source_label,
            layer_name=layer_name_lower,
            timestamp=selected_ts,
            units=units,
            bounds=bounds,
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
                "dataStatus": "REAL DATASET — TIMESTAMP UNAVAILABLE",
                "message": "No real INCOIS HYCOM dataset loaded.",
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
                        "dataStatus": "REAL DATASET — TIMESTAMP UNAVAILABLE",
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
                    "dataStatus": "REAL DATASET — TIMESTAMP UNAVAILABLE",
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
                "dataStatus": "REAL",
                "source": "INCOIS RSMC HYCOM",
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
            print(f"Error inspecting point ({lat}, {lon}): {e}")
            return {
                "status": "NO_REAL_MODEL_DATA",
                "dataStatus": "REAL DATASET — TIMESTAMP UNAVAILABLE",
                "message": f"Error indexing point at lat={lat}, lon={lon}: {e}",
                "requestedTimestamp": timestamp or "",
                "availableStart": str(available_start),
                "availableEnd": str(available_end),
                "source": "INCOIS RSMC HYCOM"
            }

incois_provider = IncoisProvider()

