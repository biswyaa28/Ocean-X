import { useEffect, useRef, useState } from 'react';

/* OCEAN-X header — frozen design from the prototype, plus the
   prototype-status popover (scientific honesty lives here). */
export default function Header({ variable, infoOpen, onInfoToggle }) {
  const popRef = useRef(null);

  useEffect(() => {
    if (!infoOpen) return;
    const close = e => {
      if (popRef.current && !popRef.current.contains(e.target)) onInfoToggle(false);
    };
    const esc = e => { if (e.key === 'Escape') onInfoToggle(false); };
    document.addEventListener('click', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('click', close);
      document.removeEventListener('keydown', esc);
    };
  }, [infoOpen, onInfoToggle]);

  const label = (variable === 'temperature' ? 'Temperature' : 'Salinity')
    + (variable === 'salinity' ? ' · P2' : '');

  return (
    <>
      <header id="app-header">
        <div className="brand">
          <svg viewBox="0 0 28 28" width="27" height="27" aria-hidden="true">
            <path d="M3 5h22" stroke="#7a879c" strokeWidth="1.4" strokeLinecap="round" />
            <path d="M4.5 5v20" stroke="#7a879c" strokeWidth="1.1" opacity=".38" />
            <path d="M6 8.5h3.2c4.8 0 3.3 9.4 8.6 12.5 1.8 1 3.7 1.5 6 1.5" fill="none" stroke="#4da3d8"
              strokeWidth="1.8" strokeLinecap="round" />
            <path d="M19.5 6.5v6.5" stroke="#7a879c" strokeWidth="1.1" strokeDasharray="1.5 2.6"
              strokeLinecap="round" />
            <circle cx="19.5" cy="14.5" r="2.1" fill="#7fd4c1" />
          </svg>
          <div>
            <div className="brand-name">OCEAN-X</div>
            <div className="brand-desc">Ocean Model · Observation Explorer</div>
          </div>
        </div>
        <div className="hdr-meta">
          <span className="hdr-ds">GLORYS12V1</span>
          <span className="sep">·</span>
          <span className="m">Indian Ocean</span>
          <span className="sep">·</span>
          <span className="hdr-var"><i id="hdr-var-dot" style={{ background: variable === 'temperature' ? 'var(--blue)' : 'var(--seafoam)' }}></i><span id="hdr-var">{label}</span></span>
          <button className="icon-btn" id="btn-info" title="Prototype status" aria-label="Prototype status"
            onClick={e => { e.stopPropagation(); onInfoToggle(!infoOpen); }}>
            <svg viewBox="0 0 14 14" width="12" height="12">
              <path d="M4.6 5.2c.2-1.6 1.3-2.4 2.6-2.4 1.5 0 2.5 1 2.5 2.2 0 2-2.5 2-2.5 3.8" fill="none"
                stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <circle cx="7.1" cy="11" r=".9" fill="currentColor" />
            </svg>
          </button>
        </div>
      </header>

      <div id="info-pop" ref={popRef} hidden={!infoOpen}>
        <h3>Prototype status</h3>
        <div className="ip-row"><span className="k">Mode</span><span className="v note">offline demo · mock data</span></div>
        <div className="ip-row"><span className="k">Demo grid</span><span className="v">0.5° × 13 levels</span></div>
        <div className="ip-row"><span className="k">Target dataset</span><span className="v">GLORYS12V1</span></div>
        <div className="ip-row"><span className="k">Target grid</span><span className="v">≈1/12° × 50 levels</span></div>
        <div className="ip-row"><span className="k">Observations</span><span className="v">mock Argo profiles</span></div>
        <div className="ip-foot">Frontend prototype for SIH26067. The displayed field and all Argo
            profiles are locally generated mock data — no Copernicus Marine or Argo data is streamed.</div>
      </div>
    </>
  );
}
