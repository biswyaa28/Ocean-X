/**
 * Shared contract for the unvalidated risk heuristic.
 *
 * The BACKEND is the only scorer (see GET /risk/{cycloneId}). A client-side
 * re-implementation previously lived here; it was removed because it silently
 * scored on invented constants whenever model data was absent. What remains is
 * the constants and the band mapping, so the UI can label a backend score
 * without ever producing one of its own.
 */
import { RiskAssessment, CycloneTrackPoint } from '../types/oceanlens';

/** Must stay in sync with backend RISK_HEURISTIC_WEIGHTS. */
export const RISK_HEURISTIC_WEIGHTS: Record<string, number> = {
  windMaxPoints: 45.0,
  windSaturatesAtKts: 140.0,
  distanceMaxPoints: 30.0,
  distanceFloorPoints: 5.0,
  distanceScaleKm: 800.0,
  tchpMaxPoints: 15.0,
  tchpSaturatesAtKJPerCm2: 100.0,
  sstMaxPoints: 10.0,
  sstThresholdC: 26.0,
  sstSpanC: 5.0,
  scoreClampMin: 10.0,
  scoreClampMax: 98.0,
};

export const RISK_DISCLAIMER =
  'NOT VALIDATED, NOT FOR OPERATIONAL USE. These weights are hand-tuned demo ' +
  'constants with no published basis, no calibration and no verification ' +
  'against historical landfall damage. They are exposed above so they cannot ' +
  'be mistaken for a scientific scale.';

/**
 * Band boundaries, shared with the backend so the client and server agree on
 * how a score maps to a label. Display only — the backend owns the score.
 */
export function getRiskCategory(score: number): 'LOW' | 'ELEVATED' | 'HIGH' | 'CRITICAL' {
  if (score >= 85) return 'CRITICAL';
  if (score >= 65) return 'HIGH';
  if (score >= 40) return 'ELEVATED';
  return 'LOW';
}
