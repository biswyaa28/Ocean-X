'use client';

import React, { useState } from 'react';
import { GISLayer } from '../types/oceanlens';
import { Layers, ChevronLeft, ChevronRight, Eye, EyeOff } from 'lucide-react';

interface LayerControlProps {
  layers: GISLayer[];
  onToggleLayer: (layerId: string) => void;
}

interface LayerItemSpec {
  id: string;
  name: string;
  unit?: string;
  statusBadge: string;
  statusType: 'real' | 'derived' | 'simulated' | 'pending' | 'not_integrated';
}

export const LayerControl: React.FC<LayerControlProps> = ({ layers, onToggleLayer }) => {
  const [collapsed, setCollapsed] = useState(false);

  const categories: { name: string; items: LayerItemSpec[] }[] = [
    {
      name: 'HAZARDS',
      items: [
        { id: 'cyclone', name: 'Cyclone Track & Forecast', statusBadge: 'REAL / HISTORICAL', statusType: 'real' },
        { id: 'risk_zones', name: 'Coastal Risk', statusBadge: 'DERIVED', statusType: 'derived' },
        { id: 'storm_surge', name: 'Storm Surge', unit: 'm', statusBadge: 'NOT INTEGRATED', statusType: 'not_integrated' },
      ],
    },
    {
      name: 'OCEAN',
      items: [
        { id: 'currents', name: 'Ocean Currents', unit: 'm/s', statusBadge: 'REAL', statusType: 'real' },
        { id: 'sst', name: 'Sea Surface Temperature', unit: '°C', statusBadge: 'REAL', statusType: 'real' },
        { id: 'salinity', name: 'Sea Surface Salinity', unit: 'PSU', statusBadge: 'REAL', statusType: 'real' },
        { id: 'tchp', name: 'Tropical Cyclone Heat Potential', unit: 'kJ/cm²', statusBadge: 'REAL', statusType: 'real' },
        { id: 'wave_height', name: 'Wave Height', unit: 'm', statusBadge: 'SIMULATED', statusType: 'simulated' },
        { id: 'chlorophyll', name: 'Chlorophyll-a', unit: 'mg/m³', statusBadge: 'NOT INTEGRATED', statusType: 'not_integrated' },
      ],
    },
    {
      name: 'ATMOSPHERE',
      items: [
        { id: 'wind', name: 'Wind Vectors', unit: 'kts', statusBadge: 'SIMULATED', statusType: 'simulated' },
        { id: 'rainfall', name: 'Rainfall', unit: 'mm/h', statusBadge: 'NOT INTEGRATED', statusType: 'not_integrated' },
      ],
    },
    {
      name: 'OBSERVATIONS',
      items: [
        { id: 'argo', name: 'Argo Observations', unit: 'IN-SITU', statusBadge: 'REAL SOURCE / PENDING', statusType: 'pending' },
        { id: 'stations', name: 'Monitoring Stations', statusBadge: 'SIMULATED', statusType: 'simulated' },
        { id: 'buoys', name: 'Buoys', statusBadge: 'SIMULATED', statusType: 'simulated' },
      ],
    },
  ];

  const getIsActive = (id: string) => {
    const found = layers.find((l) => l.id === id);
    return found ? found.active : false;
  };

  // Compact Collapsed Pill State
  if (collapsed) {
    return (
      <div className="fixed left-6 top-32 z-20 font-mono text-xs select-none">
        <button
          onClick={() => setCollapsed(false)}
          className="flex items-center gap-2.5 px-3.5 py-2 rounded-2xl bg-[#080c14]/85 backdrop-blur-xl border border-white/10 text-slate-100 hover:bg-white/10 transition-all shadow-2xl group"
          title="Expand GIS Layers"
        >
          <div className="p-1 rounded-lg bg-cyan-500/15 text-cyan-400">
            <Layers className="w-3.5 h-3.5" />
          </div>
          <span className="font-bold text-[10px] uppercase tracking-widest text-slate-200">
            LAYERS
          </span>
          <ChevronRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-white transition-colors ml-0.5" />
        </button>
      </div>
    );
  }

  // Expanded GIS Instrument State (Viewport-Safe Heights, Requirement #2 & #3)
  return (
    <div className="fixed left-6 top-32 z-20 w-64 sm:w-72 transition-all duration-300 font-mono text-xs select-none">
      <div className="bg-[#080c14]/85 backdrop-blur-xl border border-white/10 rounded-2xl p-3.5 shadow-2xl text-slate-100">
        {/* Panel Header */}
        <div className="flex items-center justify-between border-b border-white/10 pb-2 mb-2 px-1">
          <div className="flex items-center gap-2">
            <div className="p-1 rounded-lg bg-cyan-500/15 text-cyan-400">
              <Layers className="w-3.5 h-3.5" />
            </div>
            <span className="font-bold text-[10px] uppercase tracking-widest text-slate-200">
              LAYERS PANEL
            </span>
          </div>

          <button
            onClick={() => setCollapsed(true)}
            className="p-1 rounded-lg hover:bg-white/10 text-slate-400 hover:text-slate-200 transition-colors"
            title="Collapse GIS Layers"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Categories List with Internal Scrollbar & Safe Max Height (Requirement #2 & #3) */}
        <div className="space-y-3 max-h-[calc(100vh-420px)] overflow-y-auto custom-scrollbar pr-1">
          {categories.map((cat) => (
            <div key={cat.name} className="space-y-1">
              <div className="text-[8px] font-bold text-slate-500 tracking-widest uppercase px-1 mb-1">
                {cat.name}
              </div>

              <div className="space-y-0.5">
                {cat.items.map((item) => {
                  const active = getIsActive(item.id);

                  return (
                    <button
                      key={item.id}
                      onClick={() => onToggleLayer(item.id)}
                      className={`w-full px-2 py-1.5 rounded-lg text-left transition-all duration-150 flex items-center justify-between text-[10.5px] group ${
                        active
                          ? 'text-cyan-300 font-semibold bg-white/10 border border-cyan-500/40 shadow-[0_0_12px_rgba(34,211,238,0.15)]'
                          : 'text-slate-400 hover:text-slate-200 hover:bg-white/5 border border-transparent'
                      }`}
                    >
                      <div className="flex items-center gap-2 truncate min-w-0 pr-1">
                        <span
                          className={`w-1.5 h-1.5 rounded-full shrink-0 transition-all ${
                            active
                              ? 'bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.8)]'
                              : 'bg-slate-700 group-hover:bg-slate-500'
                          }`}
                        />
                        <span className="truncate text-[10.5px] font-sans tracking-wide">
                          {item.name}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {/* ACTIVE Indicator Pill (Requirement #2) */}
                        {active && (
                          <span className="text-[7px] font-black px-1 py-0.5 rounded bg-cyan-400 text-slate-950 uppercase font-mono tracking-tighter shrink-0 animate-pulse">
                            ACTIVE
                          </span>
                        )}

                        {/* Compact Status Badge (Requirement #3) */}
                        <span className={`text-[7.5px] font-bold px-1.5 py-0.5 rounded font-mono uppercase tracking-wider ${
                          item.statusType === 'real' ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30' :
                          item.statusType === 'derived' ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30' :
                          item.statusType === 'simulated' ? 'bg-yellow-500/15 text-yellow-300 border border-yellow-500/30' :
                          item.statusType === 'pending' ? 'bg-purple-500/15 text-purple-300 border border-purple-500/30' :
                          'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                        }`}>
                          {item.statusBadge}
                        </span>

                        <span className="text-slate-500 group-hover:text-slate-300">
                          {active ? (
                            <Eye className="w-3 h-3 text-cyan-400" />
                          ) : (
                            <EyeOff className="w-3 h-3 opacity-50" />
                          )}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
