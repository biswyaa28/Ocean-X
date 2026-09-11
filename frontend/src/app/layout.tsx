import type { Metadata } from "next";
import { Inter, Manrope, IBM_Plex_Mono } from "next/font/google";
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
        {children}
      </body>
    </html>
  );
}

