'use client';

import { useEffect, useState } from 'react';
import OceanCanvas from './OceanCanvas';

export default function DeferredOceanCanvas() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    const start = () => {
      if (!cancelled) setReady(true);
    };
    if (typeof idleWindow.requestIdleCallback === 'function') {
      const idle = idleWindow.requestIdleCallback(start, { timeout: 1200 });
      return () => {
        cancelled = true;
        idleWindow.cancelIdleCallback?.(idle);
      };
    }
    timer = window.setTimeout(start, 0);
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, []);

  return ready ? <OceanCanvas /> : null;
}
