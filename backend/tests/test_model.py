"""Model endpoints tests."""
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


def test_get_model_times():
    response = client.get("/api/model/times")
    assert response.status_code == 200
    times = response.json()
    assert len(times) == 7
    assert times[0]["index"] == 0
    assert "2023-07-01" in times[0]["iso_time"]
    assert "UTC" in times[0]["timestamp_utc"]


def test_get_model_depths():
    response = client.get("/api/model/depths")
    assert response.status_code == 200
    depths = response.json()
    assert len(depths) == 13
    assert depths[0]["index"] == 0
    assert depths[0]["depth_m"] == 0.0
    assert depths[10]["index"] == 10
    assert depths[10]["depth_m"] == 500.0


def test_get_model_slice_temperature():
    response = client.get("/api/model/slice?time=0&depth=0&variable=temperature")
    assert response.status_code == 200
    data = response.json()
    assert data["variable"] == "temperature"
    assert data["depth"] == 0.0
    assert data["depth_index"] == 0
    assert data["unit"] == "°C"
    assert len(data["values"]) == data["nlats"]
    assert len(data["values"][0]) == data["nlons"]
    assert data["min_value"] <= data["max_value"]


def test_get_model_slice_salinity():
    response = client.get("/api/model/slice?time=1&depth=5&variable=salinity")
    assert response.status_code == 200
    data = response.json()
    assert data["variable"] == "salinity"
    assert data["depth"] == 75.0
    assert data["unit"] == "PSU"
    assert len(data["values"]) == data["nlats"]
