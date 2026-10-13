import Script from "next/script";

/*
 * Dashboard layout — /app only.
 *
 * CesiumJS is loaded here as a CLASSIC SCRIPT rather than imported from
 * node_modules, on purpose.
 *
 * Cesium inlines its Draco/Basis WASM decoders as template literals that
 * contain a raw NUL byte directly followed by the ASCII digits `123456789`.
 * Bundlers re-serialise string literals and rewrite that raw NUL as the escape
 * `\0`, producing `\01` — an octal escape sequence, which is illegal inside a
 * template literal. The bundled Cesium chunk then fails to parse ("Octal escape
 * sequences are not allowed in template strings"), so it never evaluates, the
 * dynamic import in CesiumGlobe never resolves, and the globe hangs on its
 * loading fallback forever.
 *
 * This reproduces on both the Turbopack and webpack builders. Loading the
 * prebuilt IIFE from public/ keeps Cesium out of the module graph entirely.
 * See src/lib/cesiumRuntime.ts for the full explanation.
 *
 * It lives in THIS layout rather than the root one so that the landing page at
 * "/" never requests it: the landing page draws its own small canvas and must
 * not pay for the globe engine.
 */
export default function DashboardLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <>
      <Script src="/cesium/Cesium.js" strategy="beforeInteractive" />
      {children}
    </>
  );
}