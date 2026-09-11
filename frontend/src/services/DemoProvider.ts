import { DataProvider } from './DataProvider';
import {
  Cyclone,
  CycloneTrackPoint,
  Hazard,
  Station,
  GISLayer,
  KPIMetrics,
  DataStatus,
  ArgoProfile,
  ArgoMatchupResponse,
} from '../types/oceanlens';


const DEMO_CYCLONE_TRACK: CycloneTrackPoint[] = [
  {
    id: 'pt-0',
    timestamp: '2020-05-15T06:00:00Z',
    latitude: 10.5,
    longitude: 87.2,
    maxWindKts: 45,
    centralPressureMb: 998,
    category: 'Depression',
    status: 'OBSERVATION',
    distanceToCoastKm: 780,
    stormSpeedKts: 12,
    stormDirDeg: 315,
  },
  {
    id: 'pt-1',
    timestamp: '2020-05-15T18:00:00Z',
    latitude: 11.8,
    longitude: 86.8,
    maxWindKts: 55,
    centralPressureMb: 990,
    category: 'Deep Depression',
    status: 'OBSERVATION',
    distanceToCoastKm: 690,
    stormSpeedKts: 14,
    stormDirDeg: 320,
  },
  {
    id: 'pt-2',
    timestamp: '2020-05-16T06:00:00Z',
    latitude: 13.2,
    longitude: 86.3,
    maxWindKts: 70,
    centralPressureMb: 980,
    category: 'Cyclonic Storm',
    status: 'OBSERVATION',
    distanceToCoastKm: 580,
    stormSpeedKts: 15,
    stormDirDeg: 325,
  },
  {
    id: 'pt-3',
    timestamp: '2020-05-16T18:00:00Z',
    latitude: 14.7,
    longitude: 85.9,
    maxWindKts: 85,
    centralPressureMb: 968,
    category: 'Severe Cyclonic Storm',
    status: 'OBSERVATION',
    distanceToCoastKm: 470,
    stormSpeedKts: 16,
    stormDirDeg: 330,
  },
  {
    id: 'pt-4',
    timestamp: '2020-05-17T06:00:00Z',
    latitude: 16.3,
    longitude: 85.7,
    maxWindKts: 105,
    centralPressureMb: 950,
    category: 'Very Severe Cyclonic Storm',
    status: 'OBSERVATION',
    distanceToCoastKm: 360,
    stormSpeedKts: 18,
    stormDirDeg: 335,
  },
  {
    id: 'pt-5',
    timestamp: '2020-05-17T18:00:00Z',
    latitude: 17.8,
    longitude: 86.0,
    maxWindKts: 125,
    centralPressureMb: 935,
    category: 'Extremely Severe Cyclonic Storm',
    status: 'OBSERVATION',
    distanceToCoastKm: 270,
    stormSpeedKts: 19,
    stormDirDeg: 345,
  },
  // Historical forecast points
  {
    id: 'pt-6',
    timestamp: '2020-05-18T06:00:00Z',
    latitude: 19.2,
    longitude: 86.6,
    maxWindKts: 135,
    centralPressureMb: 928,
    category: 'Super Cyclonic Storm',
    status: 'FORECAST',
    distanceToCoastKm: 180,
    stormSpeedKts: 20,
    stormDirDeg: 350,
    forecastConfidencePct: 92,
  },
  {
    id: 'pt-7',
    timestamp: '2020-05-18T18:00:00Z',
    latitude: 20.4,
    longitude: 87.3,
    maxWindKts: 130,
    centralPressureMb: 930,
    category: 'Super Cyclonic Storm',
    status: 'FORECAST',
    distanceToCoastKm: 95,
    stormSpeedKts: 21,
    stormDirDeg: 355,
    forecastConfidencePct: 86,
  },
  {
    id: 'pt-8',
    timestamp: '2020-05-19T06:00:00Z',
    latitude: 21.5,
    longitude: 88.1,
    maxWindKts: 120,
    centralPressureMb: 940,
    category: 'Extremely Severe Cyclonic Storm',
    status: 'FORECAST',
    distanceToCoastKm: 25,
    stormSpeedKts: 22,
    stormDirDeg: 5,
    forecastConfidencePct: 80,
  },
  {
    id: 'pt-9',
    timestamp: '2020-05-19T18:00:00Z',
    latitude: 22.4,
    longitude: 88.9,
    maxWindKts: 95,
    centralPressureMb: 960,
    category: 'Very Severe Cyclonic Storm',
    status: 'FORECAST',
    distanceToCoastKm: 0,
    stormSpeedKts: 24,
    stormDirDeg: 15,
    forecastConfidencePct: 75,
  },
  {
    id: 'pt-10',
    timestamp: '2020-05-20T06:00:00Z',
    latitude: 23.5,
    longitude: 89.8,
    maxWindKts: 65,
    centralPressureMb: 980,
    category: 'Cyclonic Storm',
    status: 'FORECAST',
    distanceToCoastKm: 0,
    stormSpeedKts: 25,
    stormDirDeg: 25,
    forecastConfidencePct: 70,
  },
];

const DEMO_CYCLONE: Cyclone = {
  id: 'cyclone-amphan-2020',
  name: 'AMPHAN',
  basin: 'North Indian Ocean (Bay of Bengal)',
  dataStatus: 'OBSERVATION',
  currentTrackIndex: 5,
  track: DEMO_CYCLONE_TRACK,
  forecastCone: [
    { latitude: 19.2, longitude: 86.6, radiusKm: 45, timestamp: '2020-05-18T06:00:00Z' },
    { latitude: 20.4, longitude: 87.3, radiusKm: 75, timestamp: '2020-05-18T18:00:00Z' },
    { latitude: 21.5, longitude: 88.1, radiusKm: 110, timestamp: '2020-05-19T06:00:00Z' },
    { latitude: 22.4, longitude: 88.9, radiusKm: 150, timestamp: '2020-05-19T18:00:00Z' },
  ],
  windRadius: {
    r34ktsKm: 280,
    r50ktsKm: 160,
    r64ktsKm: 85,
  },
  sourceAttribution: 'NOAA IBTrACS v04r01 (Historical 2020 Track)',
  isHistorical: true,
};

const DEMO_STATIONS: Station[] = [
  {
    id: 'st-bd08',
    name: 'INCOIS Ocean Buoy BD08',
    latitude: 18.2,
    longitude: 89.7,
    region: 'East Bay of Bengal',
    status: 'active',
    type: 'buoy',
    dataStatus: 'SIMULATED',
    currentMeasurements: {
      sstC: 30.2,
      windSpeedKts: 48,
      waveHeightM: 5.8,
      pressureMb: 978,
      salinityPsu: 33.4,
    },
  },
  {
    id: 'st-bd10',
    name: 'INCOIS Ocean Buoy BD10',
    latitude: 16.5,
    longitude: 87.9,
    region: 'Central Bay of Bengal',
    status: 'active',
    type: 'buoy',
    dataStatus: 'SIMULATED',
    currentMeasurements: {
      sstC: 30.8,
      windSpeedKts: 110,
      waveHeightM: 9.4,
      pressureMb: 942,
      salinityPsu: 33.8,
    },
  },
  {
    id: 'st-paradip',
    name: 'Paradeep Coastal Radar & Gauge',
    latitude: 20.26,
    longitude: 86.67,
    region: 'Odisha Coast',
    status: 'active',
    type: 'coastal_radar',
    dataStatus: 'SIMULATED',
    currentMeasurements: {
      sstC: 29.5,
      windSpeedKts: 65,
      waveHeightM: 4.2,
      pressureMb: 975,
    },
  },
  {
    id: 'st-chennai',
    name: 'Chennai Coastal Station',
    latitude: 13.08,
    longitude: 80.27,
    region: 'Tamil Nadu Coast',
    status: 'active',
    type: 'tide_gauge',
    dataStatus: 'SIMULATED',
    currentMeasurements: {
      sstC: 29.8,
      windSpeedKts: 22,
      waveHeightM: 2.1,
      pressureMb: 1004,
    },
  },
];

const DEMO_LAYERS: GISLayer[] = [
  {
    id: 'cyclone',
    name: 'Cyclone Track & Forecast',
    category: 'hazard',
    active: true,
    status: 'SIMULATED',
    description: '3D cyclone center, best-track history, intensity markers, and forecast cone',
  },
  {
    id: 'currents',
    name: 'Ocean Currents',
    category: 'physical',
    active: true,
    status: 'SIMULATED',
    description: 'Surface current speed and flow direction (m/s)',
    unit: 'm/s',
  },
  {
    id: 'wind',
    name: 'Surface Wind Vectors',
    category: 'physical',
    active: true,
    status: 'SIMULATED',
    description: '10m surface wind speed and direction (knots)',
    unit: 'kts',
  },
  {
    id: 'wave_height',
    name: 'Significant Wave Height',
    category: 'physical',
    active: true,
    status: 'SIMULATED',
    description: 'Significant wave height spatial grid (meters)',
    unit: 'm',
  },
  {
    id: 'sst',
    name: 'Sea Surface Temp (SST)',
    category: 'physical',
    active: false,
    status: 'SIMULATED',
    description: 'Sea surface thermal gradient (°C)',
    unit: '°C',
  },
  {
    id: 'salinity',
    name: 'Sea Surface Salinity',
    category: 'physical',
    active: false,
    status: 'SIMULATED',
    description: 'Surface salinity distribution (PSU)',
    unit: 'PSU',
  },
  {
    id: 'chlorophyll',
    name: 'Chlorophyll-a Concentration',
    category: 'physical',
    active: false,
    status: 'SIMULATED',
    description: 'Ocean color / biogeochemical primary productivity',
    unit: 'mg/m³',
  },
  {
    id: 'stations',
    name: 'Monitoring Stations & Buoys',
    category: 'infrastructure',
    active: true,
    status: 'SIMULATED',
    description: 'INCOIS deep sea buoys and coastal radar stations',
  },
  {
    id: 'risk_zones',
    name: 'Coastal Risk Polygons',
    category: 'hazard',
    active: true,
    status: 'SIMULATED',
    description: 'Calculated high-risk storm surge and inundation hazard corridors',
  },
];

export class DemoProvider implements DataProvider {
  async getCyclones(): Promise<Cyclone[]> {
    return [DEMO_CYCLONE];
  }

  async getCycloneById(id: string): Promise<Cyclone | null> {
    if (id === DEMO_CYCLONE.id || id === 'active') {
      return DEMO_CYCLONE;
    }
    return null;
  }

  async getHazards(): Promise<Hazard[]> {
    return [
      {
        id: 'hazard-amphan-1',
        title: 'Super Cyclonic Storm AMPHAN-SIM Warning',
        type: 'cyclone',
        severity: 'CRITICAL',
        location: 'North-West Bay of Bengal / Sundarbans Coast',
        dataStatus: 'SIMULATED',
        riskAssessment: {
          score: 92,
          category: 'CRITICAL',
          modelType: 'prototype_rule_based',
          affectedRegions: [
            'West Bengal Coast (South 24 Parganas, East Midnapore)',
            'Bangladesh Sundarbans Coast (Khulna, Barisal)',
            'North Odisha Coast (Bhadrak, Balasore)',
          ],
          evidence: [
            {
              variable: 'Maximum Sustained Wind',
              value: '135',
              unit: 'kts',
              trend: 'increasing',
              relevance: 'Catastrophic wind hazard within 120km radius',
              status: 'SIMULATED',
            },
            {
              variable: 'Central Barometric Pressure',
              value: '928',
              unit: 'mb',
              trend: 'decreasing',
              relevance: 'Deep pressure deficit driving 4-6m storm surge',
              status: 'SIMULATED',
            },
            {
              variable: 'Coastal Distance',
              value: '180',
              unit: 'km',
              trend: 'decreasing',
              relevance: 'Track trajectory aligned with Sundarbans landfall',
              status: 'SIMULATED',
            },
            {
              variable: 'Sea Surface Temp Anomaly',
              value: '+1.8',
              unit: '°C',
              trend: 'increasing',
              relevance: 'High ocean heat content sustaining extreme intensity',
              status: 'SIMULATED',
            },
          ],
          explanation: {
            summary:
              'Prototype risk assessment indicates CRITICAL hazard level for the West Bengal and Bangladesh Sundarbans coastal zones due to the rapid intensification of AMPHAN-SIM over warm Bay of Bengal waters combined with a direct north-northwestward landfall trajectory.',
            keyFactors: [
              'Extreme sustained winds exceeding 130 knots (Super Cyclone threshold)',
              'Storm surge potential of 4–6 meters over low-lying Sundarbans delta',
              'Forward movement speed accelerating toward coastal impact within 18–24 hours',
            ],
            limitations:
              'This is a prototype decision-support simulation based on demo rule sets. It does not replace official IMD or INCOIS warning bulletins.',
            generatedAt: new Date().toISOString(),
          },
        },
      },
    ];
  }

  async getHazardById(id: string): Promise<Hazard | null> {
    const hazards = await this.getHazards();
    return hazards.find((h) => h.id === id) || hazards[0];
  }

  async getStations(): Promise<Station[]> {
    return DEMO_STATIONS;
  }

  async getLayers(): Promise<GISLayer[]> {
    return DEMO_LAYERS;
  }

  async getKPIMetrics(timestepIndex = 5): Promise<KPIMetrics> {
    const pt = DEMO_CYCLONE_TRACK[Math.min(timestepIndex, DEMO_CYCLONE_TRACK.length - 1)];
    const isCritical = pt.maxWindKts > 115 || pt.distanceToCoastKm < 150;
    const isHigh = pt.maxWindKts > 80;

    return {
      activeCyclones: 1,
      maxWindKts: pt.maxWindKts,
      maxWaveHeightM: Number((pt.maxWindKts * 0.075 + 2.1).toFixed(1)),
      avgSSTC: 30.5,
      coastalRiskLevel: isCritical ? 'CRITICAL' : isHigh ? 'HIGH' : 'MODERATE',
      dataConfidencePct: 88,
      forecastConfidencePct: pt.forecastConfidencePct || 92,
    };
  }

  async getDataStatus(): Promise<{ mode: DataStatus; backendConnected: boolean }> {
    return {
      mode: 'SIMULATED',
      backendConnected: false,
    };
  }

  async getArgoProfiles(): Promise<ArgoProfile[]> {
    return [];
  }

  async getArgoProfileById(id: string): Promise<ArgoProfile | null> {
    return null;
  }

  async getArgoMatchup(profileId: string): Promise<ArgoMatchupResponse | null> {
    return null;
  }
}

export const demoProvider = new DemoProvider();

