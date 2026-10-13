import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
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
    default: ({ href, children, ...rest }: any) => {
      const { createElement } = require('react');
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
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(PROJECT_NAME);
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
    const cta = screen.getByRole('link', { name: /see how it works/i });
    expect(cta.getAttribute('href')).toBe('#how-it-works');
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
    expect(images).toHaveLength(3);
    images.forEach((img) => {
      expect(img.getAttribute('alt')).toBeTruthy();
      expect((img.getAttribute('alt') ?? '').length).toBeGreaterThan(30);
      expect(img.getAttribute('loading')).toBe('lazy');
    });
  });

  it('ships the three captured screenshots', () => {
    render(<LandingPage />);
    const sources = Array.from(document.querySelectorAll('img')).map((i) => i.getAttribute('src'));
    expect(sources).toContain('/landing/dashboard-globe.webp');
    expect(sources).toContain('/landing/profile-ribbon.webp');
    expect(sources).toContain('/landing/regional-summary.webp');
  });

  it('shows the team and event in the footer', () => {
    render(<LandingPage />);
    const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    expect(screen.getByText(new RegExp(escape(PROJECT_TEAM)))).toBeTruthy();
    // The event is used twice (hero eyebrow and footer), so assert both.
    expect(screen.getAllByText(new RegExp(escape(PROJECT_EVENT))).length).toBeGreaterThanOrEqual(2);
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

  it('does not mount Cesium', () => {
    // The landing route must not request the globe engine at all.
    const { container } = render(<LandingPage />);
    const scripts = Array.from(document.querySelectorAll('script'));
    expect(scripts.some((s) => (s.getAttribute('src') ?? '').includes('Cesium'))).toBe(false);
    expect(container.querySelector('canvas')?.getAttribute('data-testid')).toBe('ocean-canvas');
  });
});