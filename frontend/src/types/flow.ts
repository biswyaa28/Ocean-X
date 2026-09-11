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

export interface EnvironmentalFlowField {
  type: 'wind' | 'current';
  timestamp: string;
  bounds: FlowBounds;
  grid: FlowGrid;
  units: string;
  source: string;
  status: 'REAL' | 'SIMULATED';
}

export interface FlowParticle {
  lat: number;
  lon: number;
  history: { lat: number; lon: number }[]; // Trail coordinate history for smooth curved streams
  age: number;
  maxAge: number;
  speed: number;
}
