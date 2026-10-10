/**
 * Cyclone-heat presentation.
 *
 * The panel exists to compare measured and modelled heat content. The tests
 * below pin the three ways that can go wrong:
 *
 *  1. it starts talking like a forecast ("the cyclone will intensify"),
 *  2. it shows a blank or a 0.000 where the measurement is genuinely missing,
 *  3. it silently presents the model's number without the caveat that the
 *     model's own TCHP formula is not published.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ArgoMatchupDrawer } from '../../components/ArgoMatchupDrawer';
import { apiProvider } from '../../services/ApiProvider';
import type { ArgoMatchupResponse } from '../../types/oceanlens';
import { makeArgoMatchup, makeArgoProfile } from '../fixtures/argoFixtures';

vi.mock('../../services/ApiProvider', () => ({
  apiProvider: {
    getArgoObservations: vi.fn(),
    getArgoMatchup: vi.fn(),
  },
}));

const getArgoObservations = vi.mocked(apiProvider.getArgoObservations);
const getArgoMatchup = vi.mocked(apiProvider.getArgoMatchup);

function renderDrawer(matchup: ArgoMatchupResponse) {
  const profile = makeArgoProfile();
  getArgoObservations.mockResolvedValue(profile.observations);
  getArgoMatchup.mockResolvedValue(matchup);
  return render(<ArgoMatchupDrawer profile={profile} onClose={() => {}} />);
}

async function openMatchupTab() {
  fireClick(screen.getByTitle('Matchup tab'));
  await waitFor(() => expect(getArgoMatchup).toHaveBeenCalled());
}

function fireClick(element: HTMLElement) {
  element.click();
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Cyclone heat section', () => {
  it('shows the float, model, residual and percentage for a warm profile', async () => {
    renderDrawer(makeArgoMatchup());
    await openMatchupTab();

    // Labels carry a CSS text-transform, so DOM casing is mixed-case. The
    // matchers are case-insensitive so they test content, not styling.
    await waitFor(() =>
      expect(screen.getByText(/float heat potential/i)).toBeTruthy()
    );
    expect(screen.getByText(/^model heat potential$/i)).toBeTruthy();
    expect(screen.getByText(/model residual/i)).toBeTruthy();
    expect(screen.getByText('82.4 kJ/cm2')).toBeTruthy();
    expect(screen.getByText('96.1 kJ/cm2')).toBeTruthy();
    expect(screen.getByText('+13.7 kJ/cm2')).toBeTruthy();
    expect(screen.getByText('+16.6% of the float estimate')).toBeTruthy();
  });

  it('states the plain-language difference between model and float', async () => {
    renderDrawer(makeArgoMatchup());
    await openMatchupTab();

    await waitFor(() =>
      expect(
        screen.getByText(/MODEL HEAT POTENTIAL IS 13.7 KJ\/CM2 ABOVE THE FLOAT ESTIMATE/i)
      ).toBeTruthy()
    );
  });

  it('reports D26 for the float and MLD for the model', async () => {
    renderDrawer(makeArgoMatchup());
    await openMatchupTab();

    await waitFor(() => expect(screen.getByText('64.2 m')).toBeTruthy());
    expect(screen.getByText('11.5 m')).toBeTruthy();
    expect(screen.getByText(/float 26 c depth \(d26\)/i)).toBeTruthy();
    expect(screen.getByText(/model mixed layer depth/i)).toBeTruthy();
  });

  it('never claims a cyclone will form or intensify', async () => {
    renderDrawer(makeArgoMatchup());
    await openMatchupTab();

    await waitFor(() => expect(screen.getByText(/^cyclone heat$/i)).toBeTruthy());
    const raw = (document.body.textContent ?? '').toLowerCase();

    // The panel's own disclaimer legitimately contains the phrases this test
    // forbids ("it says nothing about whether a cyclone will form"), so the
    // disclaimer is removed before scanning. What is left is every other
    // string the panel renders, and none of it may assert a forecast.
    const disclaimer = 'this is a comparison of measured and modelled heat content, not a forecast. it says nothing about whether a cyclone will form, intensify or track.';
    expect(raw).toContain(disclaimer);
    const withoutDisclaimer = raw.split(disclaimer).join(' ');

    for (const forbidden of [
      'will intensify',
      'will form',
      'will develop',
      'expected to',
      'forecast to',
      'predicted landfall',
      'cyclone is likely',
      'is expected',
      'risk of a cyclone',
      'warning',
    ]) {
      expect(withoutDisclaimer).not.toContain(forbidden);
    }
  });

  it('says "Not available" with the reason instead of a blank or a zero', async () => {
    renderDrawer(
      makeArgoMatchup({
        tchpFloatKjCm2: null,
        tchpModelKjCm2: null,
        tchpResidualKjCm2: null,
        tchpResidualPercent: null,
        d26FloatM: null,
        mldModelM: null,
        metricsStatus: 'FLOAT_METRICS_UNAVAILABLE',
        metricsReason: 'shallowest accepted sample deeper than 10 m',
      })
    );
    await openMatchupTab();

    await waitFor(() =>
      expect(screen.getByText(/shallowest accepted sample deeper than 10 m/)).toBeTruthy()
    );
    // Not available, and specifically NOT 0.0.
    expect(screen.getAllByText('Not available').length).toBeGreaterThan(0);
    expect(screen.queryByText('0.0 kJ/cm2')).toBeNull();
  });

  it('treats a genuine float TCHP of zero as a measurement, not a failure', async () => {
    renderDrawer(
      makeArgoMatchup({
        tchpFloatKjCm2: 0,
        tchpModelKjCm2: 41.2,
        tchpResidualKjCm2: 41.2,
        tchpResidualPercent: null,
        metricsStatus: 'SURFACE_BELOW_ISOTHERM',
      })
    );
    await openMatchupTab();

    await waitFor(() => expect(screen.getByText('0.0 kJ/cm2')).toBeTruthy());
    // No percentage, because percent against zero is undefined.
    expect(screen.queryByText(/of the float estimate/)).toBeNull();
  });

  it('carries the caveat that the model TCHP formula is not published', async () => {
    renderDrawer(makeArgoMatchup());
    await openMatchupTab();

    await waitFor(() =>
      expect(screen.getByText(/how comparable is the model value\?/i)).toBeTruthy()
    );
    const details = screen
      .getByText(/how comparable is the model value\?/i)
      .closest('details');
    expect(details?.textContent).toMatch(/no standard_name/i);
  });

  it('uses "heat potential" and "model residual" wording', async () => {
    renderDrawer(makeArgoMatchup());
    await openMatchupTab();

    await waitFor(() => expect(screen.getByText(/^cyclone heat$/i)).toBeTruthy());
    const text = (document.body.textContent ?? '').toLowerCase();
    expect(text).toMatch(/heat potential/);
    expect(text).toMatch(/model residual/);
  });
});