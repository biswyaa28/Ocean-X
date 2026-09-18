#!/usr/bin/env python3
"""OCEAN-X data preflight checker.

Reads data/manifest.json and reports the status of every dataset:
AVAILABLE, MISSING, INVALID or OPTIONAL (available/missing).

Exits with code 0 if all REQUIRED datasets are available, 1 otherwise.
Missing OPTIONAL datasets never fail the run.

Usage:
    python scripts/check-data.py [--manifest PATH] [--verbose] [--json]
"""

import argparse
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MANIFEST = REPO_ROOT / "data" / "manifest.json"

# Statuses
AVAILABLE = "AVAILABLE"
MISSING = "MISSING"
INVALID = "INVALID"
OPTIONAL_AVAILABLE = "OPTIONAL"
OPTIONAL_MISSING = "OPTIONAL (missing)"


def human_size(num_bytes):
    if num_bytes is None:
        return "unknown"
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if num_bytes < 1024 or unit == "TB":
            return f"{num_bytes:.1f} {unit}" if unit != "B" else f"{int(num_bytes)} B"
        num_bytes /= 1024


def load_manifest(manifest_path):
    with open(manifest_path, "r", encoding="utf-8") as f:
        manifest = json.load(f)
    errors = []
    if not isinstance(manifest.get("datasets"), list) or not manifest["datasets"]:
        errors.append("manifest has no 'datasets' list")
    for i, ds in enumerate(manifest.get("datasets", [])):
        for field in ("name", "local_path", "category", "required"):
            if field not in ds:
                errors.append(f"dataset #{i} is missing required field '{field}'")
    if errors:
        raise ValueError("Invalid manifest: " + "; ".join(errors))
    return manifest


def check_netcdf_schema(path, expected_coords, expected_variables, verbose):
    """Open a NetCDF file lazily and verify coords/variables exist. Returns (ok, message)."""
    try:
        import xarray as xr
    except ImportError:
        return True, "xarray not installed; schema check skipped"
    try:
        ds = xr.open_dataset(path, engine="netcdf4", chunks={})
        try:
            missing_coords = [c for c in (expected_coords or []) if c not in ds.coords]
            missing_vars = [v for v in (expected_variables or []) if v not in ds.data_vars]
            if missing_coords or missing_vars:
                msg = (
                    f"missing coords: {missing_coords}; missing variables: {missing_vars}"
                    if missing_coords or missing_vars
                    else ""
                )
                return False, msg or "schema mismatch"
            if verbose:
                dims = ", ".join(f"{k}={v}" for k, v in ds.sizes.items())
                return True, f"schema OK ({dims})"
            return True, "schema OK"
        finally:
            ds.close()
    except Exception as exc:
        return False, f"unreadable as NetCDF: {exc}"


def check_readable(path, verbose):
    """Generic readability check for non-NetCDF formats (JSON/CSV)."""
    try:
        size = path.stat().st_size
        if size == 0:
            return False, "file is empty"
        with open(path, "rb") as f:
            f.read(64)  # touch the first bytes
        return True, "readable"
    except Exception as exc:
        return False, f"not readable: {exc}"


def check_size(path, expected_bytes, tolerance=0.30, verbose=False):
    """Return (ok, message). ok is None when no expectation is set."""
    if not expected_bytes:
        return None, "no size expectation"
    actual = path.stat().st_size
    if actual <= 0:
        return False, "file is empty"
    # Only fail when dramatically smaller than expected (>70% smaller).
    if actual < expected_bytes * (1 - 0.70):
        return (
            False,
            f"suspiciously small: {human_size(actual)} vs expected ~{human_size(expected_bytes)}",
        )
    return True, f"{human_size(actual)}"


def check_dataset(ds, root, verbose):
    """Return a result dict for one manifest dataset entry."""
    name = ds["name"]
    local_path = (REPO_ROOT / ds["local_path"]).resolve() if not Path(ds["local_path"]).is_absolute() else Path(ds["local_path"])
    required = bool(ds.get("required"))
    is_fixture = bool(ds.get("is_test_fixture"))

    result = {
        "name": name,
        "required": required,
        "path": local_path,
        "status": None,
        "detail": "",
        "size": None,
    }

    if not local_path.exists():
        result["status"] = MISSING if required else OPTIONAL_MISSING
        result["detail"] = "file not found"
        return result

    result["size"] = local_path.stat().st_size

    # Size expectation (only when set)
    size_ok, size_msg = check_size(local_path, ds.get("approx_size_bytes"), verbose=verbose)
    if size_ok is False:
        result["status"] = INVALID if required else OPTIONAL_MISSING
        result["detail"] = size_msg
        return result

    # Schema / readability checks
    fmt = (ds.get("format") or "").upper()
    if "NETCDF" in fmt:
        ok, msg = check_netcdf_schema(
            local_path, ds.get("expected_coords"), ds.get("expected_variables"), verbose
        )
        if not ok:
            result["status"] = INVALID if required else OPTIONAL_MISSING
            result["detail"] = msg
            return result
        result["detail"] = msg
    else:
        ok, msg = check_readable(local_path, verbose)
        if not ok:
            result["status"] = INVALID if required else OPTIONAL_MISSING
            result["detail"] = msg
            return result
        result["detail"] = msg

    result["status"] = AVAILABLE if required else OPTIONAL_AVAILABLE
    return result


def main():
    # ---------------------------------------------------------------------------
    # Phase 3: FIXTURE mode short-circuit
    # ---------------------------------------------------------------------------
    import os
    data_mode = os.environ.get("OCEANX_DATA_MODE", "REAL").strip().upper()
    if data_mode == "FIXTURE":
        fixture_dir = REPO_ROOT / "backend" / "tests" / "fixtures"
        raw_fixture = fixture_dir / "hycom_raw_fixture.nc"
        surface_fixture = fixture_dir / "hycom_surface_fixture.nc"
        print("=" * 60)
        print("OCEAN-X Data Mode: FIXTURE")
        print("=" * 60)
        print("OCEANX_DATA_MODE=FIXTURE is set.")
        print("The backend will serve COMMITTED SYNTHETIC SCHEMA-COMPATIBLE")
        print("fixtures. No production HYCOM data is required or used.")
        print()
        print("Fixture files (committed to Git):")
        raw_ok = raw_fixture.exists()
        surface_ok = surface_fixture.exists()
        print(f"  {'[OK]' if raw_ok else '[MISSING]'} {raw_fixture}")
        print(f"  {'[OK]' if surface_ok else '[MISSING]'} {surface_fixture}")
        print()
        if raw_ok and surface_ok:
            print("Required HYCOM data available: YES (synthetic fixtures)")
            print()
            print("NOTE: These are SYNTHETIC TEST FIXTURES.")
            print("      Values are constant placeholders — NOT real ocean measurements.")
            print("      Do not present fixture output as scientific evidence.")
            return 0
        else:
            missing = []
            if not raw_ok:
                missing.append(str(raw_fixture))
            if not surface_ok:
                missing.append(str(surface_fixture))
            print("Required HYCOM data available: NO")
            print("ERROR: Fixture files missing:")
            for m in missing:
                print(f"  {m}")
            print()
            print("Regenerate with:")
            print("  cd backend && python tests/fixtures/generate_hycom_surface_fixture.py")
            return 1

    parser = argparse.ArgumentParser(description="OCEAN-X data preflight checker")
    parser.add_argument("--manifest", default=str(DEFAULT_MANIFEST), help="Path to manifest.json")
    parser.add_argument("--verbose", action="store_true", help="Show extra schema detail")
    parser.add_argument("--json", action="store_true", help="Emit machine-readable JSON")
    args = parser.parse_args()

    manifest_path = Path(args.manifest)
    if not manifest_path.exists():
        print(f"ERROR: manifest not found: {manifest_path}", file=sys.stderr)
        return 2

    try:
        manifest = load_manifest(manifest_path)
    except ValueError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2

    results = [check_dataset(ds, REPO_ROOT, args.verbose) for ds in manifest["datasets"]]

    required_missing = [r for r in results if r["required"] and r["status"] in (MISSING, INVALID)]
    required_available = [r for r in results if r["required"] and r["status"] == AVAILABLE]
    optional = [r for r in results if not r["required"]]

    all_ok = not required_missing

    if args.json:
        payload = {
            "all_required_available": all_ok,
            "results": [
                {
                    "name": r["name"],
                    "status": r["status"],
                    "required": r["required"],
                    "path": str(r["path"]),
                    "size_bytes": r["size"],
                    "detail": r["detail"],
                }
                for r in results
            ],
        }
        print(json.dumps(payload, indent=2))
        return 0 if all_ok else 1

    W = max([len(r["name"]) for r in results] + [16])
    print("OCEAN-X Data Status")
    print("=" * (W + 30))
    print(f"{'DATASET'.ljust(W)}  STATUS")
    print("-" * (W + 30))
    for r in results:
        print(f"{r['name'].ljust(W)}  {r['status']}")
        if args.verbose and r["detail"]:
            print(f"{''.ljust(W)}  -> {r['detail']}")
    print("-" * (W + 30))
    for r in required_missing:
        install = manifest_lookup_install_hint(manifest, r["name"])
        print(f"MISSING REQUIRED: {r['name']} -> {r['path']}")
        if install:
            print(f"  fix: {install}")
    print()
    print(f"Required HYCOM data available: {'YES' if all_ok else 'NO'}")
    print(
        f"  required available: {len(required_available)}, "
        f"required missing/invalid: {len(required_missing)}, "
        f"optional: {len(optional)}"
    )
    print()
    if not all_ok:
        print("Some REQUIRED datasets are missing. See data/README.md for installation,")
        print("or run: python scripts/setup-data.py")
    return 0 if all_ok else 1


def manifest_lookup_install_hint(manifest, name):
    for ds in manifest["datasets"]:
        if ds["name"] == name:
            hints = []
            if ds.get("regenerate_command"):
                hints.append(f"regenerate: {ds['regenerate_command']}")
            if ds.get("download_url"):
                hints.append(f"download: {ds['download_url']}")
            if ds.get("manual_install"):
                hints.append(ds["manual_install"])
            return " | ".join(hints)
    return None


if __name__ == "__main__":
    sys.exit(main())
