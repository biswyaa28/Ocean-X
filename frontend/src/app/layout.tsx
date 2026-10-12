import type { Metadata } from "next";
import { Inter, Manrope, IBM_Plex_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
  display: "swap",
});

const ibmPlexMono = IBM_Plex_Mono({
  weight: ["400", "500", "600", "700"],
  variable: "--font-mono-custom",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "OCEANLENS — Bay of Bengal Geospatial Intelligence",
  description:
    "3D ocean science, cyclone hazard tracking, and disaster intelligence command center for the Bay of Bengal region.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${manrope.variable} ${ibmPlexMono.variable} h-full antialiased dark`}
    >
      <body className="min-h-full flex flex-col bg-[#070a0f] text-slate-100 font-sans selection:bg-cyan-500/30 selection:text-cyan-200">
        {/*
          CesiumJS is loaded as a CLASSIC SCRIPT rather than imported from
          node_modules, on purpose.

          Cesium inlines its Draco/Basis WASM decoders as template literals that
          contain a raw NUL byte directly followed by the ASCII digits
          `123456789`. Bundlers re-serialise string literals and rewrite that raw
          NUL as the escape `\0`, producing `\01` — an octal escape sequence,
          which is illegal inside a template literal. The bundled Cesium chunk
          then fails to parse ("Octal escape sequences are not allowed in
          template strings"), so it never evaluates, the dynamic import in
          CesiumGlobe never resolves, and the globe hangs on its loading
          fallback forever.

          This reproduces on both the Turbopack and webpack builders. Loading the
          prebuilt IIFE from public/ keeps Cesium out of the module graph
          entirely. See src/lib/cesiumRuntime.ts for the full explanation.
        */}
        <Script src="/cesium/Cesium.js" strategy="beforeInteractive" />
        {children}
      </body>
    </html>
  );
}

