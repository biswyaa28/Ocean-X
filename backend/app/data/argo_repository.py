"""Argo profile repository (STEP 3B §6, §23).

Builds :class:`~app.science.argo_profile.RawArgoProfile` objects from the
development fixture. The abstraction is deliberately narrow — ``list_ids`` and
``get_raw_profile`` — so a real GDAC NetCDF reader can be added later behind the
same interface without touching the pipeline or the API.

All profiles from this repository carry ``is_fixture=True``.
"""
from __future__ import annotations

from datetime import datetime
from typing import Dict, List, Optional

import numpy as np

from app.data.fixtures import (
    FIXTURE_ARGO_PROFILES,
    FIXTURE_NOTICE,
    FIXTURE_TIMES,
    mock_sal,
    mock_temp,
)
from app.science.argo_profile import RawArgoProfile, build_raw_profile
from app.science.depth import depth_from_pressure, pressure_from_depth

FIXTURE_ARGO_NOTICE = (
    "SYNTHETIC development fixture profile — deterministic analytic values with "
    "prescribed offsets; not a real Argo measurement"
)


def _nearest_time_index(obs_time: datetime) -> int:
    """Fixture field time index used to *generate* synthetic values.

    This is a fixture construction detail only. The scientific co-location time
    is determined independently by the pipeline's temporal matching stage.
    """
    best, best_dt = 0, float("inf")
    for i, t in enumerate(FIXTURE_TIMES):
        dt = abs((obs_time - t).total_seconds())
        if dt < best_dt:
            best, best_dt = i, dt
    return best


class ArgoProfileRepository:
    """Fixture-backed Argo profile repository."""

    def __init__(self, specs: Optional[List[dict]] = None) -> None:
        self._specs = list(specs if specs is not None else FIXTURE_ARGO_PROFILES)
        self._by_id: Dict[str, dict] = {str(s["id"]): s for s in self._specs}

    # ------------------------------------------------------------------
    def list_ids(self) -> List[str]:
        return [str(s["id"]) for s in self._specs]

    def list_specs(self) -> List[dict]:
        """Raw fixture specifications, for summary listings."""
        return list(self._specs)

    def get_spec(self, profile_id: str) -> Optional[dict]:
        return self._by_id.get(str(profile_id))

    # ------------------------------------------------------------------
    def get_raw_profile(self, profile_id: str) -> Optional[RawArgoProfile]:
        """Build a :class:`RawArgoProfile` from the fixture specification.

        Pressure is the primary vertical coordinate. Where the spec declares
        ``nominal_depths_m``, pressures are synthesised with TEOS-10
        (``gsw.p_from_z``) at the profile latitude so the forward conversion
        recovers those nominal depths. Where it declares ``pressure_dbar``, those
        irregular pressures are used directly.
        """
        spec = self._by_id.get(str(profile_id))
        if spec is None:
            return None

        obs_time = datetime.fromisoformat(str(spec["time"]).replace("Z", "+00:00"))
        lat = float(spec["latitude"])
        lon = float(spec["longitude"])

        if "pressure_dbar" in spec:
            pressure = np.asarray(spec["pressure_dbar"], dtype="float64")
            pressure_origin = "irregular ascent pressures declared by the fixture"
        else:
            nominal = np.asarray(spec["nominal_depths_m"], dtype="float64")
            pressure = pressure_from_depth(nominal, lat)
            pressure_origin = (
                "pressures synthesised from nominal depths via TEOS-10 gsw.p_from_z"
            )

        # Depth used only to evaluate the synthetic field at each level.
        depth = depth_from_pressure(pressure, lat)
        field_time_index = _nearest_time_index(obs_time)

        offsets = np.asarray(spec.get("temp_offsets", []), dtype="float64")
        if offsets.size and offsets.size != pressure.size:
            raise ValueError(
                f"fixture {profile_id}: temp_offsets length {offsets.size} does not "
                f"match {pressure.size} levels"
            )
        if offsets.size == 0:
            offsets = np.zeros(pressure.size, dtype="float64")

        temperature = np.asarray(
            [
                mock_temp(lon, lat, float(z), field_time_index) + float(o)
                for z, o in zip(depth, offsets)
            ],
            dtype="float64",
        )
        salinity = np.asarray(
            [mock_sal(lon, lat, float(z), field_time_index) for z in depth],
            dtype="float64",
        )

        kwargs: dict = {}
        if spec.get("has_adjusted"):
            t_adj = float(spec.get("temp_adjustment", 0.0))
            s_adj = float(spec.get("psal_adjustment", 0.0))
            kwargs["temperature_adjusted"] = temperature + t_adj
            kwargs["salinity_adjusted"] = salinity + s_adj
            # Adjusted QC defaults to the raw QC unless the spec overrides it.
            kwargs["temp_adjusted_qc"] = spec.get("temp_adjusted_qc", spec.get("temp_qc"))
            kwargs["psal_adjusted_qc"] = spec.get("psal_adjusted_qc", spec.get("psal_qc"))
            kwargs["pressure_adjusted"] = pressure.copy()
            kwargs["pres_adjusted_qc"] = spec.get("pres_adjusted_qc", spec.get("pres_qc"))
            if "temp_adjusted_error" in spec:
                kwargs["temperature_adjusted_error"] = np.full(
                    pressure.size, float(spec["temp_adjusted_error"]), dtype="float64"
                )
            if "psal_adjusted_error" in spec:
                kwargs["salinity_adjusted_error"] = np.full(
                    pressure.size, float(spec["psal_adjusted_error"]), dtype="float64"
                )

        return build_raw_profile(
            platform_number=str(spec["id"]),
            cycle_number=int(spec["cycle"]),
            time=obs_time,
            latitude=lat,
            longitude=lon,
            pressure=pressure,
            temperature=temperature,
            salinity=salinity,
            pres_qc=spec.get("pres_qc"),
            temp_qc=spec.get("temp_qc"),
            psal_qc=spec.get("psal_qc"),
            data_mode=str(spec["mode"]),
            platform_type=spec.get("platform"),
            data_centre=spec.get("data_centre"),
            units={"temperature": "degC", "salinity": "psu"},
            is_fixture=True,
            fixture_note=f"{FIXTURE_ARGO_NOTICE}; {pressure_origin}",
            **kwargs,
        )


argo_repository = ArgoProfileRepository()
