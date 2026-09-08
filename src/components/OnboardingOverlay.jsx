/* OCEAN-X onboarding — integrated intro overlay, frozen design. */
export default function OnboardingOverlay({ gone, onStart }) {
  return (
    <div id="intro" className={gone ? 'gone' : ''}>
      <div className="intro-inner">
        <div className="intro-mark">
          <svg viewBox="0 0 28 28" width="36" height="36">
            <path d="M3 5h22" stroke="#7a879c" strokeWidth="1.4" strokeLinecap="round" />
            <path d="M4.5 5v20" stroke="#7a879c" strokeWidth="1.1" opacity=".38" />
            <path d="M6 8.5h3.2c4.8 0 3.3 9.4 8.6 12.5 1.8 1 3.7 1.5 6 1.5" fill="none" stroke="#4da3d8"
              strokeWidth="1.8" strokeLinecap="round" />
            <path d="M19.5 6.5v6.5" stroke="#7a879c" strokeWidth="1.1" strokeDasharray="1.5 2.6"
              strokeLinecap="round" />
            <circle cx="19.5" cy="14.5" r="2.1" fill="#7fd4c1" />
          </svg>
        </div>
        <div className="intro-eyebrow">OCEAN-X</div>
        <div className="intro-place">Indian Ocean</div>
        <h1>Explore the <em>ocean</em> model</h1>
        <p>Explore the ocean model and compare it with in-situ observations.</p>
        <div className="intro-flow">
          <span>Model</span>
          <svg viewBox="0 0 12 12" width="11" height="11">
            <path d="M1 6h9M7 3l3 3-3 3" fill="none" stroke="currentColor" strokeWidth="1.4"
              strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>Observe</span>
          <svg viewBox="0 0 12 12" width="11" height="11">
            <path d="M1 6h9M7 3l3 3-3 3" fill="none" stroke="currentColor" strokeWidth="1.4"
              strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>Match</span>
          <svg viewBox="0 0 12 12" width="11" height="11">
            <path d="M1 6h9M7 3l3 3-3 3" fill="none" stroke="currentColor" strokeWidth="1.4"
              strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>Compare</span>
        </div>
        <button className="cta" id="intro-start" onClick={onStart}>Start exploring</button>
        <div className="intro-note">prototype · mock data · target dataset GLORYS12V1</div>
      </div>
    </div>
  );
}
