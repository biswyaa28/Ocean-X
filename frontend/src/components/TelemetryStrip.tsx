'use client';

import React from 'react';
import { KPIMetrics } from '../types/oceanlens';
import { ShieldAlert, Wind, Waves, Thermometer, Activity } from 'lucide-react';

interface TelemetryStripProps {
  metrics: KPIMetrics | null;
}

export const TelemetryStrip: React.FC<TelemetryStripProps> = ({ metrics }) => {
  if (!metrics) return null;

  return (
    <div className="absolute top-20 left-6 z-20 hidden md:flex items-center gap-2 select-none font-mono text-[10px]">
      {/* Active Cyclone Pill */}
      <div className="bg-[#0d121c]/80 backdrop-blur-xl border border-white/10 px-3 py-1.5 rounded-xl shadow-lg flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-ping" />
        <span className="text-slate-400 font-bold uppercase tracking-wider">CYCLONES</span>
        <span className="text-white font-bold text-xs">{String(metrics.activeCyclones).padStart(2, '0')}</span>
      </div>

      {/* Max Wind Pill */}
      <div className="bg-[#0d121c]/80 backdrop-blur-xl border border-white/10 px-3 py-1.5 rounded-xl shadow-lg flex items-center gap-2">
        <Wind className="w-3.5 h-3.5 text-cyan-400" />
        <span className="text-slate-400 uppercase tracking-wider">MAX WIND</span>
        <span className="text-cyan-300 font-bold text-xs">{metrics.maxWindKts} KT</span>
      </div>

      {/* SST Pill */}
      <div className="bg-[#0d121c]/80 backdrop-blur-xl border border-white/10 px-3 py-1.5 rounded-xl shadow-lg flex items-center gap-2">
        <Thermometer className="w-3.5 h-3.5 text-rose-400" />
        <span className="text-slate-400 uppercase tracking-wider">SST</span>
        <span className="text-rose-300 font-bold text-xs">{metrics.avgSSTC} °C</span>
      </div>

      {/* Waves Pill */}
      <div className="bg-[#0d121c]/80 backdrop-blur-xl border border-white/10 px-3 py-1.5 rounded-xl shadow-lg flex items-center gap-2">
        <Waves className="w-3.5 h-3.5 text-sky-400" />
        <span className="text-slate-400 uppercase tracking-wider">WAVE</span>
        <span className="text-sky-300 font-bold text-xs">{metrics.maxWaveHeightM} M</span>
      </div>

      {/* Risk Pill */}
      <div className="bg-[#0d121c]/80 backdrop-blur-xl border border-rose-500/30 px-3 py-1.5 rounded-xl shadow-lg flex items-center gap-2">
        <ShieldAlert className="w-3.5 h-3.5 text-rose-500" />
        <span className="text-slate-400 uppercase tracking-wider">RISK</span>
        <span className="text-rose-400 font-bold text-xs tracking-wider">{metrics.coastalRiskLevel}</span>
      </div>

      {/* Forecast Confidence Pill */}
      <div className="bg-[#0d121c]/80 backdrop-blur-xl border border-white/10 px-3 py-1.5 rounded-xl shadow-lg flex items-center gap-2">
        <Activity className="w-3.5 h-3.5 text-emerald-400" />
        <span className="text-slate-400 uppercase tracking-wider">CONFIDENCE</span>
        <span className="text-emerald-300 font-bold text-xs">{metrics.forecastConfidencePct}%</span>
      </div>
    </div>
  );
};
