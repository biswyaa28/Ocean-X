import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.providers.argo_provider import argo_provider
from app.services.model_observation_matchup import match_argo_with_hycom, haversine_km

client = TestClient(app)


def test_argo_dataset_loading():
    profiles = argo_provider.get_profiles()
    assert isinstance(profiles, list)
    assert len(profiles) >= 1
    
    first = profiles[0]
    assert "profile_id" in first
    assert "float_id" in first
    assert "REAL" in first["data_status"]
    assert "observations" in first
    assert len(first["observations"]) >= 1


def test_argo_floats():
    floats = argo_provider.get_floats()
    assert len(floats) >= 1
    f = floats[0]
    assert "float_id" in f
    assert "REAL" in f["data_status"]


def test_haversine_distance():
    # Distance between (15.25, 88.42) and (15.25, 88.42) should be 0
    assert haversine_km(15.25, 88.42, 15.25, 88.42) == 0.0
    # Distance between (15.25, 88.42) and (16.25, 88.42) ~ 111 km
    dist = haversine_km(15.25, 88.42, 16.25, 88.42)
    assert 100.0 <= dist <= 120.0


def test_model_observation_matchup_calculation():
    profiles = argo_provider.get_profiles()
    p_id = profiles[0]["profile_id"]
    
    matchup = match_argo_with_hycom(p_id)
    assert matchup is not None
    assert matchup["argoProfileId"] == p_id
    assert "REAL" in matchup["dataStatus"]
    assert matchup["modelDataset"] == "INCOIS HYCOM"
    assert "comparisons" in matchup
    assert len(matchup["comparisons"]) >= 1

    comp = matchup["comparisons"][0]
    assert "depthM" in comp
    assert "argoTemperatureC" in comp
    assert "modelTemperatureC" in comp
    assert "temperatureResidualC" in comp

    # Residual convention test: ΔT = HYCOM - Argo
    if comp["modelTemperatureC"] is not None and comp["argoTemperatureC"] is not None:
        expected_residual = round(comp["modelTemperatureC"] - comp["argoTemperatureC"], 2)
        assert comp["temperatureResidualC"] == expected_residual


def test_api_argo_endpoints():
    response_floats = client.get("/api/argo/floats")
    assert response_floats.status_code == 200
    assert len(response_floats.json()) >= 1

    response_profiles = client.get("/api/argo/profiles")
    assert response_profiles.status_code == 200
    profiles = response_profiles.json()
    assert len(profiles) >= 1

    p_id = profiles[0]["profile_id"]
    response_p = client.get(f"/api/argo/profiles/{p_id}")
    assert response_p.status_code == 200
    assert response_p.json()["profile_id"] == p_id

    response_matchup = client.get(f"/api/argo/{p_id}/matchup")
    assert response_matchup.status_code == 200
    m_data = response_matchup.json()
    assert "REAL" in m_data["dataStatus"]
    assert m_data["argoProfileId"] == p_id

