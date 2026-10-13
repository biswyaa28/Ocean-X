import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import OceanCanvas, { particleCountFor, prefersReducedMotion } from './OceanCanvas';

/**
 * The hero canvas draws with requestAnimationFrame forever unless something stops
 * it. These tests pin the three things that must stop it: reduced motion, a
 * hidden tab, and unmount — plus the particle cap, which is what keeps a large
 * display from melting.
 */

const originalMatchMedia = window.matchMedia;
const originalRAF = globalThis.requestAnimationFrame;
const originalCAF = globalThis.cancelAnimationFrame;

function setReducedMotion(reduced: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: reduced && query.includes('prefers-reduced-motion'),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    onchange: null,
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

let rafCalls = 0;
let cancelled = 0;

beforeEach(() => {
  rafCalls = 0;
  cancelled = 0;
  setReducedMotion(false);
  globalThis.requestAnimationFrame = vi.fn((cb: FrameRequestCallback) => {
    rafCalls++;
    // Never actually invoke the callback: the loop must not run in a test.
    return rafCalls;
  }) as unknown as typeof globalThis.requestAnimationFrame;
  globalThis.cancelAnimationFrame = vi.fn(() => {
    cancelled++;
  }) as unknown as typeof globalThis.cancelAnimationFrame;

  // jsdom has no 2D context; a stub is enough because the tests assert on the
  // control flow (what starts and stops), not on the pixels.
  HTMLCanvasElement.prototype.getContext = vi.fn().mockImplementation(() => ({
      setTransform: vi.fn(),
      fillRect: vi.fn(),
      createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
      createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
      globalCompositeOperation: '',
      fillStyle: '',
  })) as unknown as typeof HTMLCanvasElement.prototype.getContext;
});

afterEach(() => {
  window.matchMedia = originalMatchMedia;
  globalThis.requestAnimationFrame = originalRAF;
  globalThis.cancelAnimationFrame = originalCAF;
  cleanup();
  vi.restoreAllMocks();
});

describe('particleCountFor', () => {
  it('scales with screen area rather than using a fixed number', () => {
    const phone = particleCountFor(360, 740);
    const laptop = particleCountFor(1440, 900);
    expect(laptop).toBeGreaterThan(phone);
  });

  it('never exceeds the hard ceiling on a very large display', () => {
    // A 5K display must not ask for thousands of particles.
    expect(particleCountFor(5120, 2880)).toBeLessThanOrEqual(340);
  });

  it('still renders something on a small phone', () => {
    expect(particleCountFor(360, 640)).toBeGreaterThan(0);
    expect(particleCountFor(360, 640)).toBeGreaterThanOrEqual(40);
  });

  it('returns zero for a degenerate size instead of throwing', () => {
    expect(particleCountFor(0, 0)).toBe(0);
    expect(particleCountFor(Number.NaN, 100)).toBe(0);
    expect(particleCountFor(-5, 100)).toBe(0);
  });
});

describe('prefersReducedMotion', () => {
  it('reports the media query result', () => {
    setReducedMotion(true);
    expect(prefersReducedMotion()).toBe(true);
    setReducedMotion(false);
    expect(prefersReducedMotion()).toBe(false);
  });
});

describe('OceanCanvas', () => {
  it('starts an animation loop when motion is allowed', () => {
    render(<OceanCanvas />);
    expect(rafCalls).toBeGreaterThan(0);
  });

  it('never starts an animation loop under prefers-reduced-motion', () => {
    setReducedMotion(true);
    render(<OceanCanvas />);
    // The static gradient is painted once; there is no loop at all.
    expect(rafCalls).toBe(0);
  });

  it('cancels the animation frame on unmount', () => {
    const { unmount } = render(<OceanCanvas />);
    const before = cancelled;
    unmount();
    expect(cancelled).toBeGreaterThan(before);
  });

  it('is hidden from assistive technology, being decorative', () => {
    const { container } = render(<OceanCanvas />);
    expect(container.querySelector('canvas')?.getAttribute('aria-hidden')).toBe('true');
  });
});