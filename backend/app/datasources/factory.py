"""Model data source selection (STEP 3B §23).

One process-wide cached source, chosen by ``settings.MODEL_SOURCE``. Switching
between ``"fixture"`` and ``"netcdf"`` changes no API contract and no service
signature — only which implementation the pipeline talks to.
"""
from __future__ import annotations

import threading
from typing import Optional

from app.core.config import settings
from app.datasources.base import ModelDataSource

_lock = threading.Lock()
_instance: Optional[ModelDataSource] = None
_instance_kind: Optional[str] = None


def build_model_data_source(kind: Optional[str] = None) -> ModelDataSource:
    """Construct (but do not cache) a model data source."""
    kind = (kind or settings.MODEL_SOURCE or "fixture").strip().lower()

    if kind == "fixture":
        from app.datasources.fixture_source import FixtureModelDataSource

        return FixtureModelDataSource().open()

    if kind == "netcdf":
        from app.datasources.netcdf_source import NetCDFModelDataSource

        return NetCDFModelDataSource().open()

    raise ValueError(f"unknown MODEL_SOURCE '{kind}'; expected 'fixture' or 'netcdf'")


def get_model_data_source(kind: Optional[str] = None) -> ModelDataSource:
    """Return the cached model data source, opening it on first use."""
    global _instance, _instance_kind
    requested = (kind or settings.MODEL_SOURCE or "fixture").strip().lower()
    with _lock:
        if _instance is not None and _instance_kind == requested:
            return _instance
        if _instance is not None:
            _instance.close()
        _instance = build_model_data_source(requested)
        _instance_kind = requested
        return _instance


def reset_model_data_source() -> None:
    """Close and clear the cached source. Used by tests and on reconfiguration."""
    global _instance, _instance_kind
    with _lock:
        if _instance is not None:
            _instance.close()
        _instance = None
        _instance_kind = None
