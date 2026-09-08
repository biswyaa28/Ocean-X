import { useState } from 'react';
import Timeline from './Timeline.jsx';
import DepthNavigator from './DepthNavigator.jsx';
import { api } from '../data/mockModel.js';

/* OCEAN-X left exploration rail — frozen design from the prototype.
   Every control is state-driven: values display from application
   state and interactions write back through the callbacks only. */

function Section({ title, minor, children }) {
  const [open, setOpen] = useState(true);
  return (
    <section className={'sec' + (open ? '' : ' closed')}>
      <button className="sec-h" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <span className={minor ? 'h-sec minor' : 'h-sec'}>{title}</span>
        <svg className="chev" viewBox="0 0 10 10" width="9" height="9">
          <path d="M2 3.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5"
            strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <div className="sec-b"><div className="sec-i">{children}</div></div>
    </section>
  );
}

function LayerRow({ label, icon, checked, onChange }) {
  return (
    <label className="layer-row">
      <span className="n">
        <svg viewBox="0 0 16 16" width="14" height="14">{icon}</svg>
        {label}
      </span>
      <span className="switch">
        <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} /><i></i>
      </span>
    </label>
  );
}

const ICONS = {
  field: <path d="M8 2l6 3-6 3-6-3 6-3zM2 9l6 3 6-3M2 12l6 3 6-3" fill="none"
    stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />,
  argo: <>
    <circle cx="8" cy="5.5" r="2.6" fill="none" stroke="currentColor" strokeWidth="1.3" />
    <path d="M2.5 13.5c1.4-2.4 3.2-3.6 5.5-3.6s4.1 1.2 5.5 3.6" fill="none"
      stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
  </>,
  bathy: <>
    <path d="M1.5 11.5l3.5-5 3 4 2.5-3.5 4 4.5" fill="none" stroke="currentColor"
      strokeWidth="1.2" strokeLinejoin="round" />
    <path d="M1.5 14.2h13" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity=".55" />
  </>,
  currents: <path d="M1.5 5.5q2-2 4 0t4 0 4 0M1.5 10.5q2-2 4 0t4 0 4 0" fill="none"
    stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />,
  bounds: <path d="M2.5 2.5h11v11h-11z" fill="none" stroke="currentColor" strokeWidth="1.2"
    strokeDasharray="3 2.4" />
};

function RangeControl({ label, display, value, onChange, ariaLabel, note }) {
  const min = 0, max = 100;
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="ctrl">
      <div className="ctrl-h"><span className="lbl">{label}</span><span className="val">{display}</span></div>
      <input type="range" min={min} max={max} step="1" value={value} aria-label={ariaLabel}
        style={{ '--fill': pct + '%' }}
        onChange={e => onChange(+e.target.value)} />
      {note != null && <p className="note">{note}</p>}
    </div>
  );
}

const CHEV = (
  <svg className="chev" viewBox="0 0 10 10" width="10" height="10">
    <path d="M7 1 3 5l4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"
      strokeLinejoin="round" />
  </svg>
);

export default function ExplorerControls({
  state, depthAttract, matchedTimeText, matchTimeIdx,
  onRailCollapse, onRailOpen, onDatasetAttempt, onVariableChange,
  onSetTime, onSetDepth, onToggle, onExaggeration, onOpacity,
  onResetCamera, onResetView
}) {
  const depths = api.getModelDepths();
  const vscaleNote = state.exaggeration === 1
    ? '1× is the true geometric scale.'
    : '1× is the true geometric scale; geometry is exaggerated for legibility.';

  return (
    <>
      <aside id="rail" className="reveal-o">
        <div className="rail-head">
          <span className="h-sec">Explorer</span>
          <button className="icon-btn" id="rail-collapse" title="Hide panel" aria-label="Hide explorer panel"
            onClick={onRailCollapse}>
            {CHEV}
          </button>
        </div>
        <div className="rail-scroll">


          <Section title="Explore">
            <div className="ctrl">
              <div className="ctrl-h"><span className="lbl">Dataset</span></div>
              <span className="sel"><select id="ctl-dataset" value="glorys"
                onChange={e => { if (e.target.value !== 'glorys') onDatasetAttempt(); }}>
                <option value="glorys">GLORYS12 multi-year reanalysis</option>
                <option value="multiobs">MULTIOBS_GLO_PHY_MYNRT</option>
              </select></span>
            </div>
            <div className="ctrl">
              <div className="ctrl-h"><span className="lbl">Variable</span></div>
              <span className="sel"><select id="ctl-variable" value={state.variable}
                onChange={e => onVariableChange(e.target.value)}>
                <option value="temperature">Temperature</option>
                <option value="salinity">Salinity · Phase 2</option>
              </select></span>
              <p className="note" id="var-phase2-note" hidden={state.variable !== 'salinity'}>
                Salinity is a Phase 2 extension — not part of the primary demonstration.</p>
            </div>
            <div className="ctrl">
              <div className="ctrl-h"><span className="lbl">View time</span><span className="val"
                id="val-time">{state.time.toISOString().slice(0, 10)}</span></div>
              <div className="tl-wrap">
                <button className="icon-btn" id="tl-prev" title="Previous day" aria-label="Previous model day"
                  style={{ width: '24px', height: '24px' }}
                  onClick={() => { if (state.timeIdx > 0) onSetTime(state.timeIdx - 1); }}>
                  <svg viewBox="0 0 10 10" width="8" height="8">
                    <path d="M7 1 3 5l4 4" fill="none" stroke="currentColor" strokeWidth="1.7"
                      strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                <Timeline idx={state.timeIdx} matchIdx={matchTimeIdx} onChange={i => onSetTime(i, 'tl')} />
                <button className="icon-btn" id="tl-next" title="Next day" aria-label="Next model day"
                  style={{ width: '24px', height: '24px' }}
                  onClick={() => { if (state.timeIdx < 6) onSetTime(state.timeIdx + 1); }}>
                  <svg viewBox="0 0 10 10" width="8" height="8">
                    <path d="M3 1l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.7"
                      strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </div>
              {matchedTimeText != null && (
                <div className="match-row" id="match-row">
                  <span className="lbl">Matched model time</span>
                  <span className="val" id="val-match">{matchedTimeText}</span>
                </div>
              )}
            </div>
          </Section>

          <Section title="Depth">
            <div className="depth-head">
              <span className="lbl">Selected depth</span>
              <span className="depth-val" id="val-depth">{state.depth} m</span>
            </div>
            <DepthNavigator levels={depths} idx={state.depthIdx} attract={depthAttract}
              onChange={i => onSetDepth(i, 'nav')} />
            <div className="depth-sub" id="val-depth-sub">model z-level {state.depthIdx + 1} / {depths.length}</div>
          </Section>

          <Section title="Layers" minor>
            <LayerRow label="Temperature field" icon={ICONS.field} checked={state.showField}
              onChange={on => onToggle('showField', on)} />
            <LayerRow label="Argo observations" icon={ICONS.argo} checked={state.showArgo}
              onChange={on => onToggle('showArgo', on)} />
            <LayerRow label="Bathymetry" icon={ICONS.bathy} checked={state.showBathy}
              onChange={on => onToggle('showBathy', on)} />
            <LayerRow label="Surface currents" icon={ICONS.currents} checked={state.showCurrents}
              onChange={on => onToggle('showCurrents', on)} />
          </Section>

          <Section title="View" minor>
            <RangeControl label="Vertical scale" display={state.exaggeration + '×'}
              value={state.vscaleSlider} onChange={onExaggeration} ariaLabel="Vertical scale" note={vscaleNote} />
            <RangeControl label="Field opacity" display={Math.round(state.opacity * 100) + '%'}
              value={Math.round(state.opacity * 100)} onChange={v => onOpacity(v / 100)}
              ariaLabel="Field opacity" note={null} />
            <LayerRow label="Domain boundaries" icon={ICONS.bounds} checked={state.showBounds}
              onChange={on => onToggle('showBounds', on)} />
            <div className="ctrl" style={{ marginTop: '12px' }}>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button className="btn" id="btn-reset-camera" style={{ flex: 1 }}
                  onClick={onResetCamera}>Reset camera</button>
                <button className="btn" id="btn-reset-view" style={{ flex: 1 }}
                  onClick={onResetView}>Reset view</button>
              </div>
            </div>
          </Section>

        </div>
      </aside>
      <button id="rail-tab" className="icon-btn" title="Open explorer" aria-label="Open explorer panel"
        style={{ width: '34px', height: '42px' }} onClick={onRailOpen}>
        <svg viewBox="0 0 16 16" width="15" height="15">
          <path d="M2 4h8M2 8h12M2 12h6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>
    </>
  );
}

