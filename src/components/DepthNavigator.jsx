import { useRef, useState } from 'react';
import { clamp } from '../engine/fieldEngine.js';

/* OCEAN-X depth navigator — signature control, state-driven.
   Fully synchronized with application state: the thumb position is
   derived from the `idx` prop; drags/keys write back via onChange.
   Ported from makeDepthNav(). */
const P = z => Math.pow(z / 1000, 0.6);
const H = 252, TOP = 22, BOT = 10;
const LABELS = [0, 100, 300, 500, 1000];

export default function DepthNavigator({ levels, idx, onChange, attract }) {
  const mountRef = useRef(null);
  const draggingRef = useRef(false);
  const [dragging, setDragging] = useState(false);

  const fromY = clientY => {
    const r = mountRef.current.getBoundingClientRect();
    const p = clamp((clientY - r.top - TOP) / (H - TOP - BOT), 0, 1);
    const z = 1000 * Math.pow(p, 1 / 0.6);
    let best = 0, bd = Infinity;
    levels.forEach((l, i) => { const d = Math.abs(l - z); if (d < bd) { bd = d; best = i; } });
    return best;
  };
  const handle = i => {
    const c = clamp(i, 0, levels.length - 1);
    if (c !== idx) onChange(c);
  };

  const i = clamp(idx, 0, levels.length - 1);
  const z = levels[i];
  const y = TOP + P(z) * (H - TOP - BOT);

  return (
    <div
      id="depth-nav"
      ref={mountRef}
      tabIndex="0"
      title="Model depth — drag or use arrow keys"
      aria-label="Depth navigator"
      className={(dragging ? 'dragging ' : '') + (attract ? 'attract' : '')}
      onPointerDown={e => {
        draggingRef.current = true; setDragging(true);
        mountRef.current.setPointerCapture(e.pointerId);
        handle(fromY(e.clientY));
      }}
      onPointerMove={e => { if (draggingRef.current) handle(fromY(e.clientY)); }}
      onPointerUp={() => { draggingRef.current = false; setDragging(false); }}
      onKeyDown={e => {
        if ((e.key === 'ArrowDown' || e.key === 'ArrowRight') && idx < levels.length - 1) {
          onChange(idx + 1); e.preventDefault();
        }
        if ((e.key === 'ArrowUp' || e.key === 'ArrowLeft') && idx > 0) {
          onChange(idx - 1); e.preventDefault();
        }
      }}>
      <div className="dn-surface">Surface</div>
      <div className="dn-axis" />
      <div className="dn-fill" style={{ height: (y - TOP) + 'px' }} />
      {levels.map((lv, li) => (
        <div key={lv} className="dn-tick" style={{ top: (TOP + P(lv) * (H - TOP - BOT)) + 'px' }}>
          {LABELS.includes(lv) && <span>{lv === 1000 ? '1000 m' : lv}</span>}
        </div>
      ))}
      <div className={'dn-thumb' + (dragging ? '' : ' anim')} style={{ top: y + 'px' }}>
        <b>{z} m</b>
        <i>z{i + 1}</i>
      </div>
    </div>
  );
}
