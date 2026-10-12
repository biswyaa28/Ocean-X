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

import math
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
REASON_MODEL_PROFILE_TOO_SHALLOW = (
    "model profile has fewer than two finite temperature levels"
)
REASON_MODEL_FIELD_ABSENT = "model 2D TCHP field is absent at this location"
REASON_NO_MODEL_PROFILES = (
    "no profile supplied both a model TCHP field value and a model "
    "temperature profile"
)
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


# ---------------------------------------------------------------------------
# The same formula, run on the MODEL's own temperature
# ---------------------------------------------------------------------------
# The float-side gap guard cannot be reused on a model profile: HYCOM carries six
# levels and spaces them 150 m apart across the thermocline, so a 25 m guard
# rejects every profile outright. 300 m is the model's own spacing there. Only
# that guard changes - the integral, the constants and the unit conversion stay
# in compute_ocean_heat_metrics, so the two sides cannot drift apart.
MODEL_PROFILE_MAX_GAP_M = 300.0

# Reference isotherms offered to the definition fit, 15.0-30.0 C in 0.5 C steps.
# TCHP falls as the reference deepens, so a scan covers both the plausible
# answer and the ones that would make the fit meaningless.
REFERENCE_ISOTHERM_CANDIDATES_C: Tuple[float, ...] = tuple(
    round(15.0 + 0.5 * index, 2) for index in range(31)
)

# A candidate isotherm is only scored if it yields a value for at least this
# fraction of the profiles. Without it the fit would happily "explain" the field
# with an isotherm that happens to work for one warm profile and nothing else.
REFERENCE_FIT_MIN_COVERAGE = 0.8


def compute_model_profile_tchp(
    depths_m: Sequence[Any],
    temperatures_c: Sequence[Any],
    isotherm_c: float = TCHP_ISOTHERM_C,
    max_gap_m: float = MODEL_PROFILE_MAX_GAP_M,
) -> MetricResult:
    """TCHP from the MODEL's own temperature profile, using the float formula.

    This is deliberately not a second implementation of the integral. It adapts
    the model's native levels into the shape ``compute_ocean_heat_metrics``
    already takes and calls it unchanged, so "the float's TCHP" and "the model's
    TCHP under the same definition" differ only in which water was sampled and
    never in how the number was computed. That is the whole point of running it:
    it is what turns the float-vs-field residual into a statement about
    definitions rather than about the model.

    No surface hold is applied and none is needed - the model's shallowest level
    is 0 m, so there is nothing above the first sample to stand in for.
    """
    levels: List[Dict[str, Any]] = []
    # ``or []`` cannot be used on numpy arrays, and the model side passes one.
    depth_values = [] if depths_m is None else list(depths_m)
    temperature_values = [] if temperatures_c is None else list(temperatures_c)
    for depth, temperature in zip(depth_values, temperature_values):
        resolved_depth = _finite(depth)
        resolved_temperature = _finite(temperature)
        if resolved_depth is None or resolved_temperature is None:
            continue
        levels.append(
            {"depth_m": resolved_depth, "temperature_c": resolved_temperature}
        )
    if len(levels) < 2:
        return _result(reason=REASON_MODEL_PROFILE_TOO_SHALLOW)
    return compute_ocean_heat_metrics(
        levels, max_gap_m=max_gap_m, isotherm_c=isotherm_c
    )


def summarize_model_tchp_definition(
    profiles: Iterable[Dict[str, Any]],
    isotherm_c: float = TCHP_ISOTHERM_C,
) -> Dict[str, Any]:
    """Is INCOIS's 2D TCHP field the same quantity as the float's TCHP?

    ``profiles`` is a list of ``{"fieldKjCm2", "depthsM", "temperaturesC"}``.
    Each entry pairs the model's published 2D TCHP at one float's place and time
    with the model's own temperature profile at that same place and time.

    Two questions are answered separately because they have different answers,
    and reporting only one of them is how a definition difference gets presented
    as model error:

    1. Under the FLOAT definition (the 26 C isotherm), how much larger is
       INCOIS's 2D field than the model's own profile recomputed with that same
       definition? -> ``ratioAtFloatIsotherm``. A number well above 1 means the
       two are not the same quantity.
    2. Which reference isotherm WOULD reproduce INCOIS's field from the model's
       own temperature? -> ``referenceIsothermC``, with the ratio there. A ratio
       near 1.00 means the field is the same ocean under a shallower reference
       isotherm, i.e. a different convention, not a wrong number.

    The fit is global (one isotherm for the whole set, chosen to minimise the
    error against the pooled field mean) rather than per-profile: the question
    being asked is about the product's convention, and fitting a parameter per
    profile would let each profile's own noise set its own reference.
    """
    usable: List[Dict[str, Any]] = []
    for entry in profiles or []:
        if not isinstance(entry, dict):
            continue
        field = _finite(entry.get("fieldKjCm2"))
        recomputed = compute_model_profile_tchp(
            entry.get("depthsM"), entry.get("temperaturesC"), isotherm_c=isotherm_c
        ).get("tchpKjCm2")
        if field is None or field <= 0 or recomputed is None or recomputed <= 0:
            continue
        usable.append(
            {
                "field": field,
                "recomputed": recomputed,
                "depthsM": entry.get("depthsM"),
                "temperaturesC": entry.get("temperaturesC"),
            }
        )

    if not usable:
        return {
            "status": "UNAVAILABLE",
            "reason": REASON_NO_MODEL_PROFILES,
            "profileCount": 0,
            "floatIsothermC": isotherm_c,
            "fieldMeanKjCm2": None,
            "modelProfileMeanKjCm2": None,
            "ratioAtFloatIsothermMean": None,
            "ratioAtFloatIsothermMedian": None,
            "referenceIsothermC": None,
            "referenceProfileMeanKjCm2": None,
            "referenceRatio": None,
            "referenceCoverage": 0,
            "modelProfileMaxGapM": MODEL_PROFILE_MAX_GAP_M,
        }

    ratios = [entry["field"] / entry["recomputed"] for entry in usable]
    field_mean = sum(entry["field"] for entry in usable) / len(usable)
    recomputed_mean = sum(entry["recomputed"] for entry in usable) / len(usable)

    # Ceiling, not floor: with one profile the threshold must still be 1, or a
    # single-profile fit can never resolve at all. The fraction already keeps
    # the fit from resting on a handful of outliers in a large set.
    required = max(1, math.ceil(len(usable) * REFERENCE_FIT_MIN_COVERAGE))
    best: Optional[Dict[str, Any]] = None
    for candidate in REFERENCE_ISOTHERM_CANDIDATES_C:
        values = [
            _finite(compute_model_profile_tchp(
                entry["depthsM"], entry["temperaturesC"], isotherm_c=candidate
            ).get("tchpKjCm2"))
            for entry in usable
        ]
        positive = [value for value in values if value is not None and value > 0]
        if len(positive) < required:
            continue
        candidate_mean = sum(positive) / len(positive)
        error = abs(candidate_mean - field_mean)
        if best is None or error < best["error"]:
            best = {
                "isotherm": candidate,
                "profileMean": candidate_mean,
                "coverage": len(positive),
                "error": error,
            }

    return {
        "status": "OK" if best is not None else "UNRESOLVED",
        "reason": None if best is not None else (
            "no reference isotherm reproduced the model field for enough profiles"
        ),
        "profileCount": len(usable),
        "floatIsothermC": isotherm_c,
        "fieldMeanKjCm2": round(field_mean, 4),
        "modelProfileMeanKjCm2": round(recomputed_mean, 4),
        "ratioAtFloatIsothermMean": round(sum(ratios) / len(ratios), 4),
        "ratioAtFloatIsothermMedian": round(_median(ratios), 4),
        "referenceIsothermC": best["isotherm"] if best else None,
        "referenceProfileMeanKjCm2": round(best["profileMean"], 4) if best else None,
        "referenceRatio": round(field_mean / best["profileMean"], 4) if best and best["profileMean"] else None,
        "referenceCoverage": best["coverage"] if best else 0,
        "modelProfileMaxGapM": MODEL_PROFILE_MAX_GAP_M,
    }


def _median(values: Sequence[float]) -> float:
    ordered = sorted(values)
    count = len(ordered)
    middle = count // 2
    if count % 2:
        return ordered[middle]
    return 0.5 * (ordered[middle - 1] + ordered[middle])