/**
 * The two rules this change exists to enforce, exercised through the real page:
 *
 * 1. The app opens on LIVE OCEAN, whose clock is the model's own.
 * 2. Model-derived values never appear under a date they do not belong to —
 *    either the badge states both dates, or nothing is drawn.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';

import { cesiumMock, resetLayerOps } from '../test/mocks/cesium';
vi.mock('../lib/cesiumRuntime', () => ({
  __esModule: true,
  default: cesiumMock,
  Cesium: cesiumMock,
}));
vi.mock('cesium/Build/Cesium/Widgets/widgets.css', () => ({}));

const getDepthSlice = vi.fn();
const getDataStatus = vi.fn();
const getCyclones = vi.fn();
const getLayers = vi.fn();
const getArgoProfiles = vi.fn();
const getRiskAssessment = vi.fn();
const getRealCurrentFieldPayload = vi.fn();
type GetLayerData = (
  layerName: string,
  timestamp?: string,
  stride?: number,
  signal?: AbortSignal
) => Promise<unknown>;
const getLayerData = vi.fn<GetLayerData>();

vi.mock('../services/ApiProvider', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../services/ApiProvider')>();
  const mockProvider: typeof orig.apiProvider = Object.create(Object.getPrototypeOf(orig.apiProvider));
  Object.assign(mockProvider, orig.apiProvider, {
    getDepthSlice: (...args: unknown[]) => getDepthSlice(...args),
    getRealCurrentFieldPayload: (...args: unknown[]) => getRealCurrentFieldPayload(...args),
    getRiskAssessment: (...args: unknown[]) => getRiskAssessment(...args),
    getDataStatus: () => getDataStatus(),
    getCyclones: () => getCyclones(),
    getLayers: () => getLayers(),
    getArgoProfiles: () => getArgoProfiles(),
    getLayerData: (...args: [string, string | undefined, number, AbortSignal]) => getLayerData(...args),
    inspectPoint: vi.fn(async () => null),
    inspectCyclone: vi.fn(async () => null),
  });
  return { ...orig, apiProvider: mockProvider };
});

import Home from './page';
import { makeDepthSlicePayload } from '../test/fixtures/depthSliceFixtures';
import type { ArgoProfile, Cyclone, GISLayer, RiskAssessment } from '../types/oceanlens';

const MODEL_TIMES = [
  '2026-10-07T06:00:00.000000000',
  '2026-10-07T12:00:00.000000000',
  '2026-10-08T18:00:00.000000000',
];

// The depth-resolved file is a different HYCOM run with a different window.
const MODEL_DEPTH_TIMES = [
  '2026-10-10T06:00:00.000000000',
  '2026-10-11T06:00:00.000000000',
  '2026-10-17T00:00:00.000000000',
];

const AMPHAN: Cyclone = {
  id: '2020136N10088',
  name: 'AMPHAN',
  basin: 'North Indian Ocean (Bay of Bengal)',
  dataStatus: 'REAL',
  currentTrackIndex: 1,
  forecastCone: [],
  track: [
    {
      id: 'pt-0', timestamp: '2020-05-18T06:00:00', latitude: 16.1, longitude: 87.4,
      maxWindKts: 61, centralPressureMb: 986, category: 'Severe Cyclonic Storm',
      status: 'OBSERVATION', distanceToCoastKm: 300, stormSpeedKts: 12, stormDirDeg: 315,
    },
    {
      id: 'pt-1', timestamp: '2020-05-18T18:00:00', latitude: 17.4, longitude: 86.2,
      maxWindKts: 72, centralPressureMb: 972, category: 'Very Severe Cyclonic Storm',
      status: 'OBSERVATION', distanceToCoastKm: 210, stormSpeedKts: 14, stormDirDeg: 310,
    },
  ],
} as unknown as Cyclone;

const SST_LAYERS: GISLayer[] = [
  { id: 'sst', name: 'Sea Surface Temperature', category: 'physical', active: true, status: 'REAL', description: '', unit: '°C' },
];

const CURRENTS_LAYERS: GISLayer[] = [
  { id: 'sst', name: 'Sea Surface Temperature', category: 'physical', active: false, status: 'REAL', description: '', unit: '°C' },
  { id: 'currents', name: 'Ocean Currents', category: 'physical', active: true, status: 'REAL', description: '', unit: 'm/s' },
];

function argo(id: string, observationTime: string): ArgoProfile {
  return {
    profile_id: id, float_id: id, platform_type: 'core', cycle_number: 1,
    latitude: 12, longitude: 88, observation_time: observationTime,
    data_status: 'REAL', institution: 'IFREMER', observations_count: 10,
    observations: [], provenance: { data_status: 'REAL' },
  } as ArgoProfile;
}

/** A layer grid payload carrying the model time it actually holds. */
function layerPayload(timestamp: string) {
  return {
    status: 'REAL',
    source: 'INCOIS RSMC HYCOM',
    layer_name: 'sst',
    timestamp,
    units: '°C',
    bounds: { minLat: 5, maxLat: 25, minLon: 80, maxLon: 100 },
    grid: {
      latitudes: [10, 11],
      longitudes: [86, 87],
      values: [[28.4, 28.6], [28.9, 29.1]],
    },
  };
}

beforeEach(() => {
  resetLayerOps();
  vi.clearAllMocks();
  getDataStatus.mockResolvedValue({
    mode: 'REAL' as const,
    backendConnected: true,
    dataMode: 'REAL' as const,
    datasetSynthetic: false,
    datasetLoaded: true,
  });
  getCyclones.mockResolvedValue([AMPHAN]);
  getLayers.mockResolvedValue(SST_LAYERS);
  getArgoProfiles.mockResolvedValue([]);
  getRiskAssessment.mockResolvedValue(null);
  getRealCurrentFieldPayload.mockResolvedValue(null);
  getDepthSlice.mockResolvedValue(null);
  getLayerData.mockResolvedValue(null);
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      available_timestamps: MODEL_TIMES,
      available_depth_timestamps: MODEL_DEPTH_TIMES,
    }),
  });
});

describe('default mode', () => {
  it('opens on LIVE OCEAN, not HISTORICAL REPLAY', async () => {
    render(<Home />);

    // The window is published in its own ribbon field, with its age.
    await screen.findByText('2026-10-07 06:00 UTC → 2026-10-08 18:00 UTC');
    expect(screen.getAllByText(/LATEST MODEL RUN ·/).length).toBeGreaterThan(0);
    // No cyclone provenance anywhere in LIVE.
    expect(screen.queryByText(/HISTORICAL REPLAY ·/)).not.toBeInTheDocument();
    expect(screen.queryByText(/IBTrACS/)).not.toBeInTheDocument();
  });

  it('the LIVE timeline marker opens on the latest real model timestamp', async () => {
    getLayerData.mockResolvedValue(layerPayload(MODEL_TIMES[2]));
    render(<Home />);

    await waitFor(() => expect(getLayerData).toHaveBeenCalled());
    // Every model-layer request is made at a real model time, never "now".
    for (const call of getLayerData.mock.calls) {
      expect(MODEL_TIMES).toContain(call[1]);
      expect(call[1]).toBe(MODEL_TIMES[2]); // the latest
    }
  });

  it('scrubbing the LIVE timeline moves the model request to that real model time', async () => {
    getLayerData.mockResolvedValue(layerPayload(MODEL_TIMES[2]));
    render(<Home />);
    await waitFor(() => expect(getLayerData).toHaveBeenCalled());

    fireEvent.click(screen.getByTitle(/2026-10-07 06:00 UTC \(MODEL DATA\)/i));
    await waitFor(() =>
      expect(
        getLayerData.mock.calls.some((c) => c[1] === '2026-10-07T06:00:00.000000000')
      ).toBe(true)
    );
  });
});

describe('HISTORICAL REPLAY model-time badge', () => {
  async function renderReplay() {
    getLayerData.mockResolvedValue(layerPayload(MODEL_TIMES[2]));
    render(<Home />);
    // Wait for the model window to have arrived.
    await screen.findByText('2026-10-07 06:00 UTC → 2026-10-08 18:00 UTC');
    fireEvent.click(screen.getByRole('button', { name: /HISTORICAL REPLAY/i }));
  }

  it('names the model date and the replay date it is not matched to', async () => {
    await renderReplay();

    const badge = await screen.findByTestId('model-time-badge');
    expect(badge.textContent).toContain('MODEL: 2026-10-08 18:00 UTC');
    expect(badge.textContent).toContain('NOT TIME-MATCHED to replay date');
    expect(badge.textContent).toContain('2020-05-18');
  });

  it('still requests model layers — they are shown, not hidden, but labelled', async () => {
    await renderReplay();

    await waitFor(() => expect(getLayerData).toHaveBeenCalled());
    // The requested time is a real model time, never the replay time itself.
    for (const call of getLayerData.mock.calls) {
      expect(MODEL_TIMES).toContain(call[1]);
    }
  });

  it('no badge in LIVE OCEAN — there the model date IS the timeline date', async () => {
    getLayerData.mockResolvedValue(layerPayload(MODEL_TIMES[2]));
    render(<Home />);
    await waitFor(() => expect(getLayerData).toHaveBeenCalled());
    expect(screen.queryByTestId('model-time-badge')).not.toBeInTheDocument();
  });

  it('no badge when no model layer is on screen', async () => {
    getLayers.mockResolvedValue([]);
    render(<Home />);
    // Wait for the model window to have arrived.
    await screen.findByText('2026-10-07 06:00 UTC → 2026-10-08 18:00 UTC');
    fireEvent.click(screen.getByRole('button', { name: /HISTORICAL REPLAY/i }));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(screen.queryByTestId('model-time-badge')).not.toBeInTheDocument();
  });
});

describe('Argo in LIVE mode', () => {
  it('shows only profiles observed near the selected model time, and counts them', async () => {
    getArgoProfiles.mockResolvedValue([
      argo('near-1', '2026-10-07T20:28:35Z'),
      argo('near-2', '2026-10-04T00:55:05Z'),
      argo('ancient', '2020-05-18T12:00:00Z'),
    ]);

    render(<Home />);

    // Marker sits on 2026-10-08 18:00; ±5 days keeps the two October profiles
    // and drops the 2020 one.
    expect(await screen.findByText('2 PROFILES ±5 d')).toBeInTheDocument();
    expect(screen.getByText('2 ARGO PROFILES ±5 d OF MODEL TIME')).toBeInTheDocument();
  });

  it('keeps every profile in HISTORICAL REPLAY, where none can match a replay fix', async () => {
    getArgoProfiles.mockResolvedValue([
      argo('near-1', '2026-10-07T20:28:35Z'),
      argo('ancient', '2020-05-18T12:00:00Z'),
    ]);

    render(<Home />);
    await screen.findByText('1 PROFILES ±5 d');

    fireEvent.click(screen.getByRole('button', { name: /HISTORICAL REPLAY/i }));
    expect(await screen.findByText('2 ARGO PROFILES (ALL DATES)')).toBeInTheDocument();
  });
});

describe('depth-resolved layers use the depth dataset own times', () => {
  it('requests the current field at a real depth-dataset time, not a surface time', async () => {
    getLayers.mockResolvedValue(CURRENTS_LAYERS);
    getRealCurrentFieldPayload.mockResolvedValue(null);

    render(<Home />);

    await waitFor(() => expect(getRealCurrentFieldPayload).toHaveBeenCalled());
    for (const call of getRealCurrentFieldPayload.mock.calls) {
      // The surface times (2026-10-07..08) are NOT in the depth dataset's
      // window (2026-10-10..17); asking for one is a guaranteed 404.
      expect(MODEL_DEPTH_TIMES).toContain(call[1]);
      expect(MODEL_TIMES).not.toContain(call[1]);
      expect(call[1]).toBe(MODEL_DEPTH_TIMES[2]); // its latest real time
    }
  });

  it('an explicit depth-slice timestamp is honoured as chosen', async () => {
    getLayers.mockResolvedValue(CURRENTS_LAYERS);
    getRealCurrentFieldPayload.mockResolvedValue(null);

    render(<Home />);
    await waitFor(() => expect(getRealCurrentFieldPayload).toHaveBeenCalled());

    fireEvent.click(await screen.findByTitle(/show model depth slice/i));
    fireEvent.change(await screen.findByLabelText(/depth slice variable/i), {
      target: { value: 'currents' },
    });
    fireEvent.change(await screen.findByLabelText(/depth slice model timestamp/i), {
      target: { value: MODEL_DEPTH_TIMES[0] },
    });

    await waitFor(() =>
      expect(getRealCurrentFieldPayload).toHaveBeenLastCalledWith(
        50,
        MODEL_DEPTH_TIMES[0],
        3,
        expect.any(AbortSignal)
      )
    );
  });

  it('the depth-slice picker shows the time the slice is actually requested at', async () => {
    getDepthSlice.mockResolvedValue(makeDepthSlicePayload({ timestamp: MODEL_DEPTH_TIMES[2] }));
    render(<Home />);
    fireEvent.click(await screen.findByTitle(/show model depth slice/i));

    // The request went out at the newest depth time...
    await waitFor(() =>
      expect(getDepthSlice).toHaveBeenCalledWith(
        'temperature',
        50,
        MODEL_DEPTH_TIMES[2],
        3,
        expect.any(AbortSignal)
      )
    );
    // ...so the picker must not display a different one.
    const picker = (await screen.findByLabelText(/depth slice model timestamp/i)) as HTMLSelectElement;
    expect(picker.value).toBe(MODEL_DEPTH_TIMES[2]);
  });

  it('the depth-slice picker offers the depth dataset own times', async () => {
    render(<Home />);
    fireEvent.click(await screen.findByTitle(/show model depth slice/i));

    const picker = (await screen.findByLabelText(/depth slice model timestamp/i)) as HTMLSelectElement;
    const options = Array.from(picker.options).map((o) => o.value);
    expect(options).toEqual(MODEL_DEPTH_TIMES);
  });
});

describe('risk time-matched labelling', () => {
  const score = {
    status: 'OK',
    heuristicDemoScore: 61,
    category: 'HIGH',
    modelTimestamp: '2026-10-07T06:00:00.000000000',
    timeMatched: false,
    modelType: 'prototype_rule_based',
    validated: false,
    operationalUse: 'NOT FOR OPERATIONAL USE',
    disclaimer: 'demo',
    weights: { windMaxPoints: 45 },
    evidence: [],
    explanation: null,
    affectedRegions: [],
  } as unknown as RiskAssessment;

  it('keeps the score and states that its ocean state is not the storm date', async () => {
    getRiskAssessment.mockResolvedValue(score);

    render(<Home />);
    fireEvent.click(screen.getByRole('button', { name: /HISTORICAL REPLAY/i }));

    // The score survives.
    expect(await screen.findByText(/HIGH 61\/100/)).toBeInTheDocument();
    // ...with a visible marker and the explanation in the tooltip.
    expect(screen.getByText(/\(OCEAN STATE ≠ STORM DATE\)/)).toBeInTheDocument();
    const tooltip = screen.getAllByTitle(/Ocean state from 2026-10-07 06:00 UTC, not the storm date/);
    expect(tooltip.length).toBeGreaterThan(0);
  });

  it('says nothing about the storm date when the model time IS the storm date', async () => {
    getRiskAssessment.mockResolvedValue({
      ...score,
      modelTimestamp: '2020-05-18T12:00:00.000000000',
      timeMatched: true,
    } as unknown as RiskAssessment);

    render(<Home />);
    fireEvent.click(screen.getByRole('button', { name: /HISTORICAL REPLAY/i }));

    expect(await screen.findByText(/HIGH 61\/100/)).toBeInTheDocument();
    expect(screen.queryByText(/\(OCEAN STATE ≠ STORM DATE\)/)).not.toBeInTheDocument();
    expect(screen.queryByTitle(/not the storm date/)).not.toBeInTheDocument();
  });
});