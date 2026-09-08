"""API Routes: In-situ Argo Float Profiles."""
from typing import List
from fastapi import APIRouter, HTTPException
from app.models.schemas import ArgoSummary, ArgoProfile
from app.services.argo_service import argo_service

router = APIRouter(prefix="/argo", tags=["Argo"])


@router.get("", response_model=List[ArgoSummary])
def list_argo_profiles() -> List[ArgoSummary]:
    """Retrieve summary metadata for available Argo observation profiles."""
    return argo_service.list_profiles()


@router.get("/{profile_id}", response_model=ArgoProfile)
def get_argo_profile(profile_id: str) -> ArgoProfile:
    """Retrieve observation levels and QC flags for a specific Argo profile."""
    prof = argo_service.get_profile(profile_id)
    if not prof:
        raise HTTPException(status_code=404, detail=f"Argo profile '{profile_id}' not found")
    return prof
