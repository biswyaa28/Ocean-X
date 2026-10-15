import type * as CesiumNamespace from 'cesium';

type CesiumModule = typeof CesiumNamespace;

/**
 * Runtime access to CesiumJS, plus the loader that guarantees it exists.
 *
 * WHY CESIUM IS NOT IMPORTED FROM node_modules
 * --------------------------------------------
 * Cesium inlines its Draco/Basis WASM decoders as JavaScript *template
 * literals* whose bytes include a raw NUL (`\0`) immediately followed by the
 * ASCII digits `123456789`. That is legal JavaScript in Cesium's own source,
 * but every JS bundler re-serialises string literals and rewrites the raw NUL
 * as the escape sequence `\0`. The result is `\01`, which is an **octal escape
 * sequence — illegal inside a template literal**. The emitted chunk then fails
 * to *parse* with:
 *
 *     Uncaught SyntaxError: Octal escape sequences are not allowed in
 *     template strings.
 *
 * Because the whole Cesium chunk is one file, that parse error prevents the
 * module from ever evaluating, so `import('./CesiumViewerInner')` never
 * resolves and the globe hangs forever on its loading fallback. This reproduces
 * on BOTH the Turbopack and the webpack builders, so it is not a bundler bug we
 * can configure away.
 *
 * The fix is to load the prebuilt IIFE from `public/cesium/Cesium.js`, which
 * the bundler never sees and which assigns `window.Cesium`. This module is the
 * single place that reaches it.
 *
 * WHY THERE IS A LOADER INSTEAD OF A <Script> TAG
 * ----------------------------------------------
 * A `<Script strategy="beforeInteractive">` is only honoured in the ROOT layout.
 * Placed in a nested layout, a client-side navigation renders the tag into a
 * React tree, and React refuses to execute scripts it renders on the client:
 *
 *     Encountered a script tag while rendering React component. Scripts inside
 *     React components are never executed when rendering on the client.
 *
 * The tag lands in the DOM but never runs. Worse, a plain
 * `const Cesium = window.Cesium` at module scope latches `undefined` when this
 * module happens to evaluate before the script does — and because the binding
 * is a `const`, it stays `undefined` for the life of the page even after the
 * script finishes. The globe then hangs on its loading fallback with:
 *
 *     Uncaught TypeError: can't access property "Cartesian3", ...default is undefined
 *
 * So the handle below is a live proxy (never latches), and `loadCesium()` is the
 * only supported way to make sure Cesium is present before the viewer mounts.
 */

declare global {
  interface Window {
    Cesium?: CesiumModule;
    CESIUM_BASE_URL?: string;
  }
}

/** Where the prebuilt Cesium IIFE is served from (`public/cesium/Cesium.js`). */
const CESIUM_SRC = '/cesium/Cesium.js';

/**
 * Base URL Cesium resolves its workers, assets, shaders and widgets against.
 * Must be set BEFORE the script executes, or the first asset lookup 404s.
 */
const CESIUM_BASE_URL = '/cesium/';

/** Element id used to dedupe concurrent injections. */
const SCRIPT_ID = 'cesiumjs-runtime';

/**
 * In-flight or settled load promise. Shared so that N concurrent callers — and
 * repeated client-side navigations — inject exactly one <script>.
 */
let pending: Promise<CesiumModule> | null = null;

function removeInjectedScript() {
  document.getElementById(SCRIPT_ID)?.remove();
}

/**
 * Load CesiumJS exactly once and resolve with the namespace.
 *
 * - resolves immediately if `window.Cesium` already exists
 * - injects a single deduped `<script id="cesiumjs-runtime">`
 * - sets `window.CESIUM_BASE_URL` before the script executes
 * - on failure, removes the element and clears `pending` so a later call retries
 */
export function loadCesium(): Promise<CesiumModule> {
  if (typeof window === 'undefined') {
    return Promise.reject(
      new Error('loadCesium() requires a browser environment.')
    );
  }
  if (window.Cesium) return Promise.resolve(window.Cesium);
  if (pending) return pending;

  pending = new Promise<CesiumModule>((resolve, reject) => {
    const fail = (message: string) => {
      // Allow a retry: drop both the element and the cached rejection.
      pending = null;
      removeInjectedScript();
      reject(new Error(message));
    };

    // Another caller may have injected it between our checks.
    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    const script: HTMLScriptElement = existing ?? document.createElement('script');

    script.addEventListener('load', () => {
      if (window.Cesium) resolve(window.Cesium);
      else
        fail(
          `Cesium loaded from ${CESIUM_SRC} but did not define window.Cesium.`
        );
    });
    script.addEventListener('error', () => {
      fail(`Failed to load CesiumJS from ${CESIUM_SRC}.`);
    });

    if (!existing) {
      script.id = SCRIPT_ID;
      script.src = CESIUM_SRC;
      script.async = true;
      // Set before insertion: the script runs as soon as it is appended.
      window.CESIUM_BASE_URL = CESIUM_BASE_URL;
      document.head.appendChild(script);
    }
  });

  return pending;
}

/**
 * Live view of `window.Cesium`.
 *
 * A proxy rather than a captured `const` so it can never latch `undefined`
 * during a client-side navigation, when this module evaluates before the
 * Cesium script does. Property reads are forwarded at call time, which also
 * gives a readable error instead of a cryptic `Cannot read property of
 * undefined` if something still touches the handle before `loadCesium()`.
 */
const Cesium: CesiumModule = new Proxy({} as CesiumModule, {
  get(_target, prop) {
    const runtime = window.Cesium;
    if (!runtime) {
      throw new Error(
        `CesiumJS accessed ("${String(prop)}") before it finished loading. Await loadCesium() before rendering components that use the Cesium runtime.`
      );
    }
    return runtime[prop as keyof CesiumModule];
  },
  has(_target, prop) {
    return !!window.Cesium && prop in window.Cesium;
  },
});

export { Cesium };
export default Cesium;
