import { Fragment } from 'react';
import { api } from '../data/mockModel.js';
import { fmtUTC, fmtLat, fmtLon, fmtHours } from '../engine/format.js';

/* OCEAN-X provenance section — full scientific provenance for the
   selected comparison. Information preserved verbatim. */
function KV({ rows }) {
  return (
    <div className="kv">
      {rows.map(([k, v]) => (
        <Fragment key={k}>
          <div className="k">{k}</div>
          <div className="v">{v}</div>
        </Fragment>
      ))}
    </div>
  );
}

export default function ProvenancePanel({ comp, variable, open, onToggle }) {
  const meta = api.getMetadata();
  const m = comp.profile.meta, mt = comp.match;
  return (
    <div className="prov">
      <button className={'prov-h' + (open ? ' open' : '')} id="prov-toggle" aria-expanded={open} onClick={onToggle}>
        <svg className="chev" viewBox="0 0 10 10" width="9" height="9">
          <path d="M2 3.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5"
            strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Provenance
      </button>
      <div className={'prov-body' + (open ? ' open' : '')} id="prov-body">
        <KV rows={[
          ['Dataset ID', <span style={{ fontSize: '10px' }}>{meta.datasetId}</span>],
          ['Dataset version', meta.version],
          ['Demo grid', meta.demoGrid],
          ['Target grid', meta.targetGrid],
          ['Model timestamp', fmtUTC(mt.time)],
          ['Model coordinates', fmtLon(mt.lon) + ', ' + fmtLat(mt.lat) + ' (' + mt.i + ', ' + mt.j + ')'],
          ['Observation timestamp', fmtUTC(m.time)],
          ['Observation coordinates', fmtLon(m.lon) + ', ' + fmtLat(m.lat)],
          ['Spatial distance', mt.distanceKm.toFixed(1) + ' km'],
          ['Time difference', fmtHours(mt.dtHours) + ' (model − obs)'],
          ['Argo data mode', m.mode === 'D' ? 'delayed mode (D)' : 'adjusted real-time (A)'],
          ['QC', m.qcDetail],
          ['Pressure-to-depth', 'gsw_z_from_p(p, lat) · TEOS-10'],
          ['Temperature conversion', variable === 'temperature'
            ? 'in-situ T (ITS-90) → potential temperature θ'
            : 'PSS-78 · TEOS-10 checks'],
          ['Vertical interpolation', 'linear in depth, z-levels → obs levels'],
          ['Comparison depths', comp.stats.n + ' levels · 0–1000 m']
        ]} />
      </div>
    </div>
  );
}
