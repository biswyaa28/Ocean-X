import csv
from pathlib import Path
from typing import List, Optional, Dict
from app.core.config import settings
from app.models.schemas import Cyclone, CycloneTrackPoint, ForecastConePoint, WindRadius

class IBTrACSProvider:
    def __init__(self, csv_path: Path = settings.RAW_IBTRACS_CSV):
        self.csv_path = csv_path
        self._cached_cyclones: Optional[List[Cyclone]] = None

    def _get_category(self, wind_kts: float) -> str:
        if wind_kts >= 120:
            return 'Super Cyclonic Storm'
        elif wind_kts >= 90:
            return 'Extremely Severe Cyclonic Storm'
        elif wind_kts >= 64:
            return 'Very Severe Cyclonic Storm'
        elif wind_kts >= 48:
            return 'Severe Cyclonic Storm'
        elif wind_kts >= 34:
            return 'Cyclonic Storm'
        elif wind_kts >= 28:
            return 'Deep Depression'
        else:
            return 'Depression'

    def load_cyclones(self) -> List[Cyclone]:
        if self._cached_cyclones is not None:
            return self._cached_cyclones

        if not self.csv_path.exists():
            return []

        storms_by_id: Dict[str, Dict] = {}

        try:
            with open(self.csv_path, 'r', encoding='utf-8', errors='ignore') as f:
                reader = csv.reader(f)
                header = next(reader)
                units = next(reader) # Skip units row

                # Index mapping
                sid_idx = header.index('SID') if 'SID' in header else 0
                year_idx = header.index('SEASON') if 'SEASON' in header else 1
                name_idx = header.index('NAME') if 'NAME' in header else 5
                time_idx = header.index('ISO_TIME') if 'ISO_TIME' in header else 6
                lat_idx = header.index('LAT') if 'LAT' in header else 8
                lon_idx = header.index('LON') if 'LON' in header else 9
                wmo_wind_idx = header.index('WMO_WIND') if 'WMO_WIND' in header else 10
                wmo_pres_idx = header.index('WMO_PRES') if 'WMO_PRES' in header else 11
                dist2land_idx = header.index('DIST2LAND') if 'DIST2LAND' in header else 14
                speed_idx = header.index('STORM_SPEED') if 'STORM_SPEED' in header else -2
                dir_idx = header.index('STORM_DIR') if 'STORM_DIR' in header else -1

                for row in reader:
                    if len(row) <= max(sid_idx, name_idx, time_idx, lat_idx, lon_idx):
                        continue

                    # Filter by year immediately for fast processing
                    try:
                        year = int(row[year_idx].strip())
                        if year < 2020:
                            continue
                    except ValueError:
                        continue

                    sid = row[sid_idx].strip()
                    name = row[name_idx].strip()
                    iso_time = row[time_idx].strip()

                    if not sid or not iso_time or name == 'UNNAMED':
                        continue

                    try:
                        lat = float(row[lat_idx])
                        lon = float(row[lon_idx])
                    except (ValueError, TypeError):
                        continue

                    # Parse wind & pressure
                    try:
                        wind = float(row[wmo_wind_idx]) if row[wmo_wind_idx].strip() else 45.0
                    except ValueError:
                        wind = 45.0

                    try:
                        pres = float(row[wmo_pres_idx]) if row[wmo_pres_idx].strip() else 990.0
                    except ValueError:
                        pres = 990.0

                    try:
                        dist2land = float(row[dist2land_idx]) if row[dist2land_idx].strip() else 250.0
                    except ValueError:
                        dist2land = 250.0

                    try:
                        speed = float(row[speed_idx]) if row[speed_idx].strip() else 15.0
                    except ValueError:
                        speed = 15.0

                    try:
                        sdir = float(row[dir_idx]) if row[dir_idx].strip() else 340.0
                    except ValueError:
                        sdir = 340.0

                    if sid not in storms_by_id:
                        storms_by_id[sid] = {
                            'id': sid,
                            'name': name,
                            'basin': 'North Indian Ocean (Bay of Bengal)',
                            'track': []
                        }

                    pt_idx = len(storms_by_id[sid]['track'])
                    storms_by_id[sid]['track'].append(CycloneTrackPoint(
                        id=f"{sid}-pt-{pt_idx}",
                        timestamp=iso_time,
                        latitude=lat,
                        longitude=lon,
                        maxWindKts=wind,
                        centralPressureMb=pres,
                        category=self._get_category(wind),
                        status='OBSERVATION',
                        distanceToCoastKm=dist2land,
                        stormSpeedKts=speed,
                        stormDirDeg=sdir,
                        forecastConfidencePct=None
                    ))

        except Exception as e:
            print(f"Error reading IBTrACS CSV: {e}")
            return []

        # Convert to list of Cyclone objects
        cyclones: List[Cyclone] = []
        for sid, sdata in storms_by_id.items():
            track = sdata['track']
            if len(track) < 3:
                continue

            current_idx = min(5, len(track) - 1)
            forecast_cone = [
                ForecastConePoint(
                    latitude=pt.latitude,
                    longitude=pt.longitude,
                    radiusKm=40 + idx * 25,
                    timestamp=pt.timestamp
                ) for idx, pt in enumerate(track[current_idx:])
            ]

            c_obj = Cyclone(
                id=sid,
                name=f"{sdata['name']}",
                basin=sdata['basin'],
                dataStatus='REAL',
                currentTrackIndex=current_idx,
                track=track,
                forecastCone=forecast_cone,
                windRadius=WindRadius(r34ktsKm=260, r50ktsKm=140, r64ktsKm=75),
                sourceAttribution='NOAA IBTrACS v04r01 (Real Observations)',
                isHistorical=True
            )
            cyclones.append(c_obj)

        self._cached_cyclones = cyclones
        return cyclones

    def get_cyclone_by_id(self, sid: str) -> Optional[Cyclone]:
        cyclones = self.load_cyclones()
        for c in cyclones:
            if c.id == sid or c.name.lower() == sid.lower():
                return c
        return cyclones[0] if cyclones else None

    def inspect_cyclone(
        self,
        lat: Optional[float] = None,
        lon: Optional[float] = None,
        timestamp: Optional[str] = None,
        cyclone_id: Optional[str] = None
    ) -> Optional[Dict]:
        cyclones = self.load_cyclones()
        if not cyclones:
            return None

        # Pick target cyclone
        cyclone = cyclones[0]
        if cyclone_id:
            for c in cyclones:
                if c.id == cyclone_id or c.name.lower() == cyclone_id.lower():
                    cyclone = c
                    break

        track = cyclone.track
        if not track:
            return None

        # Find best matching track point by timestamp or geographic distance
        best_pt = track[0]

        if timestamp:
            import pandas as pd
            try:
                target_dt = pd.to_datetime(timestamp).tz_localize(None)
                min_tdiff = float('inf')
                for pt in track:
                    pt_dt = pd.to_datetime(pt.timestamp).tz_localize(None)
                    diff = abs((target_dt - pt_dt).total_seconds())
                    if diff < min_tdiff:
                        min_tdiff = diff
                        best_pt = pt
            except Exception:
                pass
        elif lat is not None and lon is not None:
            min_dist = float('inf')
            for pt in track:
                dist = (pt.latitude - lat)**2 + (pt.longitude - lon)**2
                if dist < min_dist:
                    min_dist = dist
                    best_pt = pt

        return {
            "status": "OK",
            "dataStatus": "REAL",
            "observationType": "HISTORICAL OBSERVATION",
            "cycloneName": cyclone.name,
            "timestamp": best_pt.timestamp,
            "latitude": best_pt.latitude,
            "longitude": best_pt.longitude,
            "maxWindKts": best_pt.maxWindKts,
            "centralPressureMb": best_pt.centralPressureMb,
            "category": best_pt.category,
            "distanceToCoastKm": best_pt.distanceToCoastKm,
            "stormSpeedKts": best_pt.stormSpeedKts,
            "stormDirDeg": best_pt.stormDirDeg,
            "source": "NOAA IBTrACS v04r01"
        }

ibtracs_provider = IBTrACSProvider()
