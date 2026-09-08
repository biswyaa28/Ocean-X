"""Model data source abstraction (STEP 3B §4, §23).

``ModelDataSource`` is the only boundary through which the scientific pipeline
reaches model data. API and service code never manipulates xarray objects
directly, which is what lets the fixture and real NetCDF pathways share one set
of service interfaces without any API contract change.
"""
from app.datasources.base import (
    ModelDataSource,
    ModelGridInfo,
    ModelProfileSample,
    ModelRegionSlice,
    VariableResolution,
    VariableNotFoundError,
)
from app.datasources.factory import get_model_data_source, reset_model_data_source

__all__ = [
    "ModelDataSource",
    "ModelGridInfo",
    "ModelProfileSample",
    "ModelRegionSlice",
    "VariableResolution",
    "VariableNotFoundError",
    "get_model_data_source",
    "reset_model_data_source",
]
