"""API Routes: Model vs Observation Comparison."""
from typing import Optional
from fastapi import APIRouter, HTTPException, Query
from app.models.schemas import ProfileComparison
from app.services.comparison_service import comparison_service

router = APIRouter(prefix="/comparison", tags=["Comparison"])


@router.get("/{profile_id}", response_model=ProfileComparison)
def get_comparison(
    profile_id: str,
    variable: Optional[str] = Query("temperature", description="Target variable (temperature or salinity)")
) -> ProfileComparison:
    """Retrieve spatial/temporal match, profiles, Analysis–Observation Residual, and metrics for a profile."""
    comp = comparison_service.get_comparison(profile_id=profile_id, variable=variable)
    if not comp:
        raise HTTPException(status_code=404, detail=f"Comparison target profile '{profile_id}' not found")
    return comp
