"""Argo provider and Argo-vs-HYCOM matchup tests.

The matchup logic runs against the real production HYCOM file when installed;
otherwise tests/conftest.py binds the HYCOM paths to committed SYNTHETIC
schema-compatible fixtures (announced in the test banner). The assertions
validate code paths and the residual convention - they do not assert
specific scientific values, which are only meaningful against real data
(see test_integration_hycom.py for the real-data counterpart).
"""
import pytest
import math
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
    assert first["provenance"]["data_status"] == "DEMO"
    assert first["provenance"]["asset_id"] == first["profile_id"]
    assert first["provenance"]["timestamp"] == first["observation_time"]


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
    assert matchup["modelDataStatus"] == "SIMULATED"
    assert "comparisons" in matchup
    assert len(matchup["comparisons"]) >= 1
    assert matchup["matchedPointCount"] == len(matchup["comparisons"])
    assert [c["matchedModelDepthM"] for c in matchup["comparisons"]] == [
        0.0, 10.0, 10.0, 50.0, 100.0, 250.0, 500.0
    ]
    assert matchup["matchingToleranceM"] == 15.0
    assert matchup["modelDepthSelection"] == "nearest native HYCOM model depth (no interpolation)"

    comp = matchup["comparisons"][0]
    assert "depthM" in comp
    assert "argoTemperatureC" in comp
    assert "modelTemperatureC" in comp
    assert "temperatureResidualC" in comp

    # Residual convention test: ΔT = HYCOM - Argo
    if comp["modelTemperatureC"] is not None and comp["argoTemperatureC"] is not None:
        expected_residual = round(comp["modelTemperatureC"] - comp["argoTemperatureC"], 2)
        assert comp["temperatureResidualC"] == expected_residual


def test_invalid_argo_timestamp_returns_unavailable_matchup():
    original = argo_provider.get_profile
    argo_provider.get_profile = lambda profile_id: {
        **original(profile_id),
        "observation_time": "not-a-timestamp",
    }
    try:
        matchup = match_argo_with_hycom(argo_provider.get_profiles()[0]["profile_id"])
    finally:
        argo_provider.get_profile = original

    assert matchup is not None
    assert matchup["statusMessage"] == "INVALID ARGO OBSERVATION TIMESTAMP — MODEL MATCH UNAVAILABLE"
    assert matchup["matchedPointCount"] == 0


def test_non_finite_argo_values_are_missing_but_zero_remains_valid():
    original = argo_provider.get_profile
    profile = original(argo_provider.get_profiles()[0]["profile_id"])
    profile["observations"] = [
        {**profile["observations"][0], "temperature_c": math.nan, "salinity_psu": math.inf},
        {**profile["observations"][1], "temperature_c": 0.0, "salinity_psu": 0.0},
    ]
    argo_provider.get_profile = lambda profile_id: profile
    try:
        matchup = match_argo_with_hycom(profile["profile_id"])
    finally:
        argo_provider.get_profile = original

    assert matchup is not None
    assert matchup["comparisons"][0]["argoTemperatureC"] is None
    assert matchup["comparisons"][0]["argoSalinityPSU"] is None
    assert matchup["comparisons"][1]["argoTemperatureC"] == 0.0
    assert matchup["comparisons"][1]["argoSalinityPSU"] == 0.0
    assert matchup["comparisons"][1]["temperatureResidualC"] is not None
    assert matchup["comparisons"][1]["salinityResidualPSU"] is not None


def test_api_argo_endpoints():
    response_floats = client.get("/api/argo/floats")
    assert response_floats.status_code == 200
    assert len(response_floats.json()) >= 1

    response_profiles = client.get("/api/argo/profiles")
    assert response_profiles.status_code == 200
    profiles = response_profiles.json()
    assert len(profiles) >= 1
    assert profiles[0]["provenance"]["provider"]
    assert profiles[0]["provenance"]["variable"] == "temperature_c, salinity_psu"

    p_id = profiles[0]["profile_id"]
    response_p = client.get(f"/api/argo/profiles/{p_id}")
    assert response_p.status_code == 200
    assert response_p.json()["profile_id"] == p_id

    response_matchup = client.get(f"/api/argo/{p_id}/matchup")
    assert response_matchup.status_code == 200
    m_data = response_matchup.json()
    assert "REAL" in m_data["dataStatus"]
    assert m_data["argoProfileId"] == p_id
    assert m_data["statistics"]["temperature"]["n"] >= 0
    assert m_data["statistics"]["salinity"]["n"] >= 0


def test_api_matchup_diagnostics_reuse_existing_matchup_semantics():
    """Phase 2C: diagnostics are reductions over the accepted matchup response."""
    p_id = argo_provider.get_profiles()[0]["profile_id"]
    data = client.get(f"/api/argo/{p_id}/matchup").json()

    diagnostics = data["diagnostics"]
    total_observations = len(argo_provider.get_profile(p_id)["observations"])
    assert diagnostics["totalArgoObservations"] == total_observations
    # One comparison row per depth-matched Argo observation.
    assert diagnostics["matchedObservationCount"] == len(data["comparisons"])
    assert diagnostics["matchedObservationCount"] == data["matchedPointCount"]
    assert diagnostics["unmatchedObservationCount"] == (
        diagnostics["totalArgoObservations"] - diagnostics["matchedObservationCount"]
    )
    assert diagnostics["matchedPercentage"] == pytest.approx(
        round(diagnostics["matchedObservationCount"] / diagnostics["totalArgoObservations"] * 100.0, 2)
    )

    # Existing matching methodology is reused, never redefined here.
    assert data["matchingToleranceM"] == 15.0
    assert data["modelDepthSelection"] == "nearest native HYCOM model depth (no interpolation)"
    assert diagnostics["interpolationApplied"] is False

    # Existing separations are exposed unchanged.
    assert data["distanceKm"] >= 0.0
    assert data["timeDifferenceHours"] >= 0.0
    assert data["matchedModelLat"] and data["matchedModelLon"]

    # Variable-specific valid pairs come from Phase 2B statistics and can never
    # exceed the number of depth-matched observations.
    for variable in ("temperature", "salinity"):
        valid_pairs = data["statistics"][variable]["n"]
        assert 0 <= valid_pairs <= diagnostics["matchedObservationCount"]

    # Repeated native-depth matches are counted, never deduplicated.
    native_depths = [c["matchedModelDepthM"] for c in data["comparisons"]]
    assert len(native_depths) > len(set(native_depths))
    assert diagnostics["repeatedNativeDepthMatchCount"] == len(native_depths) - len(set(native_depths))
    assert diagnostics["deepestMatchedModelDepthM"] == max(native_depths)
    assert diagnostics["deepestMatchedObservationDepthM"] == max(
        c["depthM"] for c in data["comparisons"]
    )

    # No quality score / grade / verdict is produced.
    assert not any(
        token in key.lower()
        for key in diagnostics
        for token in ("score", "grade", "quality", "skill", "rank", "confidence", "pass", "fail")
    )


def test_matched_observations_and_valid_statistical_pairs_are_distinct():
    """A depth-matched observation with non-finite values is still matched."""
    original = argo_provider.get_profile
    profile = original(argo_provider.get_profiles()[0]["profile_id"])
    profile["observations"] = [
        {**profile["observations"][0], "temperature_c": math.nan},
        {**profile["observations"][1]},
    ]
    argo_provider.get_profile = lambda profile_id: profile
    try:
        matchup = match_argo_with_hycom(profile["profile_id"])
    finally:
        argo_provider.get_profile = original

    assert matchup is not None
    diagnostics = matchup["diagnostics"]
    assert diagnostics["totalArgoObservations"] == 2
    # Both observations matched by depth (the NaN one included)...
    assert diagnostics["matchedObservationCount"] == 2
    assert diagnostics["unmatchedObservationCount"] == 0
    # ...but only one is a valid temperature statistical pair.
    assert matchup["statistics"]["temperature"]["n"] == 1


def test_unavailable_matchup_diagnostics_are_reported_without_fabrication():
    """Phase 2C: no model match -> zero matched, no invented percentage/depths."""
    original = argo_provider.get_profile
    argo_provider.get_profile = lambda profile_id: {
        **original(profile_id),
        "observation_time": "not-a-timestamp",
    }
    try:
        matchup = match_argo_with_hycom(argo_provider.get_profiles()[0]["profile_id"])
    finally:
        argo_provider.get_profile = original

    assert matchup is not None
    diagnostics = matchup["diagnostics"]
    assert diagnostics["matchedObservationCount"] == 0
    assert diagnostics["unmatchedObservationCount"] == diagnostics["totalArgoObservations"]
    assert diagnostics["matchedPercentage"] == 0.0
    assert diagnostics["deepestMatchedObservationDepthM"] is None
    assert diagnostics["deepestMatchedModelDepthM"] is None
    assert diagnostics["repeatedNativeDepthMatchCount"] == 0


def test_api_argo_observations_endpoint():
    """Phase 1D: the observation list backing the depth-profile charts."""
    profiles = argo_provider.get_profiles()
    p_id = profiles[0]["profile_id"]

    response = client.get(f"/api/argo/{p_id}/observations")
    assert response.status_code == 200
    obs = response.json()
    assert isinstance(obs, list)
    assert len(obs) >= 1

    first = obs[0]
    # Wire contract used by the frontend normalization (depth is source-provided).
    assert "depth_m" in first
    assert "pressure_dbar" in first
    assert isinstance(first["depth_m"], (int, float))

    # Unknown profile → 404, never an empty fabrication.
    missing = client.get("/api/argo/nonexistent-profile/observations")
    assert missing.status_code == 404
