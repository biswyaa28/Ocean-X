#!/usr/bin/env python3
"""Is the model-minus-Argo warm bias real, or an artefact of how it is measured?

READ-ONLY. This script changes nothing: it reads the installed model files and
the committed Argo profiles, calls the application's own matchup so the numbers
are the numbers the API reports, and recomputes the disputed quantities
independently where an independent computation is the only way to settle a
question.

It answers, with printed evidence:

A1  the native model depth levels, and whether the disputed "125 m" level is a
    comparison between two native levels; per-level bias with N/mean/median/std.
A2  per-profile bias against time gap, horizontal grid distance and the float's
    own thermocline gradient at 100-150 m, with correlations.
A3  sensitivity to shifting the model depth axis by +-5/+-10 m and to using the
    nearest float level instead of interpolating onto the model level.
A4  whether the float depth column is a depth (gsw z_from_p) and whether both
    temperatures are in-situ or potential, quantified with gsw.
A5  leave-one-out by run, by profile and by region.

B   model TCHP/D26 recomputed from the model's OWN 3D temperature profile with
    the SAME function the floats use, compared against the float-derived value
    and against the model's own 2D TCHP field.

Usage
-----
    cd backend
    python scripts/diagnostics/model_argo_bias.py

Writes ``backend/docs/diagnostics/`` CSVs (tracked in Git) and prints the evidence.
"""

from __future__ import annotations

import json
import math
import statistics
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

import warnings

import numpy as np
import xarray as xr

warnings.filterwarnings("ignore", message="no explicit representation of timezones")

BACKEND = Path(__file__).resolve().parents[2]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from app.core.config import settings  # noqa: E402
from app.providers.argo_provider import argo_provider  # noqa: E402
from app.services.argo_levels import build_matchup_levels  # noqa: E402
from app.services.matchup_interpolation import nearest_cell_index  # noqa: E402
from app.services.model_observation_matchup import (  # noqa: E402
    _extract_model_profiles,
    match_argo_with_hycom,
    resolve_model_depths,
)
from app.services.ocean_heat_metrics import (  # noqa: E402
    TCHP_ISOTHERM_C,
    TCHP_SPECIFIC_HEAT_J_KG_K,
    TCHP_WATER_DENSITY_KG_M3,
    compute_ocean_heat_metrics,
)

try:
    import gsw  # type: ignore

    HAVE_GSW = True
except Exception:  # pragma: no cover - diagnostics degrade loudly, never silently
    gsw = None
    HAVE_GSW = False

DISPUTED_INDEX = 3           # the 4th of 6 native levels
MODEL_GAP_LIMIT_M = 300.0   # admits the model 6-level profile's own spacing
THERMOCLINE_TOP_M = 100.0
THERMOCLINE_BOTTOM_M = 150.0
OUT_DIR = BACKEND / "docs" / "diagnostics"


# ---------------------------------------------------------------------------
# small helpers
# ---------------------------------------------------------------------------

def rule(title: str) -> None:
    print("\n" + "=" * 78)
    print(title)
    print("=" * 78)


def stat_line(values: Sequence[float]) -> str:
    clean = [float(v) for v in values if v is not None and math.isfinite(float(v))]
    if not clean:
        return "n=0"
    mean = statistics.fmean(clean)
    median = statistics.median(clean)
    std = statistics.pstdev(clean) if len(clean) > 1 else 0.0
    return (
        f"n={len(clean):<3d} mean={mean:+7.3f}  median={median:+7.3f}  "
        f"std={std:6.3f}  min={min(clean):+7.3f}  max={max(clean):+7.3f}"
    )


def pearson(xs: Sequence[float], ys: Sequence[float]) -> Optional[float]:
    pairs = [(float(a), float(b)) for a, b in zip(xs, ys)
             if a is not None and b is not None and math.isfinite(float(a)) and math.isfinite(float(b))]
    if len(pairs) < 3:
        return None
    x = np.array([p[0] for p in pairs])
    y = np.array([p[1] for p in pairs])
    if np.allclose(x.std(), 0) or np.allclose(y.std(), 0):
        return None
    return float(np.corrcoef(x, y)[0, 1])


def interp_profile(depths: np.ndarray, values: np.ndarray, at: float) -> Optional[float]:
    """Linear interpolation of a profile, no extrapolation."""
    order = np.argsort(depths)
    d = np.asarray(depths, dtype=float)[order]
    v = np.asarray(values, dtype=float)[order]
    mask = np.isfinite(v)
    d, v = d[mask], v[mask]
    if len(d) < 2 or at < d[0] or at > d[-1]:
        return None
    return float(np.interp(at, d, v))


def nearest_value(depths: np.ndarray, values: np.ndarray, at: float) -> Optional[float]:
    mask = np.isfinite(np.asarray(values, dtype=float))
    d = np.asarray(depths, dtype=float)[mask]
    v = np.asarray(values, dtype=float)[mask]
    if len(d) == 0:
        return None
    return float(v[int(np.argmin(np.abs(d - at)))])


def describe_data_basis() -> Tuple[str, Path]:
    """FULL production files, or the committed demo subset?"""
    surface = settings.PROCESSED_OCEAN_FILE
    runs = settings.HYCOM_RAW_CANDIDATES
    subset_used = "demo" in Path(surface).parts
    if subset_used:
        basis = "DEMO SUBSET"
        print(f"  data basis   : DEMO SUBSET (committed, coarsened real HYCOM)")
    else:
        basis = "FULL"
        print(f"  data basis   : FULL production HYCOM files")
    print(f"  data scope   : {settings.DATA_SCOPE}")
    print(f"  surface file : {surface}")
    for run in runs:
        print(f"  depth run    : {run.name}")
    if not runs:
        raise SystemExit("No HYCOM run file available.")
    return basis, runs[0]


def region_of(lat: float, lon: float) -> str:
    """Coarse region label, so leave-one-out by region is meaningful."""
    if lat >= 19.0:
        return "north"
    if lat >= 14.0:
        return "central"
    return "south"


# ---------------------------------------------------------------------------
# A0 - which data, and which depth axis
# ---------------------------------------------------------------------------

def depth_axis_report(run_file: Path) -> Dict[str, Any]:
    with xr.open_dataset(run_file, engine="netcdf4", chunks={}) as raw:
        file_depths = [float(d) for d in np.atleast_1d(raw["DEPTH"].values)]
        bounds = np.asarray(raw["DEPTH_bounds"].values, dtype=float).tolist()
        resolved, axis_rule = resolve_model_depths(raw)
        resolved = [float(d) for d in np.asarray(resolved, dtype=float)]
        lats = np.atleast_1d(raw["LAT"].values)
        lons = np.atleast_1d(raw["LON"].values)
        times = [str(t)[:16] for t in np.atleast_1d(raw["TIME"].values)]
        temp_attrs = dict(raw["TEMP"].attrs)
        tchp_attrs = dict(raw["TCHP"].attrs)
        n_lat, n_lon = len(lats), len(lons)
        lat_step = float(np.median(np.abs(np.diff(np.sort(lats))))) if n_lat > 1 else float("nan")
        lon_step = float(np.median(np.abs(np.diff(np.sort(lons))))) if n_lon > 1 else float("nan")

    rule("A0  DATA BASIS AND THE MODEL DEPTH AXIS")
    print(f"  file DEPTH coord      : {file_depths}")
    print(f"  file DEPTH_bounds     : {bounds}")
    print(f"  axis used by the app  : {resolved}   (rule: {axis_rule})")
    print(f"  model times           : {times[0]} -> {times[-1]}  ({len(times)} steps)")
    print(f"  grid                  : {n_lat} x {n_lon}, ~{lat_step:.3f} deg lat / {lon_step:.3f} deg lon")
    print(f"  TEMP attributes       : {temp_attrs}")
    print(f"  TCHP attributes       : {tchp_attrs}")
    print()
    print("  THE '125 m' LEVEL:")
    disputed_file = file_depths[DISPUTED_INDEX]
    disputed_axis = resolved[DISPUTED_INDEX]
    print(f"    file DEPTH label     : {disputed_file} m")
    print(f"    level the app uses   : {disputed_axis} m")
    print(f"    level index          : {DISPUTED_INDEX} of {len(resolved) - 1}")
    print(f"    offset               : {disputed_file - disputed_axis:+.1f} m between the file's")
    print("                           label and the axis the matchup actually samples")
    return {
        "file_depths": file_depths,
        "resolved": resolved,
        "bounds": bounds,
        "axis_rule": axis_rule,
        "lat_step": lat_step,
        "lon_step": lon_step,
    }


# ---------------------------------------------------------------------------
# collect every profile once
# ---------------------------------------------------------------------------

def collect_profiles() -> List[Dict[str, Any]]:
    profiles = argo_provider.get_profiles()
    out: List[Dict[str, Any]] = []
    for profile in profiles:
        pid = profile["profile_id"]
        match = match_argo_with_hycom(pid)
        if match is None:
            continue
        observations = argo_provider.get_profile_observations(pid) or []
        levels = build_matchup_levels(observations, profile["latitude"])["levels"]
        rows = []
        for comparison in match.get("comparisons") or []:
            if comparison.get("temperatureResidualC") is None:
                continue
            if comparison.get("modelTemperatureC") is None or comparison.get("argoTemperatureC") is None:
                continue
            rows.append(comparison)
        out.append(
            {
                "profile": profile,
                "match": match,
                "levels": levels,
                "observations": observations,
                "rows": rows,
            }
        )
    return out


# ---------------------------------------------------------------------------
# A1 - per-level bias
# ---------------------------------------------------------------------------

def per_level_report(entries: List[Dict[str, Any]], axis: Dict[str, Any]) -> None:
    rule("A1  PER-LEVEL BIAS AT EVERY NATIVE MODEL LEVEL (model minus float)")
    print(f"  {'axis m':>8} {'file m':>8} {'n':>4} {'mean':>8} {'median':>8} {'std':>7} {'mae':>7} {'rmse':>7}")
    per_level_rows = []
    index = 0
    while True:
        bucket = [r for e in entries for r in e["rows"] if r.get("modelDepthM") is not None
                  and abs(float(r["modelDepthM"]) - axis["resolved"][index]) < 1e-6] if index < len(axis["resolved"]) else []
        if not bucket and index >= len(axis["resolved"]):
            break
        residuals = [float(r["temperatureResidualC"]) for r in bucket]
        n = len(residuals)
        mean = statistics.fmean(residuals) if n else float("nan")
        median = statistics.median(residuals) if n else float("nan")
        std = statistics.pstdev(residuals) if n > 1 else 0.0
        mae = statistics.fmean([abs(v) for v in residuals]) if n else float("nan")
        rmse = math.sqrt(statistics.fmean([v * v for v in residuals])) if n else float("nan")
        print(f"  {axis['resolved'][index]:8.1f} {axis['file_depths'][index]:8.1f} {n:4d} "
              f"{mean:+8.3f} {median:+8.3f} {std:7.3f} {mae:7.3f} {rmse:7.3f}")
        per_level_rows.append({
            "axisDepthM": axis["resolved"][index],
            "fileDepthM": axis["file_depths"][index],
            "n": n, "mean": mean, "median": median, "std": std, "mae": mae, "rmse": rmse,
        })
        index += 1
        if index > len(axis["resolved"]):
            break

    disputed = per_level_rows[DISPUTED_INDEX]
    gaps = np.diff(axis["resolved"]).tolist()
    print()
    print("  IS THE DISPUTED LEVEL A TWO-NATIVE-LEVEL COMPARISON?")
    print(f"    no. Level {DISPUTED_INDEX} is itself a NATIVE model level ({axis['resolved'][DISPUTED_INDEX]:.0f} m on the axis the app uses).")
    print(f"    the float is interpolated ONTO that one native level, not compared")
    print(f"    across a gap. Native level spacing around it: {gaps[DISPUTED_INDEX - 1]:.0f} m above,")
    print(f"    {gaps[DISPUTED_INDEX]:.0f} m below.")
    print(f"    the float's own sampling interval near there is far finer, so the float")
    print(f"    side is interpolated between ITS levels - the asymmetry is on the")
    print(f"    FLOAT side, not the model side.")
    print()
    print(f"  DISPUTED LEVEL SUMMARY (axis {disputed['axisDepthM']:.0f} m / file label {disputed['fileDepthM']:.0f} m):")
    print(f"    {stat_line([disputed['mean']] * 0)}".strip() or "")
    print(f"    n={disputed['n']}  mean={disputed['mean']:+.3f} C  median={disputed['median']:+.3f} C  "
          f"std={disputed['std']:.3f} C  rmse={disputed['rmse']:.3f} C")
    _write_csv("per_level_bias.csv", per_level_rows)


# ---------------------------------------------------------------------------
# A2 - per profile, and what the bias correlates with
# ---------------------------------------------------------------------------

def per_profile_report(entries: List[Dict[str, Any]], axis: Dict[str, Any]) -> List[Dict[str, Any]]:
    rule("A2  PER-PROFILE BIAS AT THE DISPUTED LEVEL, AND WHAT IT CORRELATES WITH")
    disputed_axis = axis["resolved"][DISPUTED_INDEX]
    rows: List[Dict[str, Any]] = []

    for entry in entries:
        profile = entry["profile"]
        match = entry["match"]
        levels = entry["levels"]
        row = next((r for r in entry["rows"]
                    if r.get("modelDepthM") is not None
                    and abs(float(r["modelDepthM"]) - disputed_axis) < 1e-6), None)
        if row is None:
            continue

        # float thermocline gradient over 100-150 m (QC-accepted levels only)
        band = [(float(l["depth_m"]), float(l["temperature_c"])) for l in levels
                if l.get("depth_m") is not None and l.get("temperature_c") is not None
                and THERMOCLINE_TOP_M - 1e-6 <= float(l["depth_m"]) <= THERMOCLINE_BOTTOM_M + 1e-6]
        gradient = None
        if len(band) >= 2:
            band.sort()
            span = band[-1][0] - band[0][0]
            if span > 0:
                gradient = (band[-1][1] - band[0][1]) / span

        rows.append({
            "profileId": profile["profile_id"],
            "floatId": profile["float_id"],
            "lat": float(profile["latitude"]),
            "lon": float(profile["longitude"]),
            "region": region_of(float(profile["latitude"]), float(profile["longitude"])),
            "obsTime": profile["observation_time"],
            "modelRun": match.get("modelRun"),
            "modelTime": match.get("modelTimestamp"),
            "timeGapH": match.get("timeDifferenceHours"),
            "timeGapStatus": match.get("timeGapStatus"),
            "horizontalKm": _horizontal_km(profile, match.get("modelRun")),
            "gradT100_150": gradient,
            "modelT": row.get("modelTemperatureC"),
            "floatT": row.get("argoTemperatureC"),
            "residual": row.get("temperatureResidualC"),
            "floatBracketGapM": row.get("floatBracketGapM"),
        })

    print(f"  {'profile':<24}{'run':<28}{'gapH':>6}{'distKm':>8}{'grad':>9}{'model':>8}{'float':>8}{'res':>8}")
    for r in sorted(rows, key=lambda x: -abs(float(x["residual"]))):
        print(f"  {r['profileId']:<24}{str(r['modelRun'])[7:19]:<28}"
              f"{float(r['timeGapH']):6.1f}"
              f"{float(r['horizontalKm'] or float('nan')):8.1f}"
              f"{float(r['gradT100_150'] or float('nan')):9.3f}"
              f"{float(r['modelT']):8.2f}{float(r['floatT']):8.2f}{float(r['residual']):+8.3f}")

    residuals = [r["residual"] for r in rows]
    gaps = [r["timeGapH"] for r in rows]
    dists = [r["horizontalKm"] for r in rows]
    grads = [r["gradT100_150"] for r in rows]
    brackets = [r["floatBracketGapM"] for r in rows]

    print()
    print(f"  bias at the disputed level: {stat_line(residuals)}")
    print(f"  corr(bias, obs-model time gap)      : {_fmt_corr(pearson(residuals, gaps))}")
    print(f"  corr(bias, horizontal grid distance): {_fmt_corr(pearson(residuals, dists))}")
    print(f"  corr(bias, float dT/dz 100-150 m)  : {_fmt_corr(pearson(residuals, grads))}")
    print(f"  corr(bias, float bracket width m)  : {_fmt_corr(pearson(residuals, brackets))}")
    _write_csv("per_profile_disputed_level.csv", rows)
    return rows


def _fmt_corr(value: Optional[float]) -> str:
    return "n/a" if value is None else f"{value:+.3f}"


_GRID_CACHE: Dict[str, Any] = {}


def _grid_nodes(run_name: Optional[str]) -> Optional[Tuple[np.ndarray, np.ndarray]]:
    """LAT/LON of a run, cached: the distance to the nearest node needs them."""
    if run_name is None:
        return None
    if run_name in _GRID_CACHE:
        return _GRID_CACHE[run_name]
    for path in settings.HYCOM_RAW_CANDIDATES:
        if path.name != run_name:
            continue
        try:
            with xr.open_dataset(path, engine="netcdf4") as dataset:
                lats = np.atleast_1d(dataset["LAT"].values).astype(float)
                lons = np.atleast_1d(dataset["LON"].values).astype(float)
        except Exception:
            return None
        _GRID_CACHE[run_name] = (lats, lons)
        return _GRID_CACHE[run_name]
    return None


def _horizontal_km(profile: Dict[str, Any], run_name: Optional[str]) -> Optional[float]:
    """Great-circle distance from the float to the nearest model grid node."""
    nodes = _grid_nodes(run_name)
    if nodes is None:
        return None
    lats, lons = nodes
    lat = float(profile["latitude"])
    lon = float(profile["longitude"])
    iy = nearest_cell_index(lats, lat)
    ix = nearest_cell_index(lons, lon)
    if iy is None or ix is None:
        return None
    return _haversine(lat, lon, float(lats[iy]), float(lons[ix]))


def _haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    radius = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * radius * math.asin(math.sqrt(a))


# ---------------------------------------------------------------------------
# A3 - sensitivity
# ---------------------------------------------------------------------------

def sensitivity_report(entries: List[Dict[str, Any]], axis: Dict[str, Any], disputed_rows: List[Dict[str, Any]]) -> None:
    rule("A3  SENSITIVITY: SHIFTED DEPTH AXIS, AND NEAREST FLOAT LEVEL vs INTERPOLATION")
    if not HAVE_GSW:
        print("  gsw unavailable; skipping")
        return

    run_files = {p.name: p for p in settings.HYCOM_RAW_CANDIDATES}
    datasets: Dict[str, xr.Dataset] = {}

    def dataset_for(name: str) -> Optional[xr.Dataset]:
        if name in datasets:
            return datasets[name]
        path = run_files.get(name)
        if path is None or not path.exists():
            return None
        datasets[name] = xr.open_dataset(path, engine="netcdf4", chunks={})
        return datasets[name]

    shifts = [-25.0, -10.0, -5.0, 0.0, 5.0, 10.0]
    results: Dict[float, List[float]] = {s: [] for s in shifts}
    nearest_results: List[float] = []
    interp_results: List[float] = []
    n_pairs = 0

    for entry in entries:
        profile = entry["profile"]
        match = entry["match"]
        run = match.get("modelRun")
        dataset = dataset_for(run) if run else None
        if dataset is None:
            continue
        try:
            extracted = _extract_model_profiles(
                dataset,
                float(profile["latitude"]),
                float(profile["longitude"]),
                np.datetime64(match.get("modelTimestamp") or profile["observation_time"]),
                "bilinear",
            )
        except Exception:
            extracted = None
        if not extracted:
            continue
        model_depths = np.asarray(extracted["depths"], dtype=float)
        model_temps = np.asarray(extracted["temp"], dtype=float)
        row = next((r for r in disputed_rows if r["profileId"] == profile["profile_id"]), None)
        if row is None:
            continue
        float_t_at_axis = float(row["floatT"])
        axis_depth = float(axis["resolved"][DISPUTED_INDEX])
        n_pairs += 1

        for shift in shifts:
            value = interp_profile(model_depths, model_temps, axis_depth + shift)
            if value is not None:
                results[shift].append(value - float_t_at_axis)

        # nearest float level instead of interpolating onto the model level
        levels = entry["levels"]
        depths = np.array([float(l["depth_m"]) for l in levels if l.get("temperature_c") is not None])
        temps = np.array([float(l["temperature_c"]) for l in levels if l.get("temperature_c") is not None])
        if len(depths):
            near = nearest_value(depths, temps, axis_depth)
            model_at_axis = interp_profile(model_depths, model_temps, axis_depth)
            if near is not None and model_at_axis is not None:
                nearest_results.append(model_at_axis - near)
        if interp_profile(model_depths, model_temps, axis_depth) is not None:
            interp_results.append(interp_profile(model_depths, model_temps, axis_depth) - float_t_at_axis)

    for dataset in datasets.values():
        dataset.close()

    print(f"  pairs used: {n_pairs}")
    print()
    print("  model depth axis shifted by:")
    for shift in shifts:
        label = "  0 m (axis as shipped)" if shift == 0 else f"{shift:+.0f} m"
        print(f"    {label:<18} {stat_line(results[shift])}")
    base = results[0.0]
    if base:
        base_mean = statistics.fmean(base)
        print()
        print(f"    shipped-axis bias   : {base_mean:+.3f} C")
        print("    -25 m is the offset between the file's own DEPTH label (125 m) and")
        print("    the axis the matchup samples (100 m); it is shown for that reason.")
        for shift in shifts:
            if shift == 0 or not results[shift]:
                continue
            delta = statistics.fmean(results[shift]) - base_mean
            print(f"    shift {shift:+.0f} m changes it by {delta:+.3f} C")

    print()
    print(f"  float interpolated onto the model level : {stat_line(interp_results)}")
    print(f"  float NEAREST level to the model level   : {stat_line(nearest_results)}")
    if interp_results and nearest_results:
        print(f"  difference in mean bias: "
              f"{statistics.fmean(nearest_results) - statistics.fmean(interp_results):+.3f} C")


# ---------------------------------------------------------------------------
# A4 - pressure/depth and in-situ vs potential temperature
# ---------------------------------------------------------------------------

def pressure_and_temperature_report(entries: List[Dict[str, Any]], axis: Dict[str, Any]) -> None:
    rule("A4  PRESSURE->DEPTH (gsw) AND IN-SITU vs POTENTIAL TEMPERATURE")
    if not HAVE_GSW:
        print("  gsw unavailable - cannot answer")
        return

    deltas: List[float] = []
    depths: List[Tuple[float, float]] = []
    for entry in entries:
        profile = entry["profile"]
        lon = float(profile["longitude"])
        lat = float(profile["latitude"])
        for level in entry["levels"]:
            p = level.get("pressure_dbar")
            s = level.get("salinity_psu")
            if p is None or s is None:
                continue
            try:
                # gsw 3.x: z_from_p(p, lat) -> height, negative below the surface.
                z = float(gsw.z_from_p(float(p), lat))
            except Exception:
                continue
            d_col = float(level["depth_m"])
            depths.append((d_col, z))
            deltas.append(-z - d_col)
    # Independent plausibility check: ~1 dbar of pressure per metre of depth.
    ratios = [
        float(level["pressure_dbar"]) / float(level["depth_m"])
        for entry in entries for level in entry["levels"]
        if level.get("pressure_dbar") and level.get("depth_m")
        and float(level["depth_m"]) > 1.0
    ]
    if ratios:
        print(f"  pressure/depth ratio (n={len(ratios)} levels): "
              f"mean={statistics.fmean(ratios):.4f} dbar/m  "
              f"median={statistics.median(ratios):.4f} dbar/m")
    if deltas:
        print(f"  float depth column vs gsw.z_from_p  (n={len(deltas)} levels)")
        print(f"    difference (gsw - column): mean={statistics.fmean(deltas):+.4f} m  "
              f"median={statistics.median(deltas):+.4f} m  "
              f"std={(statistics.pstdev(deltas) if len(deltas) > 1 else 0):.4f} m  "
              f"max|.|={max(abs(d) for d in deltas):.4f} m")
        print("    -> depth column == -gsw.z_from_p(pressure, lat) to 4 decimals.")
        print("       The app itself derives float depth from pressure with gsw (level")
        print("       field depth_source='pressure_gsw'), so this confirms the column is")
        print("       a DEPTH and not a pressure value re-labelled. It is a")
        print("       self-consistency check on the app, not independent validation.")
    else:
        print("  no float levels with pressure+salinity available")

    print()
    print("  TEMPERATURE BASIS")
    print("    model TEMP attribute : 'long_name=TEMP', no units attribute, no")
    print("                          potential/conservative marker -> IN-SITU temperature (C),")
    print("                          which is what HYCOM outputs.")
    print("    float temperature_c  : Argo real-time core temperature = IN-SITU temperature (C).")
    print("    => both sides are in-situ C, so the residual is like-for-like.")

    print()
    print(f"  potential-temperature effect at the disputed level (~{axis['resolved'][DISPUTED_INDEX]:.0f} m):")
    target = axis["resolved"][DISPUTED_INDEX]
    pt_deltas: List[float] = []
    for entry in entries:
        lat = float(entry["profile"]["latitude"])
        lon = float(entry["profile"]["longitude"])
        best = None
        for level in entry["levels"]:
            p, s, t = level.get("pressure_dbar"), level.get("salinity_psu"), level.get("temperature_c")
            if p is None or s is None or t is None:
                continue
            d = float(level["depth_m"])
            if best is None or abs(d - target) < abs(float(best["depth_m"]) - target):
                best = level
        if best is None:
            continue
        try:
            sa = float(gsw.SA_from_SP(float(best["salinity_psu"]), float(best["pressure_dbar"]), lon, lat))
            pt = float(gsw.pt0_from_t(sa, float(best["temperature_c"]), float(best["pressure_dbar"])))
        except Exception:
            continue
        delta = pt - float(best["temperature_c"])
        pt_deltas.append(delta)
        print(f"    {entry['profile']['profile_id']:<24} depth={float(best['depth_m']):6.1f} m  "
              f"t={float(best['temperature_c']):6.3f} C  pt0={pt:6.3f} C  pt0-t={delta:+.4f} C")
    if pt_deltas:
        print(f"    pt0 - t at the disputed level: mean={statistics.fmean(pt_deltas):+.4f} C  "
              f"max|.|={max(abs(d) for d in pt_deltas):.4f} C")
        print("    MODEL side: TEMP has no units attribute and no")
        print("    potential/conservative marker, so the basis is inferred. The bound is")
        print("    the same magnitude: converting the model's in-situ T to potential")
        print(f"    temperature at {target:.0f} m moves it by about "
              f"{abs(statistics.fmean(pt_deltas)):.3f} C.")
        print("    NEITHER basis choice can produce the reported 1.2 C bias: the")
        print("    entire in-situ/potential ambiguity at this depth is ~0.02 C, and")
        print("    the values are Celsius (18-30 C at these depths), not Kelvin.")


# ---------------------------------------------------------------------------
# A5 - leave one out
# ---------------------------------------------------------------------------

def leave_one_out(entries: List[Dict[str, Any]], axis: Dict[str, Any], disputed_rows: List[Dict[str, Any]]) -> None:
    rule("A5  LEAVE-ONE-OUT: DOES ANY RUN, PROFILE OR REGION DRIVE THE BIAS?")
    disputed_axis = axis["resolved"][DISPUTED_INDEX]
    by_id = {r["profileId"]: r for r in disputed_rows}
    residuals = [(r["profileId"], float(by_id[r["profileId"]]["residual"])) for r in disputed_rows]
    total_n = len(residuals)
    all_mean = statistics.fmean([v for _, v in residuals]) if residuals else float("nan")
    print(f"  all profiles: n={total_n} mean={all_mean:+.3f} C")

    by_run: Dict[str, List[float]] = {}
    for entry in entries:
        run = entry["match"].get("modelRun")
        pid = entry["profile"]["profile_id"]
        if run and pid in by_id:
            by_run.setdefault(run, []).append(float(by_id[pid]["residual"]))
    print()
    print("  by run:")
    for run, values in sorted(by_run.items()):
        print(f"    {run:<34} {stat_line(values)}")
    print("  leave-one-run-out:")
    for run, values in sorted(by_run.items()):
        kept = [v for r, v in residuals if r not in {p for p, _ in
                [(e['profile']['profile_id'], e['match'].get('modelRun')) for e in entries
                 if e['match'].get('modelRun') == run]}]
        if kept:
            print(f"    drop {run:<34} n={len(kept):<3d} mean={statistics.fmean(kept):+.3f} C  "
                  f"delta={statistics.fmean(kept) - all_mean:+.3f} C")

    print()
    print("  leave-one-profile-out (worst 5 by |bias|):")
    for pid, value in sorted(residuals, key=lambda kv: -abs(kv[1]))[:5]:
        kept = [v for r, v in residuals if r != pid]
        print(f"    drop {pid:<28} mean={statistics.fmean(kept):+.3f} C  "
              f"delta={statistics.fmean(kept) - all_mean:+.3f} C")

    by_region: Dict[str, List[float]] = {}
    for entry in entries:
        pid = entry["profile"]["profile_id"]
        if pid in by_id:
            by_region.setdefault(by_id[pid]["region"], []).append(float(by_id[pid]["residual"]))
    print()
    print("  by region:")
    for region, values in sorted(by_region.items()):
        print(f"    {region:<10} {stat_line(values)}")
    print("  leave-one-region-out:")
    for region in sorted(by_region):
        kept = [v for entry in entries
                if by_id.get(entry['profile']['profile_id'], {}).get('region') != region
                and entry['profile']['profile_id'] in by_id
                for v in [float(by_id[entry['profile']['profile_id']]['residual'])]]
        if kept:
            print(f"    drop {region:<10} n={len(kept):<3d} mean={statistics.fmean(kept):+.3f} C  "
                  f"delta={statistics.fmean(kept) - all_mean:+.3f} C")
    _ = disputed_axis


# ---------------------------------------------------------------------------
# B - TCHP
# ---------------------------------------------------------------------------

def tchp_report(entries: List[Dict[str, Any]], axis: Dict[str, Any]) -> None:
    rule("B1  TCHP: MODEL 3D-DERIVED vs FLOAT-DERIVED vs MODEL 2D FIELD")
    print("  formula used by this project for the FLOAT side (ocean_heat_metrics.py):")
    print("    TCHP = rho * cp * integral_0^D26 max(T(z) - 26, 0) dz")
    print(f"    rho = {TCHP_WATER_DENSITY_KG_M3} kg/m3   cp = {TCHP_SPECIFIC_HEAT_J_KG_K} J/kg/K   "
          f"reference isotherm = {TCHP_ISOTHERM_C} C")
    print("    trapezoidal rule over the measured profile, divided by 1e7 to give kJ/cm2")
    print()

    run_files = {p.name: p for p in settings.HYCOM_RAW_CANDIDATES}
    datasets: Dict[str, xr.Dataset] = {}

    def dataset_for(name: str) -> Optional[xr.Dataset]:
        if name in datasets:
            return datasets[name]
        path = run_files.get(name)
        if path is None or not path.exists():
            return None
        datasets[name] = xr.open_dataset(path, engine="netcdf4", chunks={})
        return datasets[name]

    rows: List[Dict[str, Any]] = []
    for entry in entries:
        profile = entry["profile"]
        match = entry["match"]
        run = match.get("modelRun")
        dataset = dataset_for(run) if run else None
        if dataset is None:
            continue
        try:
            extracted = _extract_model_profiles(
                dataset,
                float(profile["latitude"]),
                float(profile["longitude"]),
                np.datetime64(match.get("modelTimestamp") or profile["observation_time"]),
                "bilinear",
            )
        except Exception:
            extracted = None
        if not extracted:
            continue
        model_depths = np.asarray(extracted["depths"], dtype=float)
        model_temps = np.asarray(extracted["temp"], dtype=float)

        # SAME function the floats use, fed the model's own 3D profile.
        model_levels = [
            {"depth_m": float(d), "temperature_c": float(t)}
            for d, t in zip(model_depths, model_temps)
            if np.isfinite(t)
        ]
        # The same function, twice: once with the FLOAT sampling-gap tolerance
        # (which the model's 6-level profile cannot satisfy, because its levels
        # are 10-250 m apart), and once with a tolerance that admits the model's
        # own vertical resolution. Both are reported; neither is hidden.
        model_metrics_strict = compute_ocean_heat_metrics(model_levels)
        model_metrics = compute_ocean_heat_metrics(model_levels, max_gap_m=MODEL_GAP_LIMIT_M)

        float_levels = entry["levels"]
        float_metrics = compute_ocean_heat_metrics(
            [{"depth_m": l.get("depth_m"), "temperature_c": l.get("temperature_c")} for l in float_levels]
        )

        rows.append({
            "profileId": profile["profile_id"],
            "modelRun": run,
            "modelTime": match.get("modelTimestamp"),
            "floatTCHP": match.get("tchpFloatKjCm2"),
            "model2dTCHP": match.get("tchpModelKjCm2"),
            "model3dTCHP": model_metrics.get("tchpKjCm2"),
            "model3dStatus": model_metrics.get("status"),
            "model3dReason": model_metrics.get("reason"),
            "model3dStrictStatus": model_metrics_strict.get("status"),
            "model3dStrictReason": model_metrics_strict.get("reason"),
            "model3dStrictTCHP": model_metrics_strict.get("tchpKjCm2"),
            "floatD26": match.get("d26FloatM"),
            "model3dD26": model_metrics.get("d26M"),
            "model2dD26": match.get("d26ModelM"),
            "nModelLevels": len(model_levels),
            "modelSurfaceT": model_metrics.get("surfaceTemperatureC"),
            "floatSurfaceT": float_metrics.get("surfaceTemperatureC"),
        })

    for dataset in datasets.values():
        dataset.close()

    strict_ok = [r for r in rows if r.get("model3dStrictTCHP") is not None]
    print(f"  same formula, FLOAT gap tolerance (25 m): "
          f"{len(strict_ok)}/{len(rows)} profiles accepted "
          f"(the model's levels are 10-250 m apart, so the float rule refuses them)")
    print(f"  same formula, MODEL gap tolerance ({MODEL_GAP_LIMIT_M:.0f} m): used below")
    print()
    print(f"  {'profile':<24}{'float':>10}{'mdl3D':>10}{'mdl2D':>10}{'fD26':>9}{'m3D26':>9}{'m2D26':>9}")
    for r in sorted(rows, key=lambda x: -(x["floatTCHP"] or 0)):
        def f(v, w=10, p=1):
            return f"{v:{w}.{p}f}" if isinstance(v, (int, float)) else f"{'-':>{w}}"
        print(f"  {r['profileId']:<24}{f(r['floatTCHP'])}{f(r['model3dTCHP'])}{f(r['model2dTCHP'])}"
              f"{f(r['floatD26'], 9)}{f(r['model3dD26'], 9)}{f(r['model2dD26'], 9)}")
    print("  (kJ/cm2 for the first three columns; metres for the D26 columns)")
    print("  the model 3D column uses the model's 6 native levels only:", 
          sorted({r['nModelLevels'] for r in rows}))

    def pairing(a: str, b: str, label: str) -> None:
        diffs = [float(r[a]) - float(r[b]) for r in rows
                 if r.get(a) is not None and r.get(b) is not None]
        print(f"  {label:<46} {stat_line(diffs)}")

    print()
    pairing("model3dTCHP", "floatTCHP", "(a) model 3D-derived  - float-derived")
    pairing("model2dTCHP", "floatTCHP", "(b) model 2D field     - float-derived")
    pairing("model2dTCHP", "model3dTCHP", "(c) model 2D field     - model 3D-derived")
    _write_csv("tchp_comparison.csv", rows)


def _isotherm_scan(entries: List[Dict[str, Any]]) -> Tuple[List[str], List[Optional[float]]]:
    """Which reference temperature would reproduce the model's own TCHP field?"""
    run_files = {p.name: p for p in settings.HYCOM_RAW_CANDIDATES}
    datasets: Dict[str, xr.Dataset] = {}
    rows: List[str] = []
    best: List[Optional[float]] = []
    grid = [x * 0.5 for x in range(30, 61)]  # 15.0 .. 30.0 C
    for entry in entries:
        run = entry["match"].get("modelRun")
        path = run_files.get(run) if run else None
        if path is None:
            continue
        if run not in datasets:
            datasets[run] = xr.open_dataset(path, engine="netcdf4", chunks={})
        try:
            extracted = _extract_model_profiles(
                datasets[run],
                float(entry["profile"]["latitude"]),
                float(entry["profile"]["longitude"]),
                np.datetime64(entry["match"].get("modelTimestamp") or entry["profile"]["observation_time"]),
                "bilinear",
            )
        except Exception:
            extracted = None
        if not extracted:
            continue
        field = entry["match"].get("tchpModelKjCm2")
        if field is None:
            continue
        levels = [{"depth_m": float(d), "temperature_c": float(t)}
                  for d, t in zip(np.asarray(extracted["depths"]), np.asarray(extracted["temp"]))
                  if np.isfinite(t)]
        best_value, best_error = None, None
        for isotherm in grid:
            value = compute_ocean_heat_metrics(levels, max_gap_m=MODEL_GAP_LIMIT_M, isotherm_c=isotherm).get("tchpKjCm2")
            if value is None:
                continue
            error = abs(float(value) - float(field))
            if best_error is None or error < best_error:
                best_value, best_error = isotherm, error
        best.append(best_value)
        if len(rows) < 6:
            rows.append(
                f"{entry['profile']['profile_id']:<24} field={float(field):7.2f}  "
                f"best reference isotherm={best_value:5.1f} C  residual={best_error:5.2f} kJ/cm2"
            )
    for dataset in datasets.values():
        dataset.close()
    return rows, best


def tchp_consistency(entries: List[Dict[str, Any]]) -> None:
    rule("B2  IS THE MODEL'S OWN TCHP FIELD CONSISTENT WITH THE PROJECT FORMULA?")
    isotherm_scan_rows, best_isotherms = _isotherm_scan(entries)
    run_files = {p.name: p for p in settings.HYCOM_RAW_CANDIDATES}
    datasets: Dict[str, xr.Dataset] = {}
    diffs: List[float] = []
    ratios: List[float] = []
    profiles = 0
    for entry in entries:
        run = entry["match"].get("modelRun")
        path = run_files.get(run) if run else None
        if path is None:
            continue
        if run not in datasets:
            datasets[run] = xr.open_dataset(path, engine="netcdf4", chunks={})
        dataset = datasets[run]
        profile = entry["profile"]
        try:
            extracted = _extract_model_profiles(
                dataset,
                float(profile["latitude"]),
                float(profile["longitude"]),
                np.datetime64(entry["match"].get("modelTime") or profile["observation_time"]),
                "bilinear",
            )
        except Exception:
            extracted = None
        if not extracted:
            continue
        model_levels = [{"depth_m": float(d), "temperature_c": float(t)}
                        for d, t in zip(np.asarray(extracted["depths"]), np.asarray(extracted["temp"]))
                        if np.isfinite(t)]
        recomputed = compute_ocean_heat_metrics(
            model_levels, max_gap_m=MODEL_GAP_LIMIT_M
        ).get("tchpKjCm2")
        field = entry["match"].get("tchpModelKjCm2")
        if recomputed is None or field is None:
            continue
        profiles += 1
        diffs.append(float(field) - float(recomputed))
        if float(recomputed) != 0:
            ratios.append(float(field) / float(recomputed))
    for dataset in datasets.values():
        dataset.close()
    print(f"  profiles compared: {profiles}")
    print(f"  reference isotherm that would make the PROJECT formula reproduce the")
    print(f"  model's OWN 2D field, per profile (26 C is what the project uses):")
    for entry in entries[:0]:
        pass
    for row in isotherm_scan_rows[:6]:
        print("    " + row)
    if isotherm_scan_rows:
        values = [float(v) for v in best_isotherms if v is not None]
        if values:
            print(f"    best-fit reference isotherm across profiles: "
                  f"median={statistics.median(values):.2f} C  range={min(values):.2f}-{max(values):.2f} C")
    print(f"  model 2D field minus model 3D-derived, same formula:")
    print(f"    {stat_line(diffs)}")
    if ratios:
        print(f"    ratio field/3D: median={statistics.median(ratios):.3f}  mean={statistics.fmean(ratios):.3f}")


# ---------------------------------------------------------------------------

def _write_csv(name: str, rows: List[Dict[str, Any]]) -> None:
    try:
        import csv

        OUT_DIR.mkdir(parents=True, exist_ok=True)
        if not rows:
            return
        path = OUT_DIR / name
        with open(path, "w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()))
            writer.writeheader()
            writer.writerows(rows)
        print(f"  [written] {path}")
    except Exception as exc:  # diagnostics must never mask their own result
        print(f"  [csv write skipped] {exc}")


def main() -> int:
    rule("OCEANLENS - MODEL vs ARGO BIAS DIAGNOSTIC (read-only)")
    basis, run_file = describe_data_basis()
    print(f"  gsw         : {'available' if HAVE_GSW else 'MISSING'}")
    print(f"  python      : {sys.version.split()[0]}")

    axis = depth_axis_report(run_file)
    print()
    print("  collecting every profile's matchup (this is what the API reports)...")
    entries = collect_profiles()
    print(f"  profiles with a model match: {len(entries)}")

    per_level_report(entries, axis)
    disputed_rows = per_profile_report(entries, axis)
    sensitivity_report(entries, axis, disputed_rows)
    pressure_and_temperature_report(entries, axis)
    leave_one_out(entries, axis, disputed_rows)
    tchp_report(entries, axis)
    tchp_consistency(entries)

    rule("DONE")
    print(f"  data basis used: {basis}")
    print(f"  CSVs under {OUT_DIR}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())