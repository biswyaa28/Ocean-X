"""The risk score is computed from model data, so it must say which model date.

``/risk`` reads basin-mean TCHP/SST from the HYCOM dataset. That dataset has
its own window, which is not the cyclone's window, so a score for a 2020 storm
can be computed entirely from 2026 fields. The score is still returned — it is
not withheld — but the response now names the model time it used and whether
that time is the storm's own, so the UI can label it instead of implying a
match that does not exist.
"""

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.providers.ibtracs_provider import ibtracs_provider
from app.services.model_time_matching import is_time_matched, parse_timestamp

client = TestClient(app)


@pytest.fixture(scope="module")
def amphan():
    loaded = ibtracs_provider.load_cyclones()
    if not loaded:
        pytest.skip("IBTrACS dataset not installed")
    storm = next((c for c in loaded if c.name == "AMPHAN"), loaded[0])
    return storm


@pytest.fixture(scope="module")
def model_timestamps():
    from app.api import endpoints as ep

    stamps = ep.incois_provider.get_available_timestamps()
    if not stamps:
        pytest.skip("HYCOM model dataset not installed")
    return stamps


def test_risk_reports_the_model_timestamp_it_used(amphan, model_timestamps):
    response = client.get(f"/risk/{amphan.id}?index={amphan.currentTrackIndex}")
    assert response.status_code == 200
    body = response.json()

    assert "modelTimestamp" in body
    assert "timeMatched" in body
    if body["status"] != "OK":
        pytest.skip("risk engine declined to score (no model data)")

    # The reported model time must be a time the dataset really has.
    assert body["modelTimestamp"] in model_timestamps
    assert parse_timestamp(body["modelTimestamp"]) is not None


def test_replay_storm_is_flagged_as_not_time_matched(amphan, model_timestamps):
    """A 2020-2025 replay track against 2026 model fields is never matched."""
    response = client.get(f"/risk/{amphan.id}?index={amphan.currentTrackIndex}")
    body = response.json()
    if body["status"] != "OK":
        pytest.skip("risk engine declined to score (no model data)")

    point_time = amphan.track[amphan.currentTrackIndex].timestamp
    assert parse_timestamp(body["modelTimestamp"]).year >= min(
        parse_timestamp(t).year for t in model_timestamps
    ) - 1
    assert body["timeMatched"] is is_time_matched(body["modelTimestamp"], point_time)
    assert body["timeMatched"] is False


def test_explanation_carries_the_ocean_state_time_mismatch(amphan):
    response = client.get(f"/risk/{amphan.id}?index={amphan.currentTrackIndex}")
    body = response.json()
    if body["status"] != "OK":
        pytest.skip("risk engine declined to score (no model data)")

    limitations = body["explanation"]["limitations"]
    assert "not the storm date" in limitations
    # The human-readable limitation must name the same model date the machine
    # readable field reports.
    assert body["modelTimestamp"][:7] in limitations  # YYYY-MM of the model time


def test_unavailable_response_never_claims_a_time_matched_score(amphan, monkeypatch):
    """When there is no score there is no model time either."""
    from app.api import endpoints as ep

    monkeypatch.setattr(
        ep.incois_provider, "get_layer_data", lambda *a, **k: None
    )
    response = client.get(f"/risk/{amphan.id}?index={amphan.currentTrackIndex}")
    body = response.json()
    assert body["status"] == "UNAVAILABLE"
    assert body["heuristicDemoScore"] is None
    assert body["modelTimestamp"] is None
    assert body["timeMatched"] is False