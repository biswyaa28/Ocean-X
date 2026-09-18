"""Pytest configuration for the OCEAN-X backend test suite.

Data handling policy
--------------------
1. Production scientific datasets (the ~9.85 GB raw HYCOM NetCDF and the
   generated Bay-of-Bengal surface NetCDF) are NOT required to run the unit
   test suite.

2. When production data is ABSENT, this conftest points the application's
   dataset paths at small SYNTHETIC schema-compatible fixtures committed under
   backend/tests/fixtures/. This is announced with a clear banner - it is
   never a silent substitution. The fixtures contain constant placeholder
   values and are used ONLY to validate code paths, API contracts and schema
   assumptions - never as scientific evidence.

3. When production data IS installed, no override happens and the tests
   exercise the REAL production data path end-to-end.

4. True integration tests that specifically require the real production
   datasets live in test_integration_hycom.py, are marked
   @pytest.mark.requires_real_hycom, and are SKIPPED with an explicit message
   when the data is not installed.
"""

import os
import sys
from pathlib import Path

TESTS_DIR = Path(__file__).resolve().parent
BACKEND_DIR = TESTS_DIR.parent
FIXTURES_DIR = TESTS_DIR / "fixtures"

# Synthetic schema-compatible fixtures (committed to Git)
SURFACE_FIXTURE = FIXTURES_DIR / "hycom_surface_fixture.nc"
RAW_FIXTURE = FIXTURES_DIR / "hycom_raw_fixture.nc"

# Production dataset locations, computed independently of any environment
# overrides so that availability checks are always against the real files.
REAL_RAW_HYCOM_FILE = BACKEND_DIR / "data" / "raw" / "ocean" / "currents" / "RSMC_hycom_20260908.nc"
REAL_PROCESSED_HYCOM_FILE = BACKEND_DIR / "data" / "processed" / "ocean" / "incois_hycom_bob_surface.nc"


def real_hycom_available() -> bool:
    """True when a REAL production HYCOM NetCDF is installed locally."""
    return REAL_RAW_HYCOM_FILE.exists() or REAL_PROCESSED_HYCOM_FILE.exists()


if not real_hycom_available():
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
    if REAL_RAW_HYCOM_FILE.exists():
        print(f"  raw:      {REAL_RAW_HYCOM_FILE}")
    if REAL_PROCESSED_HYCOM_FILE.exists():
        print(f"  processed: {REAL_PROCESSED_HYCOM_FILE}")
    print("Tests will exercise the real production data path.")
    print("=" * 72)
