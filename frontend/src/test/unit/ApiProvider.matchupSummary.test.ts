/**
 * ApiProvider.getArgoMatchupSummary — contract tests.
 *
 * The regional panel renders whatever this method returns, so the only place
 * a fabricated summary can enter the UI is here: a response of the wrong shape
 * must become null, never a half-populated object the panel would render as
 * real numbers.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApiProvider } from '../../services/ApiProvider';

function jsonResponse(body: unknown, ok = true) {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
  } as unknown as Response;
}

const VALID = {
  matchMode: 'model_levels',
  modelDataset: 'INCOIS HYCOM',
  modelRuns: ['20261004'],
  floatBracketMaxGapM: 50,
  floatBracketMaxGapDeepM: 100,
  floatBracketDeepBreakpointM: 150,
  totalProfileCount: 1,
  includedProfileCount: 1,
  excludedProfileCount: 0,
  excludedProfileReasons: {},
  excludedProfiles: [],
  byModelDepth: [
    {
      modelDepthM: 17.5,
      temperature: { n: 1, bias: 0.2, mae: 0.2, rmse: 0.2 },
      salinity: { n: 1, bias: 0.0, mae: 0.0, rmse: 0.0 },
    },
  ],
  overall: {
    temperature: { n: 1, bias: 0.2, mae: 0.2, rmse: 0.2 },
    salinity: { n: 1, bias: 0.0, mae: 0.0, rmse: 0.0 },
  },
  profiles: [],
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/health')) return jsonResponse({ status: 'ok' });
    if (url.includes('/argo/matchup/summary')) return jsonResponse(VALID);
    return jsonResponse({}, false);
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ApiProvider.getArgoMatchupSummary', () => {
  it('requests the summary endpoint and returns the payload', async () => {
    const provider = new ApiProvider();
    const summary = await provider.getArgoMatchupSummary();

    expect(summary).not.toBeNull();
    expect(summary?.byModelDepth).toHaveLength(1);
    expect(summary?.byModelDepth[0].modelDepthM).toBe(17.5);
    const called = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(called.some((url) => url.endsWith('/argo/matchup/summary'))).toBe(true);
  });

  it('returns null when the payload has no per-depth rows', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/health')) return jsonResponse({ status: 'ok' });
      if (url.includes('/argo/matchup/summary')) return jsonResponse({ overall: {} });
      return jsonResponse({}, false);
    });
    const provider = new ApiProvider();
    expect(await provider.getArgoMatchupSummary()).toBeNull();
  });

  it('returns null on a non-OK response instead of throwing', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/health')) return jsonResponse({ status: 'ok' });
      if (url.includes('/argo/matchup/summary')) return jsonResponse({}, false);
      return jsonResponse({}, false);
    });
    const provider = new ApiProvider();
    expect(await provider.getArgoMatchupSummary()).toBeNull();
  });
});