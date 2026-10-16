"""Tests for the three follow-up fixes.

A  Masked cells must stay masked. ``np.nan_to_num(..., nan=0.0)`` turned land
   into a plausible 0 °C / 0 m/s / 0 KJ·cm⁻² reading, so land rendered as a real
   colour and any basin mean included phantom zeros.
B  The served default point is the PEAK OBSERVED wind, not an arbitrary early
   point that often had no observation at all.
C  The risk header reads the backend score rather than recomputing it locally.
"""

import pytest

from app.models.schemas import CycloneTrackPoint
from app.providers.ibtracs_provider import (
    IBTrACSProvider,
    select_default_track_index,
)
from app.services.risk_engine import _layer_mean


# ---------------------------------------------------------------------------
# A — masked cells
# ---------------------------------------------------------------------------

class _Grid:
    def __init__(self, values):
        self.values = values


class _Layer:
    def __init__(self, values):
        self.grid = _Grid(values)


def test_layer_mean_excludes_masked_cells_but_keeps_real_zeros():
    """A genuine 0 (slack water, TCHP=0 over cool water) is a measurement."""
    layer = _Layer([[None, 0.0], [10.0, None], [None, 20.0]])
    mean, valid, total = _layer_mean(layer)
    assert valid == 3
    assert total == 6
    # (0 + 10 + 20) / 3 — the zeros count, the nulls do not.
    assert mean == pytest.approx(10.0)


def test_layer_mean_returns_none_when_fully_masked():
    mean, valid, total = _layer_mean(_Layer([[None, None]]))
    assert mean is None
    assert valid == 0
    assert total == 2


def test_layer_mean_handles_missing_layer():
    mean, valid, total = _layer_mean(None)
    assert mean is None
    assert valid == 0 and total == 0


def test_layer_mean_ignores_nan():
    mean, valid, _ = _layer_mean(_Layer([[float("nan"), 4.0], [6.0, float("nan")]]))
    assert valid == 2
    assert mean == pytest.approx(5.0)


def test_real_layer_raster_masks_land_instead_of_zeroing_it():
    """End-to-end: the served grid must contain nulls for masked cells."""
    from app.providers.incois_provider import incois_provider

    response = incois_provider.get_layer_data("sst", stride=1)
    if response is None:
        pytest.skip("no HYCOM dataset installed")

    values = [v for row in response.grid.values for v in row]
    nulls = sum(1 for v in values if v is None)
    zeros = sum(1 for v in values if v == 0)

    assert nulls > 0, "expected masked (land) cells to be present"
    assert response.validCellCount == len(values) - nulls
    assert response.missingCellCount == nulls
    # Previously every masked cell became 0.0; now they are null.
    assert response.missingCellCount != response.validCellCount
    assert zeros < nulls or zeros == 0


def test_currents_raster_masks_land_and_keeps_real_zero_components():
    from app.providers.incois_provider import incois_provider

    response = incois_provider.get_layer_data("currents", stride=1)
    if response is None:
        pytest.skip("no HYCOM dataset installed")

    u = [v for row in response.grid.u for v in row]
    v = [v for row in response.grid.v for v in row]
    assert any(x is None for x in u), "expected masked current cells"
    assert any(x is None for x in v)


def test_masked_cells_do_not_pollute_the_heuristic_inputs():
    """The score's TCHP mean must be a mean over valid cells only."""
    from app.providers.incois_provider import incois_provider

    layer = incois_provider.get_layer_data("tchp", stride=1)
    if layer is None:
        pytest.skip("no HYCOM dataset installed")
    mean, valid, total = _layer_mean(layer)
    assert total > valid, "some cells are masked"
    assert valid == response_valid(layer)
    # A mean over all cells (including the masked-as-zero old behaviour) would
    # be strictly lower than the valid-cell mean for positive TCHP.
    assert mean > 0


def response_valid(layer):
    values = [v for row in layer.grid.values for v in row]
    return sum(1 for v in values if v is not None)


# ---------------------------------------------------------------------------
# B — default point is peak observed intensity
# ---------------------------------------------------------------------------

def _track(winds):
    return [
        CycloneTrackPoint(
            id=f"pt-{i}",
            timestamp=f"2020-05-15 {i:02d}:00:00",
            latitude=9.0 + i,
            longitude=86.0 + i,
            maxWindKts=w,
            centralPressureMb=None if w is None else 1000 - w,
            category=None,
            windSource=None if w is None else "WMO",
            pressureSource=None,
            status="OBSERVATION",
            distanceToCoastKm=300.0,
            stormSpeedKts=10.0,
            stormDirDeg=300.0,
        )
        for i, w in enumerate(winds)
    ]


def test_default_point_is_the_peak_observed_wind():
    idx, reason = select_default_track_index(_track([10.0, 40.0, 90.0, 55.0]))
    assert idx == 2
    assert reason == "peak_observed_wind"


def test_default_point_skips_null_winds_when_finding_the_peak():
    idx, reason = select_default_track_index(_track([None, None, 80.0, None, 20.0]))
    assert idx == 2
    assert reason == "peak_observed_wind"


def test_default_point_reports_a_tie():
    idx, reason = select_default_track_index(_track([30.0, 90.0, 90.0, 20.0]))
    assert idx == 1, "earliest peak wins a tie"
    assert reason == "peak_observed_wind_tie"


def test_default_point_falls_back_to_last_when_no_wind_at_all():
    idx, reason = select_default_track_index(_track([None, None, None]))
    assert idx == 2
    assert reason == "last_point_no_wind"


def test_amphan_default_point_now_has_real_wind():
    """The exact regression: AMPHAN used to serve idx 5 with no wind."""
    provider = IBTrACSProvider()
    amphan = next(
        (c for c in provider.load_cyclones() if c.name == "AMPHAN"), None
    )
    if amphan is None:
        pytest.skip("IBTrACS not installed")

    point = amphan.track[amphan.currentTrackIndex]
    assert point.maxWindKts is not None, "default point must carry a real wind"
    assert point.windSource in ("WMO", "IMD")
    assert amphan.defaultPointReason in (
        "peak_observed_wind",
        "peak_observed_wind_tie",
    )


def test_every_served_cyclone_default_point_is_scorable():
    """The default view should not land on an unscoreable point."""
    provider = IBTrACSProvider()
    for c in provider.load_cyclones():
        pt = c.track[c.currentTrackIndex]
        if c.defaultPointReason == "last_point_no_wind":
            assert pt.maxWindKts is None
        else:
            assert pt.maxWindKts is not None


def test_api_exposes_the_default_point_reason():
    from fastapi.testclient import TestClient
    from app.main import app

    client = TestClient(app)
    payload = client.get("/api/cyclones").json()
    if not payload:
        pytest.skip("IBTrACS not installed")

    for c in payload:
        assert c["defaultPointReason"] in (
            "peak_observed_wind",
            "peak_observed_wind_tie",
            "last_point_no_wind",
        )
        point = c["track"][c["currentTrackIndex"]]
        if c["defaultPointReason"] != "last_point_no_wind":
            assert point["maxWindKts"] is not None


def test_user_can_still_scrub_to_a_null_point():
    """Scrubbing elsewhere is allowed; the payload simply reports absence."""
    from fastapi.testclient import TestClient
    from app.main import app

    client = TestClient(app)
    payload = client.get("/api/cyclones").json()
    if not payload:
        pytest.skip("IBTrACS not installed")

    null_points = [
        (c, i)
        for c in payload
        for i, pt in enumerate(c["track"])
        if pt["maxWindKts"] is None
    ]
    assert null_points, "expected some null points to still exist in the payload"
    c, i = null_points[0]
    assert c["track"][i]["maxWindKts"] is None
    assert c["track"][i]["windSource"] is None


def test_risk_at_a_scrubbed_null_point_is_unavailable_not_wrong():
    """Scrubbing to a point with no wind must refuse, never substitute."""
    from fastapi.testclient import TestClient
    from app.main import app

    client = TestClient(app)
    payload = client.get("/api/cyclones").json()
    target = None
    for c in payload:
        for i, pt in enumerate(c["track"]):
            if pt["maxWindKts"] is None:
                target = (c["id"], i)
                break
        if target:
            break
    if target is None:
        pytest.skip("no null-wind points available")

    body = client.get(f"/api/risk/{target[0]}", params={"index": target[1]}).json()
    assert body["status"] == "UNAVAILABLE"
    assert body["heuristicDemoScore"] is None
    assert "wind" in body["unavailableReason"].lower()