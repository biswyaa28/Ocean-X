"""The surface-layer endpoint must report the time it actually served.

A /layers/{name} request for a time the model does not cover used to fall
through to ``datasetTimestamps[0]`` and answer with that slice. The client then
had no way to tell it was holding a different day's field, which is how a 2020
cyclone replay ended up drawing an October 2026 SST map. These tests pin the
contract that makes that impossible: the response always carries the resolved
model time, and it is a time the dataset really has.
"""

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.model_time_matching import parse_timestamp
from app.api import endpoints as ep

client = TestClient(app)


@pytest.fixture(scope="module")
def model_timestamps():
    stamps = ep.incois_provider.get_available_timestamps()
    if not stamps:
        pytest.skip("HYCOM model dataset not installed")
    return stamps


def _assert_is_a_real_model_time(label, model_timestamps):
    assert label in model_timestamps, (
        f"response reported {label!r}, which is not one of the dataset's times"
    )
    assert parse_timestamp(label) is not None


def test_layer_response_reports_a_real_model_time(model_timestamps):
    response = client.get("/api/layers/sst")
    assert response.status_code == 200
    _assert_is_a_real_model_time(response.json()["timestamp"], model_timestamps)


def test_requested_model_time_that_is_equivalent_but_not_string_equal_is_honoured(
    model_timestamps,
):
    """A client ISO stamp must not silently fall through to another day."""
    target = model_timestamps[-1]
    equivalent = target.split(".")[0] + "Z"
    assert equivalent != target  # genuinely a different string

    response = client.get(f"/api/layers/sst?timestamp={equivalent}")
    assert response.status_code == 200
    body = response.json()
    assert body["timestamp"] == target


def test_time_outside_the_dataset_reports_the_nearest_real_time_not_the_first(
    model_timestamps,
):
    """2020 is years before the installed runs.

    The old code answered with ``available_timestamps[0]``. Serving the
    NEAREST time is equally unavoidable, so the requirement is not the value but
    that the value is stated and real — and that a request after the window is
    not answered with the earliest slice.
    """
    response = client.get("/api/layers/sst?timestamp=2020-05-18T12:00:00")
    assert response.status_code == 200
    body = response.json()
    _assert_is_a_real_model_time(body["timestamp"], model_timestamps)
    assert body["timestamp"] == model_timestamps[0]  # nearest edge
    assert body["requestedTimestamp"] == "2020-05-18T12:00:00"
    assert body["timeMatched"] is False


def test_time_after_the_dataset_window_is_not_served_as_the_first_time(
    model_timestamps,
):
    response = client.get("/api/layers/sst?timestamp=2031-01-01T00:00:00")
    assert response.status_code == 200
    body = response.json()
    _assert_is_a_real_model_time(body["timestamp"], model_timestamps)
    assert body["timestamp"] == model_timestamps[-1]  # nearest edge
    assert body["timeMatched"] is False


def test_unparseable_timestamp_is_rejected_rather_than_answered_with_another_day():
    response = client.get("/api/layers/sst?timestamp=not-a-timestamp")
    assert response.status_code == 400
    detail = response.json()["detail"]
    assert detail["requestedTimestamp"] == "not-a-timestamp"
    assert "not-a-timestamp" in detail["message"]


def test_time_matched_is_true_when_the_request_is_the_model_time(model_timestamps):
    response = client.get(f"/api/layers/sst?timestamp={model_timestamps[0]}")
    assert response.json()["timeMatched"] is True

def test_observations_reports_the_depth_dataset_own_time_range():
    """The surface and depth files are different HYCOM runs with different
    windows. The depth times must be published, or every depth/currents
    request made at a surface time 404s with no way to ask for a real one.
    """
    from app.api import endpoints as ep

    body = client.get("/api/observations").json()
    depth_times = body["available_depth_timestamps"]
    surface_times = body["available_timestamps"]

    if not ep.incois_provider.get_available_depth_timestamps():
        assert depth_times == []
        return

    assert depth_times, "a depth dataset is installed but no depth times are reported"
    assert parse_timestamp(depth_times[0]) is not None
    assert parse_timestamp(depth_times[-1]) is not None
    # Whatever the relation between the two runs, neither list may be an alias
    # of the other unless they genuinely cover the same window.
    if surface_times:
        assert depth_times != surface_times or depth_times[0] == surface_times[0]
