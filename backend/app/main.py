"""OCEAN-X FastAPI Application Main Entrypoint.

Smart India Hackathon SIH26067
Web-Based Interactive 3D Visualization Platform Integrating Numerical Ocean Model Outputs and In-Situ Observations.
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.api.metadata import router as metadata_router
from app.api.model import router as model_router
from app.api.argo import router as argo_router
from app.api.comparison import router as comparison_router

app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    description=(
        "OCEAN-X Backend Service — High-performance ocean numerical model "
        "and in-situ observation analysis engine."
    ),
    docs_url="/docs",
    redoc_url="/redoc",
)

# Enable CORS for local Vite development frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health", tags=["Health"])
def health_check() -> dict:
    """Service health check endpoint."""
    return {
        "status": "ok",
        "service": "ocean-x-backend"
    }


# Include domain API routers under /api namespace
app.include_router(metadata_router, prefix="/api")
app.include_router(model_router, prefix="/api")
app.include_router(argo_router, prefix="/api")
app.include_router(comparison_router, prefix="/api")
