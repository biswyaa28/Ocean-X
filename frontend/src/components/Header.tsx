'use client';

import React, { useState, useEffect } from 'react';
import { AppMode, OceanMode, DataStatus, KPIMetrics, Cyclone } from '../types/oceanlens';
import { Compass, SlidersHorizontal, Activity } from 'lucide-react';

interface HeaderProps {
  mode: AppMode;
  onModeChange: (mode: AppMode) => void;
  oceanMode: OceanMode;
  onOceanModeChange: (oceanMode: OceanMode) => void;
  dataStatus: DataStatus;
  backendConnected: boolean;
  metrics: KPIMetrics | null;
  cyclone?: Cyclone | null;
}

export const Header: React.FC<HeaderProps> = ({
  mode,
  onModeChange,
  oceanMode,
  onOceanModeChange,
  dataStatus,
  backendConnected,
  metrics,
  cyclone,
}) => {
  const [currentTime, setCurrentTime] = useState<string>('');

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      const hours = String(now.getUTCHours()).padStart(2, '0');
      const mins = String(now.getUTCMinutes()).padStart(2, '0');
      const secs = String(now.getUTCSeconds()).padStart(2, '0');
      setCurrentTime(`UTC ${hours}:${mins}:${secs}`);
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <header className="absolute top-4 left-6 right-6 z-30 flex flex-col gap-2.5 pointer-events-none select-none">
      {/* Top Floating Control Row */}
      <div className="flex items-center justify-between w-full flex-wrap gap-2">
        {/* Left Branding Title */}
        <div className="pointer-events-auto flex items-center gap-3 bg-[#080c14]/85 backdrop-blur-xl border border-white/10 px-4 py-2 rounded-2xl shadow-2xl">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-pulse shadow-[0_0_10px_rgba(34,211,238,0.8)]" />
            <h1 className="font-display font-extrabold text-sm tracking-widest text-white uppercase">
              OCEANLENS
            </h1>
          </div>

          <div className="h-3.5 w-[1px] bg-white/15" />

          <div className="flex flex-col">
            <span className="text-[10px] font-bold font-mono tracking-wider text-slate-200 uppercase">
              BAY OF BENGAL
            </span>
            <span className="text-[8px] font-mono tracking-widest text-slate-400 uppercase">
              OCEAN INTELLIGENCE
            </span>
          </div>
        </div>

        {/* Central Prominent Ocean Mode Switcher (Requirement #1) */}
        <div className="pointer-events-auto flex items-center bg-[#080c14]/90 backdrop-blur-2xl border border-cyan-500/40 p-1 rounded-2xl shadow-2xl text-[10px] sm:text-[11px] font-mono font-bold tracking-wider">
          <button
            onClick={() => onOceanModeChange('LIVE')}
            className={`px-3 py-1.5 rounded-xl transition-all duration-200 flex items-center gap-1.5 ${
              oceanMode === 'LIVE'
                ? 'bg-emerald-500 text-slate-950 font-black shadow-lg shadow-emerald-500/30'
                : 'text-slate-300 hover:text-white hover:bg-white/5'
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${oceanMode === 'LIVE' ? 'bg-slate-950 animate-ping' : 'bg-emerald-400'}`} />
            <span>LIVE OCEAN</span>
          </button>

          <button
            onClick={() => onOceanModeChange('HISTORICAL')}
            className={`px-3 py-1.5 rounded-xl transition-all duration-200 flex items-center gap-1.5 ${
              oceanMode === 'HISTORICAL'
                ? 'bg-cyan-500 text-slate-950 font-black shadow-lg shadow-cyan-500/30'
                : 'text-slate-300 hover:text-white hover:bg-white/5'
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${oceanMode === 'HISTORICAL' ? 'bg-slate-950 animate-ping' : 'bg-cyan-400'}`} />
            <span>HISTORICAL REPLAY</span>
          </button>

          <button
            onClick={() => onOceanModeChange('SCENARIO')}
            className={`px-3 py-1.5 rounded-xl transition-all duration-200 flex items-center gap-1.5 ${
              oceanMode === 'SCENARIO'
                ? 'bg-amber-500 text-slate-950 font-black shadow-lg shadow-amber-500/30'
                : 'text-slate-300 hover:text-white hover:bg-white/5'
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${oceanMode === 'SCENARIO' ? 'bg-slate-950 animate-ping' : 'bg-amber-400'}`} />
            <span>SCENARIO</span>
          </button>
        </div>

        {/* Right Status & App Mode Pills */}
        <div className="pointer-events-auto flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-2 bg-[#080c14]/85 backdrop-blur-xl border border-white/10 px-3.5 py-1.5 rounded-2xl shadow-xl text-[10px] font-mono text-slate-300">
            <div className={`flex items-center gap-1.5 font-semibold ${backendConnected ? 'text-emerald-400' : 'text-amber-400'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${backendConnected ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
              <span>{backendConnected ? 'REAL BACKEND CONNECTED' : `● ${dataStatus}`}</span>
            </div>
            <span className="text-white/20">│</span>
            <span className="text-slate-200 tracking-wider font-semibold">{currentTime || 'UTC 17:31:28'}</span>
          </div>

          <div className="flex items-center bg-[#080c14]/85 backdrop-blur-xl border border-white/10 p-1 rounded-2xl shadow-xl text-[10px] font-mono">
            <button
              onClick={() => onModeChange('OPERATIONS')}
              className={`px-3 py-1 rounded-xl transition-all duration-200 font-semibold flex items-center gap-1.5 ${
                mode === 'OPERATIONS'
                  ? 'bg-white text-slate-950 shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Compass className="w-3 h-3" />
              <span>OPERATIONS</span>
            </button>

            <button
              onClick={() => onModeChange('RESEARCH')}
              className={`px-3 py-1 rounded-xl transition-all duration-200 font-semibold flex items-center gap-1.5 ${
                mode === 'RESEARCH'
                  ? 'bg-white text-slate-950 shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <SlidersHorizontal className="w-3 h-3" />
              <span>RESEARCH</span>
            </button>
          </div>
        </div>
      </div>

      {/* ONE Compact Integrated Telemetry & Provenance Ribbon (Requirement #12) */}
      <div className="pointer-events-auto self-start bg-[#080c14]/80 backdrop-blur-xl border border-white/10 px-4 py-1.5 rounded-xl text-[10px] font-mono text-slate-300 flex items-center gap-3 shadow-xl max-w-full overflow-x-auto">
        <div className="flex items-center gap-1.5 font-bold text-white shrink-0">
          <span className={`w-1.5 h-1.5 rounded-full animate-ping ${
            oceanMode === 'LIVE' ? 'bg-emerald-400' :
            oceanMode === 'HISTORICAL' ? 'bg-cyan-400' : 'bg-amber-400'
          }`} />
          <span>
            {oceanMode === 'LIVE' ? 'LIVE OCEAN · REAL INCOIS HYCOM DATA' :
             oceanMode === 'HISTORICAL' ? 'HISTORICAL REPLAY · AMPHAN (2020) · NOAA IBTrACS' :
             'SCENARIO SIMULATION · NOT AN OFFICIAL FORECAST'}
          </span>
        </div>

        <span className="text-white/15 shrink-0">│</span>

        <div className="flex items-center gap-1 shrink-0">
          <span className="text-slate-400">STATUS:</span>
          <span className="text-cyan-300 font-bold">
            {oceanMode === 'LIVE' ? (metrics?.activeCyclones ? '01 ACTIVE CYCLONE' : 'NO ACTIVE CYCLONE IN INTEGRATED DATA') :
             oceanMode === 'HISTORICAL' ? 'HISTORICAL RECORD (NOAA IBTrACS)' :
             'SIMULATION'}
          </span>
        </div>

        {metrics && (
          <>
            <span className="text-white/15 shrink-0">│</span>
            <div className="flex items-center gap-1 shrink-0">
              <span className="text-slate-400">MAX WIND:</span>
              <span className="text-cyan-300 font-bold">{metrics.maxWindKts} KT</span>
            </div>

            <span className="text-white/15 shrink-0">│</span>
            <div className="flex items-center gap-1 shrink-0">
              <span className="text-slate-400">SST:</span>
              <span className="text-rose-300 font-bold">{metrics.avgSSTC} °C</span>
            </div>

            <span className="text-white/15 shrink-0">│</span>
            <div className="flex items-center gap-1 shrink-0">
              <span className="text-slate-400">RISK:</span>
              <span className={`font-bold tracking-wider ${
                metrics.coastalRiskLevel === 'CRITICAL' ? 'text-rose-400' :
                metrics.coastalRiskLevel === 'HIGH' ? 'text-amber-400' :
                metrics.coastalRiskLevel === 'ELEVATED' ? 'text-yellow-400' :
                'text-emerald-400'
              }`}>{metrics.coastalRiskLevel}</span>
            </div>
          </>
        )}
      </div>
    </header>
  );
};
