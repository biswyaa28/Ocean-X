#!/usr/bin/env python3
"""Sensitivity check of evaluation metrics under different depth axis configurations.

Compares model-vs-observation evaluation metrics between:
- "ncss_file" (legacy, using the NetCDF's own stored DEPTH coordinate)
- "native" (default, matching the producer's raw file)

This script is purely a sensitivity analysis to observe how metrics shift under
each axis definition. It makes no claim regarding which axis is physically or
experimentally correct.
"""

from __future__ import annotations

import csv
import os
import sys
from pathlib import Path
from typing import Any, Dict, List

# Ensure backend package is on sys.path
REPO_ROOT = Path(__file__).resolve().parents[1]
BACKEND_DIR = REPO_ROOT / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.api.endpoints import get_argo_matchup_summary
from app.core.config import settings

OUTPUT_CSV = REPO_ROOT / "results" / "depth_axis_sensitivity.csv"


def run_evaluation_for_axis(axis_name: str) -> Dict[str, Any]:
    """Run the existing matchup evaluation pipeline for a given depth axis.

    Temporarily configures the axis setting and restores original state in a
    finally block.
    """
    old_axis = settings.MODEL_DEPTH_AXIS
    old_env = os.environ.get("OCEANX_MODEL_DEPTH_AXIS")
    try:
        settings.MODEL_DEPTH_AXIS = axis_name
        os.environ["OCEANX_MODEL_DEPTH_AXIS"] = axis_name
        return get_argo_matchup_summary()
    finally:
        settings.MODEL_DEPTH_AXIS = old_axis
        if old_env is None:
            os.environ.pop("OCEANX_MODEL_DEPTH_AXIS", None)
        else:
            os.environ["OCEANX_MODEL_DEPTH_AXIS"] = old_env


def build_csv_rows(
    file_summary: Dict[str, Any], alt_summary: Dict[str, Any]
) -> List[Dict[str, Any]]:
    """Format evaluation results into CSV rows with columns:

    axis, variable, level, rmse, mae, n_obs
    """
    rows: List[Dict[str, Any]] = []

    axes_data = [
        ("ncss_file", file_summary),
        ("native", alt_summary),
    ]

    for axis_label, summary in axes_data:
        overall = summary.get("overall", {})
        by_depth = summary.get("byModelDepth", [])

        for var in ("temperature", "salinity"):
            # Overall row
            var_overall = overall.get(var, {})
            rows.append({
                "axis": axis_label,
                "variable": var,
                "level": "overall",
                "rmse": var_overall.get("rmse"),
                "mae": var_overall.get("mae"),
                "n_obs": var_overall.get("n", 0),
            })

            # Per-level rows (by vertical level index 0..N-1)
            for idx, level_entry in enumerate(by_depth):
                var_level = level_entry.get(var, {})
                rows.append({
                    "axis": axis_label,
                    "variable": var,
                    "level": str(idx),
                    "rmse": var_level.get("rmse"),
                    "mae": var_level.get("mae"),
                    "n_obs": var_level.get("n", 0),
                })

    return rows


def print_comparison_table(
    file_summary: Dict[str, Any], alt_summary: Dict[str, Any]
) -> None:
    """Print header and markdown comparison table to stdout."""
    # Mandatory header line (exact text required by specification)
    print("SENSITIVITY CHECK ONLY. Not evidence for either depth axis.")
    print()

    file_depths = [entry.get("modelDepthM") for entry in file_summary.get("byModelDepth", [])]
    alt_depths = [entry.get("modelDepthM") for entry in alt_summary.get("byModelDepth", [])]

    file_by_depth = file_summary.get("byModelDepth", [])
    alt_by_depth = alt_summary.get("byModelDepth", [])
    file_overall = file_summary.get("overall", {})
    alt_overall = alt_summary.get("overall", {})

    print("| Level | Depth (ncss_file / native) | Variable | NCSS File RMSE | Native RMSE | Diff RMSE (Native - NCSS File) | NCSS File MAE | Native MAE | Diff MAE (Native - NCSS File) | N (NCSS File / Native) |")
    print("| :--- | :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |")

    for var in ("temperature", "salinity"):
        var_label = var.capitalize()

        # Overall row
        f_ov = file_overall.get(var, {})
        a_ov = alt_overall.get(var, {})
        f_rmse = f_ov.get("rmse")
        a_rmse = a_ov.get("rmse")
        f_mae = f_ov.get("mae")
        a_mae = a_ov.get("mae")
        diff_rmse = (a_rmse - f_rmse) if (a_rmse is not None and f_rmse is not None) else None
        diff_mae = (a_mae - f_mae) if (a_mae is not None and f_mae is not None) else None
        n_str = f"{f_ov.get('n', 0)} / {a_ov.get('n', 0)}"

        diff_rmse_str = f"{diff_rmse:+.4f}" if diff_rmse is not None else "N/A"
        diff_mae_str = f"{diff_mae:+.4f}" if diff_mae is not None else "N/A"
        f_rmse_str = f"{f_rmse:.4f}" if f_rmse is not None else "N/A"
        a_rmse_str = f"{a_rmse:.4f}" if a_rmse is not None else "N/A"
        f_mae_str = f"{f_mae:.4f}" if f_mae is not None else "N/A"
        a_mae_str = f"{a_mae:.4f}" if a_mae is not None else "N/A"

        print(
            f"| Overall | — | {var_label} | {f_rmse_str} | {a_rmse_str} | {diff_rmse_str} | {f_mae_str} | {a_mae_str} | {diff_mae_str} | {n_str} |"
        )

        # Level rows
        num_levels = max(len(file_by_depth), len(alt_by_depth))
        for idx in range(num_levels):
            f_entry = file_by_depth[idx].get(var, {}) if idx < len(file_by_depth) else {}
            a_entry = alt_by_depth[idx].get(var, {}) if idx < len(alt_by_depth) else {}
            f_depth = f"{file_depths[idx]:g} m" if idx < len(file_depths) else "N/A"
            a_depth = f"{alt_depths[idx]:g} m" if idx < len(alt_depths) else "N/A"
            depth_str = f"{f_depth} / {a_depth}"

            f_rmse = f_entry.get("rmse")
            a_rmse = a_entry.get("rmse")
            f_mae = f_entry.get("mae")
            a_mae = a_entry.get("mae")
            diff_rmse = (a_rmse - f_rmse) if (a_rmse is not None and f_rmse is not None) else None
            diff_mae = (a_mae - f_mae) if (a_mae is not None and f_mae is not None) else None
            n_str = f"{f_entry.get('n', 0)} / {a_entry.get('n', 0)}"

            diff_rmse_str = f"{diff_rmse:+.4f}" if diff_rmse is not None else "N/A"
            diff_mae_str = f"{diff_mae:+.4f}" if diff_mae is not None else "N/A"
            f_rmse_str = f"{f_rmse:.4f}" if f_rmse is not None else "N/A"
            a_rmse_str = f"{a_rmse:.4f}" if a_rmse is not None else "N/A"
            f_mae_str = f"{f_mae:.4f}" if f_mae is not None else "N/A"
            a_mae_str = f"{a_mae:.4f}" if a_mae is not None else "N/A"

            print(
                f"| Level {idx} | {depth_str} | {var_label} | {f_rmse_str} | {a_rmse_str} | {diff_rmse_str} | {f_mae_str} | {a_mae_str} | {diff_mae_str} | {n_str} |"
            )


def main() -> None:
    # 1. Run evaluation twice (once for ncss_file, once for native)
    file_summary = run_evaluation_for_axis("ncss_file")
    alt_summary = run_evaluation_for_axis("native")

    # 2. Write CSV
    OUTPUT_CSV.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = ["axis", "variable", "level", "rmse", "mae", "n_obs"]
    rows = build_csv_rows(file_summary, alt_summary)
    with open(OUTPUT_CSV, mode="w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    # 3. Print markdown comparison table to stdout
    print_comparison_table(file_summary, alt_summary)


if __name__ == "__main__":
    main()

