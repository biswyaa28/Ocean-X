'use client';

import React from 'react';
import { KPIMetrics, DataStatus } from '../types/oceanlens';

interface KPIStripProps {
  metrics: KPIMetrics;
  dataStatus: DataStatus;
}

export const KPIStrip: React.FC<KPIStripProps> = ({ metrics }) => {
  const getRiskStyle = (level: string) => {
    switch (level) {
      case 'CRITICAL':
        return 'text-red-400 font-bold';
      case 'HIGH':
        return 'text-orange-400 font-bold';
      case 'MODERATE':
        return 'text-amber-400 font-bold';
      default:
        return 'text-emerald-400 font-bold';
    }
  };

  return (
    <div className="bg-slate-950/85 border-b border-slate-800/60 px-4 py-1 text-slate-200 z-20 relative select-none font-mono">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-0.5 text-xs">
        {/* Primary Target Highlight */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
            <span className="text-[9px] text-slate-500 uppercase tracking-widest font-bold">TARGET HAZARD</span>
          </div>
          <div className="font-sans font-bold text-sm text-cyan-300">
            AMPHAN-SIM
          </div>
          <div className="text-[9px] font-bold px-1 py-0.2 rounded bg-red-950 text-red-300 border border-red-900/80 uppercase">
            SUPER CYCLONE
          </div>
        </div>

        {/* Telemetry Numeric Cluster */}
        <div className="flex items-center gap-5">
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] text-slate-500 uppercase">MAX WIND</span>
            <span className="font-bold text-white text-sm">{metrics.maxWindKts}</span>
            <span className="text-[9px] text-slate-500">kt</span>
          </div>

          <div className="h-3 w-[1px] bg-slate-800/80" />

          <div className="flex items-center gap-1.5">
            <span className="text-[9px] text-slate-500 uppercase">WAVE (Hs)</span>
            <span className="font-bold text-blue-300 text-sm">{metrics.maxWaveHeightM}</span>
            <span className="text-[9px] text-slate-500">m</span>
          </div>

          <div className="h-3 w-[1px] bg-slate-800/80" />

          <div className="flex items-center gap-1.5">
            <span className="text-[9px] text-slate-500 uppercase">SST</span>
            <span className="font-bold text-rose-300 text-sm">{metrics.avgSSTC}</span>
            <span className="text-[9px] text-slate-500">°C</span>
          </div>

          <div className="h-3 w-[1px] bg-slate-800/80" />

          <div className="flex items-center gap-1.5">
            <span className="text-[9px] text-slate-500 uppercase">COASTAL RISK</span>
            <span className={`text-xs ${metrics.coastalRiskLevel ? getRiskStyle(metrics.coastalRiskLevel) : 'text-slate-500'}`}>
              {metrics.coastalRiskLevel ?? 'UNAVAILABLE'}
            </span>
            {/* Unvalidated demo heuristic, never an official warning. */}
            <span className="text-[9px] text-amber-500/80 uppercase">demo · not validated</span>
          </div>

          <div className="h-3 w-[1px] bg-slate-800/80" />

          <div className="flex items-center gap-1.5">
            <span className="text-[9px] text-slate-500 uppercase">FORECAST CONF.</span>
            <span className="font-bold text-cyan-400 text-sm">{metrics.forecastConfidencePct}%</span>
          </div>
        </div>
      </div>
    </div>
  );
};
