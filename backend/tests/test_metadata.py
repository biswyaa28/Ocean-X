"""Metadata endpoint tests."""
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


def test_get_metadata():
    response = client.get("/api/metadata")
    assert response.status_code == 200
    data = response.json()
    assert data["dataset_id"] == "GLOBAL_MULTIYEAR_PHY_001_030"
    assert data["model"] == "GLORYS12V1"
    assert "temperature" in data["variables"]
    assert "salinity" in data["variables"]
    assert len(data["depth_levels"]) == 13
    assert data["depth_levels"][0] == 0.0
    assert data["depth_levels"][-1] == 1000.0
    assert data["data_tier"] == "local_deterministic_fixture"
    assert "Indian Ocean" in data["region"]
