import type { Metadata } from 'next';
import Link from 'next/link';
import OceanCanvas from '../components/landing/OceanCanvas';
import LiveStats from '../components/landing/LiveStats';
import Reveal from '../components/landing/Reveal';
import {
  PROJECT_EVENT,
  PROJECT_NAME,
  PROJECT_REPOSITORY_URL,
  PROJECT_TEAM,
  PROJECT_TAGLINE,
} from '../constants/project';

export const metadata: Metadata = {
  title: `${PROJECT_NAME} — 3D ocean model & Argo visualization, Bay of Bengal`,
  description: PROJECT_TAGLINE,
  openGraph: {
    title: `${PROJECT_NAME} — Bay of Bengal Geospatial Intelligence`,
    description: PROJECT_TAGLINE,
    type: 'website',
    siteName: PROJECT_NAME,
    images: [{ url: '/landing/dashboard-globe.webp', width: 1280, height: 720, alt: `${PROJECT_NAME} 3D ocean globe showing Argo float positions over the Bay of Bengal` }],
  },
};

/** Screenshots captured from the running dashboard, as optimised .webp. */
const SCREENSHOTS = [
  {
    src: '/landing/dashboard-globe.webp',
    alt: 'The OceanLens 3D globe showing Argo float positions and observation radii over the Bay of Bengal.',
    caption: '3D globe with Argo floats',
  },
  {
    src: '/landing/profile-ribbon.webp',
    alt: 'A selected float drawn as a vertical profile ribbon in the 3D scene, with HYCOM model levels marked as labelled spheres beside it.',
    caption: 'Float profile ribbon with HYCOM levels',
  },
  {
    src: '/landing/regional-summary.webp',
    alt: 'The regional summary panel showing model-minus-float bias by model depth and the TCHP comparison.',
    caption: 'Regional bias summary',
  },
];

const FEATURES = [
  {
    title: '3D globe: model + Argo together',
    body: 'INCOIS HYCOM currents, temperature and salinity sit on the same Cesium globe as the ingested Argo floats, so you can see where the water is being measured against where the model places it.',
  },
  {
    title: 'Float vs model matchup (profile comparison)',
    body: 'Open a float and compare its QC-passed profile against the model at the model’s own depth levels, per variable, with the residual convention stated rather than implied.',
  },
  {
    title: 'Cyclone ocean heat (TCHP, D26)',
    body: 'Float-derived heat content and the depth of the 26 °C isotherm next to the model’s own TCHP field, with the difference between the two definitions stated instead of presented as model error.',
  },
];

const STEPS = [
  {
    title: 'Collect',
    body: 'INCOIS RSMC HYCOM for the model, Argo GDAC for float profiles, NOAA IBTrACS for cyclone tracks.',
  },
  {
    title: 'Reconcile',
    body: 'A FastAPI service aligns time and space, matches float levels to model levels, and computes residual statistics.',
  },
  {
    title: 'Show',
    body: 'A CesiumJS web globe renders the model, the floats and their matchups directly in the browser.',
  },
];

export default function LandingPage() {
  return (
    <main className="flex-1">
      {/* ---------------- HERO ---------------- */}
      <section
        className="relative min-h-[100svh] flex items-center overflow-hidden"
        aria-labelledby="hero-heading"
      >
        <OceanCanvas />
        {/* Legibility scrim: the canvas is decoration, the text is the content. */}
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-gradient-to-b from-[#070a0f]/85 via-[#070a0f]/55 to-[#070a0f]"
        />

        <div className="relative z-10 w-full max-w-6xl mx-auto px-5 sm:px-8 py-20 sm:py-28">
          <p className="font-mono text-[11px] sm:text-xs uppercase tracking-[0.3em] text-cyan-300/90">
            {PROJECT_EVENT}
          </p>

          <h1
            id="hero-heading"
            className="mt-4 sm:mt-6 font-display text-4xl sm:text-6xl lg:text-7xl font-extrabold tracking-tight text-white text-balance"
          >
            {PROJECT_NAME}
          </h1>

          <p className="mt-4 sm:mt-6 max-w-2xl text-base sm:text-xl leading-relaxed text-slate-300 text-pretty">
            {PROJECT_TAGLINE}
          </p>

          <div className="mt-8 sm:mt-10 flex flex-col sm:flex-row gap-3">
            <Link
              href="/app"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-cyan-400 px-6 py-3.5 text-sm font-bold text-[#04121c] shadow-[0_0_30px_rgba(34,211,238,0.25)] transition-transform hover:scale-[1.02] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200 active:scale-[0.99]"
            >
              Launch dashboard
              <span aria-hidden="true">→</span>
            </Link>
            <a
              href="#how-it-works"
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/5 px-6 py-3.5 text-sm font-semibold text-slate-200 backdrop-blur transition-colors hover:bg-white/10 hover:border-white/25 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200"
            >
              See how it works
            </a>
          </div>
        </div>
      </section>

      {/* ---------------- WHAT IT DOES ---------------- */}
      <section className="relative py-16 sm:py-24" aria-labelledby="features-heading">
        <div className="max-w-6xl mx-auto px-5 sm:px-8">
          <Reveal>
            <h2
              id="features-heading"
              className="font-display text-2xl sm:text-4xl font-extrabold text-white"
            >
              What it does
            </h2>
          </Reveal>
          <div className="mt-8 sm:mt-12 grid gap-4 sm:gap-6 md:grid-cols-3">
            {FEATURES.map((feature, index) => (
              <Reveal key={feature.title} delay={index * 90}>
                <article className="h-full rounded-2xl border border-white/10 bg-[#080c14]/70 p-6 backdrop-blur-xl transition-colors hover:border-cyan-400/35 hover:bg-[#0a1018]/80">
                  <h3 className="font-display text-lg font-bold text-cyan-200">
                    {feature.title}
                  </h3>
                  <p className="mt-3 text-sm leading-relaxed text-slate-400">{feature.body}</p>
                </article>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------- LIVE PROOF ---------------- */}
      <section className="relative py-16 sm:py-24" aria-labelledby="live-heading">
        <div className="max-w-6xl mx-auto px-5 sm:px-8">
          <Reveal>
            <h2 id="live-heading" className="font-display text-2xl sm:text-4xl font-extrabold text-white">
              What is in the data right now
            </h2>
            <p className="mt-3 max-w-2xl text-sm sm:text-base leading-relaxed text-slate-400">
              These counts are read from the running analysis backend. If it cannot be reached,
              they are withheld rather than replaced with placeholder numbers.
            </p>
          </Reveal>
          <Reveal delay={120} className="mt-8">
            <LiveStats />
          </Reveal>
        </div>
      </section>

      {/* ---------------- HOW IT WORKS ---------------- */}
      <section
        id="how-it-works"
        className="relative py-16 sm:py-24 scroll-mt-8"
        aria-labelledby="how-heading"
      >
        <div className="max-w-6xl mx-auto px-5 sm:px-8">
          <Reveal>
            <h2 id="how-heading" className="font-display text-2xl sm:text-4xl font-extrabold text-white">
              How it works
            </h2>
          </Reveal>
          <ol className="mt-8 sm:mt-12 grid gap-4 sm:gap-6 md:grid-cols-3">
            {STEPS.map((step, index) => (
              <Reveal
                key={step.title}
                as="li"
                delay={index * 90}
                className="h-full rounded-2xl border border-white/10 bg-[#080c14]/70 p-6 backdrop-blur-xl"
              >
                <span className="font-mono text-xs text-cyan-400/90">STEP {index + 1}</span>
                <h3 className="mt-2 font-display text-lg font-bold text-white">{step.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-slate-300">{step.body}</p>
              </Reveal>
            ))}
          </ol>
        </div>
      </section>

      {/* ---------------- SCREENSHOTS ---------------- */}
      <section className="relative py-16 sm:py-24" aria-labelledby="shots-heading">
        <div className="max-w-6xl mx-auto px-5 sm:px-8">
          <Reveal>
            <h2 id="shots-heading" className="font-display text-2xl sm:text-4xl font-extrabold text-white">
              The dashboard
            </h2>
          </Reveal>
          <div className="mt-8 sm:mt-12 grid gap-6 sm:gap-8 md:grid-cols-3">
            {SCREENSHOTS.map((shot, index) => (
              <Reveal key={shot.src} delay={index * 90}>
                <figure className="group">
                  {/* A tilted glass frame, so the shots read as objects rather
                      than as flat images pasted into a page. */}
                  <div
                    className="rounded-2xl border border-white/12 bg-[#080c14]/70 p-2 backdrop-blur-xl transition-transform duration-300 group-hover:-rotate-1 group-hover:scale-[1.01] motion-reduce:transform-none motion-reduce:transition-none"
                    style={{ rotate: `${index % 2 === 0 ? -1.2 : 1.2}deg` }}
                  >
                    <img
                      src={shot.src}
                      alt={shot.alt}
                      loading="lazy"
                      decoding="async"
                      width={1280}
                      height={720}
                      className="w-full rounded-xl border border-white/10 object-cover aspect-video"
                    />
                  </div>
                  <figcaption className="mt-3 text-xs text-slate-400">{shot.caption}</figcaption>
                </figure>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------- HONEST DATA NOTE ---------------- */}
      <section className="relative py-12 sm:py-16" aria-labelledby="data-heading">
        <div className="max-w-6xl mx-auto px-5 sm:px-8">
          <Reveal>
            <div className="rounded-2xl border border-amber-400/25 bg-amber-500/[0.06] p-6 sm:p-7">
              <h2
                id="data-heading"
                className="font-display text-base sm:text-lg font-bold text-amber-200"
              >
                About the data
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-slate-300 max-w-3xl">
                Everything shown comes from real sources: INCOIS RSMC HYCOM, Argo GDAC and NOAA
                IBTrACS. A small demo subset of the model ships with the repository so the
                dashboard runs without downloading gigabytes; the full dataset is optional and
                can be pointed at instead. Model values are labelled with the depth actually
                sampled, and where the source file labels a level differently the UI says so.
              </p>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ---------------- FOOTER ---------------- */}
      <footer className="relative border-t border-white/10 py-12">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
          <div>
            <p className="font-display text-sm font-extrabold tracking-widest text-white uppercase">
              {PROJECT_NAME}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              {PROJECT_TEAM} · {PROJECT_EVENT}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <a
              href={PROJECT_REPOSITORY_URL}
              className="inline-flex items-center rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-xs font-semibold text-slate-300 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200"
            >
              View source
            </a>
            <Link
              href="/app"
              className="inline-flex items-center justify-center rounded-xl bg-cyan-400 px-4 py-2.5 text-xs font-bold text-[#04121c] transition-transform hover:scale-[1.02] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200"
            >
              Launch dashboard
            </Link>
          </div>
        </div>
      </footer>
    </main>
  );
}