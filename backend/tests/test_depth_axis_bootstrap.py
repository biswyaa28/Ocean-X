"""Tests for the depth-axis paired bootstrap helper.

The bootstrap is only worth reporting if it is deterministic and if it
degenerates correctly. Two properties matter:

1. Reproducibility. A confidence interval that moves between runs of the same
   script cannot be compared against anything, including itself a day later.
   The seed is therefore part of the contract, not an implementation detail.
2. Degeneracy. If both axes produce IDENTICAL per-profile errors, the difference
   must be exactly zero and the interval must contain zero. An interval that
   excluded zero in that case would mean the resampling itself -- not the data --
   had manufactured an apparent axis effect.
"""

import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPTS_DIR = REPO_ROOT / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import depth_axis_bootstrap


LEFT_SQ = [1.0, 4.0, 9.0, 16.0, 0.25]
RIGHT_SQ = [0.5, 2.0, 3.0, 4.0, 0.1]


def test_fixed_seed_gives_reproducible_output():
    first = depth_axis_bootstrap.bootstrap_difference(LEFT_SQ, RIGHT_SQ, resamples=500, seed=7)
    second = depth_axis_bootstrap.bootstrap_difference(LEFT_SQ, RIGHT_SQ, resamples=500, seed=7)

    assert first == second
    mean, low, high = first
    assert mean is not None and low is not None and high is not None
    assert low <= mean <= high


def test_identical_errors_give_a_difference_of_zero_and_a_ci_containing_zero():
    errors = [1.0, 2.0, 3.0, 4.0]

    mean, low, high = depth_axis_bootstrap.bootstrap_difference(
        errors, list(errors), resamples=500, seed=7
    )

    assert mean == 0.0
    assert low <= 0.0 <= high


def test_empty_or_mismatched_input_reports_nothing_rather_than_a_number():
    assert depth_axis_bootstrap.bootstrap_difference([], []) == (None, None, None)
    assert depth_axis_bootstrap.bootstrap_difference([1.0], [1.0, 2.0]) == (None, None, None)


def test_running_the_axis_switch_leaves_the_default_depth_axis_untouched():
    # Assert against the settings object the context manager actually mutates.
    # tests/test_data_mode.py calls importlib.reload(app.core.config), which
    # rebinds app.core.config.settings to a NEW object; a function-local import
    # would resolve the reloaded module and compare two different objects. The
    # env var is process-global, so it is checked independently of any reload.
    before_setting = depth_axis_bootstrap.settings.MODEL_DEPTH_AXIS
    before_env = os.environ.get("OCEANX_MODEL_DEPTH_AXIS")

    with depth_axis_bootstrap.depth_axis("ncss_file"):
        assert depth_axis_bootstrap.settings.MODEL_DEPTH_AXIS == "ncss_file"
        assert os.environ["OCEANX_MODEL_DEPTH_AXIS"] == "ncss_file"

    assert depth_axis_bootstrap.settings.MODEL_DEPTH_AXIS == before_setting
    assert os.environ.get("OCEANX_MODEL_DEPTH_AXIS") == before_env