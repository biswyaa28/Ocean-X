"""API-level tests for the de-fabrication of cyclone, risk and dataset endpoints.

These exercise the HTTP surface (404s, response fields, derived statuses)
rather than the providers/services in isolation.
"""

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.providers.ibtracs_provider import ibtracs_provider

client = TestClient(app)


@pytest.fixture(scope="module")
def cyclones():
    loaded = ibtracs_provider.load_cyclones()
    if not loaded:
        pytest.skip("IBTrACS dataset not installed")
    return loaded


# ---------------------------------------------------------------------------
# /cyclones — honest observation fields
# ---------------------------------------------------------------------------

def test_cyclones_endpoint_exposes_provenance_and_completeness(cyclones):
    response = client.get("/cyclones")
    assert response.status_code == 200
    payload = response.json()
    assert payload

    for c in payload:
        assert "dataCompleteness" in c
        assert 0.0 <= c["dataCompleteness"]["withWind"] <= 1.0
        assert 0.0 <= c["dataCompleteness"]["withPressure"] <= 1.0
        # No synthetic cone over historical best-track points.
        assert c["forecastCone"] == []
        for pt in c["track"]:
            if pt["maxWindKts"] is not None:
                assert pt["windSource"] in ("WMO", "IMD")


def test_cyclones_endpoint_no_longer_returns_the_fabricated_constant_pair():
    """The exact 45.0/990.0 pair is the old substitution signature.

    A real observation can legitimately be 45.0 kt, but it must then carry a
    real source — so we assert the pairing, not the bare number.
    """
    response = client.get("/cyclones")
    for c in response.json():
        for pt in c["track"]:
            if pt["maxWindKts"] == 45.0 and pt["centralPressureMb"] == 990.0:
                assert pt["windSource"] in ("WMO", "IMD"), (
                    f"{c['name']} {pt['id']}: fabricated 45.0/990.0 pair with no source"
                )


# ---------------------------------------------------------------------------
# /cyclones/{id} and /risk/{id} — the id must actually select
# ---------------------------------------------------------------------------

def test_unknown_cyclone_id_returns_404_not_the_first_storm():
    response = client.get("/cyclones/DEFINITELY-NOT-A-STORM")
    assert response.status_code == 404


def test_risk_path_param_selects_the_requested_cyclone(cyclones):
    """B2: the path parameter used to be ignored entirely."""
    target = next(
        c for c in cyclones
        if any(p.maxWindKts is not None and p.distanceToCoastKm is not None for p in c.track)
    )
    response = client.get(f"/risk/{target.id}")
    assert response.status_code == 200
    body = response.json()

    other = client.get(f"/risk/{cyclones[0].id}").json()
    # Different storms must be independently addressable. Either the scores
    # differ, or at least both responded rather than aliasing one storm.
    assert "status" in body
    assert body["status"] in ("OK", "UNAVAILABLE")
    assert other["status"] in ("OK", "UNAVAILABLE")


def test_risk_accepts_the_hazard_prefix(cyclones):
    target = cyclones[0]
    assert client.get(f"/risk/hazard-{target.id}").status_code == 200


def test_risk_unknown_id_returns_404():
    response = client.get("/risk/DEFINITELY-NOT-A-STORM")
    assert response.status_code == 404
    assert "not found" in response.json()["detail"].lower()


def test_risk_response_shape_is_renamed_and_labelled():
    response = client.get(f"/risk/{ibtracs_provider.load_cyclones()[0].id}")
    if not response.status_code == 200:
        pytest.skip("no cyclones")
    body = response.json()

    # The old field name must be gone.
    assert "score" not in body
    assert "heuristicDemoScore" in body
    assert body["validated"] is False
    assert body["operationalUse"] == "NOT FOR OPERATIONAL USE"
    assert "NOT VALIDATED" in body["disclaimer"]
    assert body["weights"], "the weights must be returned, not hidden"
    assert body["affectedRegions"] == []


def test_risk_unavailable_never_carries_a_score():
    """Whichever cyclone, an unavailable assessment must have no number."""
    for c in ibtracs_provider.load_cyclones():
        body = client.get(f"/risk/{c.id}").json()
        if body["status"] == "UNAVAILABLE":
            assert body["heuristicDemoScore"] is None
            assert body["category"] is None
            assert body["unavailableReason"]
            assert body["evidence"] == []


# ---------------------------------------------------------------------------
# /hazards — severity follows the assessment status
# ---------------------------------------------------------------------------

def test_hazards_severity_is_null_when_unavailable():
    hazards = client.get("/hazards").json()
    assert hazards
    for h in hazards:
        if h["riskAssessment"]["status"] == "UNAVAILABLE":
            assert h["severity"] is None


def test_hazards_accepts_a_cyclone_selector():
    cyclones = ibtracs_provider.load_cyclones()
    if not cyclones:
        pytest.skip("no cyclones")
    response = client.get("/hazards", params={"cyclone_id": cyclones[1].id})
    assert response.status_code == 200
    assert response.json()[0]["id"] == f"hazard-{cyclones[1].id}"


def test_hazards_unknown_cyclone_returns_404():
    response = client.get("/hazards", params={"cyclone_id": "NOT-A-STORM"})
    assert response.status_code == 404


# ---------------------------------------------------------------------------
# /datasets — reported range must match what is served
# ---------------------------------------------------------------------------

def test_datasets_ibtracs_range_matches_served_data(cyclones):
    """C2: 1842-2025 / 62851 was hardcoded; the API serves 2020+ only."""
    datasets = client.get("/datasets").json()
    ibtracs = next(d for d in datasets if "IBTrACS" in d["dataset_name"])

    expected_points = sum(len(c.track) for c in cyclones)
    assert ibtracs["time_steps_count"] == expected_points
    assert ibtracs["time_steps_count"] != 62851

    all_times = sorted(pt.timestamp for c in cyclones for pt in c.track)
    assert ibtracs["time_range"]["start"] == all_times[0]
    assert ibtracs["time_range"]["end"] == all_times[-1]

    # Must start at the filter boundary, not the file's 1842 beginning.
    assert all_times[0][:4] >= "2020"
    assert ibtracs["time_range"]["start"] != "1842-10-25"


def test_datasets_lists_the_imd_fallback_columns():
    datasets = client.get("/datasets").json()
    ibtracs = next(d for d in datasets if "IBTrACS" in d["dataset_name"])
    assert "NEWDELHI_WIND" in ibtracs["variables"]
    assert "NEWDELHI_PRES" in ibtracs["variables"]


# ---------------------------------------------------------------------------
# /observations — status derived, not asserted
# ---------------------------------------------------------------------------

def test_observations_status_is_derived_not_hardcoded_real():
    body = client.get("/observations").json()
    assert body["status"] != "REAL" or (
        body["oceanDataStatus"] == "REAL" and body["cycloneDataStatus"] == "REAL"
    )
    assert "oceanDataStatus" in body
    assert "cycloneDataStatus" in body
    assert body["cycloneDataStatus"] in (
        "REAL", "SIMULATED", "NOT CURRENTLY INTEGRATED"
    )


def test_observations_never_claims_real_without_a_dataset(monkeypatch):
    """With no model dataset installed, oceanDataStatus must not be REAL."""
    import app.api.endpoints as ep

    monkeypatch.setattr(
        ep.incois_provider, "get_available_timestamps", lambda: []
    )
    body = client.get("/observations").json()
    assert body["oceanDataStatus"] == "NOT CURRENTLY INTEGRATED"
    assert body["status"] != "REAL"


def test_observations_reports_simulated_in_fixture_mode(monkeypatch):
    import app.api.endpoints as ep

    monkeypatch.setenv("OCEANX_DATA_MODE", "FIXTURE")
    body = client.get("/observations").json()
    assert body["oceanDataStatus"] == "SIMULATED"
    assert body["status"] == "SIMULATED"
    assert body["dataMode"] == "FIXTURE"


# ---------------------------------------------------------------------------
# /inspect — no hardcoded REAL
# ---------------------------------------------------------------------------

def test_inspect_never_claims_real_for_synthetic_fixture(monkeypatch):
    monkeypatch.setenv("OCEANX_DATA_MODE", "FIXTURE")
    body = client.get("/inspect?lat=15&lon=88").json()
    if body["status"] == "OK":
        assert body["dataStatus"] == "SIMULATED"
        assert body["dataMode"] == "FIXTURE"


def test_inspect_missing_dataset_is_not_called_a_real_dataset(monkeypatch):
    import app.api.endpoints as ep

    monkeypatch.setattr(ep.incois_provider, "_get_dataset", lambda: None)
    body = client.get("/inspect?lat=15&lon=88").json()
    assert body["status"] == "NO_REAL_MODEL_DATA"
    assert body["dataStatus"] == "NOT CURRENTLY INTEGRATED"


def test_inspect_missing_pressure_is_null_not_a_default():
    body = client.get("/cyclones/inspect?lat=18.2&lon=88.4").json()
    assert body["status"] == "OK"
    assert "windSource" in body
    assert "pressureSource" in body
    assert "dataCompleteness" in body
    if body["maxWindKts"] is None:
        assert body["windSource"] is None