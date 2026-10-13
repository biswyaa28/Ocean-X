import type { Metadata } from "next";
import { Inter, Manrope, IBM_Plex_Mono } from "next/font/google";
import { PROJECT_NAME } from "../constants/project";
import "./globals.css";

/*
 * Root layout — shared shell for EVERY route.
 *
 * Deliberately loads no CesiumJS. The dashboard pulls Cesium from
 * src/app/app/layout.tsx instead, so a visitor landing on "/" never downloads
 * the globe engine. Cesium is several megabytes; making the landing page pay
 * for it would be the single largest cost on the page and buys nothing, since
 * the landing page draws its own small canvas.
 */

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
  title: `${PROJECT_NAME} — Bay of Bengal Geospatial Intelligence`,
  description:
    "3D ocean science, cyclone hazard tracking, and disaster intelligence command center for the Bay of Bengal region.",
  metadataBase: new URL("http://localhost:3000"),
};

export const viewport = {
  themeColor: "#070a0f",
  width: "device-width",
  initialScale: 1,
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
        {children}
      </body>
    </html>
  );
}