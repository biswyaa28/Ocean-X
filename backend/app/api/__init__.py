"""OCEAN-X API Router Initialization."""
from app.api.metadata import router as metadata_router
from app.api.model import router as model_router
from app.api.argo import router as argo_router
from app.api.comparison import router as comparison_router

__all__ = ["metadata_router", "model_router", "argo_router", "comparison_router"]
