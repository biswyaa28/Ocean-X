import { Fragment } from 'react';
import { api } from '../data/mockModel.js';
import { fmtUTC, fmtLat, fmtLon, fmtHours } from '../engine/format.js';
import ProvenancePanel from './ProvenancePanel.jsx';

/* OCEAN-X contextual right inspector. `active` gates the profile
   body so the sequenced selection workflow (~150 ms) from the
   prototype is preserved. */

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

export default function ObservationInspector({
  selectedId, comp, active, variable, viewTime,
  provenanceOpen, onToggleProvenance, onClear, onOpenTray
}) {
  const profilesCount = api.getArgoProfiles().length;
  const showBody = !!selectedId && !!comp && active;

  return (
    <aside id="inspector">
      <div className="insp-head">
        <span className="h-sec" id="insp-title">{showBody ? 'Inspector' : 'Observations'}</span>
        <button className="icon-btn" id="btn-clear" title="Clear selection" aria-label="Clear selection"
          hidden={!showBody} onClick={onClear}>
          <svg viewBox="0 0 10 10" width="10" height="10">
            <path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <div className="insp-scroll">

        {!showBody ? (
          <div id="insp-empty">
            <svg className="glyph" viewBox="0 0 30 30" width="30" height="30">
              <circle cx="15" cy="15" r="8" fill="none" stroke="currentColor" strokeWidth="1.3" />
              <path d="M15 3v6M15 21v6M3 15h6M21 15h6" stroke="currentColor" strokeWidth="1.3"
                strokeLinecap="round" />
              <circle cx="15" cy="15" r="1.6" fill="#7fd4c1" />
            </svg>
            <h3>Observations</h3>
            <p>Choose an Argo profile in the scene to compare model and observation.</p>
            <div id="insp-count">{profilesCount} profiles available · mock</div>
          </div>
        ) : (
          <div id="insp-body" className="swap" key={comp.profile.meta.id + '|' + variable}>
            {(() => {
              const m = comp.profile.meta, mt = comp.match;
              const valid = api.getArgoProfile(m.id).levels.filter(l => l.qc === 1).length;
              return (
                <>
                  <div className="blk">
                    <div className="blk-t">Profile</div>
                    <div className="prof-id" id="ip-id">{m.id}</div>
                    <div className="prof-sub" id="ip-sub">{m.platform} · cycle {m.cycle}</div>
                    <div id="ip-rows"><KV rows={[
                      ['Location', fmtLat(m.lat) + ' · ' + fmtLon(m.lon)],
                      ['Observation time', fmtUTC(m.time)],
                      ['Data mode', m.mode === 'D'
                        ? <span className="chip chip-d">D · delayed</span>
                        : <span className="chip chip-a">A · adjusted RT</span>],
                      ['QC', m.qc === 'GOOD'
                        ? <span className="chip chip-g">GOOD</span>
                        : <span className="chip chip-m">MIXED</span>],
                      ['Valid levels', valid + ' / 45']
                    ]} /></div>
                  </div>
                  <div className="blk">
                    <div className="blk-t">Model match</div>
                    <div className="match-block">
                      <div id="ip-match"><KV rows={[
                        ['Matched model time', <span className="hl">{fmtUTC(mt.time)}</span>],
                        ['Current view time', <span id="ip-view">{fmtUTC(viewTime)}</span>],
                        ['Temporal difference', fmtHours(mt.dtHours)],
                        ['Grid cell', fmtLon(mt.lon) + ', ' + fmtLat(mt.lat)],
                        ['Spatial distance', mt.distanceKm.toFixed(1) + ' km']
                      ]} /></div>
                    </div>
                  </div>
                  <div className="blk">
                    <div className="blk-t">Comparison</div>
                    <p className="note">Profile, model and Analysis–Observation Residual are shown in the comparison tray.
                    </p>
                    <button className="open-tray-btn" id="btn-open-tray" onClick={onOpenTray}>Open comparison tray</button>
                  </div>
                  <div className="blk">
                    <ProvenancePanel comp={comp} variable={variable} open={provenanceOpen} onToggle={onToggleProvenance} />
                  </div>
                </>
              );
            })()}
          </div>
        )}

      </div>
    </aside>
  );
}
