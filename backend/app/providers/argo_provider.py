import json
from pathlib import Path
from typing import List, Dict, Any, Optional
import math
from datetime import datetime

from app.core.config import settings

ROOT_DIR = Path(__file__).resolve().parents[2]
PROCESSED_ARGO_FILE = ROOT_DIR / "data" / "processed" / "ocean" / "argo" / "argo_bob_processed.json"
METADATA_ARGO_FILE = ROOT_DIR / "data" / "processed" / "ocean" / "argo" / "argo_bob_metadata.json"


class ArgoProvider:
    def __init__(self, data_path: Path = PROCESSED_ARGO_FILE, meta_path: Path = METADATA_ARGO_FILE):
        self.data_path = data_path
        self.meta_path = meta_path
        self._profiles: Optional[List[Dict[str, Any]]] = None
        self._metadata: Optional[Dict[str, Any]] = None

    def _load_data(self):
        if self._profiles is None:
            if self.data_path.exists():
                try:
                    with open(self.data_path, "r", encoding="utf-8") as f:
                        self._profiles = json.load(f)
                except Exception as e:
                    print(f"Error reading processed Argo JSON: {e}")
                    self._profiles = []
            else:
                self._profiles = []

    def get_metadata(self) -> Dict[str, Any]:
        if self._metadata is None:
            if self.meta_path.exists():
                try:
                    with open(self.meta_path, "r", encoding="utf-8") as f:
                        self._metadata = json.load(f)
                except Exception:
                    self._metadata = {}
            else:
                self._metadata = {}
        return self._metadata or {}

    def get_profiles(self) -> List[Dict[str, Any]]:
        self._load_data()
        return self._profiles or []

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
                return p
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
