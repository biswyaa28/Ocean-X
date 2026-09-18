export interface FlowBounds {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

export interface FlowGrid {
  latitudes: number[];
  longitudes: number[];
  u: number[][]; // grid of east-west velocity (m/s)
  v: number[][]; // grid of north-south velocity (m/s)
}

/**
 * Data provenance of a current flow field. Drives the visible status:
 * - REAL: vectors are actual HYCOM UVEL/VVEL values from the backend
 * - SIMULATED: the clearly-labelled synthetic fallback field
 * - UNAVAILABLE: no valid current vectors exist for the selection
 */
export type CurrentFieldDataStatus = 'REAL' | 'SIMULATED' | 'UNAVAILABLE';

export interface EnvironmentalFlowField {
  type: 'wind' | 'current';
  timestamp: string;
  bounds: FlowBounds;
  grid: FlowGrid;
  units: string;
  source: string;
  status: 'REAL' | 'SIMULATED';
  /** Depth (m) the vectors actually represent, when depth-aware. */
  depthM?: number;
  /** The native model depth actually matched, when reported by the backend. */
  matchedDepthM?: number;
  /** Human-readable reason for the current status (fallback/unavailable cause). */
  statusReason?: string;
  /** True when the field's coverage is limited to the surface level. */
  surfaceOnly?: boolean;
}

export interface FlowParticle {
  lat: number;
  lon: number;
  history: { lat: number; lon: number }[]; // Trail coordinate history for smooth curved streams
  age: number;
  maxAge: number;
  speed: number;
}
