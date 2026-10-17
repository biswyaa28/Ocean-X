import csv
import logging
from pathlib import Path
from typing import List, Optional, Dict, Tuple
from app.core.config import settings
from app.models.schemas import (
    Cyclone,
    CycloneTrackPoint,
    DataCompleteness,
    WindRadius,
)

logger = logging.getLogger(__name__)


class IBTrACSDataMissing(RuntimeError):
    """The committed IBTrACS snapshot is not on disk.

    This file is the only copy of the cyclone dataset in the project: nothing
    downloads it, and every /cyclones, /hazards and /risk number is measured
    from it. When it is absent those endpoints have nothing real to report, so
    the failure is raised rather than answered with an empty list -- an empty
    list is indistinguishable from "no cyclones occurred", which is false.
    """

    def __init__(self, path: Path):
        self.path = path
        super().__init__(
            f"IBTrACS snapshot missing at {path}. Every cyclone count, hazard and "
            f"risk score served by this API is measured from this file. Restore it "
            f"with: git checkout -- {path}. See data/README.md for provenance."
        )


def _to_float(raw: Optional[str]) -> Optional[float]:
    """Parse a CSV cell into a float, returning None when it is blank/absent.

    Never returns a fallback constant: an absent observation stays absent so it
    can be reported honestly downstream.
    """
    if raw is None:
        return None
    text = raw.strip()
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def _first_available(
    row: List[str], indices: Dict[str, int], names: Tuple[str, ...]
) -> Tuple[Optional[float], Optional[str]]:
    """Return the first parseable value among ``names`` plus which column it came from.

    Used to prefer the WMO consensus value and fall back to the IMD (New Delhi)
    value, which is the authoritative reporting agency for the North Indian
    Ocean. Returns ``(None, None)`` when every candidate is blank.
    """
    for name in names:
        idx = indices.get(name)
        if idx is None or idx >= len(row):
            continue
        value = _to_float(row[idx])
        if value is not None:
            return value, 'IMD' if name.startswith('NEWDELHI') else 'WMO'
    return None, None


def _quadrant_mean(
    row: List[str], indices: Dict[str, int], prefix: str
) -> Optional[float]:
    """Mean of the available quadrant radii for a wind threshold.

    IBTrACS stores R34/R50/R64 as up to four quadrant radii (NE/SE/SW/NW). We
    average whichever quadrants are actually present. Returns None when the
    agency reported no radii at all for this point.
    """
    values = []
    for quadrant in ('NE', 'SE', 'SW', 'NW'):
        idx = indices.get(f'{prefix}_{quadrant}')
        if idx is None or idx >= len(row):
            continue
        value = _to_float(row[idx])
        if value is not None and value > 0:
            values.append(value)
    if not values:
        return None
    return round(sum(values) / len(values), 1)


def select_default_track_index(track: List[CycloneTrackPoint]) -> Tuple[int, str]:
    """Choose which track point the API serves by default, and say why.

    The default is the point of PEAK OBSERVED intensity — the largest
    ``maxWindKts`` among points that actually carry a wind observation. The
    previous default was ``min(5, len-1)``, an arbitrary early point which
    frequently landed on a point with no wind observation at all, so the first
    view a user saw rendered nulls and the risk engine refused to score.

    Returns ``(index, reason)`` where reason is one of:
      * ``peak_observed_wind``    — a real peak wind was found (normal case)
      * ``peak_observed_wind_tie``— several points share the peak; earliest wins
      * ``last_point_no_wind``    — the storm has no wind observation anywhere
    """
    if not track:
        return 0, 'empty_track'

    best_idx = -1
    best_wind = None
    for idx, pt in enumerate(track):
        wind = pt.maxWindKts
        if wind is None:
            continue
        if best_wind is None or wind > best_wind:
            best_wind = wind
            best_idx = idx

    if best_idx < 0:
        # No observed wind anywhere — fall back to the last point, which is the
        # storm's most recent state.
        return len(track) - 1, 'last_point_no_wind'

    # Report a tie explicitly so the choice is never silently ambiguous.
    tied = sum(1 for pt in track if pt.maxWindKts == best_wind)
    reason = 'peak_observed_wind_tie' if tied > 1 else 'peak_observed_wind'
    return best_idx, reason


class IBTrACSDataCorrupt(RuntimeError):
    """The committed IBTrACS snapshot is on disk but could not be parsed.

    Distinct from IBTrACSDataMissing: the file is present, so its absence of
    results says nothing about whether storms occurred. Reporting [] here would
    turn a broken file into a finding about the ocean.
    """

    def __init__(self, path: Path, cause: Exception):
        self.path = path
        self.cause = cause
        super().__init__(
            f"IBTrACS snapshot at {path} could not be parsed ({type(cause).__name__}: "
            f"{cause}). Every cyclone count, hazard and risk score served by this API "
            f"is measured from this file, so it cannot be reported as an absence of "
            f"cyclones. Restore the committed snapshot with: "
            f"git checkout -- {path}. See data/README.md for provenance."
        )


class IBTrACSProvider:
    def __init__(self, csv_path: Path = settings.RAW_IBTRACS_CSV):
        self.csv_path = csv_path
        self._cached_cyclones: Optional[List[Cyclone]] = None
        # (sid, point_index) -> {'R34': float|None, 'R50': ..., 'R64': ...}
        self._radii_cache: Dict[tuple, Dict[str, Optional[float]]] = {}

    def _get_category(self, wind_kts: Optional[float]) -> Optional[str]:
        if wind_kts is None:
            return None
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
            logger.error(
                "IBTrACS snapshot not found at %s. /cyclones, /hazards and /risk have "
                "no observations to serve; this is a missing-dataset failure, not an "
                "absence of cyclones.",
                self.csv_path,
            )
            raise IBTrACSDataMissing(self.csv_path)

        storms_by_id: Dict[str, Dict] = {}

        try:
            with open(self.csv_path, 'r', encoding='utf-8', errors='ignore') as f:
                reader = csv.reader(f)
                header = next(reader)
                next(reader)  # units row
                indices = {name: i for i, name in enumerate(header)}

                sid_idx = indices.get('SID', 0)
                year_idx = indices.get('SEASON', 1)
                name_idx = indices.get('NAME', 5)
                time_idx = indices.get('ISO_TIME', 6)
                lat_idx = indices.get('LAT', 8)
                lon_idx = indices.get('LON', 9)

                for row in reader:
                    if len(row) <= max(sid_idx, name_idx, time_idx, lat_idx, lon_idx):
                        continue

                    try:
                        year = int(row[year_idx].strip())
                        if year < 2020:
                            continue
                    except (ValueError, IndexError):
                        continue

                    sid = row[sid_idx].strip()
                    name = row[name_idx].strip()
                    iso_time = row[time_idx].strip()

                    if not sid or not iso_time or name == 'UNNAMED':
                        continue

                    lat = _to_float(row[lat_idx])
                    lon = _to_float(row[lon_idx])
                    if lat is None or lon is None:
                        continue

                    # Wind: prefer the WMO consensus column, fall back to IMD
                    # (New Delhi), which is authoritative for this basin. If both
                    # are blank the value stays None — we never invent one.
                    wind, wind_src = _first_available(
                        row, indices, ('WMO_WIND', 'NEWDELHI_WIND')
                    )
                    pres, pres_src = _first_available(
                        row, indices, ('WMO_PRES', 'NEWDELHI_PRES')
                    )

                    dist2land = _to_float(
                        row[indices['DIST2LAND']] if 'DIST2LAND' in indices else None
                    )
                    speed = _to_float(
                        row[indices['STORM_SPEED']] if 'STORM_SPEED' in indices else None
                    )
                    sdir = _to_float(
                        row[indices['STORM_DIR']] if 'STORM_DIR' in indices else None
                    )

                    if sid not in storms_by_id:
                        storms_by_id[sid] = {
                            'id': sid,
                            'name': name,
                            'basin': 'North Indian Ocean (Bay of Bengal)',
                            'track': [],
                        }

                    pt_idx = len(storms_by_id[sid]['track'])
                    self._radii_cache[(sid, pt_idx)] = {
                        key: _quadrant_mean(row, indices, f'USA_{key}')
                        for key in ('R34', 'R50', 'R64')
                    }
                    storms_by_id[sid]['track'].append(
                        CycloneTrackPoint(
                            id=f"{sid}-pt-{pt_idx}",
                            timestamp=iso_time,
                            latitude=lat,
                            longitude=lon,
                            maxWindKts=wind,
                            centralPressureMb=pres,
                            windSource=wind_src,
                            pressureSource=pres_src,
                            category=self._get_category(wind),
                            status='OBSERVATION',
                            distanceToCoastKm=dist2land,
                            stormSpeedKts=speed,
                            stormDirDeg=sdir,
                            forecastConfidencePct=None,
                        )
                    )

        except Exception as e:
            logger.exception(
                "Failed to parse the IBTrACS snapshot at %s. Every cyclone count, "
                "hazard and risk score served by this API is measured from this "
                "file, so a parse failure cannot be reported as an absence of "
                "cyclones.",
                self.csv_path,
            )
            raise IBTrACSDataCorrupt(self.csv_path, e) from e

        cyclones: List[Cyclone] = []
        for sid, sdata in storms_by_id.items():
            track: List[CycloneTrackPoint] = sdata['track']
            if len(track) < 3:
                continue

            current_idx, default_reason = select_default_track_index(track)

            n = len(track)
            with_wind = sum(1 for pt in track if pt.maxWindKts is not None)
            with_pres = sum(1 for pt in track if pt.centralPressureMb is not None)
            completeness = DataCompleteness(
                trackPoints=n,
                withWind=round(with_wind / n, 4),
                withPressure=round(with_pres / n, 4),
            )

            # Wind radii come from the observed quadrant radii at the point the
            # API actually serves. Absent agency radii stay None rather than
            # being filled with one generic constant for every storm.
            radii = self._radii_cache.get((sid, current_idx), {})
            wind_radius = WindRadius(
                r34ktsKm=radii.get('R34'),
                r50ktsKm=radii.get('R50'),
                r64ktsKm=radii.get('R64'),
                source=(
                    'USA quadrant radii (IBTrACS)'
                    if any(radii.get(k) is not None for k in ('R34', 'R50', 'R64'))
                    else None
                ),
            )

            cyclones.append(
                Cyclone(
                    id=sid,
                    name=sdata['name'],
                    basin=sdata['basin'],
                    dataStatus='REAL',
                    currentTrackIndex=current_idx,
                    track=track,
                    forecastCone=[],
                    windRadius=wind_radius,
                    dataCompleteness=completeness,
                    defaultPointReason=default_reason,
                    defaultPointWindKts=(
                        track[current_idx].maxWindKts
                        if 0 <= current_idx < len(track)
                        else None
                    ),
                    sourceAttribution='NOAA IBTrACS v04r01 (Real Observations)',
                    isHistorical=True,
                )
            )

        self._cached_cyclones = cyclones
        return cyclones

    def get_cyclone_by_id(self, sid: str) -> Optional[Cyclone]:
        """Resolve a cyclone by id or name.

        Returns None when nothing matches so callers can surface a 404. It must
        never fall back to an arbitrary cyclone — that silently answers a
        question about storm A with data about storm B.
        """
        for c in self.load_cyclones():
            if c.id == sid or c.name.lower() == sid.lower():
                return c
        return None

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

        # Default to the served (peak-intensity) point rather than track[0];
        # an explicit timestamp or lat/lon still wins.
        best_pt = track[min(cyclone.currentTrackIndex, len(track) - 1)]

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
            "windSource": best_pt.windSource,
            "pressureSource": best_pt.pressureSource,
            "category": best_pt.category,
            "distanceToCoastKm": best_pt.distanceToCoastKm,
            "stormSpeedKts": best_pt.stormSpeedKts,
            "stormDirDeg": best_pt.stormDirDeg,
            "dataCompleteness": (
                cyclone.dataCompleteness.model_dump() if cyclone.dataCompleteness else None
            ),
            "defaultPointReason": cyclone.defaultPointReason,
            "defaultPointWindKts": best_pt.maxWindKts,
            "source": "NOAA IBTrACS v04r01",
        }

ibtracs_provider = IBTrACSProvider()
