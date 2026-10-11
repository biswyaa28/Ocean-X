'use client';

import React from 'react';
import { Hazard, Cyclone, CycloneTrackPoint, OceanMode } from '../types/oceanlens';
import { ChevronRight, ShieldAlert, AlertCircle } from 'lucide-react';

interface IntelligencePanelProps {
  hazard: Hazard | null;
  cyclone: Cyclone | null;
  currentTrackIndex?: number;
  currentPoint: CycloneTrackPoint | null;
  oceanMode?: OceanMode;
  isOpen?: boolean;
  onClose?: () => void;
}

export const IntelligencePanel: React.FC<IntelligencePanelProps> = ({
  hazard,
  cyclone,
  currentPoint,
  oceanMode = 'HISTORICAL',
  isOpen = true,
  onClose,
}) => {
  if (!isOpen) return null;

  // Requirement #13: Live Mode with no active cyclone
  if (oceanMode === 'LIVE') {
    return (
      <div className="fixed right-16 top-32 z-20 w-72 sm:w-80 transition-all duration-300 font-sans text-white select-none">
        <div className="bg-[#080c14]/85 backdrop-blur-xl border border-white/10 rounded-2xl p-4.5 shadow-2xl space-y-3 font-mono">
          <div className="flex items-center justify-between pb-2 border-b border-white/10 text-[10px] uppercase text-slate-400">
            <div className="flex items-center gap-2">
              <div className="p-1 rounded-lg bg-emerald-500/15 text-emerald-400">
                <ShieldAlert className="w-3.5 h-3.5" />
              </div>
              <span className="font-bold tracking-widest text-slate-200">CYCLONE INTELLIGENCE</span>
            </div>
            {onClose && (
              <button
                onClick={onClose}
                className="p-1 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl space-y-1.5 font-mono">
            <div className="flex items-center gap-2 font-bold text-emerald-400 text-xs uppercase">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>NO ACTIVE CYCLONE</span>
            </div>
            <p className="text-[10px] text-slate-300 font-sans pt-1">
              No active cyclone detected in integrated NOAA IBTrACS data stream for the current live ocean period (07 SEP 2026 – 14 SEP 2026).
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (!hazard || !cyclone || !currentPoint) return null;

  const risk = hazard.riskAssessment;
  const isScenario = oceanMode === 'SCENARIO';

  return (
    <div className="fixed right-16 top-32 z-20 w-72 sm:w-80 transition-all duration-300 font-sans text-white select-none">
      <div className="bg-[#080c14]/85 backdrop-blur-xl border border-white/10 rounded-2xl p-4.5 shadow-2xl space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between pb-2.5 font-mono text-[10px] uppercase text-slate-400 border-b border-white/10">
          <div className="flex items-center gap-2">
            <div className={`p-1 rounded-lg ${isScenario ? 'bg-amber-500/15 text-amber-400' : 'bg-rose-500/15 text-rose-400'}`}>
              <ShieldAlert className="w-3.5 h-3.5" />
            </div>
            <span className="font-bold tracking-widest text-slate-200">CYCLONE INTELLIGENCE</span>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className="p-1 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Storm Title */}
        <div>
          <h2 className="text-2xl font-black font-display text-white tracking-tight">
            {cyclone.name}
          </h2>
          <div className="text-[10px] font-mono text-rose-400 font-bold tracking-widest uppercase mt-0.5">
            {currentPoint.category}
          </div>
        </div>

        {/* Dominant Typographic Measurements */}
        <div className="flex items-baseline justify-between pt-1">
          <div>
            <div className="flex items-baseline gap-1">
              <span className="text-3xl font-black font-display text-white tracking-tight">
                {currentPoint.maxWindKts}
              </span>
              <span className="text-xs font-mono font-bold text-slate-400">KT</span>
            </div>
            <div className="text-[8px] font-mono text-slate-500 uppercase tracking-widest mt-0.5">MAX WIND</div>
          </div>

          <div className="text-center border-l border-r border-white/10 px-3">
            <div className="flex items-baseline gap-1 justify-center">
              <span className="text-3xl font-black font-display text-slate-200 tracking-tight">
                {currentPoint.centralPressureMb}
              </span>
              <span className="text-xs font-mono font-bold text-slate-400">hPa</span>
            </div>
            <div className="text-[8px] font-mono text-slate-500 uppercase tracking-widest mt-0.5">PRESSURE</div>
          </div>

          <div className="text-right">
            <div className="flex items-baseline gap-1 justify-end">
              <span className="text-xl font-bold font-mono text-amber-300">NW</span>
              <span className="text-xs font-mono font-bold text-slate-400">12 KT</span>
            </div>
            <div className="text-[8px] font-mono text-slate-500 uppercase tracking-widest mt-0.5">MOVEMENT</div>
          </div>
        </div>

        <div className="h-[1px] bg-white/10 w-full" />

        {/* Coastal Distance & Risk Score */}
        <div className="space-y-2 font-mono text-xs">
          <div className="flex items-center justify-between">
            <span className="text-[9px] text-slate-400 uppercase tracking-widest">COASTAL DISTANCE</span>
            <span className="font-bold text-white text-sm">{currentPoint.distanceToCoastKm} KM</span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-[9px] text-rose-400 font-bold uppercase tracking-widest">DEMO HEURISTIC SCORE</span>
            <div className="flex items-baseline gap-1">
              <span className="font-black text-rose-400 text-lg">
                {risk.status === 'OK' ? risk.heuristicDemoScore : 'UNAVAILABLE'}
              </span>
              {risk.status === 'OK' && <span className="text-slate-500 text-[10px]">/ 100</span>}
            </div>
            <div className="text-[9px] text-amber-500/90 text-right leading-tight">
              NOT VALIDATED · NOT FOR OPERATIONAL USE
            </div>
          </div>
        </div>

        <div className="h-[1px] bg-white/10 w-full" />

        {/* Risk Drivers */}
        <div>
          <div className="text-[9px] font-mono text-slate-400 uppercase font-bold tracking-widest mb-1.5">
            RISK DRIVERS
          </div>
          <div className="space-y-1.5 font-mono text-[10.5px]">
            {(risk.explanation?.keyFactors ?? []).map((factor, idx) => (
              <div key={idx} className="flex items-center gap-2.5 text-slate-300">
                <span className="text-[9px] font-bold text-rose-400/80 shrink-0">
                  {String(idx + 1).padStart(2, '0')}
                </span>
                <span className="uppercase text-slate-200 tracking-wide text-[10px] truncate">{factor}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="h-[1px] bg-white/10 w-full" />

        {/* Provenance Badge Context */}
        <div className="flex items-center justify-between font-mono text-xs pt-0.5">
          <div>
            <div className="text-[8px] text-slate-400 uppercase tracking-widest">
              SOURCE PROVENANCE
            </div>
            <div className="font-bold text-white text-xs mt-0.5">
              {isScenario ? 'SCENARIO SIMULATION' : 'NOAA IBTrACS v04r01'}
            </div>
          </div>
          <div className="text-right">
            <span className={`text-[9px] font-bold px-2.5 py-1 rounded-lg uppercase tracking-wider ${
              isScenario ? 'text-amber-300 bg-amber-500/10 border border-amber-500/20' :
              'text-cyan-300 bg-cyan-500/10 border border-cyan-500/20'
            }`}>
              {isScenario ? 'SIMULATED' : 'HISTORICAL CASE (2020)'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
