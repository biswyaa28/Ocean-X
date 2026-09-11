'use client';

import React, { useState, useEffect } from 'react';
import { CycloneTrackPoint, OceanMode } from '../types/oceanlens';
import { Play, Pause, SkipBack, SkipForward } from 'lucide-react';

interface TimelineProps {
  track: CycloneTrackPoint[];
  currentIndex: number;
  onIndexChange: (index: number) => void;
  oceanMode?: OceanMode;
  isHistorical?: boolean;
}

export const Timeline: React.FC<TimelineProps> = ({
  track,
  currentIndex,
  onIndexChange,
  oceanMode = 'HISTORICAL',
  isHistorical = true,
}) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState<number>(1);

  const currentPoint = track[currentIndex] || track[0];

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isPlaying) {
      interval = setInterval(() => {
        onIndexChange((currentIndex + 1) % track.length);
      }, 2000 / speed);
    }
    return () => clearInterval(interval);
  }, [isPlaying, currentIndex, track.length, speed, onIndexChange]);

  const formatShortTime = (iso?: string) => {
    if (!iso) return 'UTC 00:00:00';
    const date = new Date(iso);
    if (isNaN(date.getTime())) return iso;
    const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    const month = months[date.getUTCMonth()];
    const d = date.getUTCDate();
    const h = String(date.getUTCHours()).padStart(2, '0');
    return `${d < 10 ? '0' + d : d} ${month} · ${h}:00 UTC`;
  };

  const isHistMode = oceanMode === 'HISTORICAL' || isHistorical;
  const statusLabel = oceanMode === 'LIVE' ? 'MODEL DATA' : oceanMode === 'SCENARIO' ? 'SIMULATION' : 'HISTORICAL OBSERVATION';
  const continuationLabel = oceanMode === 'LIVE' ? 'TIMESTEP ➔' : oceanMode === 'SCENARIO' ? 'SIMULATED FORECAST ➔' : 'TRACK CONTINUATION ➔';

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-20 w-full max-w-xl px-4 select-none font-mono text-xs">
      <div className="bg-[#080c14]/85 backdrop-blur-xl border border-white/10 px-5 py-2.5 rounded-2xl shadow-2xl flex flex-col items-center gap-1.5 text-slate-100">
        {/* Controls and Readout Row */}
        <div className="flex items-center justify-between w-full text-slate-300 text-[11px]">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsPlaying(!isPlaying)}
              className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-all flex items-center gap-1 text-[10px] font-bold"
              title={isPlaying ? 'Pause Scrubber' : 'Play Scrubber'}
            >
              {isPlaying ? <Pause className="w-3 h-3 fill-current text-cyan-400" /> : <Play className="w-3 h-3 fill-current text-white" />}
              <span>{isPlaying ? 'PAUSE' : 'PLAY'}</span>
            </button>

            <button
              onClick={() => onIndexChange(Math.max(0, currentIndex - 1))}
              className="p-1 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
            >
              <SkipBack className="w-3 h-3" />
            </button>

            <button
              onClick={() => onIndexChange(Math.min(track.length - 1, currentIndex + 1))}
              className="p-1 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
            >
              <SkipForward className="w-3 h-3" />
            </button>

            <div className="flex items-center gap-1 text-[10px] ml-1">
              {[1, 2, 5].map((s) => (
                <button
                  key={s}
                  onClick={() => setSpeed(s)}
                  className={`px-1.5 py-0.5 rounded ${speed === s ? 'bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-500/40' : 'text-slate-500 hover:text-slate-300'}`}
                >
                  {s}x
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2 font-mono">
            <span className="text-cyan-300 font-extrabold text-sm tracking-wide">
              {formatShortTime(currentPoint?.timestamp)}
            </span>
            <span className="text-[9px] text-slate-400 uppercase font-semibold">
              │ {statusLabel}
            </span>
          </div>
        </div>

        {/* Time Axis Bar */}
        <div className="w-full pt-1">
          <div className="h-[2px] w-full bg-white/15 relative flex justify-between items-center rounded-full">
            {track.map((pt, idx) => {
              const isCurrent = idx === currentIndex;

              return (
                <div
                  key={pt.id || idx}
                  onClick={() => onIndexChange(idx)}
                  className="relative group cursor-pointer py-1"
                  title={`${pt.timestamp} (${statusLabel})`}
                >
                  <div
                    className={`transition-all duration-200 ${
                      isCurrent
                        ? 'w-2.5 h-2.5 rounded-full bg-rose-400 shadow-[0_0_8px_rgba(251,113,133,0.9)]'
                        : 'w-1.5 h-1.5 rounded-full bg-slate-400 hover:bg-white'
                    }`}
                  />
                </div>
              );
            })}
          </div>

          <div className="flex justify-between text-[8.5px] text-slate-500 font-mono mt-1.5 uppercase tracking-widest px-0.5">
            <span>PAST TIMESTEPS</span>
            <span className={isHistMode ? "text-amber-400 font-bold" : "text-cyan-400 font-bold"}>
              {statusLabel}
            </span>
            <span>{continuationLabel}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
