import type { Metadata } from 'next';
import Link from 'next/link';
import DashboardPreview from '../components/landing/DashboardPreview';
import DeferredLiveStats from '../components/landing/DeferredLiveStats';
import DeferredOceanCanvas from '../components/landing/DeferredOceanCanvas';
import Reveal from '../components/landing/Reveal';
import FeatureLightbox from '../components/landing/FeatureLightbox';
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
    images: [{ url: '/landing/hero.webp', width: 1800, height: 1013, alt: `${PROJECT_NAME} 3D ocean globe showing Argo float positions over the Bay of Bengal` }],
  },
};

const FEATURES = [
  {
    title: '3D globe: model + Argo together',
    body: 'INCOIS HYCOM currents, temperature and salinity sit on the same Cesium globe as the ingested Argo floats. See where the water is measured and where the model places it.',
    source: 'INCOIS RSMC HYCOM',
    image: '/landing/globe.webp',
    alt: 'OceanLens 3D globe with Argo floats and observation radii over the Bay of Bengal.',
  },
  {
    title: 'Float vs model matchup',
    body: 'Open a float and compare its QC-passed profile against the model at the model’s own depth levels, per variable, with the residual convention stated rather than implied.',
    source: 'Argo GDAC',
    image: '/landing/matchup.webp',
    alt: 'OceanLens profile ribbon comparing a selected Argo float with HYCOM levels.',
  },
  {
    title: 'Cyclone ocean heat',
    body: 'Read the cyclone-track context alongside the ocean heat view shown in the dashboard. The panel keeps the track context separate from the float and model heat products.',
    source: 'NOAA IBTrACS',
    image: '/landing/cyclone-heat.webp',
    alt: 'OceanLens cyclone tracks and ocean heat comparison view.',
  },
];

const STEPS = [
  { title: 'Sources', body: 'INCOIS RSMC HYCOM, Argo GDAC and NOAA IBTrACS provide the model, profiles and cyclone tracks.' },
  { title: 'FastAPI', body: 'The service aligns time and space, matches float levels to model levels, and computes residual statistics.' },
  { title: 'CesiumJS', body: 'A browser globe renders the model, floats and matchups without loading the dashboard engine on this page.' },
];

function FlowIcon({ index }: { index: number }) {
  if (index === 0) return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 16c3-8 13-8 16 0M5 11h14M7 7h10M12 4v16" /></svg>;
  if (index === 1) return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h10v14H7zM4 9h3M17 9h3M4 15h3M17 15h3M10 9h4M10 13h4" /></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" /><path d="M4 12h16M12 4a12 12 0 0 1 0 16M12 4a12 12 0 0 0 0 16" /></svg>;
}

export default function LandingPage() {
  return (
    <main className="landing-page">
      <nav className="landing-nav" aria-label="Primary navigation">
        <div className="landing-shell landing-nav__inner">
          <a href="#top" className="landing-brand" aria-label={`${PROJECT_NAME} home`}>
            <span className="landing-brand__mark" aria-hidden="true">◒</span>
            <span>{PROJECT_NAME}</span>
          </a>
          <div className="landing-nav__links">
            <a href="#features">Features</a>
            <a href="#how-it-works">Data flow</a>
            <a href="#data-note">Data note</a>
          </div>
          <Link href="/app" className="button button--small button--primary">Launch dashboard <span aria-hidden="true">↗</span></Link>
        </div>
      </nav>

      <section id="top" className="landing-hero" aria-labelledby="hero-heading">
        <DeferredOceanCanvas />
        <div className="hero-vignette" aria-hidden="true" />
        <div className="landing-shell landing-hero__grid">
          <div className="hero-copy">
            <p className="eyebrow"><span /> SIH26067 · BAY OF BENGAL</p>
            <h1 id="hero-heading">Compare the ocean you <em>measure</em> with the ocean you model.</h1>
            <p className="hero-lede"><span>{PROJECT_TAGLINE}</span> <span>Explore Argo profiles, HYCOM model fields and cyclone heat context in one view.</span></p>
            <div className="hero-actions">
              <Link href="/app" className="button button--primary">Launch dashboard <span aria-hidden="true">↗</span></Link>
              <a href="#features" className="button button--ghost">Explore the data <span aria-hidden="true">↓</span></a>
            </div>
          </div>
          <DashboardPreview className="hero-preview" loading="eager" priority />
        </div>
        <div className="landing-shell stats-dock" data-shot="stats" role="region" aria-label="Measured dashboard statistics">
          <DeferredLiveStats />
        </div>
      </section>

      <section id="features" className="landing-section landing-section--features" aria-labelledby="features-heading">
        <div className="landing-shell">
          <Reveal><div className="section-kicker">01 / THE VIEW</div><h2 id="features-heading">One basin. Three ways to read it.</h2><p className="section-intro">A visual comparison layer for the Bay of Bengal, grounded in the sources the dashboard actually uses.</p></Reveal>
          <div className="feature-list">
            {FEATURES.map((feature, index) => (
              <Reveal key={feature.title} delay={index * 100}>
                <article className={`feature-row ${index % 2 ? 'feature-row--reverse' : ''}`} data-testid="feature-row" data-shot={index === 0 ? 'feature' : undefined}>
                  <div className="feature-row__media"><FeatureLightbox src={feature.image} alt={feature.alt} width={1400} height={788} /></div>
                  <div className="feature-row__copy"><span className="feature-index">0{index + 1}</span><h3>{feature.title}</h3><p>{feature.body}</p><span className="source-tag">{feature.source}</span></div>
                </article>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section id="how-it-works" className="landing-section landing-section--flow" aria-labelledby="how-heading">
        <div className="landing-shell">
          <Reveal><div className="section-kicker">02 / THE PIPELINE</div><h2 id="how-heading">From source files to a navigable globe.</h2></Reveal>
          <ol className="flow-list">
            {STEPS.map((step, index) => <Reveal as="li" key={step.title} delay={index * 100}><div className="flow-card"><span className="flow-icon"><FlowIcon index={index} /></span><span className="flow-step">STEP 0{index + 1}</span><h3>{step.title}</h3><p>{step.body}</p></div>{index < STEPS.length - 1 && <span className="flow-connector" aria-hidden="true">→</span>}</Reveal>)}
          </ol>
        </div>
      </section>

      <section id="data-note" className="landing-section landing-section--honesty" aria-labelledby="data-heading">
        <div className="landing-shell"><Reveal><div className="honesty-card"><div><div className="section-kicker">DATA NOTE</div><h2 id="data-heading">Clear about what is measured.</h2></div><div><p>Everything shown comes from INCOIS RSMC HYCOM, Argo GDAC and NOAA IBTrACS. A small demo subset ships with the repository so the dashboard runs without downloading gigabytes; the full dataset is optional.</p><p className="honesty-caption">Float-derived TCHP vs INCOIS TCHP product; definitions differ.</p><FeatureLightbox src="/landing/regional.webp" alt="Regional panel comparing float-derived TCHP with the INCOIS TCHP product." width={1400} height={788} /></div></div></Reveal></div>
      </section>

      <footer className="landing-footer">
        <div className="landing-shell landing-footer__inner">
          <div><p className="landing-brand"><span className="landing-brand__mark" aria-hidden="true">◒</span>{PROJECT_NAME}</p><p className="footer-meta">{PROJECT_TEAM} · {PROJECT_EVENT}</p></div>
          <div className="footer-actions"><a href={PROJECT_REPOSITORY_URL}>View repository ↗</a><Link href="/app" className="button button--primary">Launch dashboard <span aria-hidden="true">↗</span></Link></div>
        </div>
      </footer>
    </main>
  );
}
