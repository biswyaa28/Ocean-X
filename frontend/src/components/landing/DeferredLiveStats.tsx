'use client';

import { useEffect, useRef, useState } from 'react';
import LiveStats from './LiveStats';

/**
 * Let the hero paint before the optional dashboard-count request hydrates.
 * LiveStats keeps its exact fetch and fallback contract; this only prevents a
 * large backend response from competing with the first meaningful paint.
 */
export default function DeferredLiveStats() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === 'undefined') {
      setReady(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) {
        setReady(true);
        observer.disconnect();
      }
    }, { threshold: 0.1 });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className="stats-mount">
      {ready ? <LiveStats /> : <div className="stats-placeholder" aria-hidden="true" />}
    </div>
  );
}
