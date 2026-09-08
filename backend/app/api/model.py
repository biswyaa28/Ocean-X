"""API Routes: Model Times, Depths, and Slices."""
from typing import List, Optional
from fastapi import APIRouter, Query
from app.models.schemas import ModelTime, ModelDepth, ModelSlice
from app.services.model_service import model_service

router = APIRouter(prefix="/model", tags=["Model"])


@router.get("/times", response_model=List[ModelTime])
def get_model_times() -> List[ModelTime]:
    """Retrieve available model timestamps."""
    return model_service.get_times()


@router.get("/depths", response_model=List[ModelDepth])
def get_model_depths() -> List[ModelDepth]:
    """Retrieve available model standard depth levels."""
    return model_service.get_depths()


@router.get("/slice", response_model=ModelSlice)
def get_model_slice(
    time: Optional[int] = Query(0, description="Model time index", ge=0),
    depth: Optional[int] = Query(0, description="Model depth level index", ge=0),
    variable: Optional[str] = Query("temperature", description="Target variable (temperature or salinity)")
) -> ModelSlice:
    """Retrieve a 2D horizontal field slice at specified time and depth index."""
    return model_service.get_slice(time_index=time, depth_index=depth, variable=variable)
