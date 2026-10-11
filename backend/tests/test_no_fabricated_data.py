"""Tests for the removal of fabricated data from cyclone + risk surfaces.

Every behaviour asserted here corresponds to a defect found in audit:

* A1  IBTrACS wind/pressure were substituted with 45.0 kt / 990.0 mb when the
     WMO columns were blank, then reported as ``status='REAL'``.
* A2  A synthetic forecast cone (``40 + idx*25`` km) was drawn over
     *historical* best-track points; one constant wind-radius (260/140/75 km)
     was applied to every storm regardless of intensity.
* A3  An unknown cyclone id silently returned ``cyclones[0]``.
* B1  The risk engine defaulted TCHP to 65.0 and SST to 30.2, producing a
     confident score on a machine with no model data installed.
* B2  ``/risk/{hazard_id}`` ignored its path parameter entirely.
* C1  ``/inspect`` and ``/observations`` hardcoded ``dataStatus='REAL'`` even
     when FIXTURE data or no data at all was being served.
* C2  ``/datasets`` advertised a hardcoded 1842-2025 / 62851-step range that
     did not match the seasons actually served (2020+).
"""

import pytest

from app.core.config import settings
from app.models.schemas import (
    Cyclone,
    CycloneTrackPoint,
    RISK_HEURISTIC_WEIGHTS,
)
from app.providers.ibtracs_provider import IBTrACSProvider
from app.services.risk_engine import calculate_prototype_risk


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _pt(**kw) -> CycloneTrackPoint:
    base = dict(
        id="s-pt-0",
        timestamp="2020-05-15 21:00:00",
        latitude=9.6,
        longitude=86.5,
        maxWindKts=None,
        centralPressureMb=None,
        category=None,
        windSource=None,
        pressureSource=None,
        status="OBSERVATION",
        distanceToCoastKm=563.0,
        stormSpeedKts=12.0,
        stormDirDeg=310.0,
    )
    base.update(kw)
    return CycloneTrackPoint(**base)


def _cyclone(track=None, **kw) -> Cyclone:
    return Cyclone(
        id="TESTSTORM",
        name="TESTSTORM",
        basin="North Indian Ocean (Bay of Bengal)",
        dataStatus="REAL",
        currentTrackIndex=0,
        track=track if track is not None else [_pt()],
        forecastCone=[],
        sourceAttribution="test",
        **kw,
    )


@pytest.fixture(scope="module")
def provider() -> IBTrACSProvider:
    return IBTrACSProvider()


# ---------------------------------------------------------------------------
# A1 — no substituted wind/pressure; IMD fallback; provenance fields
# ---------------------------------------------------------------------------

def test_blank_wmo_columns_are_never_substituted_with_a_constant(provider):
    """The core defect: 45.0 kt / 990.0 mb were invented for blank WMO cells."""
    for cyclone in provider.load_cyclones():
        for pt in cyclone.track:
            if pt.maxWindKts is not None:
                assert pt.maxWindKts > 0
            if pt.centralPressureMb is not None:
                assert pt.centralPressureMb > 0
            # A point must never carry the old fabricated pair together with a
            # REAL provenance claim sourced from a blank column.
            if pt.windSource is None:
                assert pt.maxWindKts is None, (
                    f"{cyclone.name} {pt.id}: wind present without a source"
                )


def test_amphan_served_point_reports_absence_not_a_fabricated_storm(provider):
    """AMPHAN track point 5 is blank in both WMO and IMD — it must be None.

    Previously this exact point reported 45.0 kt / 990.0 mb as ``status='REAL'``
    while AMPHAN was in fact a Category-5 Super Cyclonic Storm (~155 kt).
    """
    amphan = next(c for c in provider.load_cyclones() if c.name == "AMPHAN")
    pt = amphan.track[amphan.currentTrackIndex]
    assert pt.maxWindKts is None
    assert pt.centralPressureMb is None
    assert pt.windSource is None
    assert pt.pressureSource is None
    assert pt.category is None


def test_wind_source_is_either_wmo_or_imd_and_never_null_with_a_value(provider):
    for cyclone in provider.load_cyclones():
        for pt in cyclone.track:
            if pt.maxWindKts is not None:
                assert pt.windSource in ("WMO", "IMD")
            if pt.centralPressureMb is not None:
                assert pt.pressureSource in ("WMO", "IMD")


def test_imd_is_used_when_wmo_is_blank(provider):
    """IMD (New Delhi) is authoritative for the North Indian Ocean and must
    actually be consulted when the WMO consensus column is empty."""
    imd_points = [
        pt
        for c in provider.load_cyclones()
        for pt in c.track
        if pt.windSource == "IMD" or pt.pressureSource == "IMD"
    ]
    assert imd_points, "expected at least some points to resolve via the IMD fallback"


def test_data_completeness_is_reported_per_cyclone(provider):
    for cyclone in provider.load_cyclones():
        dc = cyclone.dataCompleteness
        assert dc is not None
        assert dc.trackPoints == len(cyclone.track)
        assert 0.0 <= dc.withWind <= 1.0
        assert 0.0 <= dc.withPressure <= 1.0

        expected_wind = sum(1 for p in cyclone.track if p.maxWindKts is not None)
        assert dc.withWind == pytest.approx(expected_wind / len(cyclone.track), abs=1e-4)


# ---------------------------------------------------------------------------
# A2 — no synthetic forecast cone; real-or-null wind radii
# ---------------------------------------------------------------------------

def test_forecast_cone_is_always_empty(provider):
    """IBTrACS holds best-track history, not forecasts — a cone over it lies."""
    for cyclone in provider.load_cyclones():
        assert cyclone.forecastCone == [], (
            f"{cyclone.name} still carries a synthetic forecast cone"
        )


def test_wind_radius_is_not_a_constant_across_storms(provider):
    """260/140/75 km was applied identically to all 30 storms."""
    radii = {
        (c.id, c.name): c.windRadius.r34ktsKm for c in provider.load_cyclones()
    }
    values = [v for v in radii.values() if v is not None]
    assert len(set(values)) > 1, (
        "every storm still reports an identical R34 — the constant was not removed"
    )
    assert 260.0 not in values, "the old hardcoded 260 km constant is still present"


def test_wind_radius_is_null_when_no_radii_were_observed(provider):
    """Absent agency radii must be null, never back-filled."""
    null_radii = [
        c for c in provider.load_cyclones() if c.windRadius.r34ktsKm is None
    ]
    assert null_radii, "expected some cyclones to have no observed radii"
    for c in null_radii:
        assert c.windRadius.source is None


def test_wind_radius_present_carries_a_source(provider):
    with_radii = [
        c
        for c in provider.load_cyclones()
        if c.windRadius.r34ktsKm is not None
        or c.windRadius.r50ktsKm is not None
        or c.windRadius.r64ktsKm is not None
    ]
    for c in with_radii:
        assert c.windRadius.source is not None
        assert c.windRadius.r34ktsKm is None or c.windRadius.r34ktsKm > 0


# ---------------------------------------------------------------------------
# A3 — unknown cyclone id is not silently replaced
# ---------------------------------------------------------------------------

def test_unknown_cyclone_id_returns_none_not_the_first_storm(provider):
    assert provider.get_cyclone_by_id("DEFINITELY-NOT-A-STORM") is None


def test_known_cyclone_resolves_by_id_and_by_name(provider):
    cyclones = provider.load_cyclones()
    target = cyclones[3]
    assert provider.get_cyclone_by_id(target.id).id == target.id
    assert provider.get_cyclone_by_id(target.name).id == target.id
    assert provider.get_cyclone_by_id(target.name.upper()).id == target.id


# ---------------------------------------------------------------------------
# B1 — risk engine refuses to score on invented inputs
# ---------------------------------------------------------------------------

def test_risk_unavailable_when_wind_is_missing(monkeypatch):
    """The default-served AMPHAN point has no wind, so it must not be scored."""
    amphan_like = _cyclone(track=[_pt(maxWindKts=None, windSource=None)])
    result = calculate_prototype_risk(amphan_like)
    assert result.status == "UNAVAILABLE"
    assert result.heuristicDemoScore is None
    assert result.category is None
    assert "wind" in result.unavailableReason.lower()


def test_risk_unavailable_when_no_model_data(monkeypatch):
    """With no layer data the engine must NOT fall back to 65.0 / 30.2."""
    import app.services.risk_engine as re_mod

    monkeypatch.setattr(re_mod.incois_provider, "get_layer_data", lambda *a, **k: None)

    cyclone = _cyclone(track=[_pt(maxWindKts=60.0, windSource="WMO")])
    result = calculate_prototype_risk(cyclone)

    assert result.status == "UNAVAILABLE"
    assert result.heuristicDemoScore is None
    assert result.category is None
    assert "TCHP" in result.unavailableReason or "SST" in result.unavailableReason


def test_risk_unavailable_when_layer_raises(monkeypatch):
    """A provider error must surface as unavailability, never as a score."""
    import app.services.risk_engine as re_mod

    def boom(*a, **k):
        raise RuntimeError("dataset unreadable")

    monkeypatch.setattr(re_mod.incois_provider, "get_layer_data", boom)
    result = calculate_prototype_risk(
        _cyclone(track=[_pt(maxWindKts=60.0, windSource="WMO")])
    )
    assert result.status == "UNAVAILABLE"
    assert result.heuristicDemoScore is None


def test_risk_unavailable_when_distance_to_land_missing(monkeypatch):
    import app.services.risk_engine as re_mod

    monkeypatch.setattr(
        re_mod.incois_provider,
        "get_layer_data",
        lambda *a, **k: _layer([[100.0]]),
    )
    result = calculate_prototype_risk(
        _cyclone(track=[_pt(maxWindKts=60.0, windSource="WMO", distanceToCoastKm=None)])
    )
    assert result.status == "UNAVAILABLE"


class _Grid:
    def __init__(self, values):
        self.values = values


class _Layer:
    def __init__(self, values):
        self.grid = _Grid(values)


def _layer(values):
    return _Layer(values)


# ---------------------------------------------------------------------------
# B — risk response shape: renamed field, weights, disclaimer, no invented regions
# ---------------------------------------------------------------------------

def test_risk_response_is_labelled_and_carries_weights(monkeypatch):
    import app.services.risk_engine as re_mod

    monkeypatch.setattr(
        re_mod.incois_provider,
        "get_layer_data",
        lambda name, **k: _layer([[100.0]]),
    )
    result = calculate_prototype_risk(
        _cyclone(track=[_pt(maxWindKts=60.0, windSource="WMO")])
    )
    assert result.status == "OK"
    assert result.heuristicDemoScore is not None
    assert result.validated is False
    assert "NOT FOR OPERATIONAL USE" in result.operationalUse
    assert "NOT VALIDATED" in result.disclaimer
    assert result.weights == RISK_HEURISTIC_WEIGHTS


def test_risk_never_claims_landfall_regions():
    """The old engine listed fixed coasts unrelated to the cyclone position."""
    cyclone = _cyclone(track=[_pt(maxWindKts=None, windSource=None)])
    result = calculate_prototype_risk(cyclone)
    assert result.affectedRegions == []
    assert "West Bengal Coast" not in result.model_dump_json()
    assert "Odisha Coast" not in result.model_dump_json()
    assert "Bangladesh Coast" not in result.model_dump_json()


def test_risk_evidence_marks_missing_pressure_as_unavailable(monkeypatch):
    import app.services.risk_engine as re_mod

    monkeypatch.setattr(
        re_mod.incois_provider,
        "get_layer_data",
        lambda name, **k: _layer([[100.0]]),
    )
    result = calculate_prototype_risk(
        _cyclone(track=[_pt(maxWindKts=60.0, windSource="WMO", centralPressureMb=None)])
    )
    assert result.status == "OK"
    pressure = next(e for e in result.evidence if "Pressure" in e.variable)
    assert pressure.value is None
    assert pressure.status == "UNAVAILABLE"
    assert pressure.trend == "unknown"


def test_risk_evidence_records_wind_source(monkeypatch):
    import app.services.risk_engine as re_mod

    monkeypatch.setattr(
        re_mod.incois_provider,
        "get_layer_data",
        lambda name, **k: _layer([[100.0]]),
    )
    result = calculate_prototype_risk(
        _cyclone(track=[_pt(maxWindKts=60.0, windSource="IMD")])
    )
    source_item = next(e for e in result.evidence if "source" in e.variable)
    assert source_item.value == "IMD"


def test_risk_evidence_never_reports_a_fabricated_observation(monkeypatch):
    """No evidence item may be a hardcoded 45.0/990.0 standing in for data."""
    import app.services.risk_engine as re_mod

    monkeypatch.setattr(
        re_mod.incois_provider,
        "get_layer_data",
        lambda name, **k: _layer([[100.0]]),
    )
    result = calculate_prototype_risk(
        _cyclone(track=[_pt(maxWindKts=61.3, windSource="WMO")])
    )
    wind = next(e for e in result.evidence if "Wind" in e.variable)
    assert wind.value == "61.3"
    assert wind.value != "45.0"


def test_weights_constant_matches_backend_contract():
    assert RISK_HEURISTIC_WEIGHTS["windMaxPoints"] == 45.0
    assert RISK_HEURISTIC_WEIGHTS["windSaturatesAtKts"] == 140.0
    assert RISK_HEURISTIC_WEIGHTS["distanceScaleKm"] == 800.0
    assert RISK_HEURISTIC_WEIGHTS["scoreClampMin"] == 10.0
    assert RISK_HEURISTIC_WEIGHTS["scoreClampMax"] == 98.0


# ---------------------------------------------------------------------------
# D — FIXTURE mode must never be labelled REAL
# ---------------------------------------------------------------------------

def test_fixture_mode_is_never_reported_as_real(monkeypatch):
    """FIXTURE serves synthetic constant cells; calling them REAL is a lie."""
    from app.providers.incois_provider import incois_provider

    # settings.DATA_MODE is a read-only property over OCEANX_DATA_MODE.
    monkeypatch.setenv("OCEANX_DATA_MODE", "FIXTURE")

    result = incois_provider.inspect_point(lat=15.0, lon=88.0)
    assert result["status"] == "OK"
    assert result["dataStatus"] == "SIMULATED"
    assert result["dataMode"] == "FIXTURE"
    assert "fixture" in result["source"].lower()


def test_fixture_mode_does_not_report_real_on_missing_data(monkeypatch):
    from app.providers.incois_provider import incois_provider

    monkeypatch.setenv("OCEANX_DATA_MODE", "FIXTURE")
    monkeypatch.setattr(incois_provider, "_get_dataset", lambda: None)
    result = incois_provider.inspect_point(lat=15.0, lon=88.0)
    assert result["status"] == "NO_REAL_MODEL_DATA"
    assert result["dataStatus"] != "REAL DATASET — TIMESTAMP UNAVAILABLE"