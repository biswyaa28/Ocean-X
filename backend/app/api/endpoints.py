from typing import List, Optional
from fastapi import APIRouter, HTTPException, Query

from app.models.schemas import (
    Cyclone,
    Hazard,
    Station,
    GISLayer,
    DatasetInfo,
    LayerDataResponse,
    RiskAssessment,
    ArgoProfile,
    ArgoFloat,
    ArgoObservationPoint,
    ArgoMatchupResponse
)
from app.providers.ibtracs_provider import ibtracs_provider
from app.providers.incois_provider import incois_provider
from app.providers.argo_provider import argo_provider
from app.services.risk_engine import calculate_prototype_risk
from app.services.model_observation_matchup import match_argo_with_hycom


router = APIRouter()

@router.get("/health")
def get_health():
    return {
        "status": "ok",
        "service": "OceanLens API",
        "version": "1.0.0"
    }

@router.get("/status")
def get_status():
    nc_meta = incois_provider.get_metadata()
    has_incois = bool(nc_meta)
    return {
        "mode": "REAL" if has_incois else "SIMULATED",
        "backendConnected": True,
        "datasetLoaded": has_incois,
        "provider": "INCOIS & NOAA IBTrACS"
    }

@router.get("/datasets", response_model=List[DatasetInfo])
def get_datasets():
    meta = incois_provider.get_metadata()
    timestamps = incois_provider.get_available_timestamps()
    
    incois_ds = DatasetInfo(
        dataset_name="OceanLens Bay of Bengal Ocean Conditions",
        provider="INCOIS",
        status="REAL",
        source="INCOIS RSMC HYCOM",
        region=meta.get("region", {"min_lat": 5.0, "max_lat": 25.0, "min_lon": 80.0, "max_lon": 100.0}),
        time_range={
            "start": timestamps[0] if timestamps else "2026-09-07T06:00:00",
            "end": timestamps[-1] if timestamps else "2026-09-14T00:00:00"
        },
        time_steps_count=len(timestamps),
        variables=meta.get("variables", {
            "UVEL": "Eastward ocean current",
            "VVEL": "Northward ocean current",
            "TEMP": "Sea surface temperature",
            "SALN": "Sea surface salinity",
            "TCHP": "Tropical Cyclone Heat Potential"
        })
    )

    ibtracs_ds = DatasetInfo(
        dataset_name="NOAA IBTrACS North Indian Ocean",
        provider="NOAA NCEI",
        status="REAL",
        source="IBTrACS v04r01",
        region={"min_lat": 0.0, "max_lat": 30.0, "min_lon": 50.0, "max_lon": 100.0},
        time_range={"start": "1842-10-25", "end": "2025-12-02"},
        time_steps_count=62851,
        variables={
            "LAT": "Latitude",
            "LON": "Longitude",
            "WMO_WIND": "Maximum sustained wind (kts)",
            "WMO_PRES": "Central pressure (mb)"
        }
    )

    return [incois_ds, ibtracs_ds]

@router.get("/cyclones", response_model=List[Cyclone])
def get_cyclones():
    cyclones = ibtracs_provider.load_cyclones()
    return cyclones

@router.get("/cyclones/inspect")
def inspect_cyclone(
    lat: Optional[float] = Query(None, description="Latitude"),
    lon: Optional[float] = Query(None, description="Longitude"),
    timestamp: Optional[str] = Query(None, description="ISO timestamp"),
    cyclone_id: Optional[str] = Query(None, description="Cyclone ID or name")
):
    res = ibtracs_provider.inspect_cyclone(lat=lat, lon=lon, timestamp=timestamp, cyclone_id=cyclone_id)
    if not res:
        raise HTTPException(status_code=404, detail="No cyclone observation found")
    return res

@router.get("/cyclones/{id}", response_model=Cyclone)
def get_cyclone_by_id(id: str):
    c = ibtracs_provider.get_cyclone_by_id(id)
    if not c:
        raise HTTPException(status_code=404, detail="Cyclone not found")
    return c

@router.get("/stations", response_model=List[Station])
def get_stations():
    # Stations return explicit SIMULATED status until real station API streams are connected (Req #3)
    return [
        Station(
            id='st-bd08',
            name='INCOIS Ocean Buoy BD08',
            latitude=18.2,
            longitude=89.7,
            region='East Bay of Bengal',
            status='active',
            type='buoy',
            dataStatus='SIMULATED',
            currentMeasurements={
                'sstC': 30.2,
                'windSpeedKts': 48,
                'waveHeightM': 5.8,
                'pressureMb': 978
            }
        ),
        Station(
            id='st-bd10',
            name='INCOIS Ocean Buoy BD10',
            latitude=16.5,
            longitude=87.9,
            region='Central Bay of Bengal',
            status='active',
            type='buoy',
            dataStatus='SIMULATED',
            currentMeasurements={
                'sstC': 30.8,
                'windSpeedKts': 110,
                'waveHeightM': 9.4,
                'pressureMb': 942
            }
        ),
        Station(
            id='st-paradip',
            name='Paradeep Coastal Radar & Gauge',
            latitude=20.26,
            longitude=86.67,
            region='Odisha Coast',
            status='active',
            type='coastal_radar',
            dataStatus='SIMULATED',
            currentMeasurements={
                'sstC': 29.5,
                'windSpeedKts': 65,
                'waveHeightM': 4.2
            }
        )
    ]

@router.get("/observations")
def get_observations():
    timestamps = incois_provider.get_available_timestamps()
    return {
        "status": "REAL",
        "source": "INCOIS & NOAA IBTrACS",
        "available_timestamps": timestamps,
        "active_cyclone_count": len(ibtracs_provider.load_cyclones())
    }

@router.get("/hazards", response_model=List[Hazard])
def get_hazards(
    index: Optional[int] = Query(None, description="Cyclone track index"),
    timestamp: Optional[str] = Query(None, description="Observation timestamp")
):
    cyclones = ibtracs_provider.load_cyclones()
    if not cyclones:
        raise HTTPException(status_code=404, detail="No active hazards found")

    c = cyclones[0]
    risk = calculate_prototype_risk(c, timestamp=timestamp, track_index=index)

    return [
        Hazard(
            id=f"hazard-{c.id}",
            title=f"Cyclonic Warning: {c.name}",
            type="cyclone",
            severity=risk.category,
            location=c.basin,
            dataStatus="REAL",
            riskAssessment=risk
        )
    ]

@router.get("/risk/{hazard_id}", response_model=RiskAssessment)
def get_risk_assessment(
    hazard_id: str,
    index: Optional[int] = Query(None, description="Cyclone track index"),
    timestamp: Optional[str] = Query(None, description="Observation timestamp")
):
    cyclones = ibtracs_provider.load_cyclones()
    c = cyclones[0] if cyclones else None
    if not c:
        raise HTTPException(status_code=404, detail="Hazard not found")
    return calculate_prototype_risk(c, timestamp=timestamp, track_index=index)

@router.get("/timeseries")
def get_timeseries():
    timestamps = incois_provider.get_available_timestamps()
    return {
        "status": "REAL",
        "source": "INCOIS RSMC HYCOM",
        "timestamps": timestamps
    }

@router.get("/layers", response_model=List[GISLayer])
def get_layers():
    return [
        GISLayer(
            id='currents',
            name='Ocean Currents (HYCOM)',
            category='physical',
            active=True,
            status='REAL',
            description='INCOIS HYCOM real ocean velocity vector field (u, v components)',
            unit='m/s'
        ),
        GISLayer(
            id='wind',
            name='Atmospheric Surface Wind',
            category='hazard',
            active=True,
            status='SIMULATED',
            description='Surface wind velocity field (Simulated / Analytical Parametric Model)',
            unit='kts'
        ),
        GISLayer(
            id='sst',
            name='Sea Surface Temp (SST)',
            category='physical',
            active=False,
            status='REAL',
            description='INCOIS HYCOM real absolute sea surface temperature field',
            unit='°C'
        ),
        GISLayer(
            id='salinity',
            name='Sea Surface Salinity',
            category='physical',
            active=False,
            status='REAL',
            description='INCOIS HYCOM real sea surface salinity field',
            unit='PSU'
        ),
        GISLayer(
            id='tchp',
            name='Ocean Heat Potential (TCHP)',
            category='hazard',
            active=False,
            status='REAL',
            description='INCOIS HYCOM real tropical cyclone heat potential',
            unit='kJ/cm²'
        ),
        GISLayer(
            id='argo',
            name='Argo Observations',
            category='physical',
            active=True,
            status='REAL',
            description='Real Argo float in-situ temperature and salinity profiles',
            unit='REAL • ARGO'
        )
    ]

@router.get("/layers/{layer_name}", response_model=LayerDataResponse)
def get_layer_data(
    layer_name: str,
    timestamp: Optional[str] = Query(None, description="ISO timestamp matching dataset available times"),
    stride: int = Query(3, description="Spatial downsampling stride for payload optimization")
):
    layer_res = incois_provider.get_layer_data(layer_name=layer_name, timestamp=timestamp, stride=stride)
    if not layer_res:
        raise HTTPException(
            status_code=404,
            detail=f"Layer '{layer_name}' not available or dataset missing"
        )
    return layer_res


# ============================================================
# Argo In-Situ Observation & Model Matchup Endpoints
# ============================================================

@router.get("/argo/floats", response_model=List[ArgoFloat])
def get_argo_floats():
    floats = argo_provider.get_floats()
    return floats


@router.get("/argo/profiles", response_model=List[ArgoProfile])
def get_argo_profiles():
    profiles = argo_provider.get_profiles()
    return profiles


@router.get("/argo/profiles/{profile_id}", response_model=ArgoProfile)
def get_argo_profile_by_id(profile_id: str):
    profile = argo_provider.get_profile(profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="Argo profile not found")
    return profile


@router.get("/argo/nearest", response_model=ArgoProfile)
def get_nearest_argo_profile(
    lat: float = Query(..., description="Latitude"),
    lon: float = Query(..., description="Longitude"),
    timestamp: Optional[str] = Query(None, description="Observation timestamp")
):
    profile = argo_provider.get_nearest_profile(lat, lon, timestamp)
    if not profile:
        raise HTTPException(status_code=404, detail="No nearby Argo profile found")
    return profile


@router.get("/argo/{profile_id}/observations", response_model=List[ArgoObservationPoint])
def get_argo_observations(profile_id: str):
    obs = argo_provider.get_profile_observations(profile_id)
    if obs is None:
        raise HTTPException(status_code=404, detail="Argo profile observations not found")
    return obs


@router.get("/argo/{profile_id}/matchup", response_model=ArgoMatchupResponse)
def get_argo_hycom_matchup(profile_id: str):
    matchup = match_argo_with_hycom(profile_id)
    if not matchup:
        raise HTTPException(status_code=404, detail="Could not match Argo profile with HYCOM dataset")
    return matchup


@router.get("/inspect")
def inspect_point(
    lat: float = Query(..., description="Latitude"),
    lon: float = Query(..., description="Longitude"),
    timestamp: Optional[str] = Query(None, description="ISO timestamp")
):
    res = incois_provider.inspect_point(lat=lat, lon=lon, timestamp=timestamp)
    if not res:
        raise HTTPException(status_code=404, detail="No ocean data found for target location")
    return res


