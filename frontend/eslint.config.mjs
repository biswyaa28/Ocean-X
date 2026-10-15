import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

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
