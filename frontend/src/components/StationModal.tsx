'use client';

import React from 'react';
import { Station } from '../types/oceanlens';
import { X, Radio, Thermometer, Wind, Waves, Activity, ShieldCheck } from 'lucide-react';

interface StationModalProps {
  station: Station | null;
  onClose: () => void;
}

export const StationModal: React.FC<StationModalProps> = ({ station, onClose }) => {
  if (!station) return null;

  const m = station.currentMeasurements;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-[#0d121c]/90 border border-white/15 rounded-3xl max-w-md w-full p-6 shadow-2xl text-slate-100 relative font-sans">
        <button
          onClick={onClose}
          className="absolute top-5 right-5 p-1.5 rounded-full bg-white/10 text-slate-400 hover:text-white hover:bg-white/20 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-3 mb-5">
          <div className="p-3 rounded-2xl bg-cyan-500/10 border border-cyan-500/25 text-cyan-400">
            <Radio className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <div className="text-[10px] font-mono text-cyan-400 uppercase tracking-widest font-bold">
              OBSERVATION NODE
            </div>
            <h3 className="font-display font-bold text-lg text-white">{station.name}</h3>
            <div className="text-[11px] text-slate-400 font-mono flex items-center gap-2 mt-0.5">
              <span>{station.region}</span>
              <span>•</span>
              <span className="uppercase text-slate-300 font-semibold">{station.type}</span>
            </div>
          </div>
        </div>

        {/* Location Coordinates & Status Grid */}
        <div className="grid grid-cols-2 gap-2 text-xs font-mono mb-5 bg-white/5 p-3 rounded-2xl border border-white/10">
          <div>
            <span className="text-slate-400 uppercase block text-[9px] tracking-wider">LATITUDE</span>
            <span className="text-white font-bold text-sm">{station.latitude}° N</span>
          </div>
          <div>
            <span className="text-slate-400 uppercase block text-[9px] tracking-wider">LONGITUDE</span>
            <span className="text-white font-bold text-sm">{station.longitude}° E</span>
          </div>
          <div className="pt-1">
            <span className="text-slate-400 uppercase block text-[9px] tracking-wider">STATUS</span>
            <span className="text-emerald-400 font-bold uppercase text-xs flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              {station.status}
            </span>
          </div>
          <div className="pt-1">
            <span className="text-slate-400 uppercase block text-[9px] tracking-wider">DATA CONFIRM</span>
            <span className="text-amber-400 font-bold uppercase text-xs">● {station.dataStatus}</span>
          </div>
        </div>

        {/* Ocean Measurements Grid */}
        <div className="space-y-2 mb-5">
          <div className="text-[10px] font-mono uppercase text-slate-400 tracking-widest font-bold px-1">
            REAL-TIME TELEMETRY
          </div>

          <div className="grid grid-cols-2 gap-2.5 text-xs font-mono">
            {m.sstC !== undefined && (
              <div className="p-3 rounded-2xl bg-white/5 border border-white/10 flex items-center gap-3">
                <Thermometer className="w-4 h-4 text-rose-400 shrink-0" />
                <div>
                  <div className="text-[9px] text-slate-400 uppercase tracking-wider">SEA TEMP</div>
                  <div className="font-bold text-rose-300 text-sm">{m.sstC} °C</div>
                </div>
              </div>
            )}

            {m.windSpeedKts !== undefined && (
              <div className="p-3 rounded-2xl bg-white/5 border border-white/10 flex items-center gap-3">
                <Wind className="w-4 h-4 text-cyan-400 shrink-0" />
                <div>
                  <div className="text-[9px] text-slate-400 uppercase tracking-wider">WIND SPEED</div>
                  <div className="font-bold text-cyan-300 text-sm">{m.windSpeedKts} KTS</div>
                </div>
              </div>
            )}

            {m.waveHeightM !== undefined && (
              <div className="p-3 rounded-2xl bg-white/5 border border-white/10 flex items-center gap-3">
                <Waves className="w-4 h-4 text-sky-400 shrink-0" />
                <div>
                  <div className="text-[9px] text-slate-400 uppercase tracking-wider">WAVE HEIGHT</div>
                  <div className="font-bold text-sky-300 text-sm">{m.waveHeightM} M</div>
                </div>
              </div>
            )}

            {m.pressureMb !== undefined && (
              <div className="p-3 rounded-2xl bg-white/5 border border-white/10 flex items-center gap-3">
                <Activity className="w-4 h-4 text-amber-400 shrink-0" />
                <div>
                  <div className="text-[9px] text-slate-400 uppercase tracking-wider">PRESSURE</div>
                  <div className="font-bold text-amber-300 text-sm">{m.pressureMb} hPa</div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Verification Badge */}
        <div className="p-3 rounded-2xl bg-white/5 border border-white/10 text-[11px] font-mono text-slate-300 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span>INCOIS Node Telemetry</span>
          </div>
          <span className="text-amber-400 font-bold bg-amber-400/10 border border-amber-400/20 px-2 py-0.5 rounded-full text-[9px]">
            SIMULATED
          </span>
        </div>
      </div>
    </div>
  );
};

