import { useEffect, useMemo, useRef } from 'react';
import { VARS, RAMP_DIV } from '../engine/fieldEngine.js';
import { useTween } from '../hooks/useTween.js';
import { fmtUTC } from '../engine/format.js';
import ProfileChart from './ProfileChart.jsx';
import ResidualChart from './ResidualChart.jsx';

/* OCEAN-X comparison tray: Profile / Residual tabs, metric rail
   with animated values, and the residual color legend.
   Ported from the prototype's tray markup + Charts + Metrics. */

function Metric({ label, value, format, active, children }) {
  const v = useTween(value, active);
  return (
    <div className="mrow">
      <span className="mk">{label}</span>
      <span className="mv">{v == null ? '—' : format(v)}{children}</span>
    </div>
  );
}

export default function ComparisonTray({
  comp, variable, trayTab, trayOpen, depth, timeIdx, chartsOn, metricsActive,
  railClosed, onSetTray, onSetTab
}) {
  const resCanvasRef = useRef(null);

  const cfg = VARS[variable];
  const unit = cfg.unit;
  const s = comp ? comp.stats : null;

  /* residual axis half-range (identical step search as the prototype) */
  const rmax = useMemo(() => {
    if (!comp) return null;
    let maxR = 0;
    comp.residuals.forEach(v => { maxR = Math.max(maxR, Math.abs(v)); });
    const steps = [0.1, 0.2, 0.25, 0.5, 1, 2, 2.5, 5, 10];
    return steps.find(st => st >= maxR * 1.2) || Math.ceil(maxR * 1.2);
  }, [comp]);

  /* residual color legend */
  useEffect(() => {
    const c = resCanvasRef.current;
    if (!c || !comp || trayTab !== 'residual' || rmax == null) return;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(c.width, c.height);
    for (let x = 0; x < c.width; x++) {
      const [r, g, b] = RAMP_DIV(x / (c.width - 1));
      for (let y = 0; y < c.height; y++) {
        const i = (y * c.width + x) * 4;
        img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [comp, trayTab, rmax]);

  /* keep figures crisp after layout changes */
  const resizeActive = () => {
    const el = document.getElementById(trayTab === 'profile' ? 'chart-profile' : 'chart-residual');
    if (el && !el.hidden && window.Plotly) window.Plotly.Plots.resize(el);
  };
  useEffect(() => {
    if (!railClosed) return;
    const t = setTimeout(resizeActive, 420);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [railClosed]);
  useEffect(() => {
    let t;
    const onResize = () => { clearTimeout(t); t = setTimeout(resizeActive, 220); };
    window.addEventListener('resize', onResize);
    return () => { window.removeEventListener('resize', onResize); clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trayTab]);

  const hasComp = !!comp && metricsActive;
  const fmtSigned2 = v => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(2) + ' ' + unit;
  const fmt2 = v => v.toFixed(2) + ' ' + unit;
  const fmt1km = v => v.toFixed(1) + ' km';

  return (
    <section id="tray" className="reveal-o">
      <div className="tray-bar" id="tray-bar" title="Open / close comparison"
        onClick={() => onSetTray(!trayOpen)}>
        <span className="tray-label">Comparison</span>
        <span className="tray-status" id="tray-status">
          {comp
            ? (<><span className="hl">{comp.profile.meta.id}</span> · matched <span className="mt">{fmtUTC(comp.match.time)}</span></>)
            : 'No observation selected'}
        </span>
        <button className="tray-open-btn" id="btn-tray-toggle"
          onClick={e => { e.stopPropagation(); onSetTray(!trayOpen); }}>
          <span id="btn-tray-txt">{trayOpen ? 'Close' : 'Open analysis'}</span>
          <svg className="chev" viewBox="0 0 10 10" width="10" height="10">
            <path d="M2 6.5l3-3 3 3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"
              strokeLinejoin="round" />
          </svg>
        </button>
      </div>
      <div className="tray-body">
        <div className="tray-head">
          <div className="seg" id="seg-tabs">
            <button data-tab="profile" className={trayTab === 'profile' ? 'on' : ''}
              onClick={() => onSetTab('profile')}>Profile</button>
            <button data-tab="residual" className={trayTab === 'residual' ? 'on' : ''}
              onClick={() => onSetTab('residual')}>Residual</button>
          </div>
          <div className="tray-title">
            <span className="tt" id="tray-title">
              {trayTab === 'profile' ? cfg.label + ' · depth profile' : 'Analysis–Observation Residual'}
            </span>
            <span className="tu" id="tray-unit">{unit}</span>
            <span className="res-legend" id="res-legend" hidden={trayTab !== 'residual' || !comp}>
              <canvas id="res-canvas" ref={resCanvasRef} width="96" height="6"></canvas>
              <span id="res-min">{rmax != null ? '−' + rmax.toFixed(1) : '—'}</span>
              <span>0</span>
              <span id="res-max">{rmax != null ? '+' + rmax.toFixed(1) : '—'}</span>
            </span>
          </div>
        </div>
        <div className="tray-main">
          <div className="chart-frame" id="chart-frame">
            <ProfileChart comp={comp} variable={variable} timeIdx={timeIdx} depth={depth}
              active={chartsOn && trayTab === 'profile'} />
            <ResidualChart comp={comp} variable={variable} depth={depth} rmax={rmax}
              active={chartsOn && trayTab === 'residual'} />
            {!comp && (
              <div className="chart-empty" id="chart-empty">
                <p>No observation selected</p>
                <p className="sub">Your selected profile analysis will appear here.</p>
              </div>
            )}
          </div>
          <div className={'metric-rail' + (comp ? ' swap' : '')} id="metric-rail"
            key={comp ? comp.profile.meta.id + '|' + comp.variable : 'empty'}>
            <Metric label="Bias" value={s ? s.bias : 0} active={hasComp} format={fmtSigned2} />
            <Metric label="MAE" value={s ? s.mae : 0} active={hasComp} format={fmt2} />
            <Metric label="RMSE" value={s ? s.rmse : 0} active={hasComp} format={fmt2} />
            <Metric label="Max |Δ|" value={s ? s.maxAbs : 0} active={hasComp} format={fmt2}>
              <small id="m-max-sub">{hasComp ? 'at ' + s.maxDepth + ' m' : ''}</small>
            </Metric>
            <Metric label="Match distance" value={comp ? comp.match.distanceKm : 0} active={hasComp} format={fmt1km} />
            <Metric label="Δt" value={comp ? comp.match.dtHours : 0} active={hasComp} format={fmtH} />
            <div className="mrail-n" id="m-n">
              {hasComp ? 'n = ' + s.n + (comp.excluded ? ' · ' + comp.excluded + ' QC-excluded' : '') : 'n = —'}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

  const fmtH = v => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(1) + ' h';
