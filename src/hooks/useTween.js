/* OCEAN-X — animated numeric readout.
   Faithful port of the prototype's tweenText(): values interpolate
   from the previous *target* (not the mid-flight value), exactly as
   the original did, over 420ms with cubic ease-out. */
import { useEffect, useRef, useState } from 'react';

export function useTween(target, active, dur = 420) {
  const [display, setDisplay] = useState(null);
  const prevTargetRef = useRef(0);

  useEffect(() => {
    if (!active) {
      prevTargetRef.current = 0;
      setDisplay(null);
      return;
    }
    const from = prevTargetRef.current;
    prevTargetRef.current = target;
    const t0 = performance.now();
    let raf;
    const step = now => {
      const k = Math.min(1, (now - t0) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      setDisplay(from + (target - from) * e);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, active, dur]);

  return display;
}
