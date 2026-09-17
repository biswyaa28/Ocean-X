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
    modelDepthSelection: 'nearest native HYCOM model depth (no interpolation)',
    comparisons: [
      {
        depthM: 0,
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
    residualConvention: 'ΔT = HYCOM - Argo, ΔS = HYCOM - Argo',
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
      interpolationApplied: false,
    },
    ...overrides,
  };
}
