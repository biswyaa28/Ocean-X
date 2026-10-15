'use client';

/**
 * OCEAN-X — controls and readout for the selected float's vertical profile.
 *
 * The panel is the ONLY place the ribbon's meaning is spelled out, so nothing
 * here may be implied by the scene alone:
 *
 * - the vertical exaggeration is stated in words, because a stretched column
 *   that is not labelled is simply a false picture of the water column;
 * - the ribbon and the spheres are named, because they are different kinds of
 *   thing (a measurement and a model level) drawn on the same axis;
 * - when no model level matched, the panel says so rather than letting the
 *   absence read as an omission.
 *
 * Every number shown is passed in already computed by argoProfileRibbon, so
 * this component displays and never re-derives.
 */

import React from 'react';
import { RotateCcw } from 'lucide-react';
import { getPaletteForVariable, paletteCssGradient } from '../utils/scientificPalettes';
import {
  RIBBON_EXAGGERATIONS,
  RIBBON_VARIABLE_LABELS,
  RIBBON_VARIABLE_UNITS,
  ribbonExaggerationLabel,
  type ArgoRibbonSceneData,
  type RibbonVariable,
} from '../utils/argoProfileRibbon';

interface ArgoProfileRibbonControlProps {
  visible: boolean;
  floatId?: string | null;
  data: ArgoRibbonSceneData | null;
  variable: RibbonVariable;
  paletteId: string;
  exaggeration: number;
  onVariableChange: (variable: RibbonVariable) => void;
  onExaggerationChange: (value: number) => void;
  onResetView: () => void;
}

/** Why a ribbon is missing, in words a reader can act on. */
export function ribbonRejectionMessage(
  rejection: ArgoRibbonSceneData['rejection']
): string | null {
  switch (rejection) {
    case 'NO_PROFILE':
      return 'No profile selected.';
    case 'NO_QC_ACCEPTED_LEVELS':
      return 'No QC-passed levels in this profile — nothing is drawn. A ribbon would have to show values the matchup refuses to compare.';
    case 'NO_FINITE_VALUE_FOR_VARIABLE':
      return 'This profile has no usable values for the selected variable.';
    default:
      return null;
  }
}

function formatValue(value: number): string {
  return Number.isFinite(value) ? value.toFixed(1) : '—';
}

export const ArgoProfileRibbonControl: React.FC<ArgoProfileRibbonControlProps> = ({
  visible,
  floatId,
  data,
  variable,
  paletteId,
  exaggeration,
  onVariableChange,
  onExaggerationChange,
  onResetView,
}) => {
  if (!visible) return null;

  const palette = getPaletteForVariable(
    variable === 'temperature_c' ? 'temperature' : 'salinity',
    paletteId
  );
  const rejectionMessage = ribbonRejectionMessage(data?.rejection ?? null);
  const profile = data?.profile;

  return (
    <div
      data-testid="argo-ribbon-control"
      className="absolute left-6 bottom-24 z-20 w-72 bg-[#080c14]/92 backdrop-blur-xl border border-amber-500/35 rounded-xl p-3 font-mono text-slate-100 space-y-2.5 shadow-2xl"
    >
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold text-amber-300 tracking-wider">
          ARGO PROFILE
        </span>
        <span className="text-[8px] text-slate-500">
          FLOAT {floatId ?? '—'}
        </span>
      </div>

      {rejectionMessage ? (
        <p
          data-testid="ribbon-rejection-note"
          className="text-[8.5px] leading-relaxed text-amber-200/90"
        >
          {rejectionMessage}
        </p>
      ) : (
        <>
          {/* Variable toggle */}
          <div>
            <div className="text-[8px] text-slate-400 uppercase mb-1">Coloured by</div>
            <div className="flex gap-1">
              {(Object.keys(RIBBON_VARIABLE_LABELS) as RibbonVariable[]).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => onVariableChange(option)}
                  aria-pressed={variable === option}
                  className={`flex-1 px-2 py-1 rounded text-[9px] font-bold uppercase transition-colors ${
                    variable === option
                      ? 'bg-amber-500/25 text-amber-200 border border-amber-400/50'
                      : 'bg-white/5 text-slate-400 border border-white/10 hover:text-slate-200'
                  }`}
                >
                  {RIBBON_VARIABLE_LABELS[option]}
                </button>
              ))}
            </div>
          </div>

          {/* Colour scale: the range of values actually drawn, never a hardcoded one */}
          {profile && profile.points.length > 0 && (
            <div data-testid="ribbon-colour-scale">
              <div className="text-[8px] text-slate-400 uppercase mb-1">
                {RIBBON_VARIABLE_LABELS[variable]} · drawn range
              </div>
              <div
                className="h-2 rounded border border-white/15"
                style={{ background: paletteCssGradient(palette) }}
              />
              <div className="flex justify-between text-[8px] text-slate-400 mt-0.5">
                <span>
                  {formatValue(profile.valueMin)} {RIBBON_VARIABLE_UNITS[variable]}
                </span>
                <span>
                  {formatValue(profile.valueMax)} {RIBBON_VARIABLE_UNITS[variable]}
                </span>
              </div>
              <div className="text-[7.5px] text-slate-500 mt-0.5">
                {profile.points.length} of {profile.eligibleLevelCount} measured levels drawn ·
                depth {(profile.minDepthM ?? 0).toFixed(0)}–{(profile.maxDepthM ?? 0).toFixed(0)} m
                {profile.rejectedByQcCount > 0
                  ? ` · ${profile.rejectedByQcCount} level(s) dropped by QC`
                  : ''}
              </div>
            </div>
          )}

          {/* Exaggeration, always named in words */}
          <div>
            <div className="text-[8px] text-slate-400 uppercase mb-1">
              {ribbonExaggerationLabel(exaggeration)}
            </div>
            <div className="flex gap-1">
              {RIBBON_EXAGGERATIONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => onExaggerationChange(option)}
                  aria-pressed={exaggeration === option}
                  className={`flex-1 px-2 py-1 rounded text-[9px] font-bold transition-colors ${
                    exaggeration === option
                      ? 'bg-cyan-500/25 text-cyan-200 border border-cyan-400/50'
                      : 'bg-white/5 text-slate-400 border border-white/10 hover:text-slate-200'
                  }`}
                >
                  {option}x
                </button>
              ))}
            </div>
            <div className="text-[7.5px] text-slate-500 mt-1">
              Drawn depth only. Labels always carry the real depth.
            </div>
          </div>

          {/* Legend */}
          <div className="pt-1.5 border-t border-white/10 space-y-1 text-[8.5px]">
            <div className="flex items-center gap-2">
              <span className="inline-block w-5 h-[3px] rounded" style={{ background: paletteCssGradient(palette) }} />
              <span className="text-slate-300">ribbon = Argo observation</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-block w-2.5 h-2.5 rounded-full border border-white bg-white/40" />
              <span className="text-slate-300">spheres = HYCOM model level</span>
            </div>
            {data && !data.hasModelData ? (
              <p data-testid="ribbon-no-model-note" className="text-amber-200/90 leading-relaxed">
                No HYCOM level matched this float, so no model spheres are drawn. The ribbon is
                the Argo observation on its own.
              </p>
            ) : (
              <p className="text-slate-500 leading-relaxed">
                Both use the same colour scale, so a colour difference is a value difference.
              </p>
            )}
          </div>
        </>
      )}

      <button
        type="button"
        onClick={onResetView}
        className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg bg-white/5 border border-white/10 text-[9px] font-bold text-slate-300 hover:text-slate-100 hover:border-cyan-400/40 transition-colors"
      >
        <RotateCcw className="w-3 h-3" />
        RESET VIEW
      </button>
    </div>
  );
};

export default ArgoProfileRibbonControl;