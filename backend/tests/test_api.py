"""OceanLens API contract tests.

These tests validate the API contract and code paths. They run against the
REAL production datasets when installed; otherwise tests/conftest.py points
the HYCOM paths at committed SYNTHETIC schema-compatible fixtures (announced
in the test banner) so the suite never requires the multi-gigabyte
production data. Assertions are identical in both modes.
"""
import pytest
from app.core.config import settings
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def test_health():
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert "version" in data

def test_status():
    response = client.get("/status")
    assert response.status_code == 200
    data = response.json()
    # Phase 3: dataMode and datasetSynthetic must be present
    assert "dataMode" in data, "Phase 3: /api/status must include 'dataMode'"
    assert "datasetSynthetic" in data, "Phase 3: /api/status must include 'datasetSynthetic'"
    assert data["dataMode"] in ("REAL", "FIXTURE"), f"dataMode must be REAL or FIXTURE, got {data['dataMode']!r}"
    assert isinstance(data["datasetSynthetic"], bool), "datasetSynthetic must be a bool"
    assert data["backendConnected"] is True
    # Coherence: if dataMode==FIXTURE then mode must be SIMULATED and datasetSynthetic==True
    if data["dataMode"] == "FIXTURE":
        assert data["mode"] == "SIMULATED", "FIXTURE mode must report mode=SIMULATED"
        assert data["datasetSynthetic"] is True, "FIXTURE mode must report datasetSynthetic=True"
    # Coherence: datasetLoaded must match whether the configured file exists
    has_incois = (
        settings.PROCESSED_OCEAN_FILE.exists()
        or settings.RAW_HYCOM_FILE.exists()
    )
    assert data["datasetLoaded"] == has_incois, "datasetLoaded must reflect actual file presence"

def test_datasets():
    response = client.get("/datasets")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) >= 2
    providers = [d["provider"] for d in data]
    assert "INCOIS" in providers
    assert "NOAA NCEI" in providers
    incois = next(dataset for dataset in data if dataset["provider"] == "INCOIS")
    expected_status = (
        "REAL"
        if settings.PROCESSED_OCEAN_FILE.exists() or settings.RAW_HYCOM_FILE.exists()
        else "NOT CURRENTLY INTEGRATED"
    )
    assert incois["status"] == expected_status

def test_cyclones():
    response = client.get("/cyclones")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    if len(data) > 0:
        c = data[0]
        assert c["dataStatus"] == "REAL"
        assert len(c["track"]) > 0

def test_layer_currents():
    response = client.get("/layers/currents")
    assert response.status_code == 200
    data = response.json()
    # Phase 3: status reflects actual data mode — never hardcoded REAL
    assert data["status"] in ("REAL", "SIMULATED"), \
        f"currents layer status must be REAL or SIMULATED, got {data['status']!r}"
    assert "INCOIS HYCOM" in data["source"]
    assert data["units"] == "m/s"
    assert data["grid"]["u"] is not None
    assert data["grid"]["v"] is not None

def test_layer_sst():
    response = client.get("/layers/sst")
    assert response.status_code == 200
    data = response.json()
    # Phase 3: status reflects actual data mode
    assert data["status"] in ("REAL", "SIMULATED"), \
        f"sst layer status must be REAL or SIMULATED, got {data['status']!r}"
    assert "INCOIS" in data["source"]
    assert data["units"] == "°C"
    assert data["grid"]["values"] is not None

def test_layer_salinity():
    response = client.get("/layers/salinity")
    assert response.status_code == 200
    data = response.json()
    # Phase 3: status reflects actual data mode
    assert data["status"] in ("REAL", "SIMULATED"), \
        f"salinity layer status must be REAL or SIMULATED, got {data['status']!r}"
    assert data["units"] == "PSU"

def test_layer_tchp():
    response = client.get("/layers/tchp")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] in ("REAL", "SIMULATED"), f"status must be REAL or SIMULATED, got {data['status']!r}"
    assert data["units"] == "KJ/cm2"

def test_inspect_point():
    response = client.get("/inspect?lat=15.25&lon=88.42")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "OK"
    assert data["dataStatus"] == "REAL"
    assert "INCOIS" in data["source"]
    assert "tempC" in data
    assert "salnPSU" in data
    assert "currentSpeedMS" in data

def _available_model_timestamp():
    """A model timestamp that is actually inside the installed dataset.

    The endpoint deliberately refuses a timestamp outside the dataset's
    temporal coverage rather than silently substituting the nearest slice, so
    the contract is exercised with a timestamp derived from the real (or
    fixture) coverage instead of a hardcoded run date.
    """
    from app.providers.incois_provider import IncoisProvider

    timestamps = IncoisProvider().get_available_timestamps()
    assert timestamps, "installed dataset exposes no model timestamps"
    return timestamps[0]


def test_2026_hycom_sst_inspect():
    response = client.get(f"/inspect?lat=18.2&lon=88.4&timestamp={_available_model_timestamp()}")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "OK"
    assert data["dataStatus"] == "REAL"
    assert data["tempC"] is not None
    assert isinstance(data["tempC"], float)

def test_2026_hycom_salinity_inspect():
    response = client.get(f"/inspect?lat=18.2&lon=88.4&timestamp={_available_model_timestamp()}")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "OK"
    assert data["dataStatus"] == "REAL"
    assert data["salnPSU"] is not None
    assert isinstance(data["salnPSU"], float)

def test_2026_hycom_currents_inspect():
    response = client.get(f"/inspect?lat=18.2&lon=88.4&timestamp={_available_model_timestamp()}")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "OK"
    assert data["dataStatus"] == "REAL"
    assert data["uvelMS"] is not None
    assert data["vvelMS"] is not None
    assert data["currentSpeedMS"] is not None

def test_2020_hycom_timestamp_unavailable():
    response = client.get("/inspect?lat=18.2&lon=88.4&timestamp=2020-05-15T21:00:00")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "NO_REAL_MODEL_DATA"
    assert data["dataStatus"] == "REAL DATASET — TIMESTAMP UNAVAILABLE"
    assert "No real INCOIS HYCOM model data" in data["message"]
    assert "availableStart" in data
    assert "availableEnd" in data
    assert "tempC" not in data

def test_2020_amphan_cyclone_inspect():
    response = client.get("/cyclones/inspect?lat=18.2&lon=88.4&timestamp=2020-05-15T21:00:00")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "OK"
    assert data["dataStatus"] == "REAL"
    assert data["observationType"] == "HISTORICAL OBSERVATION"
    assert "AMPHAN" in data["cycloneName"].upper()
    assert data["source"] == "NOAA IBTrACS v04r01"
    assert data["maxWindKts"] > 0
    assert data["centralPressureMb"] > 0
