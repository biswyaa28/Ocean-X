import pytest
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
    assert data["mode"] in ["REAL", "SIMULATED"]
    assert data["backendConnected"] is True

def test_datasets():
    response = client.get("/datasets")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) >= 2
    providers = [d["provider"] for d in data]
    assert "INCOIS" in providers
    assert "NOAA NCEI" in providers

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
    assert data["status"] == "REAL"
    assert "INCOIS HYCOM — REAL VECTOR FIELD" in data["source"]
    assert data["units"] == "m/s"
    assert data["grid"]["u"] is not None
    assert data["grid"]["v"] is not None

def test_layer_sst():
    response = client.get("/layers/sst")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "REAL"
    assert "INCOIS" in data["source"]
    assert data["units"] == "°C"
    assert data["grid"]["values"] is not None

def test_layer_salinity():
    response = client.get("/layers/salinity")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "REAL"
    assert data["units"] == "PSU"

def test_layer_tchp():
    response = client.get("/layers/tchp")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "REAL"
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

def test_2026_hycom_sst_inspect():
    response = client.get("/inspect?lat=18.2&lon=88.4&timestamp=2026-09-08T12:00:00")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "OK"
    assert data["dataStatus"] == "REAL"
    assert data["tempC"] is not None
    assert isinstance(data["tempC"], float)

def test_2026_hycom_salinity_inspect():
    response = client.get("/inspect?lat=18.2&lon=88.4&timestamp=2026-09-08T12:00:00")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "OK"
    assert data["dataStatus"] == "REAL"
    assert data["salnPSU"] is not None
    assert isinstance(data["salnPSU"], float)

def test_2026_hycom_currents_inspect():
    response = client.get("/inspect?lat=18.2&lon=88.4&timestamp=2026-09-08T12:00:00")
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

