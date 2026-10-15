"""Tests for manifest provenance merging in scripts/archive_hycom_runs.py.

The archive is a rolling operation: INCOIS publishes ~5 runs at a time, so each
invocation sees a DIFFERENT subset of what is already on disk. The manifest is
the provenance record of every subset ever fetched, and a routine that archived
today's run must not erase the record of the runs fetched last week.

These tests drive record_provenance against a temporary manifest so the real
data/manifest.json is never touched.
"""

import json
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPTS_DIR = REPO_ROOT / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import archive_hycom_runs as archive


def _entry(run_date):
    return {
        "runDate": run_date,
        "filename": f"RSMC_hycom_{run_date}_bob_subset.nc",
        "timeStart": f"2026-10-01T06:00:00.000000000",
        "timeEnd": f"2026-10-08T00:00:00.000000000",
        "timeStepHours": 6.0,
        "timeSteps": 28,
        "depthLevelsM": [0.0, 17.5, 52.5, 125.0, 275.0, 500.0],
        "latCount": 349,
        "lonCount": 334,
        "bytes": 378615360,
        "variables": ["TEMP", "SALN"],
    }


def _write_manifest(path, run_dates):
    payload = {
        "datasets": [
            {"name": "ARGO_PROFILES_BOB", "purpose": "an unrelated dataset"},
            {
                "name": "HYCOM_RSMC_RAW_SUBSETS",
                "purpose": "archived subsets",
                "archived_runs": [_entry(d) for d in run_dates],
            },
        ]
    }
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def _archived(manifest_path):
    payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    datasets = [d for d in payload["datasets"] if d["name"] == "HYCOM_RSMC_RAW_SUBSETS"]
    assert len(datasets) == 1, "expected exactly one HYCOM_RSMC_RAW_SUBSETS entry"
    return datasets[0]["archived_runs"]


def _run_dates(manifest_path):
    return [e["runDate"] for e in _archived(manifest_path)]


@pytest.fixture
def manifest_path(tmp_path, monkeypatch):
    """A temporary manifest, patched over the module constant.

    Patching rather than pointing the script at a new repository keeps the real
    data/manifest.json out of reach: the script resolves the path at call time
    from this module attribute.
    """
    path = tmp_path / "manifest.json"
    _write_manifest(path, ["20261004", "20261005", "20261006"])
    monkeypatch.setattr(archive, "MANIFEST", path)
    return path


def test_archiving_one_new_run_keeps_the_existing_entries(manifest_path):
    archive.record_provenance([_entry("20261011")])

    assert _run_dates(manifest_path) == ["20261004", "20261005", "20261006", "20261011"]


def test_re_archiving_an_existing_run_updates_it_without_duplicating(manifest_path):
    refreshed = _entry("20261005")
    refreshed["bytes"] = 12345
    refreshed["timeSteps"] = 30

    archive.record_provenance([refreshed])

    dates = _run_dates(manifest_path)
    assert dates.count("20261005") == 1, "the run must not be duplicated"
    assert len(dates) == len(set(dates)), "every run date must be unique"
    # The runs that were not part of this invocation must survive it.
    assert set(dates) == {"20261004", "20261005", "20261006"}
    updated = next(e for e in _archived(manifest_path) if e["runDate"] == "20261005")
    assert updated["bytes"] == 12345
    assert updated["timeSteps"] == 30


def test_entries_are_kept_sorted_by_run_date(manifest_path):
    archive.record_provenance([_entry("20261008"), _entry("20261011"), _entry("20261007")])

    dates = _run_dates(manifest_path)
    assert dates == sorted(dates)
    assert dates == ["20261004", "20261005", "20261006", "20261007", "20261008", "20261011"]


def test_unrelated_dataset_entries_are_preserved(manifest_path):
    archive.record_provenance([_entry("20261011")])

    payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    names = [d["name"] for d in payload["datasets"]]
    assert names == ["ARGO_PROFILES_BOB", "HYCOM_RSMC_RAW_SUBSETS"]


def test_the_repository_manifest_is_never_the_one_under_test(manifest_path, tmp_path):
    """Guard: the patched path must point at the temp dir, not data/manifest.json."""
    assert archive.MANIFEST == manifest_path
    assert archive.MANIFEST.parent == tmp_path
    assert archive.MANIFEST != REPO_ROOT / "data" / "manifest.json"