import math
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, HTTPException, Query

from app.core.config import settings
from app.models.schemas import (
    Cyclone,
    Hazard,
    GISLayer,
    DatasetInfo,
    LayerDataResponse,
    DepthSliceResponse,
    RiskAssessment,
    ArgoProfile,
    ArgoFloat,
    ArgoObservationPoint,
    ArgoMatchupResponse,
    StatusResponse,
)
from app.providers.ibtracs_provider import ibtracs_provider
from app.providers.incois_provider import (
    DepthSliceDatasetError,
    DepthSliceDepthError,
    DepthSliceTimestampError,
    DepthSliceVariableError,
    DepthSliceVariableUnavailableError,
    LayerDataTimestampError,
    incois_provider,
)
from app.providers.argo_provider import argo_provider
from app.services.risk_engine import calculate_prototype_risk
from app.services.model_observation_matchup import (
    DEFAULT_MATCH_MODE,
    MODEL_DEPTH_SELECTION_MODEL_LEVELS,
    match_argo_with_hycom,
)
from app.services.ocean_heat_metrics import TCHP_DEFINITION_STATUS
from app.services.matchup_summary import (
    REASON_COARSE,
    REASON_NO_OVERLAP,
    REASON_NO_PAIRS,
    REASON_TIME_GAP,
    REASON_UNAVAILABLE,
    exclusion_counts,
    summarize_matches,
)


router = APIRouter()
_landing_summary_cache: Optional[Dict[str, Any]] = None

@router.get("/health")
def get_health():
    return {
        "status": "ok",
        "service": "OceanLens API",
        "version": "1.0.0"
    }

@router.get("/status", response_model=StatusResponse)
def get_status():
    """Return system status including explicit data mode information.

    dataMode:        "REAL" or "FIXTURE" — set by OCEANX_DATA_MODE env var.
    datasetSynthetic: True when serving committed synthetic fixture data.
    mode:            Backward-compatible; "REAL" only when DATA_MODE==REAL
                     and the production file is present, "SIMULATED" otherwise.
    datasetLoaded:   True when the configured HYCOM file is reachable.
    """
    data_mode = settings.DATA_MODE  # "REAL" | "FIXTURE"
    dataset_file_present = (
        settings.PROCESSED_OCEAN_FILE.exists()
        or settings.RAW_HYCOM_FILE.exists()
    )
    dataset_synthetic = (data_mode == "FIXTURE")
    # "REAL" on the wire only when we have REAL production data
    compat_mode = (
        "REAL"
        if (data_mode == "REAL" and dataset_file_present)
        else "SIMULATED"
    )
    return StatusResponse(
        mode=compat_mode,
        backendConnected=True,
        datasetLoaded=dataset_file_present,
        provider="INCOIS & NOAA IBTrACS",
        dataMode=data_mode,
        datasetSynthetic=dataset_synthetic,
        # A coarsened REAL subset stays REAL data; the scope says how much of
        # it is installed so a reader is never misled about the resolution.
        dataScope=settings.DATA_SCOPE,
    )


@router.get("/summary/landing")
def get_landing_summary():
    """Return the small set of measured counts used by the landing page.

    The first request reuses the existing providers and matchup summary
    calculation. The compact result is then held for the lifetime of this
    process, so the landing page never downloads the full profile, cyclone, or
    regional-summary payloads and repeated visits do not repeat the work.
    """
    global _landing_summary_cache
    if _landing_summary_cache is None:
        profiles = argo_provider.get_profiles()
        cyclones = ibtracs_provider.load_cyclones()
        summary = get_argo_matchup_summary()
        _landing_summary_cache = {
            "argoProfileCount": len(profiles),
            "includedProfileCount": int(summary.get("includedProfileCount", 0)),
            "excludedProfileCount": int(summary.get("excludedProfileCount", 0)),
            "cycloneTrackCount": len(cyclones),
            "modelRunCount": len(summary.get("modelRuns") or []),
            "dataScope": settings.DATA_SCOPE,
        }
    return _landing_summary_cache

@router.get("/datasets", response_model=List[DatasetInfo])
def get_datasets():
    meta = incois_provider.get_metadata()
    timestamps = incois_provider.get_available_timestamps()
    has_incois = (
        settings.PROCESSED_OCEAN_FILE.exists()
        or settings.RAW_HYCOM_FILE.exists()
    )

    incois_ds = DatasetInfo(
        dataset_name="OceanLens Bay of Bengal Ocean Conditions",
        provider="INCOIS",
        status="REAL" if has_incois else "NOT CURRENTLY INTEGRATED",
        source="INCOIS RSMC HYCOM",
        region=meta.get("region", {"min_lat": 5.0, "max_lat": 25.0, "min_lon": 80.0, "max_lon": 100.0}),
        time_range={
            "start": timestamps[0] if timestamps else "",
            "end": timestamps[-1] if timestamps else ""
        },
        time_steps_count=len(timestamps),
        dataScope=settings.DATA_SCOPE,
        variables=meta.get("variables", {
            "UVEL": "Eastward ocean current",
            "VVEL": "Northward ocean current",
            "TEMP": "Sea surface temperature",
            "SALN": "Sea surface salinity",
            "TCHP": "Tropical Cyclone Heat Potential"
        })
    )

    # IBTrACS facts are measured from the file that is actually served, not
    # asserted: the provider filters to seasons >= 2020 and skips UNNAMED
    # storms, so the advertised range and count must come from that same set.
    served_cyclones = ibtracs_provider.load_cyclones()
    ibtracs_points = sum(len(c.track) for c in served_cyclones)
    ibtracs_times = sorted(
        pt.timestamp for c in served_cyclones for pt in c.track
    )

    ibtracs_ds = DatasetInfo(
        dataset_name="NOAA IBTrACS North Indian Ocean",
        provider="NOAA NCEI",
        status="REAL" if served_cyclones else "NOT CURRENTLY INTEGRATED",
        source="IBTrACS v04r01 (seasons >= 2020 as served by this API)",
        region={"min_lat": 0.0, "max_lat": 30.0, "min_lon": 50.0, "max_lon": 100.0},
        time_range={
            "start": ibtracs_times[0] if ibtracs_times else "",
            "end": ibtracs_times[-1] if ibtracs_times else ""
        },
        time_steps_count=ibtracs_points,
        dataScope="FULL",
        variables={
            "LAT": "Latitude",
            "LON": "Longitude",
            "WMO_WIND": "Maximum sustained wind (kts), preferred",
            "NEWDELHI_WIND": "IMD maximum sustained wind (kts), used when WMO_WIND is blank",
            "WMO_PRES": "Central pressure (mb), preferred",
            "NEWDELHI_PRES": "IMD central pressure (mb), used when WMO_PRES is blank"
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

@router.get("/observations")
def get_observations():
    timestamps = incois_provider.get_available_timestamps()
    cyclones = ibtracs_provider.load_cyclones()

    # Derive the status from what was actually read, never a hardcoded "REAL".
    if settings.DATA_MODE == "FIXTURE":
        ocean_status = "SIMULATED"
    elif timestamps:
        ocean_status = "REAL"
    else:
        ocean_status = "NOT CURRENTLY INTEGRATED"

    cyclone_status = "REAL" if cyclones else "NOT CURRENTLY INTEGRATED"

    if ocean_status == "SIMULATED":
        overall = "SIMULATED"
    elif cyclone_status == "REAL" and ocean_status == "REAL":
        overall = "REAL"
    else:
        overall = "PARTIAL"

    return {
        "status": overall,
        "oceanDataStatus": ocean_status,
        "cycloneDataStatus": cyclone_status,
        "dataMode": settings.DATA_MODE,
        "source": "INCOIS & NOAA IBTrACS",
        "available_timestamps": timestamps,
        # The depth-resolved file is a SEPARATE HYCOM run with its own window,
        # which can differ from the surface file's. Publishing it is what lets a
        # depth or currents request be made at a time that dataset really has.
        "available_depth_timestamps": incois_provider.get_available_depth_timestamps(),
        "active_cyclone_count": len(cyclones)
    }

@router.get("/hazards", response_model=List[Hazard])
def get_hazards(
    cyclone_id: Optional[str] = Query(None, description="Cyclone id or name (default: first available)"),
    index: Optional[int] = Query(None, description="Cyclone track index"),
    timestamp: Optional[str] = Query(None, description="Observation timestamp")
):
    cyclones = ibtracs_provider.load_cyclones()
    if not cyclones:
        raise HTTPException(status_code=404, detail="No active hazards found")

    if cyclone_id:
        c = ibtracs_provider.get_cyclone_by_id(cyclone_id)
        if c is None:
            raise HTTPException(
                status_code=404, detail=f"Cyclone '{cyclone_id}' not found"
            )
    else:
        c = cyclones[0]

    risk = calculate_prototype_risk(c, timestamp=timestamp, track_index=index)

    return [
        Hazard(
            id=f"hazard-{c.id}",
            title=f"Cyclonic Warning: {c.name}",
            type="cyclone",
            # Severity is None whenever the heuristic declined to score; the
            # client must check riskAssessment.status rather than assume a band.
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
    """Score a specific cyclone.

    ``hazard_id`` genuinely selects the cyclone (accepting either the IBTrACS
    SID or the storm name, with or without a ``hazard-`` prefix). An unknown id
    is a 404 — never a silently substituted different storm.
    """
    cyclones = ibtracs_provider.load_cyclones()
    if not cyclones:
        raise HTTPException(status_code=404, detail="No cyclones loaded")

    sid = hazard_id[len('hazard-'):] if hazard_id.startswith('hazard-') else hazard_id
    c = ibtracs_provider.get_cyclone_by_id(sid)
    if c is None:
        raise HTTPException(
            status_code=404,
            detail=(
                f"Cyclone '{hazard_id}' not found. "
                f"Available ids: {', '.join(sorted(x.id for x in cyclones)[:10])}..."
            ),
        )
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
    """Return available GIS layers with status values that reflect the actual
    active data mode.

    HYCOM layer status coherence rules:
      DATA_MODE==REAL  + production file present  → "REAL"
      DATA_MODE==REAL  + production file absent   → "NOT CURRENTLY INTEGRATED"
      DATA_MODE==FIXTURE                          → "SIMULATED"

    Only layers backed by a real dataset are listed: the HYCOM physical
    fields (currents, SST, salinity, TCHP, SSH, MLD) plus the Argo in-situ
    layer, which is always "REAL".
    """
    data_mode = settings.DATA_MODE
    # The path may already resolve into the committed demo subset, so presence
    # is not evidence of a production install — the scope is.
    data_scope = settings.DATA_SCOPE
    production_available = (
        settings.PROCESSED_OCEAN_FILE.exists()
        or settings.RAW_HYCOM_FILE.exists()
    )

    if data_mode == "FIXTURE":
        hycom_status: str = "SIMULATED"
        hycom_desc_suffix = " (synthetic fixture — not scientific evidence)"
    elif production_available:
        hycom_status = "REAL"
        hycom_desc_suffix = ""
    else:
        hycom_status = "NOT CURRENTLY INTEGRATED"
        hycom_desc_suffix = " (production dataset not installed)"

    return [
        GISLayer(
            id='currents',
            name='Ocean Currents (HYCOM)',
            category='physical',
            active=True,
            status=hycom_status,
            description='INCOIS HYCOM ocean velocity vector field (u, v components)' + hycom_desc_suffix,
            unit='m/s',
            dataScope=data_scope,
        ),
        GISLayer(
            id='sst',
            name='Sea Surface Temp (SST)',
            category='physical',
            active=False,
            status=hycom_status,
            description='INCOIS HYCOM sea surface temperature field' + hycom_desc_suffix,
            unit='°C',
            dataScope=data_scope,
        ),
        GISLayer(
            id='salinity',
            name='Sea Surface Salinity',
            category='physical',
            active=False,
            status=hycom_status,
            description='INCOIS HYCOM sea surface salinity field' + hycom_desc_suffix,
            unit='PSU',
            dataScope=data_scope,
        ),
        GISLayer(
            id='tchp',
            name='Ocean Heat Potential (TCHP)',
            category='hazard',
            active=False,
            status=hycom_status,
            description='INCOIS HYCOM tropical cyclone heat potential' + hycom_desc_suffix,
            unit='kJ/cm²',
            dataScope=data_scope,
        ),
        GISLayer(
            id='ssh',
            name='Sea Surface Height (SSH)',
            category='physical',
            active=False,
            status=hycom_status,
            description='INCOIS HYCOM sea surface height anomaly' + hycom_desc_suffix,
            unit='m',
            dataScope=data_scope,
        ),
        GISLayer(
            id='mld',
            name='Mixed Layer Depth (MLD)',
            category='physical',
            active=False,
            status=hycom_status,
            description='INCOIS HYCOM mixed layer depth' + hycom_desc_suffix,
            unit='m',
            dataScope=data_scope,
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
    """Return one surface model layer.

    The response carries both the time it was asked for (``requestedTimestamp``)
    and the model time the grid actually holds (``timestamp``), plus
    ``timeMatched``. A request for a time the dataset does not cover is
    answered with the nearest time it does have and ``timeMatched: false`` —
    never silently with a different day that the response reads as the request.
    """
    try:
        layer_res = incois_provider.get_layer_data(layer_name=layer_name, timestamp=timestamp, stride=stride)
    except LayerDataTimestampError as e:
        # An unreadable timestamp is a client error; it is never answered with
        # another day's field.
        raise HTTPException(status_code=400, detail=e.detail)
    if not layer_res:
        raise HTTPException(
            status_code=404,
            detail=f"Layer '{layer_name}' not available or dataset missing"
        )
    return layer_res


# ============================================================
# HYCOM Model Depth Slice (Phase 1A)
# ============================================================

@router.get("/model/depth-slice", response_model=DepthSliceResponse)
def get_model_depth_slice(
    variable: str = Query(..., description="Variable to slice: temperature, salinity, currents, ssh, tchp, mld"),
    timestamp: Optional[str] = Query(None, description="ISO timestamp; defaults to the first available model time"),
    depth: float = Query(..., description="Requested depth in meters; the nearest native HYCOM model depth is used"),
    stride: int = Query(3, description="Spatial downsampling stride for payload optimization")
):
    """Return a HYCOM model depth slice at the nearest native model depth level.

    Values come from a single native model level - depth is never
    interpolated. The response reports both the requested depth and the
    matched native model depth.
    """
    try:
        return incois_provider.get_depth_slice(
            variable=variable,
            timestamp=timestamp,
            requested_depth_m=depth,
            stride=stride,
        )
    except DepthSliceVariableError as e:
        raise HTTPException(status_code=404, detail=e.detail)
    except DepthSliceTimestampError as e:
        # Unparseable input is a client error; a parseable timestamp outside
        # the dataset's coverage is an unavailable-data error.
        if "unparseable" in e.message:
            raise HTTPException(status_code=400, detail=e.detail)
        raise HTTPException(status_code=404, detail=e.detail)
    except DepthSliceDepthError as e:
        raise HTTPException(status_code=400, detail=e.detail)
    except DepthSliceVariableUnavailableError as e:
        # The dataset genuinely lacks the variable (e.g. UVEL/VVEL absent):
        # an honest unavailable-data error, never a substitute variable.
        raise HTTPException(status_code=503, detail=e.detail)
    except DepthSliceDatasetError as e:
        raise HTTPException(status_code=503, detail=e.detail)


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
def get_argo_hycom_matchup(
    profile_id: str,
    matchMode: Optional[str] = Query(
        None,
        description="Vertical sub-sampling: 'model_levels' (default) compares the model AT its "
                    "own depth levels, interpolating the float onto each; 'float_levels' blends "
                    "between native HYCOM depths onto every float depth; 'native' uses the "
                    "nearest native level within the tolerance only. 'interpolated' is accepted "
                    "as a backward-compatible alias for 'float_levels'.",
    ),
    spatialMode: Optional[str] = Query(
        None,
        description="Horizontal sub-sampling: 'bilinear' (default) blends the four surrounding cells; "
                    "'nearest' uses the closest grid cell only",
    ),
    # snake_case aliases so both the wire convention and the response field
    # names work for callers.
    match_mode: Optional[str] = Query(None, include_in_schema=False),
    spatial_mode: Optional[str] = Query(None, include_in_schema=False),
):
    matchup = match_argo_with_hycom(
        profile_id,
        match_mode=matchMode if matchMode is not None else match_mode,
        spatial_mode=spatialMode if spatialMode is not None else spatial_mode,
    )
    if not matchup:
        raise HTTPException(status_code=404, detail="Could not match Argo profile with HYCOM dataset")
    return matchup


def _finite(value: Any) -> Optional[float]:
    """``math.isfinite`` that tolerates ``None`` and non-numeric model cells."""
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value) if math.isfinite(value) else None
    return None


def _exclusion_reason(matchup: Dict[str, Any]) -> str:
    """Classify a profile that yielded no comparison row at all.

    Three findings look identical in the response (an empty ``comparisons``
    list) but mean different things, so they are told apart here rather than
    collapsing every one of them into "no overlap".
    """
    rejected = [entry.get("reason") for entry in (matchup.get("excludedModelLevels") or [])]
    if any(value == "float_sampling_too_coarse" for value in rejected):
        return REASON_COARSE
    if not rejected:
        # The float never entered the model's depth range, so no model level was
        # even a candidate.
        return REASON_NO_OVERLAP
    # Model levels were in range but every one of them was rejected.
    return REASON_NO_PAIRS


@router.get("/argo/matchup/summary")
def get_argo_matchup_summary():
    """Regional model-vs-observation summary across every ingested profile.

    Runs the default ``model_levels`` matchup for each profile and aggregates
    per model depth. Only profiles whose observation-model time gap is
    "good" contribute; every excluded profile is counted with a reason so a
    missing contribution is visible rather than silent.

    Statistics are aggregated per profile and then per depth (see
    ``matchup_summary``), so a profile that sampled finely does not dominate.
    """
    profiles = argo_provider.get_profiles()
    matches = []
    exclusions = []

    for profile in profiles:
        matchup = match_argo_with_hycom(profile["profile_id"])
        if matchup is None:
            exclusions.append((REASON_UNAVAILABLE, {"profileId": profile["profile_id"]}))
            continue

        profile_id = profile["profile_id"]
        if matchup.get("statusMessage"):
            exclusions.append((REASON_UNAVAILABLE, {"profileId": profile_id}))
            continue
        if matchup.get("timeGapStatus") != "good":
            exclusions.append((REASON_TIME_GAP, {"profileId": profile_id}))
            continue

        comparisons = matchup.get("comparisons") or []
        if not comparisons:
            exclusions.append((_exclusion_reason(matchup), {
                "profileId": profile_id,
                "excludedModelLevels": [
                    entry.get("reason")
                    for entry in (matchup.get("excludedModelLevels") or [])
                ],
            }))
            continue

        # A profile can produce comparison rows whose every model and/or float
        # value was rejected downstream (QC, or a nil model cell). Such a profile
        # has rows but no usable statistic, so counting it as included would
        # inflate the denominator of the regional figures.
        if not any(
            _finite(pair.get("temperatureResidualC")) is not None
            or _finite(pair.get("salinityResidualPSU")) is not None
            for pair in comparisons
        ):
            exclusions.append((REASON_NO_PAIRS, {
                "profileId": profile_id,
                "excludedModelLevels": [
                    entry.get("reason")
                    for entry in (matchup.get("excludedModelLevels") or [])
                ],
            }))
            continue

        matches.append({
            "profileId": profile_id,
            "floatId": matchup.get("floatId"),
            "observationTimestamp": matchup.get("observationTimestamp"),
            "timeDifferenceHours": matchup.get("timeDifferenceHours"),
            "timeGapStatus": matchup.get("timeGapStatus"),
            "modelRun": matchup.get("modelRun"),
            "modelDataStatus": matchup.get("modelDataStatus"),
            "comparisons": comparisons,
            # Cyclone-relevant heat content, carried through the same inclusion
            # decision so the scatter and the temperature rows describe the same
            # set of profiles.
            "tchpFloatKjCm2": matchup.get("tchpFloatKjCm2"),
            "tchpModelKjCm2": matchup.get("tchpModelKjCm2"),
            "tchpResidualKjCm2": matchup.get("tchpResidualKjCm2"),
            "tchpResidualPercent": matchup.get("tchpResidualPercent"),
            "d26FloatM": matchup.get("d26FloatM"),
            "mldModelM": matchup.get("mldModelM"),
            "metricsStatus": matchup.get("metricsStatus"),
            "metricsReason": matchup.get("metricsReason"),
            "modelDepthAxis": matchup.get("modelDepthAxis"),
            "modelDepthAxisRule": matchup.get("modelDepthAxisRule"),
            "modelDepths": matchup.get("modelDepths"),
            "storedFileDepths": matchup.get("storedFileDepths"),
            "modelProfileTemperaturesC": matchup.get("modelProfileTemperaturesC"),
            "modelDepthSelection": matchup.get("modelDepthSelection"),
        })

    summary = summarize_matches(matches)
    counts = exclusion_counts(exclusions)
    excluded_profiles = [
        {"profileId": detail.get("profileId"), "reason": reason, **{
            k: v for k, v in detail.items() if k != "profileId"
        }}
        for reason, detail in exclusions
    ]

    return {
        "matchMode": DEFAULT_MATCH_MODE,
        "modelDataset": "INCOIS HYCOM",
        "modelDataStatus": next(
            (m.get("modelDataStatus") for m in matches if m.get("modelDataStatus")), "UNAVAILABLE"
        ),
        "modelRuns": sorted({m.get("modelRun") for m in matches if m.get("modelRun")}),
        "modelDepthAxis": next(
            (m.get("modelDepthAxis") for m in matches if m.get("modelDepthAxis")),
            "native",
        ),
        "modelDepthAxisRule": next(
            (m.get("modelDepthAxisRule") for m in matches if m.get("modelDepthAxisRule")),
            "native",
        ),
        "modelDepths": next(
            (m.get("modelDepths") for m in matches if m.get("modelDepths")),
            [],
        ),
        "storedFileDepths": next(
            (m.get("storedFileDepths") for m in matches if m.get("storedFileDepths")),
            [],
        ),
        "modelDepthSelection": next(
            (m.get("modelDepthSelection") for m in matches if m.get("modelDepthSelection")),
            MODEL_DEPTH_SELECTION_MODEL_LEVELS,
        ),
        "floatBracketMaxGapM": settings.FLOAT_BRACKET_MAX_GAP_M,
        "floatBracketMaxGapDeepM": settings.FLOAT_BRACKET_MAX_GAP_DEEP_M,
        "floatBracketDeepBreakpointM": settings.FLOAT_BRACKET_DEEP_BREAKPOINT_M,
        "totalProfileCount": len(profiles),
        "includedProfileCount": summary["profileCount"],
        "excludedProfileCount": len(exclusions),
        "excludedProfileReasons": counts,
        "excludedProfiles": excluded_profiles,
        "byModelDepth": summary["byModelDepth"],
        "overall": summary["overall"],
        # --- cyclone-relevant heat content ---
        "tchp": summary["tchp"],
        "tchpScatter": summary["tchpScatter"],
        "tchpProfiles": summary["tchpProfiles"],
        "tchpModelDefinition": summary.get("tchpModelDefinition"),
        "tchpIsothermC": 26.0,
        "tchpDefinitionStatus": TCHP_DEFINITION_STATUS,
        "tchpRuleOfThumbKJPerCm2": settings.TCHP_RULE_OF_THUMB_KJ_CM2,
        "profiles": summary["profiles"],
    }


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
