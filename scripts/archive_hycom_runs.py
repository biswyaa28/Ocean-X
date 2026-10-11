#!/usr/bin/env python3
"""Archive Bay-of-Bengal subsets of the INCOIS RSMC HYCOM forecast runs.

INCOIS rotates this product: only the ~5 most recent runs are published and
older ones are deleted. The full run is ~10.58 GB, but OCEAN-X only ever reads
the Bay of Bengal (5-25 N, 80-100 E), so each run is archived as a ~90 MB
NetCDFSubset (NCSS) of the genuine published file.

Why subset rather than full download: 5 x 10.58 GB = 53 GB and ~10 h at the
observed 1-1.5 MB/s, versus 5 x 90 MB in minutes. The subset keeps the real
run's native depth axis, grid resolution, time steps and variable values, so
every schema/integration test and every matchup exercises real model output.

Usage:
    python scripts/archive_hycom_runs.py                # every published run
    python scripts/archive_hycom_runs.py --runs 20261007 20261008
    python scripts/archive_hycom_runs.py --list          # show what is published

Re-running is safe: an existing, readable subset of the right size is skipped
unless --force is passed.
"""

import argparse
import json
import re
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = REPO_ROOT / "backend" / "data" / "raw" / "ocean" / "currents"
MANIFEST = REPO_ROOT / "data" / "manifest.json"

CATALOG_URL = "https://incois.gov.in/thredds/catalog/osf/currents2/catalog.xml"
NCSS_BASE = "https://incois.gov.in/thredds/ncss/grid/osf/currents2"

VARIABLES = ["TEMP", "SALN", "UVEL", "VVEL", "SSH", "TCHP", "MLD"]
MIN_LAT, MAX_LAT = 5.0, 25.0
MIN_LON, MAX_LON = 80.0, 100.0

# Each published run is a 7-day window of 6-hourly steps covering
# [runDate - 1 day 06Z, runDate + 6 days 00Z] (verified against the catalogue).
# The window below is deliberately far wider than that so NCSS returns each
# run's COMPLETE available coverage - clipping it would silently discard the
# forecast tail of the later runs.
DEFAULT_TIME_START = "2026-01-01T00:00:00Z"
DEFAULT_TIME_END = "2027-12-31T23:59:59Z"

# The run/coverage relationship the publisher uses, documented so the archive's
# provenance can be interpreted without re-probing upstream.
RUN_WINDOW_NOTE = (
    "Each RSMC HYCOM run is a 7-day, 6-hourly window covering "
    "[runDate - 1 day 06Z, runDate + 6 days 00Z]; the run is produced about two "
    "hours after the nominal cycle date, so the first steps are analysis/nowcast "
    "and later steps are forecast with lead time up to ~7 days."
)


def published_runs():
    """(run_date, filename) for every RSMC_hycom run currently published."""
    with urllib.request.urlopen(CATALOG_URL, timeout=120) as response:
        xml = response.read().decode("utf-8", errors="replace")
    runs = []
    for match in re.finditer(r'<dataset name="(RSMC_hycom_(\d{8})\.nc)"', xml):
        runs.append((match.group(2), match.group(1)))
    return sorted(set(runs))


def subset_path(run_date):
    return OUT_DIR / f"RSMC_hycom_{run_date}_bob_subset.nc"


def build_url(filename, time_start, time_end):
    query = urllib.parse.urlencode(
        [("var", name) for name in VARIABLES]
        + [
            ("north", MAX_LAT),
            ("south", MIN_LAT),
            ("east", MAX_LON),
            ("west", MIN_LON),
            ("horizStride", 1),
            ("verticalStride", 1),
            ("time_start", time_start),
            ("time_end", time_end),
            ("dataset", filename),
        ]
    )
    # NCSS takes the dataset in the path, not as a query parameter.
    query = query.replace("&dataset=" + filename, "")
    return f"{NCSS_BASE}/{filename}?{query}"


def is_readable_netcdf(path):
    if not path.exists() or path.stat().st_size < 1_000_000:
        return False
    try:
        out = subprocess.run(
            [sys.executable, "-c",
             "import xarray as xr,sys;d=xr.open_dataset(sys.argv[1]);"
             "print(len(d.TIME), len(d.DEPTH))"],
            capture_output=True, text=True, timeout=180, cwd=str(REPO_ROOT / "backend"),
        )
        return out.returncode == 0
    except Exception:
        return False


def describe(path):
    """Structural summary of an archived subset."""
    sys.path.insert(0, str(REPO_ROOT / "backend"))
    import numpy as np
    import xarray as xr

    with xr.open_dataset(path) as ds:
        times = np.atleast_1d(ds["TIME"].values)
        depths = [float(d) for d in np.atleast_1d(ds["DEPTH"].values)]
        steps = np.diff(times.astype("datetime64[s]").astype("int64")) / 3600.0
        return {
            "timeStart": str(times[0]),
            "timeEnd": str(times[-1]),
            "timeStepHours": float(np.median(steps)) if len(steps) else None,
            "timeSteps": int(len(times)),
            "depthLevelsM": depths,
            "latCount": int(len(ds["LAT"])),
            "lonCount": int(len(ds["LON"])),
            "variables": sorted(str(v) for v in ds.data_vars),
            "bytes": path.stat().st_size,
        }


def download(run_date, filename, time_start, time_end, force, attempts=3):
    target = subset_path(run_date)
    if not force and is_readable_netcdf(target):
        print(f"  {filename}: already archived ({target.stat().st_size / 1e6:.1f} MB) - skipping")
        return target
    url = build_url(filename, time_start, time_end)
    target.parent.mkdir(parents=True, exist_ok=True)

    for attempt in range(1, attempts + 1):
        # Download to a scratch file and rename on success. INCOIS drops the
        # connection part-way through multi-hundred-MB responses, and writing
        # straight to the final name would leave a truncated file that the
        # matchup then tries to open as a real run.
        scratch = target.with_suffix(".nc.part")
        print(f"  {filename}: fetching Bay-of-Bengal subset (attempt {attempt}/{attempts}) ...")
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "oceanx-setup/1.0"})
            with urllib.request.urlopen(request, timeout=1800) as response:
                with open(scratch, "wb") as handle:
                    while True:
                        chunk = response.read(1 << 20)
                        if not chunk:
                            break
                        handle.write(chunk)
            if scratch.stat().st_size < 1_000_000:
                raise OSError(f"response too small ({scratch.stat().st_size} bytes)")
            scratch.replace(target)
            print(f"  {filename}: wrote {target.name} ({target.stat().st_size / 1e6:.1f} MB)")
            return target
        except Exception as error:
            print(f"  {filename}: attempt {attempt} failed: {type(error).__name__}: {error}")
            scratch.unlink(missing_ok=True)
    print(f"  {filename}: FAILED after {attempts} attempts - {target.name} NOT updated")
    return None


def record_provenance(entries):
    """Merge the archived runs into data/manifest.json.

    The archive is a rolling operation: INCOIS publishes only the most recent
    runs, so every invocation sees a DIFFERENT subset of what is already on
    disk. This manifest is the provenance record of every subset ever fetched,
    so an entry for a run this invocation did not touch has to survive it.
    Replacing the list outright dropped every run fetched by an earlier session
    the moment a newer run was archived, which is how the record of the
    20261004-20261008 subsets was lost when 20261011 was fetched.

    Entries are keyed by runDate: a run handled again is updated in place, a run
    not handled is left untouched, and the result is sorted by run date so the
    list reads chronologically however the runs were fetched.
    """
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    existing = next(
        (d for d in manifest["datasets"] if d["name"] == "HYCOM_RSMC_RAW_SUBSETS"),
        None,
    )

    merged: Dict[str, Dict[str, Any]] = {}
    for entry in (existing or {}).get("archived_runs") or []:
        run_date = entry.get("runDate")
        if run_date:
            merged[run_date] = entry
    for entry in entries:
        run_date = entry.get("runDate")
        if run_date:
            merged[run_date] = entry
    ordered = [merged[run_date] for run_date in sorted(merged)]

    # Start from the existing dataset entry so fields added by a later version
    # of this script are not silently dropped, then refresh the descriptive ones.
    dataset = dict(existing) if existing else {}
    dataset.update({
        "name": "HYCOM_RSMC_RAW_SUBSETS",
        "category": "local-scientific",
        "required": False,
        "purpose": (
            "Archived Bay-of-Bengal NetCDFSubsets of every INCOIS RSMC HYCOM run "
            "currently published, so matchups can select the run whose time window "
            "covers an Argo profile. INCOIS deletes older runs."
        ),
        "local_path": "backend/data/raw/ocean/currents/RSMC_hycom_<YYYYMMDD>_bob_subset.nc",
        "format": "NetCDF4 (CF-1.6 grid, cut with the INCOIS THREDDS NCSS service)",
        "source": "INCOIS Ocean State Forecast THREDDS server (RSMC HYCOM currents product)",
        "source_url": CATALOG_URL,
        "download_url": NCSS_BASE,
        "auto_download": False,
        "regenerate_command": "python scripts/archive_hycom_runs.py",
        "region": {"min_lat": MIN_LAT, "max_lat": MAX_LAT, "min_lon": MIN_LON, "max_lon": MAX_LON},
        "variables": VARIABLES,
        "archived_runs": ordered,
        "provenance_note": (
            "Genuine INCOIS model output restricted to the Bay of Bengal by the "
            "publisher's own NetcdfSubset service; native depth axis, grid and "
            "time steps are unchanged. Never committed to Git."
        ),
    })

    datasets = [d for d in manifest["datasets"] if d["name"] != "HYCOM_RSMC_RAW_SUBSETS"]
    datasets.append(dataset)
    manifest["datasets"] = datasets
    MANIFEST.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"  recorded {len(entries)} run(s) in data/manifest.json "
          f"({len(ordered)} archived in total)")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runs", nargs="*", default=None, help="run dates as YYYYMMDD")
    parser.add_argument("--list", action="store_true", help="list published runs and exit")
    parser.add_argument("--force", action="store_true", help="re-download existing subsets")
    parser.add_argument("--time-start", default=DEFAULT_TIME_START)
    parser.add_argument("--time-end", default=DEFAULT_TIME_END)
    parser.add_argument("--no-manifest", action="store_true")
    args = parser.parse_args()

    print("Checking the INCOIS catalogue for published RSMC HYCOM runs ...")
    available = published_runs()
    if not available:
        print("No published runs found.")
        return 1
    for run_date, filename in available:
        print(f"  {filename}")

    if args.list:
        return 0

    targets = available
    if args.runs:
        wanted = set(args.runs)
        targets = [item for item in available if item[0] in wanted]
        missing = wanted - {item[0] for item in available}
        if missing:
            print(f"Requested run(s) no longer published upstream: {sorted(missing)}")

    print(f"\nArchiving {len(targets)} run(s) as Bay-of-Bengal subsets "
          f"({args.time_start} .. {args.time_end}) ...")
    entries = []
    for run_date, filename in targets:
        path = download(run_date, filename, args.time_start, args.time_end, args.force)
        if path is None:
            continue
        summary = describe(path)
        entries.append({"runDate": run_date, "filename": path.name, **{
            k: v for k, v in summary.items() if k != "variables"
        }, "variables": VARIABLES})
        print(f"    coverage {summary['timeStart']} .. {summary['timeEnd']} "
              f"step={summary['timeStepHours']}h n={summary['timeSteps']} "
              f"depths={summary['depthLevelsM']}")

    if entries and not args.no_manifest:
        record_provenance(entries)

    total = sum(e["bytes"] for e in entries)
    print(f"\nArchived {len(entries)} run(s), {total / 1e6:.1f} MB total.")
    return 0


if __name__ == "__main__":
    sys.exit(main())