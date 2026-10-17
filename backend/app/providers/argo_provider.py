import json
import logging
from pathlib import Path
from typing import List, Dict, Any, Optional
import math
from datetime import datetime

from app.core.config import settings
from app.models.schemas import ScientificProvenance

logger = logging.getLogger(__name__)


class ArgoDataCorrupt(RuntimeError):
    """The processed Argo JSON is on disk but could not be parsed.

    A failed load must not be cached as an empty profile list: that is
    indistinguishable from "the array contained no profiles", which is a
    different claim about the data.
    """

    def __init__(self, path: Path, cause: Exception):
        self.path = path
        self.cause = cause
        super().__init__(
            f"Processed Argo JSON at {path} could not be parsed "
            f"({type(cause).__name__}: {cause}). Every Argo profile, float and "
            f"observation served by this API is measured from this file, so the "
            f"failure cannot be reported as an absence of profiles. Restore it "
            f"with: git checkout -- {path}."
        )
        self.__cause__ = cause


class ArgoProvider:
    def __init__(self, data_path: Path = None, meta_path: Path = None):
        self.data_path = data_path or settings.PROCESSED_ARGO_FILE
        self.meta_path = meta_path or settings.PROCESSED_ARGO_META
        self._profiles: Optional[List[Dict[str, Any]]] = None
        self._metadata: Optional[Dict[str, Any]] = None
        # Recorded rather than raised here, so importing the app never fails on
        # a bad data file. get_profiles() turns it back into an exception.
        self._load_error: Optional[ArgoDataCorrupt] = None
        # Metadata is provenance labelling only: it supplies source, provider,
        # dataset_name and source_url. A broken metadata file must not take the
        # observations down with it, so it is recorded rather than raised.
        self._metadata_error: Optional[Exception] = None

    def _load_data(self):
        if self._profiles is None and self._load_error is None:
            if self.data_path.exists():
                try:
                    with open(self.data_path, "r", encoding="utf-8") as f:
                        self._profiles = json.load(f)
                except Exception as e:
                    logger.exception(
                        "Failed to parse the processed Argo JSON at %s. Every Argo "
                        "endpoint is measured from this file, so this cannot be "
                        "reported as an absence of profiles.",
                        self.data_path,
                    )
                    self._load_error = ArgoDataCorrupt(self.data_path, e)
            else:
                self._profiles = []
        if self._load_error is not None:
            raise self._load_error

    def get_metadata(self) -> Dict[str, Any]:
        if self._metadata is None and self._metadata_error is None:
            if self.meta_path.exists():
                try:
                    with open(self.meta_path, "r", encoding="utf-8") as f:
                        self._metadata = json.load(f)
                except Exception as e:
                    logger.exception(
                        "Failed to parse the Argo metadata JSON at %s. The profile "
                        "observations are unaffected, but their provenance labels "
                        "cannot be populated.",
                        self.meta_path,
                    )
                    self._metadata_error = e
                    self._metadata = {}
            else:
                self._metadata = {}
        return self._metadata or {}

    @property
    def metadata_unavailable(self) -> bool:
        """True when provenance metadata could not be read (not merely absent)."""
        return self._metadata_error is not None

    def get_profiles(self) -> List[Dict[str, Any]]:
        self._load_data()
        profiles = self._profiles or []
        return [self._with_provenance(profile) for profile in profiles]

    def _with_provenance(self, profile: Dict[str, Any]) -> Dict[str, Any]:
        """Keep the legacy fields while adding explicit fixture/demo provenance."""
        result = dict(profile)
        metadata = self.get_metadata()
        result["provenance"] = ScientificProvenance(
            source=metadata.get("source"),
            provider=metadata.get("provider"),
            dataset=metadata.get("dataset_name", "ARGO_PROFILES_BOB"),
            variable="temperature_c, salinity_psu",
            units="°C, PSU",
            timestamp=profile.get("observation_time"),
            latitude=profile.get("latitude"),
            longitude=profile.get("longitude"),
            processing_status="curated fallback profile set",
            data_status="DEMO",
            asset_id=profile.get("profile_id"),
            source_url=metadata.get("source_url"),
        ).model_dump()
        return result

    def get_floats(self) -> List[Dict[str, Any]]:
        self._load_data()
        floats_dict: Dict[str, Dict[str, Any]] = {}
        for p in self._profiles or []:
            fid = p["float_id"]
            if fid not in floats_dict:
                floats_dict[fid] = {
                    "float_id": fid,
                    "platform_type": p.get("platform_type", "Argo Float"),
                    "institution": p.get("institution", "INCOIS"),
                    "last_latitude": p["latitude"],
                    "last_longitude": p["longitude"],
                    "last_observation_time": p["observation_time"],
                    "data_status": "REAL",
                    "profile_count": 1
                }
            else:
                floats_dict[fid]["profile_count"] += 1
                if p["observation_time"] > floats_dict[fid]["last_observation_time"]:
                    floats_dict[fid]["last_observation_time"] = p["observation_time"]
                    floats_dict[fid]["last_latitude"] = p["latitude"]
                    floats_dict[fid]["last_longitude"] = p["longitude"]
        return list(floats_dict.values())

    def get_profile(self, profile_id: str) -> Optional[Dict[str, Any]]:
        self._load_data()
        for p in self._profiles or []:
            if p["profile_id"] == profile_id or p["profile_id"].endswith(profile_id):
                return self._with_provenance(p)
        return None

    def get_profile_observations(self, profile_id: str) -> Optional[List[Dict[str, Any]]]:
        p = self.get_profile(profile_id)
        if p:
            return p.get("observations", [])
        return None

    def get_nearest_profile(self, lat: float, lon: float, timestamp: Optional[str] = None) -> Optional[Dict[str, Any]]:
        self._load_data()
        profiles = self._profiles or []
        if not profiles:
            return None

        def haversine_km(lat1, lon1, lat2, lon2):
            R = 6371.0
            dlat = math.radians(lat2 - lat1)
            dlon = math.radians(lon2 - lon1)
            a = math.sin(dlat / 2.0)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2.0)**2
            return 2.0 * R * math.asin(math.sqrt(a))

        best_profile = None
        min_dist = float('inf')

        for p in profiles:
            dist = haversine_km(lat, lon, p["latitude"], p["longitude"])
            if dist < min_dist:
                min_dist = dist
                best_profile = p

        return best_profile


argo_provider = ArgoProvider()
