'use client';

import React, { useState } from 'react';
import {
  Search,
  Locate,
  Ruler,
  Share2,
  Settings,
  X,
  ShieldAlert,
  Navigation,
  Download,
  Copy,
  Check,
  Sun,
  Moon,
  Compass,
} from 'lucide-react';
import { Cyclone, Hazard, CycloneTrackPoint, AstronomicalData } from '../types/oceanlens';
import { ActiveRightTool } from './ToolRail';

interface ToolModalsProps {
  activeTool: ActiveRightTool;
  onClose: () => void;
  onFlyTo: (location: { lat: number; lon: number; height?: number }) => void;
  cyclone: Cyclone | null;
  hazard: Hazard | null;
  currentPoint: CycloneTrackPoint | null;
  astroData?: AstronomicalData | null;
}

export const ToolModals: React.FC<ToolModalsProps> = ({
  activeTool,
  onClose,
  onFlyTo,
  cyclone,
  hazard,
  currentPoint,
  astroData = null,
}) => {
  // Search drawer states
  const [searchQuery, setSearchQuery] = useState('');
  // Share drawer states
  const [copied, setCopied] = useState(false);
  // Measure drawer states
  const [unit, setUnit] = useState<'km' | 'nm' | 'mi'>('km');
  // Settings drawer states
  const [enableLighting, setEnableLighting] = useState(true);
  const [enableFog, setEnableFog] = useState(true);
  const [enableGrid, setEnableGrid] = useState(true);
  const [simSpeed, setSimSpeed] = useState('1.0x');

  if (!activeTool) return null;

  const presets = [
    { name: 'Cyclone Eye Core', lat: 18.2, lon: 88.4, height: 1200000, desc: 'Active Storm Center · Category 4' },
    { name: 'Sundarbans Delta', lat: 21.9, lon: 88.9, height: 800000, desc: 'High Risk Sector · West Bengal / Bangladesh' },
    { name: 'Odisha Coast (Dhamra)', lat: 20.8, lon: 86.9, height: 750000, desc: 'Predicted Landfall Zone' },
    { name: 'Chittagong Sector', lat: 22.3, lon: 91.8, height: 850000, desc: 'Eastern Bay Storm Surge Zone' },
    { name: 'Cox\'s Bazar Sector', lat: 21.4, lon: 91.9, height: 700000, desc: 'Coastal Vulnerability Watch' },
    { name: 'Chennai Ocean Station', lat: 13.0, lon: 80.2, height: 900000, desc: 'INCOIS Deep Sea Mooring IN-BOB-01' },
  ];

  const filteredPresets = presets.filter((p) =>
    p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    p.desc.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleCopyLink = () => {
    if (typeof window !== 'undefined') {
      navigator.clipboard?.writeText(window.location.href);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadJSON = () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(cyclone, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `OceanLens_${cyclone?.name || 'Cyclone'}_Telemetry.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  const multiplier = unit === 'km' ? 1 : unit === 'nm' ? 0.539957 : 0.621371;
  const risk = hazard?.riskAssessment;

  return (
    <div className="fixed right-20 top-36 z-30 font-mono text-xs select-none transition-all duration-300">
      {/* ================= ASTRONOMICAL VIEW INTEGRATED DRAWER ================= */}
      {activeTool === 'astro' && (
        <div className="bg-[#080c14]/90 backdrop-blur-xl border border-cyan-500/40 rounded-2xl p-4 shadow-2xl w-80 text-slate-100 font-mono">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-white/10 pb-2.5 mb-3">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-amber-500/15 text-amber-400">
                <Sun className="w-4 h-4" />
              </div>
              <div>
                <div className="font-bold text-[10.5px] uppercase tracking-widest text-slate-100">
                  ASTRONOMICAL ENGINE
                </div>
                <div className="text-[8.5px] text-cyan-400 font-semibold tracking-wider uppercase">
                  CESIUM / SIMON1994 PLANETARY
                </div>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-1 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {astroData ? (
            <div className="space-y-3">
              {/* Sun Telemetry Card */}
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 font-bold text-amber-300 text-xs">
                    <Sun className="w-3.5 h-3.5 text-amber-400" />
                    <span>SOLAR TELEMETRY</span>
                  </div>
                  <span className={`text-[8.5px] font-bold px-2 py-0.5 rounded uppercase tracking-wider ${
                    astroData.sun.isDaylight
                      ? 'bg-amber-400/20 text-amber-300 border border-amber-400/30'
                      : 'bg-indigo-900/40 text-indigo-300 border border-indigo-500/30'
                  }`}>
                    {astroData.sun.isDaylight ? 'DAYLIGHT' : 'NIGHT'}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-[10px]">
                  <div>
                    <div className="text-[8px] text-slate-400 uppercase">ELEVATION</div>
                    <div className="font-bold text-white text-xs">{astroData.sun.elevationDeg}°</div>
                  </div>
                  <div>
                    <div className="text-[8px] text-slate-400 uppercase">AZIMUTH</div>
                    <div className="font-bold text-white text-xs">{astroData.sun.azimuthDeg}°</div>
                  </div>
                  <div>
                    <div className="text-[8px] text-slate-400 uppercase">SUNRISE (UTC)</div>
                    <div className="font-bold text-emerald-400">{astroData.sun.sunriseUtc}</div>
                  </div>
                  <div>
                    <div className="text-[8px] text-slate-400 uppercase">SUNSET (UTC)</div>
                    <div className="font-bold text-rose-400">{astroData.sun.sunsetUtc}</div>
                  </div>
                </div>

                <button
                  onClick={() => onFlyTo({ lat: 0, lon: 0, isSun: true } as any)}
                  className="w-full mt-1.5 py-1.5 px-2.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 font-bold text-[9.5px] uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all group"
                >
                  <Navigation className="w-3 h-3 group-hover:scale-110 transition-transform" />
                  <span>ORIENT CAMERA TO SUN</span>
                </button>
              </div>

              {/* Moon Telemetry Card */}
              <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-xl p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 font-bold text-indigo-300 text-xs">
                    <Moon className="w-3.5 h-3.5 text-indigo-300" />
                    <span>LUNAR TELEMETRY</span>
                  </div>
                  <span className="text-[8.5px] font-bold px-2 py-0.5 rounded uppercase tracking-wider bg-indigo-400/20 text-indigo-200 border border-indigo-400/30">
                    {astroData.moon.phaseName}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-[10px]">
                  <div>
                    <div className="text-[8px] text-slate-400 uppercase">ELEVATION</div>
                    <div className="font-bold text-white text-xs">{astroData.moon.elevationDeg}°</div>
                  </div>
                  <div>
                    <div className="text-[8px] text-slate-400 uppercase">AZIMUTH</div>
                    <div className="font-bold text-white text-xs">{astroData.moon.azimuthDeg}°</div>
                  </div>
                  <div className="col-span-2 flex items-center justify-between pt-1 border-t border-white/10">
                    <span className="text-[8px] text-slate-400 uppercase">ILLUMINATION</span>
                    <span className="font-bold text-cyan-300 text-xs">{astroData.moon.illuminationPercent}%</span>
                  </div>
                </div>

                <button
                  onClick={() => onFlyTo({ lat: 0, lon: 0, isMoon: true } as any)}
                  className="w-full mt-1.5 py-1.5 px-2.5 rounded-lg bg-indigo-500/20 hover:bg-indigo-500/30 border border-indigo-500/40 text-indigo-300 font-bold text-[9.5px] uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all group"
                >
                  <Navigation className="w-3 h-3 group-hover:scale-110 transition-transform" />
                  <span>ORIENT CAMERA TO MOON</span>
                </button>
              </div>

              {/* Location & Clock Details */}
              <div className="text-[9px] space-y-1 pt-1 border-t border-white/10 text-slate-400">
                <div className="flex justify-between">
                  <span>TARGET LAT/LON:</span>
                  <span className="font-bold text-slate-200">{astroData.location.lat.toFixed(4)}° N, {astroData.location.lon.toFixed(4)}° E</span>
                </div>
                <div className="flex justify-between">
                  <span>CLOCK TIMESTAMP:</span>
                  <span className="font-bold text-cyan-300">{astroData.timestamp}</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center text-slate-400 text-xs py-4">
              Calculating real-time planetary positions...
            </div>
          )}
        </div>
      )}

      {/* ================= 0. STORM INTELLIGENCE INTEGRATED DRAWER ================= */}
      {activeTool === 'storm' && cyclone && currentPoint && hazard && (
        <div className="bg-[#080c14]/90 backdrop-blur-xl border border-white/15 rounded-2xl p-4.5 shadow-2xl w-80 text-slate-100 font-sans">
          {/* Header */}
          <div className="flex items-center justify-between pb-2.5 mb-2 font-mono text-[10px] uppercase text-slate-400 border-b border-white/10">
            <div className="flex items-center gap-2">
              <div className="p-1 rounded-lg bg-rose-500/15 text-rose-400">
                <ShieldAlert className="w-3.5 h-3.5" />
              </div>
              <span className="font-bold tracking-widest text-slate-200">CYCLONE INTELLIGENCE</span>
            </div>
            <button
              onClick={onClose}
              className="p-1 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
              title="Close Intelligence Instrument"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="space-y-3">
            {/* Storm Title */}
            <div>
              {(cyclone.isHistorical || cyclone.name.toLowerCase().includes('amphan')) && (
                <div className="text-[9px] font-mono font-bold tracking-widest text-amber-400 uppercase bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded w-fit mb-1">
                  HISTORICAL CASE (2020)
                </div>
              )}
              <h2 className="text-2xl font-black font-display text-white tracking-tight">
                {cyclone.name}
              </h2>
              <div className="text-[10px] font-mono text-rose-400 font-bold tracking-widest uppercase mt-0.5">
                {currentPoint.category}
              </div>
            </div>

            {/* Dominant Measurements */}
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

            {/* Thin Horizontal Divider */}
            <div className="h-[1px] bg-white/10 w-full" />

            {/* Coastal Distance & Risk Score Row */}
            <div className="space-y-2 font-mono text-xs">
              <div className="flex items-center justify-between">
                <span className="text-[9px] text-slate-400 uppercase tracking-widest">COASTAL DISTANCE</span>
                <span className="font-bold text-white text-sm">{currentPoint.distanceToCoastKm} KM</span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-[9px] text-rose-400 font-bold uppercase tracking-widest">RISK SCORE</span>
                <div className="flex items-baseline gap-1">
                  <span className="font-black text-rose-400 text-lg">{risk?.score || 92}</span>
                  <span className="text-slate-500 text-[10px]">/ 100</span>
                </div>
              </div>
            </div>

            {/* Thin Horizontal Divider */}
            <div className="h-[1px] bg-white/10 w-full" />

            {/* Risk Drivers List */}
            <div>
              <div className="text-[9px] font-mono text-slate-400 uppercase font-bold tracking-widest mb-2">
                RISK DRIVERS
              </div>
              <div className="space-y-1.5 font-mono text-[10.5px]">
                {risk?.explanation?.keyFactors?.map((factor, idx) => (
                  <div key={idx} className="flex items-center gap-2.5 text-slate-300">
                    <span className="text-[9px] font-bold text-rose-400/80 shrink-0">
                      {String(idx + 1).padStart(2, '0')}
                    </span>
                    <span className="uppercase text-slate-200 tracking-wide text-[10px] truncate">{factor}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Thin Horizontal Divider */}
            <div className="h-[1px] bg-white/10 w-full" />

            {/* Impact Window / Historical Context */}
            <div className="flex items-center justify-between font-mono text-xs pt-0.5">
              <div>
                <div className="text-[8px] text-slate-400 uppercase tracking-widest">
                  {cyclone?.isHistorical ? 'HISTORICAL IMPACT CONTEXT' : 'IMPACT WINDOW'}
                </div>
                <div className="font-bold text-white text-sm mt-0.5">
                  {cyclone?.isHistorical ? 'HISTORICAL RECORD' : '12–24 HOURS'}
                </div>
              </div>
              <div className="text-right">
                <span className={`text-[9px] font-bold px-2.5 py-1 rounded-lg uppercase tracking-wider ${
                  risk?.category === 'CRITICAL' ? 'text-rose-400 bg-rose-500/10 border border-rose-500/20' :
                  risk?.category === 'HIGH' ? 'text-amber-400 bg-amber-500/10 border border-amber-500/20' :
                  risk?.category === 'ELEVATED' ? 'text-yellow-400 bg-yellow-500/10 border border-yellow-500/20' :
                  'text-emerald-400 bg-emerald-500/10 border border-emerald-500/20'
                }`}>
                  {risk?.category || 'ELEVATED'} HAZARD
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ================= 1. SEARCH GEOCODER INSTRUMENT ================= */}
      {activeTool === 'search' && (
        <div className="bg-[#080c14]/90 backdrop-blur-xl border border-white/15 rounded-2xl p-4 shadow-2xl w-80 text-slate-100 font-mono">
          <div className="flex items-center justify-between border-b border-white/10 pb-2.5 mb-3">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-cyan-500/15 text-cyan-400">
                <Search className="w-4 h-4" />
              </div>
              <div>
                <div className="font-bold text-[10.5px] uppercase tracking-widest text-slate-100">
                  GIS SEARCH & GEOCODER
                </div>
                <div className="text-[8.5px] text-slate-400">BAY OF BENGAL REGIONAL TARGETS</div>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-1 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="relative mb-3">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search location or coordinates..."
              className="w-full bg-[#05070a] border border-white/15 rounded-xl px-3 py-2 text-[11px] font-sans text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500/60 focus:ring-1 focus:ring-cyan-500/40"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white text-xs"
              >
                ×
              </button>
            )}
          </div>

          <div className="space-y-1.5 max-h-72 overflow-y-auto custom-scrollbar pr-1">
            <div className="text-[8.5px] font-bold text-slate-500 uppercase tracking-widest px-1 mb-1">
              STRATEGIC BAY OF BENGAL SECTORS
            </div>
            {filteredPresets.map((preset) => (
              <button
                key={preset.name}
                onClick={() => {
                  onFlyTo({ lat: preset.lat, lon: preset.lon, height: preset.height });
                  onClose();
                }}
                className="w-full text-left p-2.5 rounded-xl bg-white/5 hover:bg-cyan-500/15 border border-white/5 hover:border-cyan-500/30 transition-all flex items-start gap-2.5 group"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 mt-1.5 shrink-0 group-hover:shadow-[0_0_8px_rgba(34,211,238,0.8)]" />
                <div className="flex-1 truncate">
                  <div className="text-[11px] font-sans font-medium text-slate-200 group-hover:text-cyan-300 transition-colors">
                    {preset.name}
                  </div>
                  <div className="text-[9px] font-mono text-slate-400 truncate mt-0.5">
                    {preset.desc}
                  </div>
                </div>
                <Navigation className="w-3.5 h-3.5 text-slate-500 group-hover:text-cyan-400 shrink-0 mt-1" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ================= 2. LOCATE RE-CENTER NOTIFICATION ================= */}
      {activeTool === 'center' && (
        <div className="bg-[#080c14]/90 backdrop-blur-xl border border-cyan-500/40 rounded-2xl p-3.5 shadow-2xl w-72 text-slate-100 font-mono flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-cyan-500/20 text-cyan-300">
              <Locate className="w-4 h-4 animate-pulse" />
            </div>
            <div>
              <div className="font-bold text-[10px] uppercase tracking-widest text-cyan-300">
                CAMERA RE-CENTERED
              </div>
              <div className="text-[9px] text-slate-300 font-mono">
                BAY OF BENGAL · 18.0° N, 88.0° E
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* ================= 3. MEASURE SPATIAL INSTRUMENT ================= */}
      {activeTool === 'measure' && (
        <div className="bg-[#080c14]/90 backdrop-blur-xl border border-white/15 rounded-2xl p-4 shadow-2xl w-80 text-slate-100 font-mono">
          <div className="flex items-center justify-between border-b border-white/10 pb-2.5 mb-3">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-cyan-500/15 text-cyan-400">
                <Ruler className="w-4 h-4" />
              </div>
              <div>
                <div className="font-bold text-[10.5px] uppercase tracking-widest text-slate-100">
                  SPATIAL RADIUS & DISTANCE
                </div>
                <div className="text-[8.5px] text-slate-400">REAL-TIME TELEMETRY GEOMETRY</div>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-1 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex items-center justify-between bg-[#05070a] border border-white/10 rounded-xl p-1 mb-3 text-[10px]">
            <span className="text-slate-400 px-2 font-sans text-[9.5px]">UNIT FORMAT:</span>
            <div className="flex gap-1">
              {(['km', 'nm', 'mi'] as const).map((u) => (
                <button
                  key={u}
                  onClick={() => setUnit(u)}
                  className={`px-2.5 py-1 rounded-lg uppercase tracking-wider transition-all ${unit === u
                      ? 'bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-500/40'
                      : 'text-slate-400 hover:text-white'
                    }`}
                >
                  {u}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <div className="bg-white/5 border border-white/10 rounded-xl p-2.5 flex items-center justify-between">
              <div>
                <div className="text-[9px] text-slate-400 font-mono">EYE TO NEAREST LANDFALL</div>
                <div className="text-[10px] text-rose-300 font-bold font-sans mt-0.5">
                  ODISHA / DHAMRA SECTOR
                </div>
              </div>
              <div className="text-right">
                <div className="text-base font-bold text-cyan-300 font-mono tracking-tight">
                  {(270 * multiplier).toFixed(1)} {unit.toUpperCase()}
                </div>
                <div className="text-[8.5px] text-slate-400">EST. LANDFALL ~14.5 HRS</div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="bg-white/5 border border-white/10 rounded-xl p-2.5">
                <div className="text-[8.5px] text-slate-400 uppercase">R50 WIND RADIUS</div>
                <div className="text-sm font-bold text-rose-400 font-mono mt-1">
                  {((cyclone?.windRadius.r50ktsKm || 120) * multiplier).toFixed(0)} {unit.toUpperCase()}
                </div>
                <div className="text-[8.5px] text-slate-500">50 KT SEVERE GALES</div>
              </div>

              <div className="bg-white/5 border border-white/10 rounded-xl p-2.5">
                <div className="text-[8.5px] text-slate-400 uppercase">R34 WIND RADIUS</div>
                <div className="text-sm font-bold text-amber-400 font-mono mt-1">
                  {((cyclone?.windRadius.r34ktsKm || 240) * multiplier).toFixed(0)} {unit.toUpperCase()}
                </div>
                <div className="text-[8.5px] text-slate-500">34 KT GALE FORCE</div>
              </div>
            </div>

            <div className="bg-[#05070a] border border-white/10 rounded-xl p-2.5 flex items-center justify-between text-[9.5px] text-slate-400 font-mono">
              <span>CURRENT EYE COORDS:</span>
              <span className="text-slate-200 font-bold">18.20° N, 88.40° E</span>
            </div>
          </div>
        </div>
      )}

      {/* ================= 4. SHARE & EXPORT INSTRUMENT ================= */}
      {activeTool === 'export' && (
        <div className="bg-[#080c14]/90 backdrop-blur-xl border border-white/15 rounded-2xl p-4 shadow-2xl w-80 text-slate-100 font-mono">
          <div className="flex items-center justify-between border-b border-white/10 pb-2.5 mb-3">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-cyan-500/15 text-cyan-400">
                <Share2 className="w-4 h-4" />
              </div>
              <div>
                <div className="font-bold text-[10.5px] uppercase tracking-widest text-slate-100">
                  SHARE & TELEMETRY EXPORT
                </div>
                <div className="text-[8.5px] text-slate-400">OPERATIONAL REPORTING</div>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-1 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="space-y-2.5">
            <div className="bg-white/5 border border-white/10 rounded-xl p-2.5">
              <div className="text-[9px] text-slate-400 uppercase mb-1.5">LIVE PORTAL URL</div>
              <div className="flex gap-2">
                <input
                  type="text"
                  readOnly
                  value={typeof window !== 'undefined' ? window.location.href : 'http://localhost:3000'}
                  className="flex-1 bg-[#05070a] border border-white/10 rounded-lg px-2.5 py-1.5 text-[10px] text-slate-300 font-mono truncate focus:outline-none"
                />
                <button
                  onClick={handleCopyLink}
                  className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 text-[10px] font-bold transition-all shrink-0 ${copied
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                      : 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 hover:bg-cyan-500/30'
                    }`}
                >
                  {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copied ? 'COPIED' : 'COPY'}</span>
                </button>
              </div>
            </div>

            <button
              onClick={handleDownloadJSON}
              className="w-full p-2.5 rounded-xl bg-white/5 hover:bg-cyan-500/15 border border-white/10 hover:border-cyan-500/40 transition-all flex items-center justify-between text-left group"
            >
              <div className="flex items-center gap-2.5">
                <div className="p-1.5 rounded-lg bg-cyan-500/10 text-cyan-400 group-hover:bg-cyan-500/20">
                  <Download className="w-3.5 h-3.5" />
                </div>
                <div>
                  <div className="text-[11px] font-sans font-semibold text-slate-200 group-hover:text-cyan-300">
                    DOWNLOAD TELEMETRY DATA
                  </div>
                  <div className="text-[8.5px] font-mono text-slate-400">JSON FORMAT · CYCLONE TRACK & STATIONS</div>
                </div>
              </div>
              <Download className="w-3.5 h-3.5 text-slate-500 group-hover:text-cyan-300" />
            </button>
          </div>
        </div>
      )}

      {/* ================= 5. GEOSPATIAL SETTINGS INSTRUMENT ================= */}
      {activeTool === 'settings' && (
        <div className="bg-[#080c14]/90 backdrop-blur-xl border border-white/15 rounded-2xl p-4 shadow-2xl w-80 text-slate-100 font-mono">
          <div className="flex items-center justify-between border-b border-white/10 pb-2.5 mb-3">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-cyan-500/15 text-cyan-400">
                <Settings className="w-4 h-4" />
              </div>
              <div>
                <div className="font-bold text-[10.5px] uppercase tracking-widest text-slate-100">
                  GLOBE RENDER SETTINGS
                </div>
                <div className="text-[8.5px] text-slate-400">VISUAL ENVIRONMENT PARAMETERS</div>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-1 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between p-2 rounded-xl bg-white/5 border border-white/10">
              <span className="text-[11px] font-sans text-slate-300">Atmospheric Lighting</span>
              <button
                onClick={() => setEnableLighting(!enableLighting)}
                className={`w-9 h-5 rounded-full p-0.5 transition-colors ${enableLighting ? 'bg-cyan-500' : 'bg-slate-700'
                  }`}
              >
                <div
                  className={`w-4 h-4 rounded-full bg-white transition-transform ${enableLighting ? 'translate-x-4' : 'translate-x-0'
                    }`}
                />
              </button>
            </div>

            <div className="flex items-center justify-between p-2 rounded-xl bg-white/5 border border-white/10">
              <span className="text-[11px] font-sans text-slate-300">Planetary Fog Depth</span>
              <button
                onClick={() => setEnableFog(!enableFog)}
                className={`w-9 h-5 rounded-full p-0.5 transition-colors ${enableFog ? 'bg-cyan-500' : 'bg-slate-700'
                  }`}
              >
                <div
                  className={`w-4 h-4 rounded-full bg-white transition-transform ${enableFog ? 'translate-x-4' : 'translate-x-0'
                    }`}
                />
              </button>
            </div>

            <div className="flex items-center justify-between p-2 rounded-xl bg-white/5 border border-white/10">
              <span className="text-[11px] font-sans text-slate-300">Hazard Grid Lines</span>
              <button
                onClick={() => setEnableGrid(!enableGrid)}
                className={`w-9 h-5 rounded-full p-0.5 transition-colors ${enableGrid ? 'bg-cyan-500' : 'bg-slate-700'
                  }`}
              >
                <div
                  className={`w-4 h-4 rounded-full bg-white transition-transform ${enableGrid ? 'translate-x-4' : 'translate-x-0'
                    }`}
                />
              </button>
            </div>

            <div className="p-2.5 rounded-xl bg-white/5 border border-white/10 mt-2">
              <div className="text-[9px] text-slate-400 uppercase mb-1.5 font-mono">SIMULATION SCRUB SPEED</div>
              <div className="grid grid-cols-4 gap-1">
                {['0.5x', '1.0x', '2.0x', '5.0x'].map((s) => (
                  <button
                    key={s}
                    onClick={() => setSimSpeed(s)}
                    className={`py-1 rounded-lg text-[10px] font-mono transition-all ${simSpeed === s
                        ? 'bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-500/40'
                        : 'text-slate-400 hover:text-white bg-[#05070a]'
                      }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
