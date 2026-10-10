"""Tests for the depth axis sensitivity check script.

Verifies that:
1. The script runs end-to-end and produces the expected CSV artifact.
2. The default setting (settings.MODEL_DEPTH_AXIS and OCEANX_MODEL_DEPTH_AXIS)
   is strictly unchanged before and after the script executes.
3. The CSV contains rows for both axes with all required columns.
4. The evaluation results under the default axis match the standard matchup summary.
"""

import csv
import os
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPTS_DIR = REPO_ROOT / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import depth_axis_sensitivity
from app.api.endpoints import get_argo_matchup_summary
from app.core.config import settings


def test_default_setting_unchanged_after_script_runs(tmp_path):
    """Confirm the default setting is unchanged after running the sensitivity script."""
    initial_setting = settings.MODEL_DEPTH_AXIS
    initial_env = os.environ.get("OCEANX_MODEL_DEPTH_AXIS")

    assert initial_setting == "native"

    # Run the script end to end
    depth_axis_sensitivity.main()

    # Verify settings and environment are identical to initial state
    assert settings.MODEL_DEPTH_AXIS == initial_setting
    assert os.environ.get("OCEANX_MODEL_DEPTH_AXIS") == initial_env


def test_csv_output_contains_both_axes_and_required_columns():
    """Verify that results/depth_axis_sensitivity.csv contains rows for both axes."""
    csv_path = REPO_ROOT / "results" / "depth_axis_sensitivity.csv"
    assert csv_path.is_file(), f"Expected CSV file at {csv_path}"

    with open(csv_path, mode="r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames
        assert fieldnames == ["axis", "variable", "level", "rmse", "mae", "n_obs"]
        rows = list(reader)

    axes = {row["axis"] for row in rows}
    assert "ncss_file" in axes
    assert "native" in axes

    variables = {row["variable"] for row in rows}
    assert {"temperature", "salinity"}.issubset(variables)

    for axis in ("ncss_file", "native"):
        for var in ("temperature", "salinity"):
            axis_var_levels = {
                row["level"]
                for row in rows
                if row["axis"] == axis and row["variable"] == var
            }
            assert "overall" in axis_var_levels
            for idx in range(6):
                assert str(idx) in axis_var_levels


def test_sensitivity_matches_existing_evaluation():
    """Verify that the sensitivity evaluation reuses existing summary maths."""
    direct_summary = get_argo_matchup_summary()
    script_native_summary = depth_axis_sensitivity.run_evaluation_for_axis("native")

    assert script_native_summary["overall"]["temperature"]["rmse"] == direct_summary["overall"]["temperature"]["rmse"]
    assert script_native_summary["overall"]["salinity"]["rmse"] == direct_summary["overall"]["salinity"]["rmse"]
    assert script_native_summary["includedProfileCount"] == direct_summary["includedProfileCount"]
