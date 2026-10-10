"""Ocean heat-content metrics from a single float temperature profile.

Tropical Cyclone Heat Potential (TCHP) and the 26 C isotherm depth (D26) are the
two numbers a cyclone-potential forecast actually consumes. They are derived
here from the same QC-accepted float levels the temperature matchup uses, so
the float-side TCHP and the float-side 125 m temperature come from one sample
and cannot disagree about which observations were trusted.

Definitions used, stated explicitly because they are choices, not facts
------------------------------------------------------------------
TCHP is the ocean heat content above the 26 C isotherm, per unit area:

    TCHP = rho * cp * integral_0^D26 max(T(z) - 26, 0) dz

integrated by the trapezoidal rule over the measured profile and reported in
kJ/cm2, the unit the model's own TCHP field uses. 1 kJ/cm2 = 1e7 J/m2, so the
J/m2 integral is divided by 1e7. rho and cp are held at fixed standard values
rather than being computed from the profile's own salinity, because the model's
TCHP field does not publish its own rho/cp choice (see
``TCHP_DEFINITION_STATUS``), and a float-derived number using different
constants than the model would make the residual uninterpretable. Holding them
fixed is the conservative choice: it is the simplest defensible definition, and
its limitation is stated rather than hidden.

D26 is the depth of the DEEPEST downward crossing from >= 26 C to < 26 C,
located by linear interpolation between the two bracketing measured levels. If
the profile warms again below that depth and crosses 26 C again, the deepest
crossing wins, because that is the depth below which the water is no longer
cyclone-supporting.

Every rejection returns ``(None, reason)``. The reasons are machine-readable
strings so the API can pass them through and the UI can explain a missing value
instead of showing a blank or a zero. A rejected profile NEVER returns 0.0 for
TCHP: "we could not measure this" and "there is no heat here" are different
claims, and conflating them is how a validation number becomes fiction.
"""

from __future__ import annotations

from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

# --- physical constants ----------------------------------------------------

# Sea-water density of reference used by the heat-content integral, kg/m3.
# 1026 is the conventional open-ocean value used for tropical heat content.
TCHP_WATER_DENSITY_KG_M3 = 1026.0

# Specific heat capacity of sea water, J/kg/K. 3985 is the standard constant
# (3985 J/kg/K ~ 4000); it is the value paired with 1026 kg/m3 in the usual
# ocean heat content literature.
TCHP_SPECIFIC_HEAT_J_KG_K = 3985.0

# 1 kJ/cm2 = 1e7 J/m2. The integral is in J/m2, so divide by this to get kJ/cm2.
J_PER_M2_PER_KJ_PER_CM2 = 1.0e7

# --- metric definitions ----------------------------------------------------

# The isotherm that bounds the cyclone-relevant warm layer.
TCHP_ISOTHERM_C = 26.0

# The shallowest accepted float sample may stand in for the surface only when it
# is at or above this depth. A float's first CTD reading is typically 1-5 m down
# because the instrument must be wet before it can measure, so without this a
# warm tropical profile would be rejected for missing "0 m".
METRICS_MAX_SURFACE_DEPTH_M = 10.0

# Largest gap tolerated between consecutive accepted samples inside the warm
# layer. A float can miss levels (QC rejection, a pump failure, a transmit gap);
# integrating straight across a wide gap would invent a thermocline shape out of
# two distant points. 25 m is roughly the sampling interval of a typical 5 m
# CTD binned to 10 m.
METRICS_MAX_GAP_M = 25.0

# What is known about the model's own TCHP definition. Verified against the
# installed files: TCHP carries long_name "Tropical Cyclone Heat Potential" and
# units "KJ/cm2", with NO standard_name, NO algorithm attribute, NO reference
# and no documented D26 threshold. The value in the file therefore cannot be
# traced to a published formula. This string is surfaced in the API response so
# a reader is told the limitation at the point of use.
TCHP_DEFINITION_STATUS = (
    "The model's TCHP field publishes only long_name='Tropical Cyclone Heat "
    "Potential' and units='KJ/cm2'. It carries no standard_name, no algorithm or "
    "method attribute, no reference, and no documented isotherm threshold, so "
    "its exact formula (and whether it uses the same 26 C isotherm, the same "
    "seawater density and the same specific heat) could not be confirmed from "
    "the file or from any INCOIS documentation available to this analysis. The "
    "float value here uses the definition documented in ocean_heat_metrics and "
    "fixed constants of 1026 kg/m3 and 3985 J/kg/K. A systematic difference "
    "between the two is therefore expected and cannot be separated from a real "
    "model error with the information published in the file."
)

# --- rejection reasons -----------------------------------------------------
REASON_NO_SAMPLES = "no accepted temperature samples"
REASON_NO_VALID_TEMPERATURE = "no finite temperature values"
REASON_SURFACE_TOO_DEEP = (
    f"shallowest accepted sample deeper than {METRICS_MAX_SURFACE_DEPTH_M:g} m, "
    "so the surface value cannot be established without extrapolation"
)
REASON_SURFACE_BELOW_ISOTHERM = "surface temperature below 26 C"
REASON_NO_CROSSING = "profile does not reach 26 C within its sampled depth range"
REASON_GAP_TOO_WIDE = (
    f"a gap between accepted samples inside the warm layer exceeds "
    f"{METRICS_MAX_GAP_M:g} m"
)
REASON_STATS_SUPPRESSED = (
    "observation-model time gap too large; residual statistics are withheld"
)

MetricResult = Dict[str, Any]


def _finite(value: Any) -> Optional[float]:
    if isinstance(value, bool) or value is None:
        return None
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if result == result and abs(result) != float("inf") else None


def _accepted_samples(
    levels: Iterable[Dict[str, Any]],
) -> List[Tuple[float, float]]:
    """``(depth_m, temperature_c)`` for levels the matchup already trusted.

    Only levels that reached the matchup as a real measurement are used, i.e.
    ones with both a finite GSW depth and a finite temperature. A level whose
    temperature failed QC never reaches here, so no QC decision is duplicated
    or second-guessed in this module.
    """
    samples: List[Tuple[float, float]] = []
    for level in levels or []:
        if not isinstance(level, dict):
            continue
        depth = _finite(level.get("depth_m"))
        temperature = _finite(level.get("temperature_c"))
        if depth is None or temperature is None:
            continue
        samples.append((depth, temperature))
    samples.sort(key=lambda item: item[0])
    return samples


def _result(
    *,
    tchp: Optional[float] = None,
    d26: Optional[float] = None,
    status: Optional[str] = None,
    reason: Optional[str] = None,
    surface_depth_m: Optional[float] = None,
    surface_temperature_c: Optional[float] = None,
    warm_layer_thickness_m: Optional[float] = None,
) -> MetricResult:
    return {
        "tchpKjCm2": tchp,
        "d26M": d26,
        "status": status,
        "reason": reason,
        "surfaceDepthM": surface_depth_m,
        "surfaceTemperatureC": surface_temperature_c,
        "warmLayerThicknessM": warm_layer_thickness_m,
    }


def _crossing_depth(
    samples: Sequence[Tuple[float, float]],
    isotherm_c: float = TCHP_ISOTHERM_C,
) -> Optional[float]:
    """Deepest downward crossing from >= isotherm to < isotherm, interpolated.

    Returns None when the profile never makes such a crossing.
    """
    crossing: Optional[float] = None
    for (depth_a, temp_a), (depth_b, temp_b) in zip(samples, samples[1:]):
        if temp_a >= isotherm_c > temp_b:
            # Linear interpolation between the bracketing measured levels.
            span = temp_a - temp_b
            if span <= 0:  # pragma: no cover - guarded by the condition above
                continue
            fraction = (temp_a - isotherm_c) / span
            crossing = depth_a + fraction * (depth_b - depth_a)
    return crossing


def compute_ocean_heat_metrics(
    levels: Iterable[Dict[str, Any]],
    max_surface_depth_m: float = METRICS_MAX_SURFACE_DEPTH_M,
    max_gap_m: float = METRICS_MAX_GAP_M,
    isotherm_c: float = TCHP_ISOTHERM_C,
) -> MetricResult:
    """Float-derived TCHP and D26 from QC-accepted matchup levels.

    Args:
        levels: match levels from ``argo_levels.build_matchup_levels``. Only
            ``depth_m`` and ``temperature_c`` are read.
        max_surface_depth_m: shallowest accepted sample may stand in for the
            surface up to this depth. Beyond it the metric is refused rather
            than extrapolated.
        max_gap_m: widest gap tolerated between consecutive accepted samples
            inside the warm layer.
        isotherm_c: the isotherm defining the warm layer.

    Returns a dict with ``tchpKjCm2``, ``d26M``, ``status``, ``reason`` plus the
    surface values used. ``tchpKjCm2`` is 0.0 only when the surface is at or
    below the isotherm - a real measurement of no heat - never as a stand-in for
    a failure.
    """
    samples = _accepted_samples(levels)
    if not levels:
        return _result(reason=REASON_NO_SAMPLES)
    if not samples:
        return _result(reason=REASON_NO_VALID_TEMPERATURE)

    surface_depth, surface_temperature = samples[0]
    if surface_depth > max_surface_depth_m:
        # Refused rather than extrapolated: an integral from an assumed surface
        # value would invent the most important single number in the profile.
        return _result(
            reason=REASON_SURFACE_TOO_DEEP,
            surface_depth_m=surface_depth,
            surface_temperature_c=surface_temperature,
        )

    if surface_temperature < isotherm_c:
        # A measured absence of heat, not a measurement failure.
        return _result(
            tchp=0.0,
            d26=None,
            status="SURFACE_BELOW_ISOTHERM",
            reason=REASON_SURFACE_BELOW_ISOTHERM,
            surface_depth_m=surface_depth,
            surface_temperature_c=surface_temperature,
            warm_layer_thickness_m=0.0,
        )

    # Hold the shallowest accepted sample constant from the sea surface down to
    # the depth it was measured. This is a stated assumption, not an
    # extrapolation of a measurement: the value is used at its own depth and
    # repeated upward over the 0 -> surface_depth interval.
    profile: List[Tuple[float, float]] = [(0.0, surface_temperature)]
    profile.extend(
        (depth, temperature) for depth, temperature in samples if depth > 0.0
    )
    # A surface sample at exactly 0 m would duplicate the held constant.
    deduped: List[Tuple[float, float]] = []
    for depth, temperature in profile:
        if deduped and abs(depth - deduped[-1][0]) < 1e-9:
            continue
        deduped.append((depth, temperature))

    d26 = _crossing_depth(deduped, isotherm_c)
    if d26 is None:
        return _result(
            reason=REASON_NO_CROSSING,
            surface_depth_m=surface_depth,
            surface_temperature_c=surface_temperature,
        )

    # Integrate over 0 -> D26 only, which by definition ends at the crossing.
    warm: List[Tuple[float, float]] = [
        (depth, temperature)
        for depth, temperature in deduped
        if depth <= d26 + 1e-9
    ]
    # The crossing is an interpolated point, not a measured one; add it so the
    # integral ends exactly at D26 rather than at the last level above it.
    if not warm or abs(warm[-1][0] - d26) > 1e-9:
        warm.append((d26, isotherm_c))

    # Gap guard inside the warm layer only.
    for (depth_a, _t_a), (depth_b, _t_b) in zip(warm, warm[1:]):
        if (depth_b - depth_a) > max_gap_m + 1e-9:
            widest = max(
                (warm[index + 1][0] - warm[index][0])
                for index in range(len(warm) - 1)
            )
            return _result(
                d26=None,
                status="GAP_TOO_WIDE",
                reason=f"{REASON_GAP_TOO_WIDE} (widest {widest:.2f} m)",
                surface_depth_m=surface_depth,
                surface_temperature_c=surface_temperature,
            )

    # Trapezoidal rule on the excess above the isotherm.
    integral_j_m2 = 0.0
    for (depth_a, temp_a), (depth_b, temp_b) in zip(warm, warm[1:]):
        excess_a = max(temp_a - isotherm_c, 0.0)
        excess_b = max(temp_b - isotherm_c, 0.0)
        integral_j_m2 += 0.5 * (excess_a + excess_b) * (depth_b - depth_a)

    heat_content = TCHP_WATER_DENSITY_KG_M3 * TCHP_SPECIFIC_HEAT_J_KG_K * integral_j_m2
    tchp_kj_cm2 = heat_content / J_PER_M2_PER_KJ_PER_CM2

    return _result(
        tchp=round(tchp_kj_cm2, 4),
        d26=round(d26, 2),
        status="OK",
        reason=None,
        surface_depth_m=round(surface_depth, 2),
        surface_temperature_c=round(surface_temperature, 4),
        warm_layer_thickness_m=round(d26, 2),
    )