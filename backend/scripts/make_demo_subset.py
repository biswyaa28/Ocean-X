#!/usr/bin/env python3
"""Build the committed demo subset from the installed real HYCOM files.

Why this exists
---------------
The production INCOIS runs are ~378 MB each and are not in git, so a fresh
clone has no ocean data at all and the app has nothing to show. This script
produces ``backend/data/demo/``: a **subsample of the real files** that is
small enough to commit. It is real INCOIS output — no synthetic values, no
interpolation, no invented timestamps. The only operations are taking every
N-th element and keeping some times.

What is thinned
---------------
* horizontal grid (default every 4th point in LAT and LON),
* the TIME axis (default every 4th step = 24 h),
* nothing else: DEPTH levels, variables and values are kept as published.

Every kept number is the number the publisher wrote, at the index it was
written at. The output records its origin in the global attributes
``subset_of``, ``subset_method``, ``source_filename``, ``time_steps_kept`` and
``time_steps_source``.

Usage
-----
    python scripts/make_demo_subset.py                 # default thinning
    python scripts/make_demo_subset.py --lat-stride 2 # a finer demo
    python scripts/make_demo_subset.py --dry-run       # report sizes only
    python scripts/make_demo_subset.py --depth-run RSMC_hycom_20261004_bob_subset.nc

The demo directory layout mirrors the production one so the provider's normal
path resolution finds it with no configuration:

    backend/data/demo/processed/ocean/incois_hycom_bob_surface.nc
    backend/data/demo/raw/ocean/currents/RSMC_hycom_<date>_bob_subset.nc
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Dict, List, Optional, Sequence

import numpy as np
import xarray as xr

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from app.core import config  # noqa: E402
from app.core.config import settings  # noqa: E402

# Size budget. The target is what we aim for; the hard limit is what we refuse
# to write, because a larger artifact stops being "committable demo data".
TARGET_MB = 40.0
HARD_LIMIT_MB = 60.0

# The variables the application reads. Anything else in the source (e.g. the
# *_bounds helper variables) is kept when present so the depth axis can still
# be reconstructed exactly as it is from the full file.
KEPT_VARIABLES = ("TEMP", "SALN", "UVEL", "VVEL", "SSH", "MLD", "TCHP")


class SubsetTooLarge(RuntimeError):
    """The output exceeded the hard size limit, so it must not be committed."""


def select_time_indices(n_times: int, time_step: int) -> List[int]:
    """Indices of the time steps to keep, every ``time_step``-th.

    The newest step is always kept: Live mode shows the most recent model
    state, and a subset that ended a day early would understate it.
    """
    if n_times <= 0:
        return []
    step = max(1, int(time_step))
    indices = list(range(0, n_times, step))
    if indices[-1] != n_times - 1:
        indices.append(n_times - 1)
    return indices


def coarsen(
    dataset: xr.Dataset,
    lat_stride: int,
    lon_stride: int,
    time_indices: Sequence[int],
) -> xr.Dataset:
    """Subsample in LAT/LON/TIME. DEPTH and every value are left untouched."""
    lat_stride = max(1, int(lat_stride))
    lon_stride = max(1, int(lon_stride))
    times = dataset.isel(TIME=list(time_indices))
    # Explicit index arrays: `isel` slices carry no stride, and the point of
    # this function is to take whole source points and nothing in between.
    return times.isel(
        LAT=np.arange(0, dataset.sizes["LAT"], lat_stride),
        LON=np.arange(0, dataset.sizes["LON"], lon_stride),
    )


def _ordinal(value: int) -> str:
    """1 -> 1st, 2 -> 2nd, 4 -> 4th. Used only in the provenance string."""
    value = int(value)
    if 10 <= value % 100 <= 20:
        suffix = "th"
    else:
        suffix = {1: "st", 2: "nd", 3: "rd"}.get(value % 10, "th")
    return f"{value}{suffix}"


def demo_attrs(
    source_attrs: Dict,
    source_filename: str,
    lat_stride: int,
    lon_stride: int,
    time_indices: Sequence[int],
    source_times: int,
) -> Dict:
    """Source attributes plus the record of what was thinned and why."""
    lat_stride = max(1, int(lat_stride))
    lon_stride = max(1, int(lon_stride))
    method = (
        f"coarsened real HYCOM subset: every {_ordinal(lat_stride)} LAT and "
        f"{_ordinal(lon_stride)} LON grid point, {len(time_indices)} of "
        f"{int(source_times)} time steps kept; values subsampled only, never "
        "interpolated, averaged or replaced"
    )
    attrs = dict(source_attrs or {})
    attrs.update(
        subset_of=source_filename,
        subset_method=method,
        source_filename=source_filename,
        time_steps_kept=int(len(time_indices)),
        time_steps_source=int(source_times),
        # REAL output at lower resolution — the single most important thing to
        # get right here. A "synthetic" flag would make the app hide it.
        data_status="REAL",
    )
    attrs.pop("synthetic", None)
    return attrs


def write_demo_dataset(
    dataset: xr.Dataset,
    destination: Path,
    attrs: Dict,
    compression_level: int = 4,
) -> Path:
    """Write a float32, zlib-compressed copy of ``dataset`` to ``destination``."""
    destination.parent.mkdir(parents=True, exist_ok=True)
    encoded = dataset.astype({name: "float32" for name in dataset.data_vars})
    encoding: Dict[str, Dict] = {}
    for name, variable in encoded.variables.items():
        if name in encoded.coords:
            continue
        encoding[name] = {
            "zlib": True,
            "complevel": compression_level,
            "shuffle": True,
            "dtype": "float32",
        }
    encoded = encoded.assign_attrs(attrs)
    encoded.to_netcdf(
        destination,
        format="NETCDF4",
        encoding=encoding,
        unlimited_dims=None,
    )
    return destination


def enforce_budget(
    written: Sequence[Path], target_mb: float = TARGET_MB, hard_mb: float = HARD_LIMIT_MB
) -> Dict:
    """Refuse to leave an over-hard-limit artifact behind; report the rest."""
    sizes = {path: path.stat().st_size for path in written}
    total_mb = sum(sizes.values()) / (1024 * 1024)
    if total_mb > hard_mb:
        for path in written:
            path.unlink(missing_ok=True)
        raise SubsetTooLarge(
            f"demo subset is {total_mb:.1f} MB, over the {hard_mb:.0f} MB hard limit; "
            "thin it further (--lat-stride/--lon-stride/--time-step) and retry."
        )
    return {
        "files": {path.name: round(size / (1024 * 1024), 2) for path, size in sizes.items()},
        "total_mb": round(total_mb, 2),
        "target_mb": target_mb,
        "over_target": total_mb > target_mb,
        "within_hard_limit": True,
    }


def _describe(dataset: xr.Dataset, label: str) -> str:
    times = [str(t)[:16] for t in dataset["TIME"].values]
    return (
        f"  {label}: {dataset.sizes['TIME']} time step(s), "
        f"{dataset.sizes.get('DEPTH', 1)} depth level(s), "
        f"{dataset.sizes['LAT']}x{dataset.sizes['LON']} grid"
        f" ({times[0] if times else '—'} → {times[-1] if times else '—'})"
    )


def build(
    surface_source: Optional[Path] = None,
    depth_source: Optional[Path] = None,
    demo_dir: Optional[Path] = None,
    lat_stride: int = 4,
    lon_stride: int = 4,
    surface_lat_stride: int = 1,
    surface_lon_stride: int = 1,
    time_step: int = 4,
    compression_level: int = 4,
    dry_run: bool = False,
) -> Dict:
    """Build both demo files and return a summary of what was written."""
    surface_source = surface_source or settings.PROCESSED_OCEAN_FILE
    demo_dir = demo_dir or settings.DEMO_DIR
    if depth_source is None:
        candidates = settings.HYCOM_RAW_CANDIDATES
        if not candidates:
            raise SystemExit(
                "No HYCOM run file found. Install the production data first "
                "(see data/README.md) — this script thins real files, it never "
                "creates them."
            )
        depth_source = candidates[0]

    if not surface_source.exists():
        raise SystemExit(f"Surface file not found: {surface_source}")
    if not depth_source.exists():
        raise SystemExit(f"Depth run file not found: {depth_source}")

    surface_dst = demo_dir / "processed" / "ocean" / "incois_hycom_bob_surface.nc"
    depth_dst = demo_dir / config.HYCOM_CURRENTS_DIR / depth_source.name

    written: List[Path] = []
    report: Dict[str, Dict] = {}

    with xr.open_dataset(surface_source, engine="netcdf4", chunks={}) as source:
        surface_ds = coarsen(
            source,
            surface_lat_stride,
            surface_lon_stride,
            list(range(source.sizes["TIME"])),
        )
        surface_attrs = demo_attrs(
            dict(source.attrs),
            source_filename=surface_source.name,
            lat_stride=surface_lat_stride,
            lon_stride=surface_lon_stride,
            time_indices=list(range(source.sizes["TIME"])),
            source_times=source.sizes["TIME"],
        )
        report["surface"] = {
            "source": str(surface_source),
            "destination": str(surface_dst),
            "detail": _describe(surface_ds, "surface"),
        }
        if not dry_run:
            write_demo_dataset(surface_ds, surface_dst, surface_attrs, compression_level)
            written.append(surface_dst)

    with xr.open_dataset(depth_source, engine="netcdf4", chunks={}) as source:
        keep = select_time_indices(source.sizes["TIME"], time_step)
        depth_ds = coarsen(source, lat_stride, lon_stride, keep)
        depth_ds = depth_ds.drop_vars(
            [name for name in KEPT_VARIABLES if name not in depth_ds.data_vars],
            errors="ignore",
        )
        depth_attrs = demo_attrs(
            dict(source.attrs),
            source_filename=depth_source.name,
            lat_stride=lat_stride,
            lon_stride=lon_stride,
            time_indices=keep,
            source_times=source.sizes["TIME"],
        )
        report["depth"] = {
            "source": str(depth_source),
            "destination": str(depth_dst),
            "kept_time_indices": keep,
            "detail": _describe(depth_ds, "depth"),
        }
        if not dry_run:
            write_demo_dataset(depth_ds, depth_dst, depth_attrs, compression_level)
            written.append(depth_dst)

    summary: Dict = {"demo_dir": str(demo_dir), "dry_run": dry_run, **report}
    if not dry_run:
        summary["size"] = enforce_budget(written)
    return summary


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--depth-run", default=None, help="file name of the run to thin")
    parser.add_argument("--surface-file", default=None)
    parser.add_argument("--demo-dir", default=None)
    parser.add_argument("--lat-stride", type=int, default=4, help="keep every Nth LAT point")
    parser.add_argument("--lon-stride", type=int, default=4, help="keep every Nth LON point")
    parser.add_argument("--surface-lat-stride", type=int, default=1)
    parser.add_argument("--surface-lon-stride", type=int, default=1)
    parser.add_argument("--time-step", type=int, default=4, help="keep every Nth time step")
    parser.add_argument("--compression-level", type=int, default=4)
    parser.add_argument("--dry-run", action="store_true", help="report the plan, write nothing")
    args = parser.parse_args(argv)

    depth_source = (
        REPO_ROOT / "data" / "raw" / "ocean" / "currents" / args.depth_run
        if args.depth_run
        else None
    )
    summary = build(
        surface_source=Path(args.surface_file) if args.surface_file else None,
        depth_source=depth_source,
        demo_dir=Path(args.demo_dir) if args.demo_dir else None,
        lat_stride=args.lat_stride,
        lon_stride=args.lon_stride,
        surface_lat_stride=args.surface_lat_stride,
        surface_lon_stride=args.surface_lon_stride,
        time_step=args.time_step,
        compression_level=args.compression_level,
        dry_run=args.dry_run,
    )

    print(f"demo dir: {summary['demo_dir']}")
    for key in ("surface", "depth"):
        entry = summary[key]
        print(f"{entry['source']} -> {entry['destination']}")
        print(entry["detail"])
        if "kept_time_indices" in entry:
            print(f"  kept time indices: {entry['kept_time_indices']}")
    if "size" in summary:
        size = summary["size"]
        print(f"total: {size['total_mb']} MB (target {size['target_mb']} MB)")
        for name, megabytes in size["files"].items():
            print(f"  {name}: {megabytes} MB")
        if size["over_target"]:
            print(
                f"WARNING: over the {size['target_mb']} MB target but within the hard "
                "limit. Thin further with --lat-stride/--lon-stride/--time-step."
            )
    else:
        print("dry run — nothing written")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())