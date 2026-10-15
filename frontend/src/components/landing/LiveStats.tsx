'use client';

/**
 * "Live proof" figures, read from the running backend.
 *
 * The rule this component is built around: **if the backend cannot be reached,
 * the numbers are hidden, not faked.** A landing page that shows a confident
 * "1,204 Argo profiles" when nothing answered would be lying, and a viewer has
 * no way to tell the difference. So every figure below is either measured from
 * the API or absent — there is no fallback value anywhere in this file.
 */

import { useEffect, useRef, useState } from 'react';

export interface LandingStats {
  argoProfiles: number;
  cyclones: number;
  matchedProfiles: number | null;
  totalProfiles: number | null;
  modelRunCount: number;
  dataScope: string | null;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000/api';

/**
 * Fetch the landing figures.
 *
 * Exported so the fallback behaviour can be asserted directly rather than
 * inferred from a rendered component: a rejected fetch must leave the caller
 * with nothing to show.
 */
export async function fetchLandingStats(
  signal?: AbortSignal
): Promise<LandingStats | null> {
  try {
    const response = await fetch(`${API_BASE}/summary/landing`, { signal });
    const summary = response.ok ? await response.json() : null;

    // Nothing usable came back: the caller hides the section.
    if (!summary || typeof summary !== 'object') return null;
    if (
      typeof summary.argoProfileCount !== 'number' ||
      typeof summary.cycloneTrackCount !== 'number' ||
      typeof summary.includedProfileCount !== 'number' ||
      typeof summary.excludedProfileCount !== 'number' ||
      typeof summary.modelRunCount !== 'number'
    ) {
      return null;
    }

    return {
      argoProfiles: summary.argoProfileCount,
      cyclones: summary.cycloneTrackCount,
      matchedProfiles: summary.includedProfileCount,
      totalProfiles: summary.argoProfileCount,
      modelRunCount: summary.modelRunCount,
      dataScope: typeof summary.dataScope === 'string' ? summary.dataScope : null,
    };
  } catch {
    // Unreachable backend, aborted request, malformed payload — all the same
    // to the reader: there is no number to show.
    return null;
  }
}

/**
 * Count from 0 to `target` once, when scrolled into view.
 *
 * Honours prefers-reduced-motion by jumping straight to the final value, so the
 * number is still readable without any motion.
 */
export function CountUp({
  value,
  durationMs = 900,
  className,
}: {
  value: number;
  durationMs?: number;
  className?: string;
}) {
  const [display, setDisplay] = useState(0);
  const [started, setStarted] = useState(false);
  const ref = useRef<HTMLSpanElement | null>(null);
  const frameRef = useRef(0);

  useEffect(() => {
    const node = ref.current;
    if (!node || started) return;
    if (typeof IntersectionObserver === 'undefined') {
      setStarted(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setStarted(true);
          observer.disconnect();
        }
      },
      { threshold: 0.4 }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [started]);

  useEffect(() => {
    if (!started) return;

    const reduced =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (reduced) {
      setDisplay(value);
      return;
    }

    const start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / durationMs);
      // easeOutCubic: fast at first, settling gently, which reads as "arriving".
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(value * eased));
      if (progress < 1) frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameRef.current);
  }, [started, value, durationMs]);

  return (
    <span ref={ref} className={className}>
      {display.toLocaleString('en-US')}
    </span>
  );
}

function Stat({
  value,
  label,
  suffix,
  note,
}: {
  value: number | string | null;
  label: string;
  suffix?: string;
  note?: string;
}) {
  // null means the backend did not report this figure. It is never replaced
  // with a fallback number.
  if (value === null) {
    return (
      <div
        data-testid="live-stat-missing"
        className="rounded-2xl border border-white/10 bg-[#080c14]/70 p-4 sm:p-5 backdrop-blur-xl"
      >
        <div className="font-display text-2xl sm:text-3xl font-extrabold text-slate-600">—</div>
        <div className="mt-1 text-[11px] sm:text-xs uppercase tracking-wider text-slate-500 font-semibold">
          {label}
        </div>
        <div className="mt-1 text-[10px] text-slate-400 leading-snug">
          Not reported by the backend
        </div>
      </div>
    );
  }
  // A worded value ("5 archived runs") is not a count and must not be set in
  // the huge tabular display size, where it wraps into an unreadable block.
  const isCount = typeof value === 'number';
  return (
    <div className="rounded-2xl border border-white/10 bg-[#080c14]/70 p-4 sm:p-5 backdrop-blur-xl">
      <div
        className={
          isCount
            ? 'font-display text-2xl sm:text-3xl font-extrabold text-cyan-300 tabular-nums'
            : 'font-display text-lg sm:text-xl font-extrabold text-cyan-300 leading-tight'
        }
      >
        {isCount ? <CountUp value={value} /> : value}
        {suffix ? <span className="text-base text-slate-400 font-semibold ml-1">{suffix}</span> : null}
      </div>
      <div className="mt-1 text-[11px] sm:text-xs uppercase tracking-wider text-slate-300 font-semibold">
        {label}
      </div>
      {note ? <div className="mt-1 text-[10px] text-slate-400 leading-snug">{note}</div> : null}
    </div>
  );
}

export default function LiveStats() {
  const [stats, setStats] = useState<LandingStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    fetchLandingStats(controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      setStats(result);
      setLoading(false);
    });
    return () => controller.abort();
  }, []);

  // Backend unreachable or not answering: show nothing rather than invent a
  // figure. The section itself still explains what the dashboard measures.
  if (loading || !stats) {
    if (loading) {
      return (
        <div data-testid="live-stats-skeleton" className="stats-skeleton" aria-label="Loading measured statistics">
          {[1, 2, 3, 4].map((item) => <span key={item} />)}
        </div>
      );
    }
    return (
      <div
        data-testid="live-stats-unavailable"
        className="rounded-2xl border border-white/10 bg-[#080c14]/70 p-5 backdrop-blur-xl text-slate-400 text-sm"
      >
        Live figures appear here when the analysis backend is reachable. Run the API to see
        measured counts instead of a placeholder.
      </div>
    );
  }

  const runLabel =
    stats.modelRunCount > 0
      ? `${stats.modelRunCount} archived run${stats.modelRunCount === 1 ? '' : 's'}`
      : null;

  return (
    <div data-testid="live-stats" className="grid gap-3 sm:gap-4 grid-cols-2 lg:grid-cols-4">
      <Stat
        value={stats.argoProfiles}
        label="Argo profiles"
        note="Ingested from Argo GDAC"
      />
      <Stat
        value={stats.matchedProfiles}
        label="Matched to model"
        note={
          stats.totalProfiles
            ? `Of ${stats.totalProfiles} compared`
            : 'Model levels vs float levels'
        }
      />
      <Stat
        value={stats.cyclones}
        label="Cyclone tracks"
        note="NOAA IBTrACS, seasons ≥ 2020"
      />
      <Stat
        value={runLabel ?? '—'}
        label="HYCOM model"
        note={stats.dataScope ? `Data scope: ${stats.dataScope}` : 'INCOIS RSMC HYCOM'}
      />
    </div>
  );
}