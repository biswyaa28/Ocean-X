'use client';

import React, { useMemo } from 'react';
import { ChevronDown, Eye, EyeOff, Loader2, AlertCircle, Waves, RotateCcw } from 'lucide-react';
import { DEPTH_SLICE_VARIABLES, DepthSlicePayload } from '../services/ApiProvider';
import { modelDepthLabel, type ModelDepthAxis } from '../utils/modelDepthLabel';
import {
  DepthSliceDisplaySettings,
  DepthSliceRenderConfig,
  validateDisplayRange,
} from '../utils/depthSliceViz';
import { palettesForVariable } from '../utils/scientificPalettes';
import { DepthSliceColorbar } from './DepthSliceColorbar';

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
  /** Scientific visualization settings (display only — never the source data). */
  display: DepthSliceDisplaySettings;
  onDisplayChange: (next: DepthSliceDisplaySettings) => void;
  onResetDisplay: () => void;
  /** Fully resolved, always-valid render configuration (drives the raster + colorbar). */
  render: DepthSliceRenderConfig | null;
  loading: boolean;
  unavailable: string | null;
  metadata: DepthSlicePayload | null;
  datasetTimestamps: string[];
  availableDepthsM: number[] | null;
  /**
   * The time the slice will actually be requested at when the user has not
   * picked one. Displayed as the current selection so the control never shows a
   * time the request is not using.
   */
  defaultTimestamp?: string | undefined;
}

const DEPTH_PRESETS_M = [0, 10, 50, 100, 250, 500];

export const DepthSliceControl: React.FC<DepthSliceControlProps> = ({
  visible,
  onToggleVisible,
  selection,
  onChange,
  display,
  onDisplayChange,
  onResetDisplay,
  render,
  loading,
  unavailable,
  metadata,
  datasetTimestamps,
  availableDepthsM,
  defaultTimestamp,
}) => {
  const varMeta = DEPTH_SLICE_VARIABLES.find((v) => v.id === selection.variable);
  const variableLabel = varMeta ? varMeta.label : selection.variable;

  // Native model depth levels from the backend payload (preferred); the
  // preset fallback only covers the very first load before any payload
  // has arrived. The backend still matches the nearest native level and
  // reports requested vs matched explicitly.
  const nativeDepths = availableDepthsM && availableDepthsM.length > 0 ? availableDepthsM : DEPTH_PRESETS_M;
  const depthOptions = nativeDepths.includes(selection.depthM)
    ? nativeDepths
    : [...nativeDepths, selection.depthM].sort((a, b) => a - b);
  // The subset file's own DEPTH labels, so a level can be shown as sampled AND
  // as the file names it. They differ on the thermocline levels.
  const depthAxis = useMemo<ModelDepthAxis>(
    () => ({
      modelDepths: metadata?.available_depths_m ?? null,
      storedFileDepths: metadata?.stored_file_depths_m ?? null,
    }),
    [metadata?.available_depths_m, metadata?.stored_file_depths_m]
  );

  const palettes = palettesForVariable(selection.variable);

  // Display-range inputs are controlled directly by the committed display
  // bounds. An invalid pair (min >= max) is committed to the settings but
  // NEVER reaches the renderer: the resolved render configuration falls
  // back to the auto data range and a validation state is shown.
  const parsedMin = display.min;
  const parsedMax = display.max;
  let rangeError: string | null = null;
  if (parsedMin !== null && parsedMax !== null) {
    rangeError = validateDisplayRange(parsedMin, parsedMax).reason;
  }

  const commitBound = (field: 'min' | 'max', raw: string) => {
    const trimmed = raw.trim();
    if (trimmed === '') {
      onDisplayChange({ ...display, [field]: null });
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) return; // unparseable edit: never committed
    onDisplayChange({ ...display, [field]: parsed });
  };

  const logDisabled = !render || !render.logAvailable;
  // The ACTIVE scale is the effective (resolved) scale — when a requested
  // log scale cannot be honored (zero/negative data), linear is what is
  // actually displayed and the toggle must say so.
  const effectiveScale = render ? render.scale : display.scale;

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
          <div className="space-y-2.5 max-h-[calc(100vh-380px)] overflow-y-auto custom-scrollbar pr-0.5">
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
                Model depth level (native)
              </label>
              <div className="relative">
                <select
                  aria-label="Depth slice model depth level"
                  value={selection.depthM}
                  onChange={(e) => onChange({ ...selection, depthM: Number(e.target.value) })}
                  className="w-full appearance-none bg-white/5 border border-white/10 rounded-lg px-2.5 py-1.5 text-[10.5px] text-slate-100 focus:outline-none focus:border-indigo-400/60 pr-7"
                >
                  {depthOptions.map((d) => (
                    <option key={d} value={d} className="bg-[#080c14]">
                      {modelDepthLabel(d, depthAxis)}
                      {nativeDepths.includes(d) ? '' : ' · requested (nearest native match)'}
                    </option>
                  ))}
                </select>
                <ChevronDown className="w-3 h-3 text-slate-500 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>
            </div>

            {datasetTimestamps.length > 0 && (
              <div className="space-y-1.5">
                <label className="text-[8px] font-bold text-slate-500 tracking-widest uppercase block px-1">
                  Model timestamp
                </label>
                <div className="relative">
                  <select
                    aria-label="Depth slice model timestamp"
                    value={selection.timestamp ?? defaultTimestamp ?? ''}
                    onChange={(e) => onChange({ ...selection, timestamp: e.target.value || defaultTimestamp })}
                    className="w-full appearance-none bg-white/5 border border-white/10 rounded-lg px-2.5 py-1.5 text-[10.5px] text-slate-100 focus:outline-none focus:border-indigo-400/60 pr-7"
                  >
                    {(defaultTimestamp && !datasetTimestamps.includes(defaultTimestamp)
                      ? [defaultTimestamp, ...datasetTimestamps]
                      : datasetTimestamps
                    ).map((ts) => (
                      <option key={ts} value={ts} className="bg-[#080c14]">
                        {ts.replace('T', ' ').slice(0, 16)}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="w-3 h-3 text-slate-500 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>
              </div>
            )}

            {/* Scientific visualization settings (display only) */}
            <div className="space-y-1.5 border-t border-white/10 pt-2">
              <div className="flex items-center justify-between px-1">
                <label className="text-[8px] font-bold text-slate-500 tracking-widest uppercase">
                  Color palette
                </label>
                <button
                  onClick={onResetDisplay}
                  className="flex items-center gap-1 text-[8px] font-bold px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-slate-400 hover:text-slate-200 transition-colors"
                  title="Reset display settings to defaults"
                >
                  <RotateCcw className="w-2.5 h-2.5" />
                  RESET
                </button>
              </div>
              <div className="relative">
                <select
                  aria-label="Depth slice color palette"
                  value={display.paletteId}
                  onChange={(e) => onDisplayChange({ ...display, paletteId: e.target.value })}
                  className="w-full appearance-none bg-white/5 border border-white/10 rounded-lg px-2.5 py-1.5 text-[10.5px] text-slate-100 focus:outline-none focus:border-indigo-400/60 pr-7"
                >
                  {palettes.map((p) => (
                    <option key={p.id} value={p.id} className="bg-[#080c14]">
                      {p.label}
                    </option>
                  ))}
                </select>
                <ChevronDown className="w-3 h-3 text-slate-500 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-[8px] font-bold text-slate-500 tracking-widest uppercase block px-1">
                Display range ({metadata?.units || varMeta?.unit || ''}) · display only
              </label>
              <div className="grid grid-cols-2 gap-1.5">
                <input
                  aria-label="Depth slice display minimum"
                  type="number"
                  step="any"
                  value={display.min === null ? '' : String(display.min)}
                  onChange={(e) => commitBound('min', e.target.value)}
                  placeholder={render ? String(render.dataMin) : 'auto'}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-2.5 py-1.5 text-[10.5px] text-slate-100 focus:outline-none focus:border-indigo-400/60"
                />
                <input
                  aria-label="Depth slice display maximum"
                  type="number"
                  step="any"
                  value={display.max === null ? '' : String(display.max)}
                  onChange={(e) => commitBound('max', e.target.value)}
                  placeholder={render ? String(render.dataMax) : 'auto'}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-2.5 py-1.5 text-[10.5px] text-slate-100 focus:outline-none focus:border-indigo-400/60"
                />
              </div>
              {rangeError ? (
                <div className="flex items-center gap-1.5 text-[8.5px] text-amber-300 px-1" role="alert">
                  <AlertCircle className="w-2.5 h-2.5 shrink-0" />
                  <span>{rangeError} · showing AUTO data range</span>
                </div>
              ) : (
                <div className="text-[7.5px] text-slate-600 px-1 leading-relaxed">
                  EMPTY = AUTO (DATA RANGE) · RANGE AFFECTS VISUALIZATION ONLY, NEVER THE SOURCE DATA
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="text-[8px] font-bold text-slate-500 tracking-widest uppercase block px-1">
                Scale
              </label>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  onClick={() => onDisplayChange({ ...display, scale: 'linear' })}
                  title={effectiveScale === 'linear' ? 'Linear scale active' : 'Switch to linear scale'}
                  className={`px-2 py-1 rounded-lg border text-[9px] font-bold transition-colors ${
                    effectiveScale === 'linear'
                      ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
                      : 'bg-white/5 text-slate-400 border-white/10 hover:text-slate-200'
                  }`}
                >
                  LINEAR
                </button>
                <button
                  onClick={() => onDisplayChange({ ...display, scale: 'log' })}
                  disabled={logDisabled}
                  title={
                    logDisabled
                      ? `Log scale unavailable${render?.logUnavailableReason ? ': ' + render.logUnavailableReason.replace(/^Log scale is unavailable: /, '') : ' — waiting for data'}`
                      : 'Log scale (logarithmic display mapping)'
                  }
                  className={`px-2 py-1 rounded-lg border text-[9px] font-bold transition-colors ${
                    effectiveScale === 'log'
                      ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                      : 'bg-white/5 text-slate-400 border-white/10'
                  } ${logDisabled ? 'opacity-40 cursor-not-allowed' : 'hover:text-slate-200'}`}
                >
                  LOG
                </button>
              </div>
              {logDisabled && render?.logUnavailableReason && (
                <div className="text-[7.5px] text-amber-300/80 px-1 leading-relaxed">
                  {render.logUnavailableReason.toUpperCase()}
                </div>
              )}
              <div className="text-[7.5px] text-slate-600 px-1 leading-relaxed">
                SCALE CHANGES THE DISPLAY MAPPING ONLY — NEVER THE UNDERLYING DATA
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-[8px] font-bold text-slate-500 tracking-widest uppercase block px-1 flex justify-between">
                <span>Layer opacity</span>
                <span className="text-slate-300">{Math.round(display.opacity * 100)}%</span>
              </label>
              <input
                aria-label="Depth slice opacity"
                type="range"
                min={0}
                max={100}
                step={5}
                value={Math.round(display.opacity * 100)}
                onChange={(e) => onDisplayChange({ ...display, opacity: Number(e.target.value) / 100 })}
                className="w-full accent-indigo-400"
              />
              <div className="text-[7.5px] text-slate-600 px-1">AFFECTS THIS LAYER ONLY — NEVER OTHER GRAPHICS</div>
            </div>

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
                  <span className="text-slate-200 font-bold">{variableLabel.toUpperCase()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">REQUESTED DEPTH</span>
                  <span className="text-slate-200 font-bold">{metadata.requested_depth_m} m</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">MATCHED MODEL DEPTH</span>
                  <span className="text-indigo-300 font-bold">
                    {modelDepthLabel(metadata.matched_depth_m, depthAxis)}
                  </span>
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
                  <span className="text-emerald-400 font-bold">{metadata.provenance?.data_status || metadata.status}</span>
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

            {/* Synchronized scientific colorbar (same resolved config as the raster) */}
            {render && metadata && !unavailable && (
              <DepthSliceColorbar
                palette={render.palette}
                rangeMin={render.rangeMin}
                rangeMax={render.rangeMax}
                scale={render.scale}
                units={metadata.units}
                variableLabel={variableLabel}
                isAutoRange={render.isAutoRange}
                matchedDepthM={metadata.matched_depth_m}
                depthAxis={depthAxis}
                timestamp={metadata.timestamp}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
};
