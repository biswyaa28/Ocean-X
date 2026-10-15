/**
 * Pure helpers for rendering cyclone observations honestly.
 *
 * IBTrACS leaves wind, pressure and quadrant wind-radii blank for many track
 * points. The backend reports those as `null` rather than substituting a
 * plausible constant, so the 3D layer must decide "draw or omit" here — where
 * it is unit-testable — rather than inline in the Cesium effect.
 */
import type { CycloneTrackPoint, WindRadius } from '../types/oceanlens';

/** True only when an agency actually reported a usable R34 radius. */
export function hasObservedRadius(radius: number | null | undefined): boolean {
  return radius !== null && radius !== undefined && Number.isFinite(radius) && radius > 0;
}

/**
 * The radii that can actually be drawn, in km. Entries whose observation is
 * absent are omitted rather than defaulted.
 */
export function observedRadii(windRadius: WindRadius | null | undefined): {
  r34ktsKm: number | null;
  r50ktsKm: number | null;
} {
  return {
    r34ktsKm: hasObservedRadius(windRadius?.r34ktsKm) ? windRadius!.r34ktsKm : null,
    r50ktsKm: hasObservedRadius(windRadius?.r50ktsKm) ? windRadius!.r50ktsKm : null,
  };
}

/**
 * Human-readable intensity for a track point.
 *
 * A missing observation reads as "NOT OBSERVED" — never as "null KT", never as
 * a substituted value, and never as an invented category.
 */
export function formatCycloneIntensity(point: CycloneTrackPoint | null | undefined): string {
  const wind = point?.maxWindKts;
  if (wind === null || wind === undefined) {
    return 'INTENSITY NOT OBSERVED';
  }
  const category = point?.category ? point.category.toUpperCase() : 'UNCLASSIFIED';
  return `${category} · ${wind} KT`;
}

/** Label for the storm-eye callout. */
export function cycloneEyeLabel(
  cycloneName: string | null | undefined,
  point: CycloneTrackPoint | null | undefined
): string {
  return `EYE OF STORM: ${cycloneName ?? 'UNKNOWN'}\n${formatCycloneIntensity(point)}`;
}