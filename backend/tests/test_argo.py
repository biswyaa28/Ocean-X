"""Argo endpoints tests."""
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


def test_list_argo_profiles():
    response = client.get("/api/argo")
    assert response.status_code == 200
    profiles = response.json()
    assert len(profiles) == 3
    assert profiles[0]["id"] == "2902641"
    assert "platform" in profiles[0]
    assert "cycle" in profiles[0]


def test_get_argo_profile_success():
    response = client.get("/api/argo/2902641")
    assert response.status_code == 200
    data = response.json()
    assert data["meta"]["id"] == "2902641"
    assert data["meta"]["mode"] == "D"
    assert data["meta"]["matched_time_index"] == 2
    assert len(data["levels"]) == 13
    assert data["levels"][0]["depth_m"] == 0.0
    assert data["levels"][0]["qc"] == 1


def test_get_argo_profile_with_bad_qc():
    response = client.get("/api/argo/1901452")
    assert response.status_code == 200
    data = response.json()
    assert data["meta"]["id"] == "1901452"
    assert data["meta"]["qc"] == "MIXED"
    # Find level at 75m which has QC=3
    level_75 = next(l for l in data["levels"] if l["depth_m"] == 75.0)
    assert level_75["qc"] == 3


def test_get_argo_profile_not_found():
    response = client.get("/api/argo/9999999")
    assert response.status_code == 404
    assert "not found" in response.json()["detail"].lower()
