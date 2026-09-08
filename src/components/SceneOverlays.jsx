import { useEffect, useRef, useState } from 'react';
import { VARS } from '../engine/fieldEngine.js';
import { api } from '../data/mockModel.js';
import { fmtDate, fmtLat, fmtLon, fmtUTC } from '../engine/format.js';

/* OCEAN-X scene overlays: vertical-scale badge, camera hint,
   temperature legend, toast stack, and the Argo hover tooltip.
   All state-driven; visuals identical to the frozen prototype. */

function Legend({ variable, depth, time, range, probe }) {
  const canvasRef = useRef(null);
  const cfg = VARS[variable];

  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !range) return;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(c.width, c.height);
    for (let x = 0; x < c.width; x++) {
      const [r, g, b] = cfg.ramp(x / (c.width - 1));
      for (let y = 0; y < c.height; y++) {
        const i = (y * c.width + x) * 4;
        img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [cfg, range]);

  return (
    <div id="legend" className="reveal-o">
      <div className="lg-t">
        <span className="lg-name" id="lg-var">{cfg.label}{variable === 'salinity' ? ' · Phase 2' : ''}</span>
        <span className="lg-unit" id="lg-unit">{cfg.unit}</span>
      </div>
      <canvas id="lg-canvas" ref={canvasRef} width="212" height="7"></canvas>
      <div className="lg-mm">
        <span id="lg-min">{range ? range[0].toFixed(1) + ' ' + cfg.unit : '—'}</span>
        <span id="lg-max">{range ? range[1].toFixed(1) + ' ' + cfg.unit : '—'}</span>
      </div>
      <div className="lg-line" id="lg-line">depth −{depth} m · {fmtDate(time)}</div>
      {probe && (
        <div className="lg-line" id="lg-probe">
          probe {fmtLon(probe.lon)} {fmtLat(probe.lat)} · {probe.v.toFixed(2)} {cfg.unit} @ −{depth} m
        </div>
      )}
      <div className="lg-argo"><span><i className="d"></i>Argo · delayed</span><span><i className="a"></i>Argo · adjusted
                RT</span></div>
    </div>
  );
}

function Toast({ msg }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setShow(true));
    const t = setTimeout(() => setShow(false), 3400);
    return () => { cancelAnimationFrame(raf); clearTimeout(t); };
  }, []);
  return <div className={'toast' + (show ? ' show' : '')}>{msg}</div>;
}

function ArgoTip({ hoverTip }) {
  const p = hoverTip ? api.getArgoProfile(hoverTip.id) : null;
  if (!hoverTip || !p) return <div id="argo-tip"></div>;
  const m = p.meta;
  const valid = p.levels.filter(l => l.qc === 1).length;
  let x = hoverTip.x + 16, y = hoverTip.y + 18;
  if (x + 230 > window.innerWidth) x = hoverTip.x - 246;
  if (y + 130 > window.innerHeight) y = hoverTip.y - 140;
  return (
    <div id="argo-tip" className="show" style={{ left: Math.max(8, x) + 'px', top: Math.max(8, y) + 'px' }}>
      <div className="at-id">{m.id}</div>
      <div className="at-row"><span className="k">Location</span><span className="v">{fmtLat(m.lat)} · {fmtLon(m.lon)}</span></div>
      <div className="at-row"><span className="k">Observed</span><span className="v">{fmtUTC(m.time)}</span></div>
      <div className="at-row"><span className="k">Valid levels</span><span className="v">{valid} / 45</span></div>
      <div className="at-row"><span className="k">Data mode</span><span className={'v ' + (m.mode === 'D' ? 'md' : 'ma')}>{m.mode === 'D' ? 'delayed (D)' : 'adjusted RT (A)'}</span></div>
    </div>
  );
}

export default function SceneOverlays({
  exaggeration, variable, depth, time, legendRange, probe,
  toasts, hoverTip, camHintFaded
}) {
  return (
    <>
      {/* scene overlays */}
      <div id="vz-badge" className="reveal-o">
        {exaggeration === 1
          ? <>Vertical scale <b>true 1×</b></>
          : <>Vertical scale <b>{exaggeration}×</b></>}
      </div>
      <div id="cam-hint" className={'reveal-o' + (camHintFaded ? ' fade' : '')}>
        Drag to rotate · scroll to zoom · right-drag to tilt
      </div>
      <Legend variable={variable} depth={depth} time={time} range={legendRange} probe={probe} />
      <div id="toast-stack">
        {toasts.map(t => <Toast key={t.id} msg={t.msg} />)}
      </div>
      <ArgoTip hoverTip={hoverTip} />
    </>
  );
}
