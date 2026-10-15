import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { ArgoMatchupDrawer } from '../../components/ArgoMatchupDrawer';

const getArgoMatchup = vi.fn();
const getArgoMatchupSummary = vi.fn();

vi.mock('../../services/ApiProvider', () => ({
  apiProvider: {
    getArgoMatchup: (...a: unknown[]) => getArgoMatchup(...a),
    getArgoMatchupSummary: (...a: unknown[]) => getArgoMatchupSummary(...a),
    getArgoObservations: vi.fn().mockResolvedValue([]),
  },
}));

/**
 * The drawer must hand RegionalSummary a compact layout when it is short.
 * The prop was dead for as long as it existed, so this pins the wiring that
 * makes it reachable.
 */

const matchup = {
  profileId: 'p1',
  floatId: '5907346',
  observationTimestamp: '2026-10-04T06:00:00Z',
  timeGapStatus: 'good',
  modelRun: '20261004',
  variables: ['temperature', 'salinity'],
  matchMode: 'model_levels',
  modelDepths: [0, 10],
};

let observedHeight = 1200;

class MockResizeObserver {
  constructor(private cb: ResizeObserverCallback) {}
  observe(target: Element) {
    // recharts shares the global, so hand back a well-formed entry rather than
    // firing the callback bare — ResponsiveContainer reads contentRect.
    const contentRect = {
      width: 420,
      height: observedHeight,
      top: 0,
      left: 0,
      right: 420,
      bottom: observedHeight,
      x: 0,
      y: 0,
    } as DOMRectReadOnly;
    this.cb(
      [{ target, contentRect } as unknown as ResizeObserverEntry],
      this as unknown as ResizeObserver
    );
  }
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.clearAllMocks();
  observedHeight = 1200;
  getArgoMatchup.mockResolvedValue(matchup);
  getArgoMatchupSummary.mockResolvedValue({
    totalProfileCount: 23,
    includedProfileCount: 20,
    excludedProfileCount: 3,
    modelRuns: ['a'],
    byModelDepth: [{ modelDepthM: 0, temperature: { n: 1, bias: 0.1, mae: 0.2, rmse: 0.3 }, salinity: { n: 1, bias: 0.1, mae: 0.2, rmse: 0.3 } }],
    tchpScatter: [],
    tchp: { n: 0, bias: null, mae: null, rmse: null, medianBias: null, meanModelMinusFloat: null, meanFloat: null, meanModel: null },
    tchpProfiles: [],
    tchpIsothermC: 26,
    tchpRuleOfThumbKJPerCm2: 50,
    overall: {
      temperature: { n: 1, bias: null, mae: null, rmse: null },
      salinity: { n: 1, bias: null, mae: null, rmse: null },
    },
    profiles: [],
    matchMode: 'model_levels',
    modelDataset: 'INCOIS HYCOM',
    floatBracketMaxGapM: 50,
    floatBracketMaxGapDeepM: 100,
    floatBracketDeepBreakpointM: 150,
    excludedProfileReasons: {},
    excludedProfiles: [],
    modelDepths: [0, 10],
    storedFileDepths: [0, 10],
  });

  vi.stubGlobal(
    'ResizeObserver',
    MockResizeObserver as unknown as typeof globalThis.ResizeObserver
  );
  // jsdom reports every element as 0x0, so the height the drawer measures has
  // to be supplied explicitly.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    function () {
      return { height: observedHeight, width: 420, top: 0, left: 0, right: 420, bottom: observedHeight, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
    }
  );
});

afterEach(() => vi.unstubAllGlobals());

async function renderRegionTab() {
  render(
    <ArgoMatchupDrawer
      profile={{
        profileId: 'p1',
        float_id: '5907346',
        floatId: '5907346',
        observation_time: '2026-10-04T06:00:00Z',
        latitude: 18,
        longitude: 88,
        institution: 'INCOIS',
        observations: [],
      } as never}
      onClose={() => {}}
    />
  );
  fireEvent.click(screen.getByTitle('Regional tab'));
  await waitFor(() => expect(getArgoMatchupSummary).toHaveBeenCalled());
}

describe('ArgoMatchupDrawer — compact wiring', () => {
  it('uses the full RegionalSummary layout when the drawer is tall', async () => {
    observedHeight = 1200;
    await renderRegionTab();

    await waitFor(() => expect(screen.getByText('20/23')).toBeTruthy());
    expect(screen.getByText('BIAS VS DEPTH — °C')).toBeTruthy();
  });

  it('uses the compact RegionalSummary layout when the drawer is short', async () => {
    observedHeight = 260;
    await renderRegionTab();

    await waitFor(() => expect(screen.getByText('20/23')).toBeTruthy());
    expect(screen.queryByText('BIAS VS DEPTH — °C')).toBeNull();
  });
});