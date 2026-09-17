'use client';

import React from 'react';
import { ScientificPalette, paletteCssGradient } from '../utils/scientificPalettes';
import { DepthSliceScale } from '../utils/depthSliceViz';

/** Adaptive scientific-value formatting for colorbar tick labels. */
export function formatColorbarValue(v: number): string {
  const a = Math.abs(v);
  if (a >= 1000) return v.toFixed(0);
  if (a >= 100) return v.toFixed(1);
  return v.toFixed(2);
}

interface DepthSliceColorbarProps {
  palette: ScientificPalette;
  rangeMin: number;
  rangeMax: number;
  scale: DepthSliceScale;
  units: string;
  variableLabel: string;
  isAutoRange: boolean;
  matchedDepthM?: number;
  timestamp?: string;
}

/**
 * Synchronized scientific colorbar for the HYCOM model depth slice.
 * Every value shown derives from the actual visualization configuration
 * (palette, display range, scale, units, matched depth, timestamp) — the
 * same resolved configuration the raster renderer consumes, so the legend
 * can never drift from the imagery.
 */
export const DepthSliceColorbar: React.FC<DepthSliceColorbarProps> = ({
  palette,
  rangeMin,
  rangeMax,
  scale,
  units,
  variableLabel,
  isAutoRange,
  matchedDepthM,
  timestamp,
}) => {
  // Mid tick: arithmetic mean on linear scale, geometric mean on log scale
  // (both sit at the 50% position of their normalization).
  const mid = scale === 'log' ? Math.sqrt(rangeMin * rangeMax) : (rangeMin + rangeMax) / 2;

  const formatTimestamp = (ts?: string) => {
    if (!ts) return '';
    return ts.replace('T', ' ').slice(0, 16);
  };

  return (
    <div className="bg-[#05070a] border border-white/10 rounded-xl p-2 space-y-1.5 text-[9px]" aria-label="Depth slice colorbar">
      <div className="flex items-center justify-between">
        <span className="text-slate-500 tracking-widest uppercase font-bold">
          COLORBAR · {variableLabel.toUpperCase()}
        </span>
        <span className="flex items-center gap-1">
          <span
            className={`px-1 py-0.5 rounded font-bold border ${
              scale === 'log'
                ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                : 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30'
            }`}
          >
            {scale === 'log' ? 'LOG' : 'LINEAR'}
          </span>
          <span
            className={`px-1 py-0.5 rounded font-bold border ${
              isAutoRange
                ? 'bg-white/5 text-slate-400 border-white/10'
                : 'bg-indigo-500/15 text-indigo-300 border-indigo-400/40'
            }`}
          >
            {isAutoRange ? 'AUTO' : 'CUSTOM'} RANGE
          </span>
        </span>
      </div>

      <div
        data-testid="depth-slice-colorbar-gradient"
        className="h-2.5 w-full rounded-md border border-white/10"
        style={{ background: paletteCssGradient(palette) }}
      />

      <div className="flex justify-between text-[8.5px] text-slate-400 font-mono">
        <span className="font-bold text-slate-300">{formatColorbarValue(rangeMin)}</span>
        <span>{formatColorbarValue(mid)}</span>
        <span className="font-bold text-slate-300">{formatColorbarValue(rangeMax)}</span>
      </div>

      <div className="flex justify-between text-[8px] text-slate-500 border-t border-white/5 pt-1">
        <span>
          {units} · {palette.label}
        </span>
        <span>
          {matchedDepthM !== undefined && <span className="text-indigo-300 font-bold">{matchedDepthM} m · </span>}
          {timestamp && <span className="text-cyan-300">{formatTimestamp(timestamp)}</span>}
        </span>
      </div>

      <div className="text-[7.5px] text-slate-600 leading-relaxed">
        DISPLAY RANGE ONLY — SOURCE DATA, UNITS AND MODEL LEVELS ARE NEVER MODIFIED
      </div>
    </div>
  );
};
