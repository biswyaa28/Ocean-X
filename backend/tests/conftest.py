"""Pytest configuration for the OCEAN-X backend test suite.

Data handling policy
--------------------
1. Production scientific datasets (the ~10.6 GB raw HYCOM NetCDF and the
   generated Bay-of-Bengal surface NetCDF) are NOT required to run the unit
   test suite.

2. When production data is ABSENT but the committed REAL demo subset is
   present (backend/data/demo), nothing is overridden: the application
   resolves the subset itself, so a fresh clone exercises the same real data it
   serves. The banner says so.

3. When neither production data NOR the demo subset is present, this conftest
   points the application's dataset paths at small SYNTHETIC schema-compatible
   fixtures committed under backend/tests/fixtures/. This is announced with a
   clear banner - it is never a silent substitution. The fixtures contain
   constant placeholder values and are used ONLY to validate code paths, API
   contracts and schema assumptions - never as scientific evidence.

4. When production data IS installed, no override happens and the tests
   exercise the REAL production data path end-to-end.

5. True integration tests that specifically require the real production
   datasets live in test_integration_hycom.py, are marked
   @pytest.mark.requires_real_hycom, and are SKIPPED with an explicit message
   when the data is not installed.

Real-file resolution
--------------------
Two real HYCOM files may be installed (see
backend/data/raw/ocean/currents/README.md):

* ``RSMC_hycom_20261008.nc``               - the full 10.58 GB global file
  (preferred; this is what ``data/manifest.json`` declares);
* ``RSMC_hycom_20261008_bob_subset.nc``    - a genuine Bay-of-Bengal subset of
  the same run, cut with the INCOIS THREDDS NCSS service.

Both are real INCOIS output, so the full-downloaded file is preferred and the
Bay-of-Bengal subset is used when only that one is present. An incomplete
``*.full-download-partial`` file is NEVER resolved: opening it would fail or
return corrupt data.
"""

import os
import sys
from pathlib import Path

from app.core.config import settings

TESTS_DIR = Path(__file__).resolve().parent
BACKEND_DIR = TESTS_DIR.parent
FIXTURES_DIR = TESTS_DIR / "fixtures"

# Synthetic schema-compatible fixtures (committed to Git)
SURFACE_FIXTURE = FIXTURES_DIR / "hycom_surface_fixture.nc"
RAW_FIXTURE = FIXTURES_DIR / "hycom_raw_fixture.nc"

# Production dataset locations, computed independently of any environment
# overrides so that availability checks are always against the real files.
HYCOM_DIR = BACKEND_DIR / "data" / "raw" / "ocean" / "currents"
REAL_RAW_HYCOM_FILE = HYCOM_DIR / "RSMC_hycom_20261008.nc"
REAL_PROCESSED_HYCOM_FILE = BACKEND_DIR / "data" / "processed" / "ocean" / "incois_hycom_bob_surface.nc"


def resolve_real_hycom_files():
    """Every installed real HYCOM file, best candidate first.

    Mirrors ``settings.HYCOM_RAW_CANDIDATES`` on purpose: INCOIS deletes older
    runs, so the installed set is whatever is on disk, and the matchup selects
    among several archived runs. Hardcoding one dated filename here would hide
    the multi-run selection from the test suite. An incomplete
    ``*.full-download-partial`` file is never resolved: opening it would fail
    or return corrupt data.
    """
    if not HYCOM_DIR.exists():
        return []
    full = sorted(
        (
            path
            for path in HYCOM_DIR.glob("RSMC_hycom_*.nc")
            if path.is_file() and not path.name.endswith("_bob_subset.nc")
        ),
        key=lambda path: path.name,
        reverse=True,
    )
    subsets = sorted(
        (
            path
            for path in HYCOM_DIR.glob("RSMC_hycom_*_bob_subset.nc")
            if path.is_file()
        ),
        key=lambda path: path.name,
        reverse=True,
    )
    return full + subsets


# Every real HYCOM file installed locally (newest run first).
REAL_HYCOM_FILES = resolve_real_hycom_files()
# The file the integration tests open. None when no real HYCOM data is installed.
REAL_HYCOM_FILE = REAL_HYCOM_FILES[0] if REAL_HYCOM_FILES else None
# Kept for the availability report: the newest archived Bay-of-Bengal subset.
REAL_BOB_SUBSET_HYCOM_FILE = next(
    (path for path in REAL_HYCOM_FILES if path.name.endswith("_bob_subset.nc")),
    None,
)

# The committed demo subset. It is REAL INCOIS output, coarsened, so a clone
# with no production files still has real model data to serve and to test
# against. Resolved through settings so an OCEANX_DATA_DIR override moves both
# the application and this decision together.
DEMO_DIR = settings.DEMO_DIR
DEMO_SUBSET_SURFACE_FILE = DEMO_DIR / "processed" / "ocean" / "incois_hycom_bob_surface.nc"
DEMO_RUNS_DIR = DEMO_DIR / "raw" / "ocean" / "currents"
DEMO_SUBSET_FILES = (
    sorted(DEMO_RUNS_DIR.glob("RSMC_hycom_*.nc"), key=lambda p: p.name, reverse=True)
    if DEMO_RUNS_DIR.exists()
    else []
)
DEMO_SUBSET_FILE = DEMO_SUBSET_FILES[0] if DEMO_SUBSET_FILES else None
DEMO_SUBSET_AVAILABLE = DEMO_SUBSET_FILE is not None and DEMO_SUBSET_SURFACE_FILE.exists()


# An explicit FIXTURE run must be honoured even when real data happens to be
# installed on this machine: settings.RAW_HYCOM_FILE ignores the env override
# in FIXTURE mode and serves the committed fixtures, so the tests must be
# brought into line with the dataset the application will actually open.
FIXTURE_MODE_REQUESTED = os.environ.get("OCEANX_DATA_MODE", "").strip().upper() == "FIXTURE"


def real_hycom_available() -> bool:
    """True when the dataset under test is REAL HYCOM output.

    A forced FIXTURE run makes the application serve the committed fixtures
    even though real files may be installed, so it is not "real" for testing.
    """
    return (REAL_HYCOM_FILE is not None or DEMO_SUBSET_FILE is not None) and not FIXTURE_MODE_REQUESTED


def demo_subset_available() -> bool:
    """True when the committed real subset is the data under test."""
    return REAL_HYCOM_FILE is None and DEMO_SUBSET_AVAILABLE and not FIXTURE_MODE_REQUESTED


if demo_subset_available():
    # No production HYCOM file, but the committed demo subset is real INCOIS
    # output (coarsened). Letting the application resolve it keeps the test
    # suite honest AND lets a fresh clone exercise the same data it serves.
    print("=" * 72)
    print("TEST MODE: REAL HYCOM — committed demo subset (no production files)")
    print("=" * 72)
    print(f"  surface: {DEMO_SUBSET_SURFACE_FILE}")
    print(f"  depth:   {DEMO_SUBSET_FILE}")
    print("Real model output at lower resolution and fewer time steps. Values are")
    print("unaltered (subsampled), so these are scientific evidence at reduced")
    print("coverage. Integration tests requiring the FULL production dataset are")
    print("SKIPPED (see summary).")
    print("=" * 72)
elif not real_hycom_available():
    # Production HYCOM data is absent from this machine. Fall back to the
    # committed synthetic fixtures so unit tests validate code paths without
    # requiring multi-gigabyte scientific datasets.
    if not SURFACE_FIXTURE.exists() or not RAW_FIXTURE.exists():
        print(
            "ERROR: production HYCOM data is absent and test fixtures are missing.\n"
            f"Expected fixtures:\n  {SURFACE_FIXTURE}\n  {RAW_FIXTURE}\n"
            "Regenerate them with: cd backend && python tests/fixtures/generate_hycom_surface_fixture.py",
            file=sys.stderr,
        )
        raise SystemExit(2)

    os.environ["OCEANX_RAW_HYCOM_FILE"] = str(RAW_FIXTURE)
    os.environ["OCEANX_PROCESSED_OCEAN_FILE"] = str(SURFACE_FIXTURE)

    print("=" * 72)
    if FIXTURE_MODE_REQUESTED:
        print("TEST MODE: FIXTURE MODE FORCED (OCEANX_DATA_MODE=FIXTURE)")
    else:
        print("TEST MODE: SYNTHETIC FIXTURES (production HYCOM data not installed)")
    print("=" * 72)
    print("The raw/processed HYCOM NetCDF datasets were not found at:")
    print(f"  {REAL_RAW_HYCOM_FILE}")
    print(f"  {REAL_PROCESSED_HYCOM_FILE}")
    print("Unit tests are running against SYNTHETIC schema-compatible fixtures:")
    print(f"  {RAW_FIXTURE}")
    print(f"  {SURFACE_FIXTURE}")
    print("These fixtures contain constant placeholder values - they are NOT")
    print("real ocean observations. They validate code paths and API contracts only.")
    print("Integration tests requiring real data are SKIPPED (see summary).")
    print("To run against real data, install it via: python scripts/setup-data.py")
    print("=" * 72)
else:
    print("=" * 72)
    print("TEST MODE: REAL PRODUCTION HYCOM DATA DETECTED")
    print("=" * 72)
    print(f"  runs:     {len(REAL_HYCOM_FILES)} real HYCOM file(s) installed")
    for path in REAL_HYCOM_FILES:
        print(f"            {path.name}")
    if REAL_HYCOM_FILE == REAL_BOB_SUBSET_HYCOM_FILE:
        print("  ! These are real Bay-of-Bengal NCSS SUBSETS of published runs,")
        print("    not full 10.58 GB global files. Real model output, but")
        print("    geographically restricted. See data/README.md")
    # No env override is set here on purpose: the application discovers the
    # installed runs by glob exactly as it does in production, so the test
    # suite exercises the real multi-run selection.
    print("Tests will exercise the real production data path.")
    print("=" * 72)
