#!/usr/bin/env python3
"""OCEAN-X dataset setup tool.

Reads data/manifest.json and helps bring a fresh clone to a working state
without committing large scientific datasets to Git.

Usage:
    python scripts/setup-data.py              # status + instructions (safe, no download)
    python scripts/setup-data.py --check      # same as above, exit 1 if required data missing
    python scripts/setup-data.py --download   # download datasets that have a configured
                                              # public source (asks for confirmation first;
                                              # the HYCOM source is ~9.85 GB)
    python scripts/setup-data.py --download --dataset HYCOM_RSMC_RAW   # limit to one dataset
    python scripts/setup-data.py --download --yes                     # no confirmation prompt
    python scripts/setup-data.py --process    # regenerate derived datasets after download
                                              # (runs backend/scripts/extract_hycom_bob.py)
    python scripts/setup-data.py --ibtracs   # compare the committed IBTrACS snapshot against
                                              # the current NOAA revision (never overwrites)

Only datasets with a verified 'download_url' in the manifest are downloadable.
Everything else is reported with manual installation instructions.
"""

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
import urllib.error
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MANIFEST = REPO_ROOT / "data" / "manifest.json"
BACKEND_VENV_PYTHON = REPO_ROOT / "backend" / ".venv" / "bin" / "python"
BACKEND_DIR = REPO_ROOT / "backend"

CHUNK_SIZE = 1024 * 1024  # 1 MiB


def human_size(num_bytes):
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if num_bytes < 1024 or unit == "TB":
            return f"{num_bytes:.2f} {unit}" if unit != "B" else f"{int(num_bytes)} B"
        num_bytes /= 1024


def load_manifest():
    with open(DEFAULT_MANIFEST, "r", encoding="utf-8") as f:
        return json.load(f)


def resolve_path(ds):
    p = Path(ds["local_path"])
    return p if p.is_absolute() else (REPO_ROOT / p)


def confirm(prompt):
    try:
        answer = input(f"{prompt} [y/N] ").strip().lower()
    except (EOFError, KeyboardInterrupt):
        return False
    return answer in ("y", "yes")


def download_file(url, dest: Path, expected_bytes=None):
    """Stream a file to disk with resume support. Returns True on success."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    partial_bytes = dest.stat().st_size if dest.exists() else 0

    headers = {"User-Agent": "oceanx-setup/1.0"}
    if partial_bytes > 0:
        headers["Range"] = f"bytes={partial_bytes}-"

    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            status = resp.status
            if status == 206 and partial_bytes > 0:
                mode = "ab"
                print(f"  resuming from {human_size(partial_bytes)} ({partial_bytes} bytes)")
            elif status == 200 and partial_bytes > 0:
                # Server ignored Range; restart from scratch.
                mode = "wb"
                partial_bytes = 0
                print("  server does not support resume; restarting download")
            elif status == 200:
                mode = "wb"
            else:
                print(f"  unexpected HTTP status {status}")
                return False

            total = resp.headers.get("Content-Length")
            total = int(total) + partial_bytes if total else None
            downloaded = partial_bytes
            start_time = time.time()
            last_report = 0.0

            with open(dest, mode) as f:
                while True:
                    chunk = resp.read(CHUNK_SIZE)
                    if not chunk:
                        break
                    f.write(chunk)
                    downloaded += len(chunk)
                    if total and time.time() - last_report > 5.0:
                        pct = downloaded / total * 100
                        rate = (downloaded - partial_bytes) / max(time.time() - start_time, 1e-6)
                        print(
                            f"  {human_size(downloaded)} / {human_size(total)} "
                            f"({pct:.1f}%, {human_size(rate)}/s)",
                            end="\r",
                        )
                        last_report = time.time()
            print(f"  downloaded {human_size(downloaded)}{' ' * 30}")
    except urllib.error.HTTPError as exc:
        print(f"  HTTP error: {exc.code} {exc.reason}")
        return False
    except Exception as exc:
        print(f"  download error: {exc}")
        print("  partial file preserved; re-run to resume.")
        return False

    actual = dest.stat().st_size
    if expected_bytes and actual < expected_bytes * 0.95:
        print(
            f"  WARNING: file is {human_size(actual)} but ~{human_size(expected_bytes)} was expected;"
            " it may be truncated. Re-run to resume."
        )
        return False
    return True


def run_extractor():
    """Regenerate the processed surface dataset using the backend environment."""
    script = BACKEND_DIR / "scripts" / "extract_hycom_bob.py"
    if not script.exists():
        print(f"ERROR: extractor not found: {script}")
        return False
    py = str(BACKEND_VENV_PYTHON) if BACKEND_VENV_PYTHON.exists() else sys.executable
    if BACKEND_VENV_PYTHON.exists():
        print(f"Using backend venv python: {py}")
    else:
        print(f"Backend venv not found; using current interpreter: {py}")
        print("(It must have xarray + netCDF4 installed.)")
    result = subprocess.run([py, str(script)], cwd=str(BACKEND_DIR))
    return result.returncode == 0


def sha256_of(path: Path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for block in iter(lambda: fh.read(CHUNK_SIZE), b""):
            h.update(block)
    return h.hexdigest()


def cmd_ibtracs(manifest):
    """Compare the committed IBTrACS snapshot against the current NOAA revision.

    Read-only by construction. The committed file is the canonical snapshot that
    every clone shares, so this fetches upstream to a temporary file and reports
    the difference. It never writes to the dataset path, whatever the outcome.
    """
    ds = next((d for d in manifest["datasets"] if d["name"] == "IBTrACS_NI"), None)
    if ds is None:
        print("IBTrACS_NI is not present in the manifest.", file=sys.stderr)
        return 1

    url = ds.get("upstream_url")
    if not url:
        print("IBTrACS_NI has no upstream_url in the manifest.", file=sys.stderr)
        return 1

    local = resolve_path(ds)
    committed_sha = ds.get("snapshot_sha256")
    print("IBTrACS_NI snapshot comparison")
    print("=" * 70)
    print(f"  committed : {local}")
    print(f"  snapshot  : {ds.get('snapshot_date', 'unknown')}  {committed_sha}")
    print(f"  upstream  : {url}")
    print()

    if not local.exists():
        print(f"ERROR: committed snapshot is missing at {local}", file=sys.stderr)
        print("       /cyclones, /hazards and /risk have no tracks to serve.", file=sys.stderr)
        print("       Upstream no longer serves these bytes, so see data/README.md",
              file=sys.stderr)
        return 1

    actual = sha256_of(local)
    if committed_sha and actual != committed_sha:
        print(f"WARNING: the committed file does not match its recorded checksum.", file=sys.stderr)
        print(f"         recorded : {committed_sha}", file=sys.stderr)
        print(f"         on disk  : {actual}", file=sys.stderr)
        print("         The snapshot was modified outside its recorded provenance.",
              file=sys.stderr)

    print(f"Fetching current NOAA revision to a temporary file (~27 MB)...")
    tmp_dir = tempfile.mkdtemp(prefix="oceanx-ibtracs-")
    tmp = Path(tmp_dir) / Path(url).name
    try:
        if not download_file(url, tmp, ds.get("approx_size_bytes")):
            print(f"ERROR: could not fetch {url}", file=sys.stderr)
            return 1
        upstream_sha = sha256_of(tmp)
        upstream_rows = sum(1 for _ in open(tmp, "rb"))
        local_rows = sum(1 for _ in open(local, "rb"))

        print()
        print(f"  committed : {actual}  ({human_size(local.stat().st_size)}, {local_rows:,} rows)")
        print(f"  upstream  : {upstream_sha}  ({human_size(tmp.stat().st_size)}, {upstream_rows:,} rows)")
        print()

        if actual == upstream_sha:
            print("MATCH: the committed snapshot is identical to the current NOAA revision.")
            return 0

        print("DIFFERENT: the committed snapshot and the current NOAA revision diverge.")
        print()
        print("  Nothing has been changed. The committed copy is the canonical one:")
        print("  every clone gets these exact storms, and the same numbers on screen.")
        print()
        print("  NOAA revises IBTrACS in place, so this URL returns a newer revision")
        print("  and no longer serves the committed bytes. The committed snapshot")
        print("  therefore cannot be reproduced by re-downloading.")
        print()
        print("  Adopting the newer revision is a deliberate act, because it changes the")
        print("  dataset the /cyclones, /hazards and /risk endpoints serve. To do it:")
        print()
        print(f"    1. cp {local} <backup>")
        print(f"    2. cp {tmp} {local}")
        print(f"    3. update snapshot_date and snapshot_sha256 in data/manifest.json")
        print("       and the provenance table in data/README.md")
        print("    4. re-run the backend test suite")
        print()
        print(f"  fetched copy kept for inspection: {tmp}")
        return 0
    finally:
        if not tmp.exists():
            shutil.rmtree(tmp_dir, ignore_errors=True)


def main():
    parser = argparse.ArgumentParser(
        description="OCEAN-X dataset setup tool",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__.split("Usage:")[1] if "Usage:" in __doc__ else None,
    )
    parser.add_argument("--check", action="store_true", help="report status and exit (exit 1 if required data is missing)")
    parser.add_argument("--download", action="store_true", help="download datasets that have a configured public source (confirmation required)")
    parser.add_argument("--process", action="store_true", help="regenerate derived datasets (run the HYCOM extractor)")
    parser.add_argument("--ibtracs", action="store_true", help="compare the committed IBTrACS snapshot against the current NOAA revision (never overwrites)")
    parser.add_argument(
        "--archive-runs",
        action="store_true",
        help="archive a Bay-of-Bengal NCSS subset of every published INCOIS RSMC HYCOM run "
             "(see scripts/archive_hycom_runs.py); INCOIS deletes older runs",
    )
    parser.add_argument("--dataset", action="append", help="restrict action to the given dataset name(s); repeatable")
    parser.add_argument("--yes", "-y", action="store_true", help="assume 'yes' at confirmation prompts")
    args = parser.parse_args()

    if args.archive_runs:
        # Delegated to the dedicated archiver: it needs the publisher catalogue
        # and per-run NCSS requests, which do not fit the manifest's one-URL model.
        archiver = REPO_ROOT / "scripts" / "archive_hycom_runs.py"
        cmd = [sys.executable, str(archiver)] + (["--force"] if args.yes else [])
        print("OCEAN-X Model-Run Archiver")
        print("=" * 60)
        return subprocess.call(cmd, cwd=str(REPO_ROOT))

    manifest = load_manifest()
    if args.ibtracs:
        return cmd_ibtracs(manifest)
    datasets = manifest["datasets"]
    if args.dataset:
        names = set(args.dataset)
        unknown = names - {d["name"] for d in datasets}
        if unknown:
            print(f"ERROR: unknown dataset name(s): {', '.join(sorted(unknown))}")
            print(f"Available: {', '.join(d['name'] for d in datasets)}")
            return 2
        datasets = [d for d in datasets if d["name"] in names]

    print("OCEAN-X Data Setup")
    print("=" * 60)

    downloadable_missing = []
    for ds in datasets:
        path = resolve_path(ds)
        exists = path.exists()
        size = human_size(path.stat().st_size) if exists else "-"
        flag = "present" if exists else "MISSING"
        req = "required" if ds.get("required") else "optional"
        print(f"[{flag:>7}] {ds['name']} ({req}, {ds['category']})")
        print(f"          path: {path}")
        print(f"          size: {size}")
        if not exists:
            if ds.get("download_url"):
                print(f"          download source: {ds['download_url']}")
                downloadable_missing.append(ds)
            elif ds.get("regenerate_command"):
                print(f"          regenerate: {ds['regenerate_command']}")
            if ds.get("manual_install"):
                print(f"          install:    {ds['manual_install']}")
        print()

    if args.check:
        missing_required = [
            d for d in datasets if d.get("required") and not resolve_path(d).exists()
        ]
        if missing_required:
            print(f"Required data missing: {', '.join(d['name'] for d in missing_required)}")
            return 1
        print("All required datasets present.")
        return 0

    if args.download:
        if not downloadable_missing:
            print("Nothing to download: no missing dataset has an automatic download source.")
            print("(Datasets without a download_url must be installed manually - see above.)")
        else:
            print("The following datasets can be downloaded automatically:")
            for ds in downloadable_missing:
                size = ds.get("approx_size_bytes")
                size_str = f" (~{human_size(size)})" if size else ""
                print(f"  - {ds['name']}{size_str}")
                print(f"    from: {ds['download_url']}")
            print()
            print("NOTE: these are LARGE scientific files. The HYCOM source is ~9.85 GB.")
            print("Downloading may take a long time depending on your connection.")
            proceed = args.yes or confirm("Proceed with download?")
            if not proceed:
                print("Aborted. No files were downloaded.")
                return 0
            ok = True
            for ds in downloadable_missing:
                dest = resolve_path(ds)
                print(f"Downloading {ds['name']} -> {dest}")
                if not download_file(ds["download_url"], dest, ds.get("approx_size_bytes")):
                    ok = False
            if ok:
                print("\nDownloads finished.")
                print("Next step - regenerate the processed surface dataset:")
                print("  python scripts/setup-data.py --process")
            return 0 if ok else 1

    if args.process:
        raw_ds = next((d for d in datasets if d["name"] == "HYCOM_RSMC_RAW"), None)
        surface_ds = next((d for d in datasets if d["name"] == "HYCOM_BOB_SURFACE"), None)
        if surface_ds is None:
            print("ERROR: HYCOM_BOB_SURFACE not present in manifest; nothing to process.")
            return 2
        if raw_ds and not resolve_path(raw_ds).exists():
            print(f"ERROR: raw HYCOM dataset is missing: {resolve_path(raw_ds)}")
            print("Download it first: python scripts/setup-data.py --download --dataset HYCOM_RSMC_RAW")
            return 1
        print("Running the HYCOM Bay of Bengal extractor...")
        return 0 if run_extractor() else 1

    # Default: instructions
    print("What to do next:")
    print("  1. Check status anytime:            python scripts/check-data.py")
    if any(d.get("download_url") and not resolve_path(d).exists() for d in datasets):
        print("  2. Download available datasets:    python scripts/setup-data.py --download")
        print("     (HYCOM raw is ~9.85 GB; you will be asked to confirm)")
    if any(d.get("regenerate_command") and not resolve_path(d).exists() for d in datasets):
        print("  3. Regenerate derived datasets:    python scripts/setup-data.py --process")
    print("  4. Re-run tests:                   cd backend && python -m pytest tests/")
    print()
    print("Datasets without an automatic source must be installed manually -")
    print("see data/README.md and data/manifest.json for every path and origin.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
