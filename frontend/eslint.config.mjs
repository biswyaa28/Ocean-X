import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// TypeScript is deliberately held at 6.x. TS 7 typechecks this project cleanly
// and `next build` is happy with it, but the typescript-eslint bundled inside
// eslint-config-next declares SUPPORTED_TYPESCRIPT_VERSIONS = ">=4.8.4 <6.1.0"
// and calls handleUnsupportedTSVersion() at import time, so installing TS 7 makes
// `npm run lint` fail before it reads a single file. There is no override knob;
// the library resolves TypeScript with a plain require("typescript").
//
// Re-check on: https://github.com/typescript-eslint/typescript-eslint/issues/10940
// When that closes, `npm i -D typescript@^7` is the whole migration — the source
// already compiles clean under 7.0.2.
const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    // eslint-config-next ships these, but anchored (".next/**" only matches
    // <root>/.next, never a nested one). Re-declare them unanchored so a stray
    // nested build directory cannot be linted.
    "**/.next/**",
    "**/out/**",
    "**/build/**",
    "**/dist/**",
    "**/node_modules/**",
    "next-env.d.ts",
    // Vendored CesiumJS distribution (CESIUM_BASE_URL points here at runtime).
    // Third-party, pre-minified build output — not ours to lint.
    "public/cesium/**",
  ]),
  {
    rules: {
      // A leading underscore means "this parameter is required by the interface
      // but deliberately unused here" — the convention the data providers use
      // for stubbed methods. Same convention TypeScript itself honours.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
]);

export default eslintConfig;
