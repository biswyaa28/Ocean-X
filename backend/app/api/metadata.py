"""API Route: Dataset and Model Metadata."""
from fastapi import APIRouter
from app.models.schemas import DatasetMetadata
from app.services.model_service import model_service

router = APIRouter(prefix="/metadata", tags=["Metadata"])


@router.get("", response_model=DatasetMetadata)
def get_metadata() -> DatasetMetadata:
    """Retrieve ocean numerical model dataset and runtime metadata."""
    return model_service.get_metadata()
