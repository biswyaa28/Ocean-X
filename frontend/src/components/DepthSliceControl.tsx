'use client';

import React from 'react';
import { ChevronDown, Eye, EyeOff, Loader2, AlertCircle, Waves } from 'lucide-react';
import { DEPTH_SLICE_VARIABLES, DepthSlicePayload } from '../services/ApiProvider';

export interface DepthSliceSelection {
  variable: string;
  depthM: number;
  timestamp?: string;
}

interface DepthSliceControlProps {
  visible: boolean;
  onToggleVisible: () => void;
  selection: DepthSliceSelection;
  onChange: (next: DepthSliceSelection) => void;
  loading: boolean;
  unavailable: string | null;
  metadata: DepthSlicePayload | null;
  datasetTimestamps: string[];
  availableDepthsM: number[] | null;
}

const DEPTH_PRESETS_M = [0, 10, 50, 100, 250, 500];

export const DepthSliceControl: React.FC<DepthSliceControlProps> = ({
  visible,
  onToggleVisible,
  selection,
  onChange,
  loading,
  unavailable,
  metadata,
  datasetTimestamps,
  availableDepthsM,
}) => {
  const varMeta = DEPTH_SLICE_VARIABLES.find((v) => v.id === selection.variable);
  const depthOptions = availableDepthsM ?? DEPTH_PRESETS_M;

  return (
    <div className="fixed left-6 bottom-40 z-20 w-64 sm:w-72 font-mono text-xs select-none">
      <div className="bg-[#080c14]/85 backdrop-blur-xl border border-white/10 rounded-2xl p-3.5 shadow-2xl text-slate-100 space-y-2.5">
        {/* Header: HYCOM MODEL DEPTH SLICE + show/hide */}
        <div className="flex items-center justify-between border-b border-white/10 pb-2 px-1">
          <div className="flex items-center gap-2 min-w-0">
            <div className="p-1 rounded-lg bg-indigo-500/15 text-indigo-400">
              <Waves className="w-3.5 h-3.5" />
            </div>
            <div className="min-w-0">
              <div className="font-bold text-[10px] uppercase tracking-widest text-slate-200 truncate">
                HYCOM MODEL DEPTH SLICE
              </div>
              <div className="text-[8px] text-slate-500 uppercase">Subsurface · Nearest native model level</div>
            </div>
          </div>
          <button
            onClick={onToggleVisible}
            className={`p-1 rounded-lg transition-colors ${visible ? 'text-indigo-300 bg-indigo-500/15' : 'text-slate-500 hover:text-slate-300 hover:bg-white/5'}`}
            title={visible ? 'Hide model depth slice' : 'Show model depth slice'}
            aria-label={visible ? 'Hide model depth slice' : 'Show model depth slice'}
          >
            {visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
          </button>
        </div>

        {/* Controls: visible only when the slice is shown */}
        {visible && (
          <>
            <div className="space-y-1.5">
              <label className="text-[8px] font-bold text-slate-500 tracking-widest uppercase block px-1">
                Variable
              </label>
              <div className="relative">
                <select
                  aria-label="Depth slice variable"
                  value={selection.variable}
                  onChange={(e) => onChange({ ...selection, variable: e.target.value })}
                  className="w-full appearance-none bg-white/5 border border-white/10 rounded-lg px-2.5 py-1.5 text-[10.5px] text-slate-100 focus:outline-none focus:border-indigo-400/60 pr-7"
                >
                  {DEPTH_SLICE_VARIABLES.map((v) => (
                    <option key={v.id} value={v.id} className="bg-[#080c14]">
                      {v.label} ({v.unit})
                    </option>
                  ))}
                </select>
                <ChevronDown className="w-3 h-3 text-slate-500 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-[8px] font-bold text-slate-500 tracking-widest uppercase block px-1">
                Requested depth (m)
              </label>
              <input
                aria-label="Requested depth in meters"
                type="number"
                min={0}
                step={10}
                value={selection.depthM}
                onChange={(e) => onChange({ ...selection, depthM: Number(e.target.value) })}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-2.5 py-1.5 text-[10.5px] text-slate-100 focus:outline-none focus:border-indigo-400/60"
              />
              {availableDepthsM && availableDepthsM.length > 0 && (
                <div className="flex flex-wrap gap-1 pt-0.5">
                  {depthOptions.map((d) => (
                    <button
                      key={d}
                      onClick={() => onChange({ ...selection, depthM: d })}
                      className={`text-[8px] font-bold px-1.5 py-0.5 rounded font-mono border transition-colors ${
                        Math.abs(selection.depthM - d) < 1e-6
                          ? 'bg-indigo-500/25 text-indigo-200 border-indigo-400/50'
                          : 'bg-white/5 text-slate-400 border-white/10 hover:text-slate-200'
                      }`}
                    >
                      {d} m
                    </button>
                  ))}
                </div>
              )}
            </div>

            {datasetTimestamps.length > 0 && (
              <div className="space-y-1.5">
                <label className="text-[8px] font-bold text-slate-500 tracking-widest uppercase block px-1">
                  Model timestamp
                </label>
                <div className="relative">
                  <select
                    aria-label="Depth slice model timestamp"
                    value={selection.timestamp ?? ''}
                    onChange={(e) => onChange({ ...selection, timestamp: e.target.value || undefined })}
                    className="w-full appearance-none bg-white/5 border border-white/10 rounded-lg px-2.5 py-1.5 text-[10.5px] text-slate-100 focus:outline-none focus:border-indigo-400/60 pr-7"
                  >
                    {datasetTimestamps.map((ts) => (
                      <option key={ts} value={ts} className="bg-[#080c14]">
                        {ts.replace('T', ' ').slice(0, 16)}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="w-3 h-3 text-slate-500 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>
              </div>
            )}

            {/* Status line */}
            {loading && (
              <div className="flex items-center gap-1.5 text-[9px] text-indigo-300 px-1">
                <Loader2 className="w-3 h-3 animate-spin" />
                <span>FETCHING REAL HYCOM DEPTH SLICE…</span>
              </div>
            )}
            {!loading && unavailable && (
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-2 text-[9px] text-amber-200 space-y-1">
                <div className="flex items-center gap-1.5 font-bold text-amber-400">
                  <AlertCircle className="w-3 h-3 shrink-0" />
                  <span>HYCOM MODEL DEPTH SLICE UNAVAILABLE</span>
                </div>
                <p className="text-slate-300 leading-snug break-words">{unavailable}</p>
              </div>
            )}

            {/* Compact metadata (only real values from the API response) */}
            {!loading && metadata && !unavailable && (
              <div className="bg-[#05070a] border border-white/10 rounded-xl p-2 space-y-1 text-[9px]">
                <div className="flex justify-between">
                  <span className="text-slate-500">VARIABLE</span>
                  <span className="text-slate-200 font-bold">{varMeta ? varMeta.label.toUpperCase() : metadata.variable.toUpperCase()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">REQUESTED DEPTH</span>
                  <span className="text-slate-200 font-bold">{metadata.requested_depth_m} m</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">MATCHED MODEL DEPTH</span>
                  <span className="text-indigo-300 font-bold">{metadata.matched_depth_m} m</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">TIMESTAMP</span>
                  <span className="text-cyan-300 font-semibold truncate max-w-[140px]" title={metadata.timestamp}>
                    {metadata.timestamp.replace('T', ' ').slice(0, 16)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">UNITS</span>
                  <span className="text-slate-200 font-bold">{metadata.units}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">SOURCE</span>
                  <span className="text-slate-200 font-bold truncate max-w-[140px]" title={metadata.source}>
                    {metadata.source}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">DATASET</span>
                  <span className="text-slate-400 truncate max-w-[140px] font-mono" title={metadata.dataset_file}>
                    {metadata.dataset_file.split('/').pop() || '—'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">DATA STATUS</span>
                  <span className="text-emerald-400 font-bold">{metadata.status}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">MISSING VALUES</span>
                  <span className="text-slate-200 font-bold">{metadata.missing_values} cells</span>
                </div>
                <div className="text-[7.5px] text-slate-600 pt-1 border-t border-white/5 leading-relaxed">
                  MODEL DEPTH SLICE · 2D GEOGRAPHIC DRAPE AT MODEL LEVEL — NOT A VOLUMETRIC OR WATER-COLUMN VIEW
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
