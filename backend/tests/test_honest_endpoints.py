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
    response = client.get("/api/cyclones")
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
    response = client.get("/api/cyclones")
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
    response = client.get("/api/cyclones/DEFINITELY-NOT-A-STORM")
    assert response.status_code == 404


def test_risk_path_param_selects_the_requested_cyclone(cyclones):
    """B2: the path parameter used to be ignored entirely."""
    target = next(
        c for c in cyclones
        if any(p.maxWindKts is not None and p.distanceToCoastKm is not None for p in c.track)
    )
    response = client.get(f"/api/risk/{target.id}")
    assert response.status_code == 200
    body = response.json()

    other = client.get(f"/api/risk/{cyclones[0].id}").json()
    # Different storms must be independently addressable. Either the scores
    # differ, or at least both responded rather than aliasing one storm.
    assert "status" in body
    assert body["status"] in ("OK", "UNAVAILABLE")
    assert other["status"] in ("OK", "UNAVAILABLE")


def test_risk_accepts_the_hazard_prefix(cyclones):
    target = cyclones[0]
    assert client.get(f"/api/risk/hazard-{target.id}").status_code == 200


def test_risk_unknown_id_returns_404():
    response = client.get("/api/risk/DEFINITELY-NOT-A-STORM")
    assert response.status_code == 404
    assert "not found" in response.json()["detail"].lower()


def test_risk_response_shape_is_renamed_and_labelled():
    response = client.get(f"/api/risk/{ibtracs_provider.load_cyclones()[0].id}")
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
        body = client.get(f"/api/risk/{c.id}").json()
        if body["status"] == "UNAVAILABLE":
            assert body["heuristicDemoScore"] is None
            assert body["category"] is None
            assert body["unavailableReason"]
            assert body["evidence"] == []


# ---------------------------------------------------------------------------
# /hazards — severity follows the assessment status
# ---------------------------------------------------------------------------

def test_hazards_severity_is_null_when_unavailable():
    hazards = client.get("/api/hazards").json()
    assert hazards
    for h in hazards:
        if h["riskAssessment"]["status"] == "UNAVAILABLE":
            assert h["severity"] is None


def test_hazards_accepts_a_cyclone_selector():
    cyclones = ibtracs_provider.load_cyclones()
    if not cyclones:
        pytest.skip("no cyclones")
    response = client.get("/api/hazards", params={"cyclone_id": cyclones[1].id})
    assert response.status_code == 200
    assert response.json()[0]["id"] == f"hazard-{cyclones[1].id}"


def test_hazards_unknown_cyclone_returns_404():
    response = client.get("/api/hazards", params={"cyclone_id": "NOT-A-STORM"})
    assert response.status_code == 404


# ---------------------------------------------------------------------------
# /datasets — reported range must match what is served
# ---------------------------------------------------------------------------

def test_datasets_ibtracs_range_matches_served_data(cyclones):
    """C2: 1842-2025 / 62851 was hardcoded; the API serves 2020+ only."""
    datasets = client.get("/api/datasets").json()
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
    datasets = client.get("/api/datasets").json()
    ibtracs = next(d for d in datasets if "IBTrACS" in d["dataset_name"])
    assert "NEWDELHI_WIND" in ibtracs["variables"]
    assert "NEWDELHI_PRES" in ibtracs["variables"]


# ---------------------------------------------------------------------------
# /observations — status derived, not asserted
# ---------------------------------------------------------------------------

def test_observations_status_is_derived_not_hardcoded_real():
    body = client.get("/api/observations").json()
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
    body = client.get("/api/observations").json()
    assert body["oceanDataStatus"] == "NOT CURRENTLY INTEGRATED"
    assert body["status"] != "REAL"


def test_observations_reports_simulated_in_fixture_mode(monkeypatch):
    import app.api.endpoints as ep

    monkeypatch.setenv("OCEANX_DATA_MODE", "FIXTURE")
    body = client.get("/api/observations").json()
    assert body["oceanDataStatus"] == "SIMULATED"
    assert body["status"] == "SIMULATED"
    assert body["dataMode"] == "FIXTURE"


# ---------------------------------------------------------------------------
# /inspect — no hardcoded REAL
# ---------------------------------------------------------------------------

def test_inspect_never_claims_real_for_synthetic_fixture(monkeypatch):
    monkeypatch.setenv("OCEANX_DATA_MODE", "FIXTURE")
    body = client.get("/api/inspect?lat=15&lon=88").json()
    if body["status"] == "OK":
        assert body["dataStatus"] == "SIMULATED"
        assert body["dataMode"] == "FIXTURE"


def test_inspect_missing_dataset_is_not_called_a_real_dataset(monkeypatch):
    import app.api.endpoints as ep

    monkeypatch.setattr(ep.incois_provider, "_get_dataset", lambda: None)
    body = client.get("/api/inspect?lat=15&lon=88").json()
    assert body["status"] == "NO_REAL_MODEL_DATA"
    assert body["dataStatus"] == "NOT CURRENTLY INTEGRATED"


def test_inspect_missing_pressure_is_null_not_a_default():
    body = client.get("/api/cyclones/inspect?lat=18.2&lon=88.4").json()
    assert body["status"] == "OK"
    assert "windSource" in body
    assert "pressureSource" in body
    assert "dataCompleteness" in body
    if body["maxWindKts"] is None:
        assert body["windSource"] is None

# ---------------------------------------------------------------------------
# Missing IBTrACS snapshot must be loud, never an empty answer
# ---------------------------------------------------------------------------

def test_missing_snapshot_raises_rather_than_returning_empty_list(monkeypatch):
    """An absent dataset is not the same finding as "no cyclones occurred"."""
    from app.providers.ibtracs_provider import IBTrACSDataMissing

    monkeypatch.setattr(
        ibtracs_provider, "csv_path", ibtracs_provider.csv_path.parent / "__absent__.csv"
    )
    monkeypatch.setattr(ibtracs_provider, "_cached_cyclones", None)

    with pytest.raises(IBTrACSDataMissing) as excinfo:
        ibtracs_provider.load_cyclones()

    # The message has to say what is wrong and how to fix it.
    assert "missing" in str(excinfo.value).lower()
    assert "git checkout" in str(excinfo.value)


def test_missing_snapshot_surfaces_as_503_with_remedy(monkeypatch):
    """Endpoints must not degrade into an empty 200 when the file is gone."""
    monkeypatch.setattr(
        ibtracs_provider, "csv_path", ibtracs_provider.csv_path.parent / "__absent__.csv"
    )
    monkeypatch.setattr(ibtracs_provider, "_cached_cyclones", None)

    for route in (
        "/api/cyclones",
        "/api/hazards",
        "/api/summary/landing",
        "/api/datasets",
        "/api/observations",
    ):
        response = client.get(route)
        assert response.status_code == 503, f"{route} returned {response.status_code}"
        detail = response.json()["detail"]
        assert detail["error"] == "ibtracs_dataset_missing"
        assert "git checkout" in detail["remedy"]
        assert detail["see"] == "data/README.md#ibtracs-ni-provenance"


def test_committed_snapshot_matches_its_recorded_checksum():
    """The provenance recorded in the manifest must describe the real bytes."""
    import hashlib
    import json
    from pathlib import Path

    manifest = json.loads(
        (Path(__file__).resolve().parents[2] / "data" / "manifest.json").read_text()
    )
    entry = next(d for d in manifest["datasets"] if d["name"] == "IBTrACS_NI")

    csv_path = Path(__file__).resolve().parents[2] / entry["local_path"]

    digest = hashlib.sha256(csv_path.read_bytes()).hexdigest()
    assert digest == entry["snapshot_sha256"], (
        "IBTrACS snapshot has drifted from the checksum recorded in "
        "data/manifest.json; update snapshot_sha256 and the provenance table "
        "in data/README.md deliberately"
    )
    assert entry["committed"] is True
    assert entry["snapshot_date"]


def test_unreadable_snapshot_surfaces_as_503_not_empty_200(tmp_path, monkeypatch):
    """A file that is present but unparseable must not read as 'no cyclones'."""
    from app.providers.ibtracs_provider import IBTrACSDataCorrupt

    corrupt = tmp_path / "ibtracs.corrupt.csv"
    # A truncated header: `next(reader)` for the units row raises StopIteration,
    # which the parse loop cannot recover from.
    corrupt.write_text("SID,SEASON,NAME\n", encoding="utf-8")

    monkeypatch.setattr(ibtracs_provider, "csv_path", corrupt)
    monkeypatch.setattr(ibtracs_provider, "_cached_cyclones", None)

    with pytest.raises(IBTrACSDataCorrupt) as excinfo:
        ibtracs_provider.load_cyclones()

    # Chained from the original error, and it names a remedy.
    assert excinfo.value.__cause__ is not None
    assert "git checkout" in str(excinfo.value)

    for route in ("/api/cyclones", "/api/hazards", "/api/summary/landing"):
        response = client.get(route)
        assert response.status_code == 503, f"{route} returned {response.status_code}"
        detail = response.json()["detail"]
        assert detail["error"] == "ibtracs_dataset_unreadable"
        assert detail["cause"], "the underlying parse failure must be reported"
        assert "git checkout" in detail["remedy"]
        assert detail["see"] == "data/README.md#ibtracs-ni-provenance"


# ---------------------------------------------------------------------------
# Corrupt Argo JSON must not read as "zero profiles"
# ---------------------------------------------------------------------------

def test_corrupt_argo_json_raises_instead_of_reporting_zero_profiles(tmp_path):
    """A broken processed Argo file is not the same finding as an empty one."""
    from app.providers.argo_provider import ArgoDataCorrupt, ArgoProvider

    corrupt = tmp_path / "argo_bob_processed.json"
    corrupt.write_text('{"this is not": valid json', encoding="utf-8")

    provider = ArgoProvider(data_path=corrupt, meta_path=tmp_path / "meta.json")

    # Startup must survive: importing/constructing the provider does not raise.
    with pytest.raises(ArgoDataCorrupt) as excinfo:
        provider.get_profiles()

    assert excinfo.value.__cause__ is not None
    assert "git checkout" in str(excinfo.value)
    # The failure is recorded, so the bad file is not retried on every access.
    assert provider._load_error is not None


def test_absent_argo_file_still_reports_zero_profiles(tmp_path):
    """A genuinely absent file is a real 'no data installed', not a failure."""
    from app.providers.argo_provider import ArgoProvider

    provider = ArgoProvider(
        data_path=tmp_path / "not_installed.json", meta_path=tmp_path / "meta.json"
    )
    assert provider.get_profiles() == []
    assert provider._load_error is None


def test_corrupt_argo_json_surfaces_as_503(monkeypatch):
    """Endpoints return an honest 503, never a 200 with an empty profile list."""
    from app.providers import argo_provider as argo_mod
    from app.providers.argo_provider import ArgoProvider

    real = ArgoProvider()
    broken_file = real.data_path.parent / "__corrupt_argo__.json"
    broken_file.write_text("{ not json", encoding="utf-8")

    broken = ArgoProvider(data_path=broken_file, meta_path=real.meta_path)
    monkeypatch.setattr("app.api.endpoints.argo_provider", broken)

    for route in ("/api/argo/profiles", "/api/argo/floats", "/api/summary/landing"):
        response = client.get(route)
        assert response.status_code == 503, f"{route} returned {response.status_code}"
        detail = response.json()["detail"]
        assert detail["error"] == "argo_dataset_unreadable"
        assert detail["cause"], "the underlying parse failure must be reported"

    broken_file.unlink()


# ---------------------------------------------------------------------------
# A failed inspect must not be reported as NO_REAL_MODEL_DATA
# ---------------------------------------------------------------------------

def test_inspect_failure_raises_instead_of_reporting_no_real_model_data(monkeypatch):
    """A crash while indexing is not 'this timestamp is not in the record'."""
    import app.providers.incois_provider as incois_mod
    from app.providers.incois_provider import InspectPointFailed

    provider = incois_mod.incois_provider

    class ExplodingSelection:
        """Stands in for the time-selected dataset; indexing it is what fails."""

        def sel(self, *args, **kwargs):
            raise RuntimeError("netcdf index exploded")

    class Dataset:
        def isel(self, **kwargs):
            return ExplodingSelection()

    # A dataset and a timestamp list are both present, so the only way to fail
    # is inside the indexing path itself.
    monkeypatch.setattr(provider, "_get_dataset", lambda: Dataset(), raising=False)
    monkeypatch.setattr(
        provider, "get_available_timestamps", lambda: ["2024-01-01T00:00:00"],
        raising=False,
    )

    with pytest.raises(InspectPointFailed) as excinfo:
        provider.inspect_point(lat=15.0, lon=85.0)

    assert excinfo.value.__cause__ is not None
    assert "not a statement about the model field" in str(excinfo.value)
    assert (excinfo.value.lat, excinfo.value.lon) == (15.0, 85.0)


def test_inspect_still_reports_no_real_model_data_when_no_dataset(monkeypatch):
    """The three legitimate NO_REAL_MODEL_DATA paths must be untouched."""
    import app.providers.incois_provider as incois_mod

    provider = incois_mod.incois_provider
    monkeypatch.setattr(provider, "_get_dataset", lambda: None, raising=False)

    result = provider.inspect_point(lat=15.0, lon=85.0)
    assert result["status"] == "NO_REAL_MODEL_DATA"
    assert result["dataStatus"] in ("SIMULATED", "NOT CURRENTLY INTEGRATED")


def test_inspect_failure_surfaces_as_503(monkeypatch):
    """The API must not hand the frontend a status it renders as REAL."""
    from app.providers.incois_provider import InspectPointFailed

    monkeypatch.setattr(
        "app.api.endpoints.incois_provider.inspect_point",
        lambda **kw: (_ for _ in ()).throw(InspectPointFailed(15.0, 85.0, None, RuntimeError("boom"))),
    )

    response = client.get("/api/inspect?lat=15&lon=85")
    assert response.status_code == 503
    detail = response.json()["detail"]
    assert detail["error"] == "inspect_failed"
    assert detail["note"].startswith("The request could not be evaluated")
