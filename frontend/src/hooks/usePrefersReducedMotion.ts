'use client';

import { useSyncExternalStore } from 'react';

/**
 * Tracks the OS/browser "reduce motion" preference as a live external store.
 *
 * The preference lives outside React (it is a CSS media query the user can flip
 * at any time), so it belongs in useSyncExternalStore rather than in an effect
 * that copies it into state. Two things this buys over the effect version:
 *
 * - useSyncExternalStore supplies a server snapshot, so server and client
 *   agree on the first render and hydration does not warn.
 * - A mid-session change (the user turns reduce-motion on while the page is
 *   open) re-renders every consumer, instead of only whoever happened to be
 *   listening at mount time.
 */
const QUERY = '(prefers-reduced-motion: reduce)';

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => {};
  }
  const mediaQuery = window.matchMedia(QUERY);
  mediaQuery.addEventListener('change', onChange);
  return () => mediaQuery.removeEventListener('change', onChange);
}

function getSnapshot(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(QUERY).matches;
}

// The server has no window and therefore no media query: report no preference.
function getServerSnapshot(): boolean {
  return false;
}

export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
