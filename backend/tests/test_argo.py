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


def matchup_with_mode(profile_id: str, mode: str, profile=None):
    """Match a (possibly patched) profile under a specific comparison mode."""
    original = argo_provider.get_profile
    argo_provider.get_profile = lambda pid: profile if profile is not None else original(pid)
    try:
        return match_argo_with_hycom(profile_id, match_mode=mode)
    finally:
        argo_provider.get_profile = original


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
    """Default behaviour: GSW depth + vertical interpolation + bilinear cells."""
    profiles = argo_provider.get_profiles()
    p_id = profiles[0]["profile_id"]

    matchup = match_argo_with_hycom(p_id)
    assert matchup is not None
    assert matchup["argoProfileId"] == p_id
    assert "REAL" in matchup["dataStatus"]
    assert matchup["modelDataset"] == "INCOIS HYCOM"
    # The reported status must follow the dataset actually installed: REAL for
    # real HYCOM output, SIMULATED only for the synthetic fixtures.
    from conftest import real_hycom_available

    assert matchup["modelDataStatus"] == ("REAL" if real_hycom_available() else "SIMULATED")
    assert "comparisons" in matchup
    assert len(matchup["comparisons"]) >= 1
    assert matchup["matchedPointCount"] == len(matchup["comparisons"])

    # Defaults are the interpolating modes.
    # Default comparison is at the model's OWN depth levels.
    assert matchup["matchMode"] == "model_levels"
    assert matchup["spatialMode"] == "bilinear"
    assert "model values at native HYCOM depth levels" in matchup["modelDepthSelection"]
    # Depth comes from the GSW pressure conversion, not from depth_m.
    assert matchup["depthSource"] == "pressure_gsw"
    assert matchup["qcFlagsUsed"] == {"raw": [1, 2], "adjusted": [1, 2, 5]}
    # The ingested GDAC profiles carry a real-time/adjusted data mode; the
    # reported basis must follow it (R -> raw, A/D -> adjusted when adjusted
    # arrays are present).
    assert matchup["argoDataMode"] in ("R", "A", "D", "auto")
    if matchup["argoDataMode"] == "R":
        assert matchup["variableBasis"] == "raw"
    # A model run is always selected and named.
    assert matchup["modelRun"]
    # Time gap against the archived model runs must be classifiable.
    assert matchup["timeGapStatus"] in ("good", "marginal", "too_large")
    # Every committed level carries explicit QC flags.
    assert matchup["missingQcLevelCount"] == 0
    assert matchup["diagnostics"]["missingQcLevelCount"] == 0
    # In model_levels a row IS a model level, so depthSource reports the row's
    # own origin ("model_level"); the FLOAT depth basis stays a profile-level
    # field and is asserted separately.
    assert all(row["depthSource"] == "model_level" for row in matchup["comparisons"])
    assert all(row["method"] in ("float_native", "float_interpolated")
               for row in matchup["comparisons"])

    # Coverage is bounded by the MODEL's valid depth range, not by the float's
    # full profile: real Argo profiles reach ~1700 dbar while the archived
    # HYCOM runs go to 500 m, so levels below the model are correctly unmatched
    # rather than extrapolated.
    diagnostics = matchup["diagnostics"]
    assert diagnostics["matchedObservationCount"] + diagnostics["unmatchedObservationCount"] == (
        diagnostics["totalArgoObservations"]
    )
    assert diagnostics["matchedPercentage"] == pytest.approx(
        round(
            diagnostics["matchedObservationCount"] / diagnostics["totalArgoObservations"] * 100.0, 2
        )
    )
    from app.providers.incois_provider import IncoisProvider

    native_depths = IncoisProvider().get_available_depths()
    assert native_depths
    # model_levels: at most one pair per MODEL level, so the pair count is
    # bounded by the model's depth axis and never by the float's level count.
    assert 0 < diagnostics["matchedObservationCount"] <= len(native_depths)
    matched_model_depths = [row["modelDepthM"] for row in matchup["comparisons"]]
    assert sorted(matched_model_depths) == matched_model_depths
    assert all(depth in native_depths for depth in matched_model_depths)
    # The float was interpolated onto the model levels, never the reverse.
    assert all(row["method"] in ("float_native", "float_interpolated") for row in matchup["comparisons"])
    assert (
        diagnostics["interpolatedLevelCount"] + diagnostics["nativeLevelCount"]
        == diagnostics["matchedObservationCount"]
    )

    comp = matchup["comparisons"][0]
    assert "depthM" in comp
    assert "argoTemperatureC" in comp
    assert "modelTemperatureC" in comp
    assert "temperatureResidualC" in comp

    # Residual convention test: ΔT = HYCOM - Argo
    if comp["modelTemperatureC"] is not None and comp["argoTemperatureC"] is not None:
        expected_residual = round(comp["modelTemperatureC"] - comp["argoTemperatureC"], 2)
        assert comp["temperatureResidualC"] == expected_residual


def test_native_match_mode_preserves_the_previous_nearest_level_behaviour():
    """Backward compatibility: matchMode="native" reproduces the old tolerance rule."""
    from app.providers.incois_provider import IncoisProvider

    native_depths = IncoisProvider().get_available_depths()
    assert native_depths, "installed dataset exposes no native model depths"

    p_id = argo_provider.get_profiles()[0]["profile_id"]

    matchup = match_argo_with_hycom(p_id, match_mode="native")
    assert matchup is not None
    assert matchup["matchMode"] == "native"
    assert matchup["modelDepthSelection"] == "nearest native HYCOM model depth (no interpolation)"
    assert matchup["matchingToleranceM"] == 15.0
    # Model values come only from native levels of the installed dataset.
    assert all(row["matchedModelDepthM"] in native_depths for row in matchup["comparisons"])
    assert all(row["method"] == "native" for row in matchup["comparisons"])
    # Every matched native level is within the documented tolerance of the
    # float depth it was selected for.
    for row in matchup["comparisons"]:
        assert abs(row["matchedModelDepthM"] - row["depthM"]) <= 15.0

    diagnostics = matchup["diagnostics"]
    assert diagnostics["interpolatedLevelCount"] == 0
    assert diagnostics["nativeLevelCount"] == diagnostics["matchedObservationCount"]
    assert diagnostics["interpolationApplied"] is False


def test_interpolated_mode_matches_strictly_more_levels_than_native():
    """Vertical interpolation is what recovers the levels native mode drops."""
    p_id = argo_provider.get_profiles()[0]["profile_id"]

    interpolated = match_argo_with_hycom(p_id, match_mode="interpolated")
    native = match_argo_with_hycom(p_id, match_mode="native")
    assert interpolated["matchedPointCount"] > native["matchedPointCount"]


def test_spatial_modes_are_both_selectable_and_report_the_nearest_cell():
    p_id = argo_provider.get_profiles()[0]["profile_id"]

    for spatial_mode in ("bilinear", "nearest"):
        matchup = match_argo_with_hycom(p_id, spatial_mode=spatial_mode)
        assert matchup["spatialMode"] == spatial_mode
        # distanceKm is always the distance to the nearest cell centre.
        assert matchup["distanceKm"] >= 0.0
        assert matchup["matchedModelLat"] is not None
        assert matchup["matchedModelLon"] is not None


def test_unknown_modes_fall_back_to_the_documented_defaults():
    p_id = argo_provider.get_profiles()[0]["profile_id"]

    matchup = match_argo_with_hycom(p_id, match_mode="nonsense", spatial_mode="nonsense")
    assert matchup["matchMode"] == "model_levels"
    assert matchup["spatialMode"] == "bilinear"


def test_interpolated_is_accepted_as_an_alias_for_float_levels():
    """Clients written against the earlier naming keep working."""
    p_id = argo_provider.get_profiles()[0]["profile_id"]
    matchup = match_argo_with_hycom(p_id, match_mode="interpolated")
    assert matchup["matchMode"] == "float_levels"
    assert "model interpolation error" in matchup["modelDepthSelection"]


def test_float_level_deeper_than_the_model_is_never_extrapolated():
    """A float level below the model's deepest level stays unmatched."""
    original = argo_provider.get_profile
    profile = original(argo_provider.get_profiles()[0]["profile_id"])
    template = profile["observations"][-1]
    profile["observations"] = profile["observations"] + [
        {**template, "depth_m": 800.0, "pressure_dbar": 808.0},
        {**template, "depth_m": 1500.0, "pressure_dbar": 1515.0},
    ]
    argo_provider.get_profile = lambda profile_id: profile
    try:
        matchup = match_argo_with_hycom(profile["profile_id"])
    finally:
        argo_provider.get_profile = original

    assert matchup is not None
    matched_depths = [row["depthM"] for row in matchup["comparisons"]]
    # Neither injected deep level is ever matched, and nothing past the
    # model's deepest native level is invented.
    assert not any(600.0 <= depth <= 1600.0 for depth in matched_depths)
    assert not any(depth >= 1400.0 for depth in matched_depths)
    assert max(matched_depths) < 600.0


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
        # float_levels: every float level is a comparison row, which is what
        # this test inspects. (model_levels targets the MODEL's 6 depths.)
        matchup = match_argo_with_hycom(profile["profile_id"], match_mode="float_levels")
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
    """Diagnostics are reductions over the matchup response."""
    p_id = argo_provider.get_profiles()[0]["profile_id"]
    data = client.get(f"/api/argo/{p_id}/matchup").json()

    diagnostics = data["diagnostics"]
    total_observations = len(argo_provider.get_profile(p_id)["observations"])
    assert diagnostics["totalArgoObservations"] == total_observations
    # One comparison row per matched Argo observation.
    assert diagnostics["matchedObservationCount"] == len(data["comparisons"])
    assert diagnostics["matchedObservationCount"] == data["matchedPointCount"]
    assert diagnostics["unmatchedObservationCount"] == (
        diagnostics["totalArgoObservations"] - diagnostics["matchedObservationCount"]
    )
    assert diagnostics["matchedPercentage"] == pytest.approx(
        round(diagnostics["matchedObservationCount"] / diagnostics["totalArgoObservations"] * 100.0, 2)
    )

    # Matching methodology is reported explicitly, never redefined here.
    assert data["matchingToleranceM"] == 15.0
    assert data["matchMode"] == "model_levels"
    assert data["spatialMode"] == "bilinear"
    assert data["modelDepthSelection"] == (
        "model values at native HYCOM depth levels; float interpolated onto them"
    )
    assert data["depthSource"] == "pressure_gsw"
    assert data["qcFlagsUsed"] == {"raw": [1, 2], "adjusted": [1, 2, 5]}
    # Real-time profiles read raw; adjusted (A) profiles read adjusted. The
    # response always states which family was used.
    assert data["variableBasis"] in ("raw", "adjusted")
    assert data["missingQcLevelCount"] == 0
    assert diagnostics["missingQcLevelCount"] == 0
    # Derived, never hardcoded: True only when at least one pair interpolated.
    assert diagnostics["interpolationApplied"] is (
        diagnostics["interpolatedLevelCount"] > 0
    )
    assert (
        diagnostics["interpolatedLevelCount"] + diagnostics["nativeLevelCount"]
        == diagnostics["matchedObservationCount"]
    )

    # Existing separations are exposed unchanged.
    assert data["distanceKm"] >= 0.0
    assert data["timeDifferenceHours"] >= 0.0
    assert data["matchedModelLat"] and data["matchedModelLon"]

    # Variable-specific valid pairs come from the statistics and can never
    # exceed the number of matched observations.
    for variable in ("temperature", "salinity"):
        valid_pairs = data["statistics"][variable]["n"]
        assert 0 <= valid_pairs <= diagnostics["matchedObservationCount"]

    # Depth coverage is reported from the matched rows, never invented.
    model_depths = [c["matchedModelDepthM"] for c in data["comparisons"]]
    assert diagnostics["deepestMatchedModelDepthM"] == max(model_depths)
    assert diagnostics["deepestMatchedObservationDepthM"] == max(
        c["depthM"] for c in data["comparisons"]
    )

    # No quality score / grade / verdict is produced.
    assert not any(
        token in key.lower()
        for key in diagnostics
        for token in ("score", "grade", "quality", "skill", "rank", "confidence", "pass", "fail")
    )


def test_matchup_endpoint_accepts_match_and_spatial_mode_query_parameters():
    p_id = argo_provider.get_profiles()[0]["profile_id"]

    native = client.get(f"/api/argo/{p_id}/matchup", params={"matchMode": "native"}).json()
    assert native["matchMode"] == "native"
    assert native["diagnostics"]["interpolatedLevelCount"] == 0

    nearest = client.get(
        f"/api/argo/{p_id}/matchup",
        params={"matchMode": "float_levels", "spatialMode": "nearest"},
    ).json()
    assert nearest["spatialMode"] == "nearest"
    assert nearest["matchMode"] == "float_levels"

    # The legacy "interpolated" spelling still resolves to float_levels.
    legacy = client.get(
        f"/api/argo/{p_id}/matchup", params={"matchMode": "interpolated"}
    ).json()
    assert legacy["matchMode"] == "float_levels"


def _require_statistics(matchup):
    """Skip when the time-gap guard correctly withheld residual statistics.

    The statistics path only exists for an observation-model pair that is close
    enough in time. With the synthetic September fixture alongside real October
    profiles the guard reports "too_large" and suppresses the statistics by
    design - there is then nothing for a statistics assertion to check.
    """
    if matchup.get("statisticsSuppressed"):
        pytest.skip(
            "Residual statistics are suppressed: the time-gap guard classified this "
            f"observation-model pair as {matchup.get('timeGapStatus')!r}."
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
        # float_levels: one row per float level, so the NaN level is still a row.
        matchup = match_argo_with_hycom(profile["profile_id"], match_mode="float_levels")
    finally:
        argo_provider.get_profile = original

    assert matchup is not None
    _require_statistics(matchup)
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


def test_missing_qc_flags_reach_the_diagnostics_and_the_api_response():
    """Absent QC flags stay lenient but are counted and disclosed end to end."""
    original = argo_provider.get_profile
    profile = original(argo_provider.get_profiles()[0]["profile_id"])
    # Strip every QC flag: the values stay usable, but the assumption is counted.
    profile["observations"] = [
        {k: v for k, v in obs.items() if k not in ("temp_qc", "psal_qc")}
        for obs in profile["observations"]
    ]
    argo_provider.get_profile = lambda profile_id: profile
    try:
        matchup = match_argo_with_hycom(profile["profile_id"])
    finally:
        argo_provider.get_profile = original

    assert matchup is not None
    _require_statistics(matchup)
    total = len(profile["observations"])
    assert matchup["missingQcLevelCount"] == total
    assert matchup["diagnostics"]["missingQcLevelCount"] == total
    # Lenient: the profile is still matched, not discarded.
    assert matchup["matchedPointCount"] > 0
    assert matchup["statistics"]["temperature"]["n"] == matchup["matchedPointCount"]


def test_realtime_data_mode_R_uses_raw_values_even_when_adjusted_exist():
    original = argo_provider.get_profile
    profile = original(argo_provider.get_profiles()[0]["profile_id"])
    profile["data_mode"] = "R"
    first = profile["observations"][0]
    profile["observations"] = [
        {
            **first,
            "temperature_c": 27.5,
            "TEMP_ADJUSTED": 27.9,
            "TEMP_ADJUSTED_QC": 1,
            "PRES_ADJUSTED": first["pressure_dbar"] + 0.2,
        }
    ]
    argo_provider.get_profile = lambda profile_id: profile
    try:
        matchup = match_argo_with_hycom(profile["profile_id"])
    finally:
        argo_provider.get_profile = original

    assert matchup is not None
    assert matchup["argoDataMode"] == "R"
    assert matchup["variableBasis"] == "raw"
    # Real-time mode must read the RAW value even though adjusted values exist.
    rows = matchup_with_mode(profile_id="argo-2902746-p042", mode="float_levels",
                             profile=profile)["comparisons"]
    assert rows and rows[0]["argoTemperatureC"] == 27.5
    assert rows[0]["argoVariableSource"] == "raw"


def test_delayed_data_mode_D_uses_adjusted_values():
    original = argo_provider.get_profile
    profile = original(argo_provider.get_profiles()[0]["profile_id"])
    profile["data_mode"] = "D"
    first = profile["observations"][0]
    profile["observations"] = [
        {**first, "TEMP_ADJUSTED": 27.9, "TEMP_ADJUSTED_QC": 5, "PSAL_ADJUSTED": 32.8, "PSAL_ADJUSTED_QC": 1}
    ]
    argo_provider.get_profile = lambda profile_id: profile
    try:
        matchup = match_argo_with_hycom(profile["profile_id"])
    finally:
        argo_provider.get_profile = original

    assert matchup is not None
    assert matchup["argoDataMode"] == "D"
    assert matchup["variableBasis"] == "adjusted"
    rows = matchup_with_mode(profile_id="argo-2902746-p042", mode="float_levels",
                             profile=profile)["comparisons"]
    assert rows and rows[0]["argoTemperatureC"] == 27.9
    assert rows[0]["argoVariableSource"] == "adjusted"
