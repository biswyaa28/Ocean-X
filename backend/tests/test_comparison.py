"""Comparison endpoints tests."""
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


def test_get_comparison_temperature_success():
    response = client.get("/api/comparison/2902641?variable=temperature")
    assert response.status_code == 200
    data = response.json()
    
    assert data["profile_id"] == "2902641"
    assert data["variable"] == "temperature"
    assert data["unit"] == "°C"
    assert data["residual_label"] == "Analysis–Observation Residual"
    
    # Match information
    match = data["match"]
    assert match["distance_km"] >= 0.0
    assert "time_utc" in match
    
    # Profile values and residuals
    assert len(data["obs_depths"]) == len(data["obs_values"])
    assert len(data["obs_values"]) == len(data["model_values"])
    assert len(data["model_values"]) == len(data["residuals"])
    
    # Verify scientific residual calculation: Analysis - Observation
    for obs_v, mod_v, res in zip(data["obs_values"], data["model_values"], data["residuals"]):
        assert abs((mod_v - obs_v) - res) < 1e-4
        
    # Metrics
    metrics = data["metrics"]
    assert metrics["n"] == len(data["residuals"])
    assert metrics["rmse"] >= 0.0
    assert metrics["mae"] >= 0.0
    
    # Provenance
    prov = data["provenance"]
    assert prov["dataset_id"] == "GLOBAL_MULTIYEAR_PHY_001_030"
    assert prov["model"] == "GLORYS12V1"
    assert prov["observation_id"] == "2902641"
    assert prov["temperature_units"] == "°C (ITS-90)"
    # STEP 3B §14 requires depth_reference to state the unit of the depth axis.
    # The STEP 3A descriptive text moved to depth_reference_note, which now also
    # names the actual TEOS-10 conversion performed (STEP 3A had no conversion).
    assert prov["depth_reference"] == "meters"
    assert "gsw.z_from_p" in prov["depth_reference_note"]


def test_get_comparison_with_excluded_bad_qc():
    response = client.get("/api/comparison/1901452?variable=temperature")
    assert response.status_code == 200
    data = response.json()
    
    assert data["profile_id"] == "1901452"
    # Should exclude the 1 level flagged QC=3 (at 75m)
    assert data["excluded_count"] == 1
    assert 75.0 not in data["obs_depths"]
    assert data["metrics"]["n"] == 12


def test_get_comparison_not_found():
    response = client.get("/api/comparison/nonexistent_id")
    assert response.status_code == 404
    assert "not found" in response.json()["detail"].lower()
