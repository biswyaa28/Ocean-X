import { useRef, useState } from 'react';
import { clamp } from '../engine/fieldEngine.js';
import { api } from '../data/mockModel.js';
import { fmtDate } from '../engine/format.js';

/* OCEAN-X view-time timeline — state-driven instrument.
   The head position is derived from the `idx` prop (application
   state is the single source of truth); dragging writes back
   through onChange only. Ported from makeTimeline(). */
const N = 6;

export default function Timeline({ idx, matchIdx, onChange }) {
  const mountRef = useRef(null);
  const draggingRef = useRef(false);
  const [dragging, setDragging] = useState(false);
  const times = api.getModelTimes();

  const fromX = clientX => {
    const r = mountRef.current.getBoundingClientRect();
    return Math.round(clamp((clientX - r.left) / r.width, 0, 1) * N);
  };
  const handle = i => {
    const c = clamp(i, 0, N);
    if (c !== idx) onChange(c);
  };

  const pct = clamp(idx, 0, N) / N * 100;

  return (
    <div id="tl-canvas" ref={mountRef} tabIndex="0" title="Model timeline — view time"
      aria-label="View time timeline"
      onPointerDown={e => {
        draggingRef.current = true; setDragging(true);
        mountRef.current.setPointerCapture(e.pointerId);
        handle(fromX(e.clientX));
      }}
      onPointerMove={e => { if (draggingRef.current) handle(fromX(e.clientX)); }}
      onPointerUp={() => { draggingRef.current = false; setDragging(false); }}
      onKeyDown={e => {
        if (e.key === 'ArrowRight' && idx < N) { onChange(idx + 1); e.preventDefault(); }
        if (e.key === 'ArrowLeft' && idx > 0) { onChange(idx - 1); e.preventDefault(); }
      }}>
      <div className="tl-base" />
      <div className="tl-fill" style={{ width: pct + '%' }} />
      {times.map((t, i) => (
        <div key={fmtDate(t)} className="tl-tick" style={{ left: (i / N * 100) + '%' }}>
          <span>{fmtDate(t).slice(5)}</span>
        </div>
      ))}
      <div className="tl-head" style={{ left: pct + '%', transition: dragging ? 'none' : undefined }} />
      {matchIdx != null && (
        <div className="tl-match" title="Matched model time — anchored to the selected profile"
          style={{ left: (matchIdx / N * 100) + '%' }} />
      )}
    </div>
  );
}
