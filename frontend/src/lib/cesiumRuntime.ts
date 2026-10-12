import type * as CesiumNamespace from 'cesium';

type CesiumModule = typeof CesiumNamespace;

/**
 * Runtime handle to CesiumJS.
 *
 * WHY THIS EXISTS
 * ---------------
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
 * THE FIX
 * -------
 * Cesium is loaded as a classic script from `public/cesium/Cesium.js` (see
 * `app/layout.tsx`), which the bundler never sees. That file has zero illegal
 * escapes and assigns `window.Cesium`. This module is the single place that
 * reaches it, so there is exactly one place to change if the loading strategy
 * ever moves.
 *
 * `CesiumTypes` re-exports the namespace for TYPE positions only — it is
 * erased at compile time and therefore never bundled.
 */

declare global {
  interface Window {
    Cesium?: CesiumModule;
  }
}

const Cesium: CesiumModule = window.Cesium as CesiumModule;

export { Cesium };
export default Cesium;
