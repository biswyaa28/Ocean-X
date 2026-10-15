import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Contract for loadCesium() — the guard that stops the globe from ever
 * mounting before the CesiumJS runtime exists.
 *
 * The bug this prevents: on a client-side navigation the old
 * `<Script strategy="beforeInteractive">` in the nested /app layout rendered a
 * tag React refuses to execute, while `const Cesium = window.Cesium` latched
 * `undefined` at module scope. The globe hung on its loading fallback forever.
 */
const SCRIPT_ID = 'cesiumjs-runtime';
const CESIUM_SRC = '/cesium/Cesium.js';

/** Minimal stand-in for the real Cesium namespace. */
const fakeCesium = { Viewer: class {}, Cartesian3: {} };

function scripts(): HTMLScriptElement[] {
  return Array.from(document.querySelectorAll(`script#${SCRIPT_ID}`));
}

/** Resolve/reject the pending <script> the way the browser would. */
function settle(success: boolean) {
  const el = scripts()[0];
  expect(el, 'a script element should have been injected').toBeTruthy();
  el.dispatchEvent(new Event(success ? 'load' : 'error'));
}

async function importFresh() {
  vi.resetModules();
  return import('./cesiumRuntime');
}

describe('loadCesium', () => {
  beforeEach(() => {
    document.head.querySelectorAll(`#${SCRIPT_ID}`).forEach((n) => n.remove());
    delete (window as { Cesium?: unknown }).Cesium;
    delete (window as { CESIUM_BASE_URL?: string }).CESIUM_BASE_URL;
  });

  afterEach(() => {
    document.head.querySelectorAll(`#${SCRIPT_ID}`).forEach((n) => n.remove());
    delete (window as { Cesium?: unknown }).Cesium;
  });

  it('resolves immediately when window.Cesium already exists, injecting nothing', async () => {
    (window as { Cesium?: unknown }).Cesium = fakeCesium;
    const { loadCesium } = await importFresh();

    await expect(loadCesium()).resolves.toBe(fakeCesium);
    expect(scripts()).toHaveLength(0);
  });

  it('injects exactly one script when Cesium is absent, then resolves on load', async () => {
    const { loadCesium } = await importFresh();

    const promise = loadCesium();
    expect(scripts()).toHaveLength(1);
    expect(scripts()[0].src).toContain(CESIUM_SRC);

    // The browser runs the IIFE, which assigns window.Cesium.
    (window as { Cesium?: unknown }).Cesium = fakeCesium;
    settle(true);

    await expect(promise).resolves.toBe(fakeCesium);
  });

  it('sets CESIUM_BASE_URL before the script executes', async () => {
    const { loadCesium } = await importFresh();

    const promise = loadCesium();
    // Observed immediately after injection — the only window that matters,
    // because the script resolves its workers/assets as soon as it runs.
    expect((window as { CESIUM_BASE_URL?: string }).CESIUM_BASE_URL).toBe('/cesium/');

    (window as { Cesium?: unknown }).Cesium = fakeCesium;
    settle(true);
    await promise;
  });

  it('dedupes concurrent calls into a single injected script', async () => {
    const { loadCesium } = await importFresh();

    const a = loadCesium();
    const b = loadCesium();
    const c = loadCesium();

    expect(scripts()).toHaveLength(1);

    (window as { Cesium?: unknown }).Cesium = fakeCesium;
    settle(true);

    const results = await Promise.all([a, b, c]);
    expect(results).toEqual([fakeCesium, fakeCesium, fakeCesium]);
    expect(scripts()).toHaveLength(1);
  });

  it('does not re-inject across repeated calls after a successful load', async () => {
    const { loadCesium } = await importFresh();

    const first = loadCesium();
    (window as { Cesium?: unknown }).Cesium = fakeCesium;
    settle(true);
    await first;

    await loadCesium();
    await loadCesium();
    expect(scripts()).toHaveLength(1);
  });

  it('rejects with a readable error when the script fails to load', async () => {
    const { loadCesium } = await importFresh();

    const promise = loadCesium();
    settle(false);

    await expect(promise).rejects.toThrow(/Failed to load CesiumJS/);
  });

  it('rejects if the script loads but never defines window.Cesium', async () => {
    const { loadCesium } = await importFresh();

    const promise = loadCesium();
    settle(true); // 'load' fires but window.Cesium is still undefined

    await expect(promise).rejects.toThrow(/did not define window\.Cesium/);
  });

  it('allows a retry after a failure', async () => {
    const { loadCesium } = await importFresh();

    const failing = loadCesium();
    settle(false);
    await expect(failing).rejects.toThrow();

    // The failed element is removed so a retry starts clean.
    expect(scripts()).toHaveLength(0);

    const retry = loadCesium();
    expect(scripts()).toHaveLength(1);

    (window as { Cesium?: unknown }).Cesium = fakeCesium;
    settle(true);

    await expect(retry).resolves.toBe(fakeCesium);
  });

  it('reuses a pre-existing script element instead of injecting a second one', async () => {
    // Someone (or an earlier navigation) already added the tag.
    const existing = document.createElement('script');
    existing.id = SCRIPT_ID;
    document.head.appendChild(existing);

    const { loadCesium } = await importFresh();
    const promise = loadCesium();

    expect(scripts()).toHaveLength(1);

    (window as { Cesium?: unknown }).Cesium = fakeCesium;
    settle(true);

    await expect(promise).resolves.toBe(fakeCesium);
  });
});

describe('Cesium runtime handle', () => {
  beforeEach(() => {
    delete (window as { Cesium?: unknown }).Cesium;
  });

  afterEach(() => {
    delete (window as { Cesium?: unknown }).Cesium;
  });

  it('reads through to window.Cesium instead of latching undefined', async () => {
    const mod = await importFresh();

    // Before loading: the handle is empty but does not throw on `in`.
    expect('Cartesian3' in mod.default).toBe(false);

    // This is the exact race that broke the globe: the module evaluated
    // first, the script finished later. The handle must now see it.
    (window as { Cesium?: unknown }).Cesium = fakeCesium;

    expect('Cartesian3' in mod.default).toBe(true);
    expect(mod.default.Cartesian3).toBe(fakeCesium.Cartesian3);
  });

  it('throws a directive error if the handle is touched before loading', async () => {
    const mod = await importFresh();

    expect(() => mod.default.Cartesian3).toThrow(/before it finished loading/);
  });
});
