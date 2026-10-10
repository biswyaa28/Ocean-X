import { ArgoProfile, ArgoObservationPoint, ArgoMatchupResponse } from '../../types/oceanlens';

/**
 * Schema-compatible Argo fixtures mirroring the backend wire format
 * (ArgoProfile / ArgoObservationPoint / ArgoMatchupResponse).
 * TEST FIXTURES ONLY — synthetic values, never real scientific data.
 */

export function obsPoint(
  depth: number,
  temperature?: number | null,
  salinity?: number | null,
  tempQc = 1,
  psalQc = 1
): ArgoObservationPoint {
  return {
    depth_m: depth,
    pressure_dbar: depth + 0.5,
    temperature_c: temperature,
    salinity_psu: salinity,
    temp_qc: tempQc,
    psal_qc: psalQc,
  };
}

export function makeArgoProfile(overrides: Partial<ArgoProfile> = {}): ArgoProfile {
  return {
    profile_id: 'argo-2902746-p042',
    float_id: '2902746',
    platform_type: 'Apex Profiling Float (INCOIS)',
    cycle_number: 42,
    latitude: 15.25,
    longitude: 88.42,
    observation_time: '2026-09-08T03:15:00Z',
    data_status: 'REAL SOURCE — INGESTION PENDING',
    institution: 'INCOIS / Argo GDAC',
    observations_count: 3,
    observations: [
      obsPoint(0, 29.85, 32.84),
      obsPoint(10, 29.8, 32.86),
      obsPoint(50, 27.6, 34.05),
    ],
    provenance: {
      source: 'TEST FIXTURE ONLY',
      provider: 'test',
      dataset: 'synthetic-argo-profile-fixture',
      variable: 'temperature_c, salinity_psu',
      units: '°C, PSU',
      timestamp: '2026-09-08T03:15:00Z',
      latitude: 15.25,
      longitude: 88.42,
      processing_status: 'fixture-backed test payload',
      data_status: 'DEMO',
      asset_id: 'argo-2902746-p042',
    },
    ...overrides,
  };
}

export function makeArgoMatchup(overrides: Partial<ArgoMatchupResponse> = {}): ArgoMatchupResponse {
  return {
    argoProfileId: 'argo-2902746-p042',
    floatId: '2902746',
    observationTimestamp: '2026-09-08T03:15:00Z',
    observationLat: 15.25,
    observationLon: 88.42,
    modelDataset: 'INCOIS HYCOM',
    modelTimestamp: '2026-09-08T00:00:00Z',
    matchedModelLat: 15.25,
    matchedModelLon: 88.42,
    timeDifferenceHours: 3.25,
    distanceKm: 4.2,
    matchedDepths: [0, 50],
    matchedPointCount: 2,
    matchingToleranceM: 15,
    matchMode: 'native',
    spatialMode: 'nearest',
    variableBasis: 'raw',
    argoDataMode: 'auto',
    missingQcLevelCount: 0,
    modelDepthSelection: 'nearest native HYCOM model depth (no interpolation)',
    depthSource: 'pressure_gsw',
    qcFlagsUsed: { raw: [1, 2], adjusted: [1, 2, 5, 8] },
    comparisons: [
      {
        depthM: 0,
        depthSource: 'pressure_gsw',
        method: 'float_native',
        argoTemperatureC: 29.85,
        modelTemperatureC: 29.4,
        temperatureResidualC: -0.45,
        argoSalinityPSU: 32.84,
        modelSalinityPSU: 32.9,
        salinityResidualPSU: 0.06,
        matchedModelDepthM: 0,
      },
      {
        depthM: 50,
        depthSource: 'pressure_gsw',
        method: 'float_native',
        argoTemperatureC: 27.6,
        modelTemperatureC: 27.2,
        temperatureResidualC: -0.4,
        argoSalinityPSU: 34.05,
        modelSalinityPSU: 34.11,
        salinityResidualPSU: 0.06,
        matchedModelDepthM: 50,
      },
    ],
    dataStatus: 'REAL SOURCE — INGESTION PENDING',
    source: 'Argo Global Data (GDAC) + INCOIS RSMC HYCOM',
    residualConvention: 'ΔT = HYCOM - Argo, ΔS = HYCOM - Argo, ΔTCHP = HYCOM - Argo',
    // Cyclone-relevant heat content. Present by default so the drawer's
    // "Cyclone heat" section is exercised; override to null to test the
    // "Not available" path.
    tchpFloatKjCm2: 82.4,
    tchpModelKjCm2: 96.1,
    tchpResidualKjCm2: 13.7,
    tchpResidualPercent: 16.6,
    d26FloatM: 64.2,
    mldModelM: 11.5,
    metricsStatus: 'OK',
    metricsReason: null,
    metricsSurfaceDepthM: 2.4,
    metricsSurfaceTemperatureC: 29.8,
    tchpDefinitionStatus:
      "The model's TCHP field publishes only long_name and units; it carries no standard_name and no documented formula.",
    tchpIsothermC: 26,
    tchpMetricsMaxGapM: 25,
    statusMessage: null,
    statistics: {
      temperature: { n: 2, meanResidual: -0.425, mae: 0.425, rmse: 0.4253 },
      salinity: { n: 2, meanResidual: 0.06, mae: 0.06, rmse: 0.06 },
    },
    diagnostics: {
      totalArgoObservations: 3,
      matchedObservationCount: 2,
      unmatchedObservationCount: 1,
      matchedPercentage: 66.67,
      deepestMatchedObservationDepthM: 50,
      deepestMatchedModelDepthM: 50,
      repeatedNativeDepthMatchCount: 0,
      interpolatedLevelCount: 0,
      nativeLevelCount: 2,
      interpolationApplied: false,
      missingQcLevelCount: 0,
      timeDifferenceHours: 3.25,
      timeGapStatus: 'good',
    },
    timeGapStatus: 'good',
    statisticsSuppressed: false,
    modelRun: 'RSMC_hycom_20261008_bob_subset.nc',
    ...overrides,
  };
}

/**
 * An interpolated-mode matchup: extra float levels recovered by vertical
 * interpolation, and the depth basis reported by the backend.
 */
export function makeInterpolatedArgoMatchup(
  overrides: Partial<ArgoMatchupResponse> = {}
): ArgoMatchupResponse {
  return makeArgoMatchup({
    matchMode: 'float_levels',
    spatialMode: 'bilinear',
    modelDepthSelection:
      'linear interpolation between native HYCOM model depths (includes model interpolation error across sparse levels)',
    matchedPointCount: 3,
    matchedDepths: [0, 25, 50],
    comparisons: [
      {
        depthM: 0,
        depthSource: 'pressure_gsw',
        method: 'float_native',
        argoTemperatureC: 29.85,
        modelTemperatureC: 29.4,
        temperatureResidualC: -0.45,
        argoSalinityPSU: 32.84,
        modelSalinityPSU: 32.9,
        salinityResidualPSU: 0.06,
        matchedModelDepthM: 0,
      },
      {
        depthM: 25.05,
        depthSource: 'pressure_gsw',
        method: 'float_interpolated',
        argoTemperatureC: 28.7,
        modelTemperatureC: 28.1,
        temperatureResidualC: -0.6,
        argoSalinityPSU: 33.45,
        modelSalinityPSU: 33.5,
        salinityResidualPSU: 0.05,
        matchedModelDepthM: 25.05,
      },
      {
        depthM: 50,
        depthSource: 'pressure_gsw',
        method: 'float_native',
        argoTemperatureC: 27.6,
        modelTemperatureC: 27.2,
        temperatureResidualC: -0.4,
        argoSalinityPSU: 34.05,
        modelSalinityPSU: 34.11,
        salinityResidualPSU: 0.06,
        matchedModelDepthM: 50,
      },
    ],
    statistics: {
      temperature: { n: 3, meanResidual: -0.4833, mae: 0.4833, rmse: 0.4986 },
      salinity: { n: 3, meanResidual: 0.0567, mae: 0.0567, rmse: 0.0566 },
    },
    diagnostics: {
      totalArgoObservations: 3,
      matchedObservationCount: 3,
      unmatchedObservationCount: 0,
      matchedPercentage: 100,
      deepestMatchedObservationDepthM: 50,
      deepestMatchedModelDepthM: 50,
      repeatedNativeDepthMatchCount: 0,
      interpolatedLevelCount: 1,
      nativeLevelCount: 2,
      interpolationApplied: true,
      missingQcLevelCount: 0,
      timeDifferenceHours: 3.25,
      timeGapStatus: 'good',
    },
    timeGapStatus: 'good',
    statisticsSuppressed: false,
    modelRun: 'RSMC_hycom_20261008_bob_subset.nc',
    ...overrides,
  });
}
