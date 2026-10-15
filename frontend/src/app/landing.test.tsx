import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import LandingPage from './page';
import { PROJECT_EVENT, PROJECT_NAME, PROJECT_TAGLINE, PROJECT_TEAM } from '../constants/project';

/**
 * Guards the promises the landing page makes: it links to /app, it says what
 * the project is, and it never claims anything the dashboard does not do.
 */

const originalFetch = global.fetch;
const originalGetContext = HTMLCanvasElement.prototype.getContext;
const originalRAF = globalThis.requestAnimationFrame;

beforeEach(() => {
  // jsdom has no canvas backend; the landing page draws a decorative hero, so a
  // stub context is enough to exercise the render path.
  HTMLCanvasElement.prototype.getContext = vi.fn().mockImplementation(() => ({
      setTransform: vi.fn(),
      fillRect: vi.fn(),
      createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
      createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
      globalCompositeOperation: '',
      fillStyle: '',
  })) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  globalThis.requestAnimationFrame = vi.fn(() => 1) as unknown as typeof globalThis.requestAnimationFrame;

  global.fetch = vi.fn(async () => {
    throw new Error('ECONNREFUSED');
  }) as unknown as typeof fetch;
  // next/link renders a plain anchor in tests.
  vi.mock('next/link', () => ({
    default: ({ href, children, ...rest }: { href: string; children: ReactNode } & Record<string, unknown>) => {
      return createElement('a', { href, ...rest }, children);
    },
  }));
});

afterEach(() => {
  global.fetch = originalFetch;
  HTMLCanvasElement.prototype.getContext = originalGetContext;
  globalThis.requestAnimationFrame = originalRAF;
  cleanup();
  vi.restoreAllMocks();
});

describe('LandingPage', () => {
  it('renders the project name from the shared constant', () => {
    render(<LandingPage />);
    expect(screen.getByRole('link', { name: new RegExp(`${PROJECT_NAME} home`, 'i') })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('measure');
  });

  it('states the one-line value proposition', () => {
    render(<LandingPage />);
    expect(screen.getByText(PROJECT_TAGLINE)).toBeTruthy();
  });

  it('links to /app from the hero and the footer', () => {
    render(<LandingPage />);
    const toApp = screen
      .getAllByRole('link')
      .filter((link) => link.getAttribute('href') === '/app');
    expect(toApp.length).toBeGreaterThanOrEqual(2);
    const hero = toApp.find((link) => link.textContent?.includes('Launch dashboard'));
    expect(hero).toBeTruthy();
  });

  it('has a secondary action that smooth-scrolls to how it works', () => {
    render(<LandingPage />);
    const cta = screen.getByRole('link', { name: /explore the data/i });
    expect(cta.getAttribute('href')).toBe('#features');
  });

  it('renders the landing navigation and anchored content sections', () => {
    render(<LandingPage />);
    expect(screen.getByRole('navigation')).toBeTruthy();
    expect(screen.getByRole('link', { name: /features/i }).getAttribute('href')).toBe('#features');
    expect(screen.getByRole('link', { name: /data flow/i }).getAttribute('href')).toBe('#how-it-works');
    expect(screen.getByRole('link', { name: /data note/i }).getAttribute('href')).toBe('#data-note');
    expect(document.querySelector('#features')).toBeTruthy();
    expect(document.querySelector('#data-note')).toBeTruthy();
  });

  it('uses semantic landmarks and a sane heading order', () => {
    const { container } = render(<LandingPage />);
    expect(container.querySelector('main')).toBeTruthy();
    expect(container.querySelector('footer')).toBeTruthy();
    const levels = Array.from(container.querySelectorAll('h1,h2,h3')).map((h) =>
      Number(h.tagName.slice(1))
    );
    expect(levels[0]).toBe(1);
    // No level is ever skipped going down the page.
    levels.forEach((level, index) => {
      if (index > 0) expect(level - levels[index - 1]).toBeLessThanOrEqual(1);
    });
  });

  it('describes each screenshot with real alt text', () => {
    render(<LandingPage />);
    const images = Array.from(document.querySelectorAll('img'));
    expect(images).toHaveLength(5);
    images.forEach((img) => {
      expect(img.getAttribute('alt')).toBeTruthy();
      expect((img.getAttribute('alt') ?? '').length).toBeGreaterThan(30);
    });
    expect(document.querySelector('[data-hero-image="true"]')).toBeTruthy();
    expect(images.slice(1).every((img) => img.getAttribute('loading') === 'lazy')).toBe(true);
  });

  it('ships the three captured screenshots', () => {
    render(<LandingPage />);
    const images = Array.from(document.querySelectorAll('img'));
    expect(images.some((img) => img.getAttribute('alt')?.includes('3D globe'))).toBe(true);
    expect(images.some((img) => img.getAttribute('alt')?.includes('profile ribbon'))).toBe(true);
    expect(images.some((img) => img.getAttribute('alt')?.includes('TCHP product'))).toBe(true);
  });

  it('shows the team and event in the footer', () => {
    render(<LandingPage />);
    const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    expect(screen.getByText(new RegExp(escape(PROJECT_TEAM)))).toBeTruthy();
    expect(screen.getByText(new RegExp(escape(PROJECT_EVENT)))).toBeTruthy();
  });

  it('names its real data sources in the how-it-works flow', () => {
    render(<LandingPage />);
    const text = document.body.textContent ?? '';
    expect(text).toContain('INCOIS RSMC HYCOM');
    expect(text).toContain('Argo GDAC');
    expect(text).toContain('NOAA IBTrACS');
    expect(text).toContain('FastAPI');
    expect(text).toContain('CesiumJS');
  });

  it('presents features as factual rows with source tags', () => {
    render(<LandingPage />);
    expect(screen.getByText('3D globe: model + Argo together')).toBeTruthy();
    // getAllByText: two cards legitimately credit the same source — the globe
    // screenshot and the cyclone-heat screenshot are both HYCOM products. What
    // matters is that each real source is named, not that they are distinct.
    expect(screen.getAllByText('INCOIS RSMC HYCOM').length).toBeGreaterThan(0);
    expect(screen.getByText('Argo GDAC')).toBeTruthy();
    expect(document.querySelectorAll('[data-testid="feature-row"]')).toHaveLength(3);
  });

  it('names every real data source it draws on', () => {
    render(<LandingPage />);
    // IBTrACS supplies cyclone tracks and the risk engine rather than any one
    // feature screenshot, so it is asserted against the page as a whole.
    const text = document.body.textContent ?? '';
    ['INCOIS RSMC HYCOM', 'Argo GDAC', 'NOAA IBTrACS'].forEach((source) => {
      expect(text).toContain(source);
    });
  });

  it('uses the dedicated feature screenshots and regional TCHP note', () => {
    render(<LandingPage />);
    const featureImages = Array.from(document.querySelectorAll('[data-testid="feature-row"] img'));
    expect(featureImages[0]?.getAttribute('src')).toContain('globe');
    expect(featureImages[1]?.getAttribute('src')).toContain('matchup');
    expect(featureImages[2]?.getAttribute('src')).toContain('cyclone-heat');
    expect(screen.queryByText('Built to inspect, not decorate.')).toBeNull();
    expect(screen.getByText(/float-derived TCHP vs INCOIS TCHP product/i)).toBeTruthy();
  });

  it('makes no claim the app cannot back up', () => {
    render(<LandingPage />);
    const text = (document.body.textContent ?? '').toLowerCase();
    // These are the specific overclaims a landing page drifts into.
    ['trusted by', 'industry-leading', 'real-time', 'industry standard', 'used by agencies'].forEach(
      (claim) => {
        expect(text).not.toContain(claim);
      }
    );
  });

  it('states the demo subset honestly', () => {
    render(<LandingPage />);
    const text = (document.body.textContent ?? '').toLowerCase();
    expect(text).toContain('demo subset');
    expect(text).toContain('optional');
  });

  it('withholds the figures while the backend is unreachable', async () => {
    render(<LandingPage />);
    await waitFor(() => expect(screen.getByTestId('live-stats-unavailable')).toBeTruthy());
    expect(screen.queryByTestId('live-stats')).toBeNull();
  });

  it('does not mount Cesium', async () => {
    // The landing route must not request the globe engine at all.
    const { container } = render(<LandingPage />);
    const scripts = Array.from(document.querySelectorAll('script'));
    expect(scripts.some((s) => (s.getAttribute('src') ?? '').includes('Cesium'))).toBe(false);
    await waitFor(() =>
      expect(container.querySelector('canvas')?.getAttribute('data-testid')).toBe('ocean-canvas')
    );
  });
});