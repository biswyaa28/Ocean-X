'use client';

import React, { useState } from 'react';
import {
  ShieldAlert,
  Search,
  Locate,
  Ruler,
  Share2,
  Settings,
  Sun,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { Cyclone, Hazard, CycloneTrackPoint, AstronomicalData, type FlyToTarget } from '../types/oceanlens';
import { ToolModals } from './ToolModals';

export type ActiveRightTool =
  | 'storm'
  | 'search'
  | 'center'
  | 'measure'
  | 'export'
  | 'settings'
  | 'astro'
  | null;

interface ToolRailProps {
  activeTool: ActiveRightTool;
  onSelectTool: (tool: ActiveRightTool) => void;
  cyclone?: Cyclone | null;
  hazard?: Hazard | null;
  currentPoint?: CycloneTrackPoint | null;
  astroData?: AstronomicalData | null;
  onFlyTo?: (location: FlyToTarget) => void;
}

export const ToolRail: React.FC<ToolRailProps> = ({
  activeTool,
  onSelectTool,
  cyclone = null,
  hazard = null,
  currentPoint = null,
  astroData = null,
  onFlyTo = () => {},
}) => {
  const [expanded, setExpanded] = useState(false);

  const tools: {
    id: ActiveRightTool & string;
    label: string;
    detail: string;
    icon: React.ComponentType<{ className?: string }>;
    isHazard?: boolean;
  }[] = [
    {
      id: 'storm',
      label: 'STORM INTELLIGENCE',
      detail: currentPoint ? `${currentPoint.category} · ${currentPoint.maxWindKts} KT WINDS` : 'HISTORICAL CASE (2020)',
      icon: ShieldAlert,
      isHazard: true,
    },
    {
      id: 'astro',
      label: 'ASTRONOMICAL VIEW',
      detail: 'REAL SUN · MOON · SPACE ENGINE',
      icon: Sun,
    },
    {
      id: 'search',
      label: 'GIS SEARCH',
      detail: 'BAY OF BENGAL GEOCODER',
      icon: Search,
    },
    {
      id: 'center',
      label: 'CENTER MAP',
      detail: '18.0° N, 88.0° E',
      icon: Locate,
    },
    {
      id: 'measure',
      label: 'MEASURE RADIUS',
      detail: 'SPATIAL TELEMETRY',
      icon: Ruler,
    },
    {
      id: 'export',
      label: 'EXPORT DATA',
      detail: 'TELEMETRY REPORT',
      icon: Share2,
    },
    {
      id: 'settings',
      label: 'GLOBE SETTINGS',
      detail: 'RENDER PARAMETERS',
      icon: Settings,
    },
  ];

  const handleToolClick = (id: ActiveRightTool & string) => {
    if (id === 'center') {
      onFlyTo({ lat: 18.0, lon: 88.0, height: 3600000 });
    }

    if (activeTool === id) {
      onSelectTool(null);
    } else {
      onSelectTool(id);
    }
  };

  return (
    <>
      {/* Right-Side Tool Rail Container */}
      <div className="fixed right-6 top-36 z-20 font-mono text-xs select-none">
        <div className="bg-[#080c14]/85 backdrop-blur-xl border border-white/10 rounded-2xl p-1.5 shadow-2xl flex flex-col items-center gap-1">
          {/* Toggle Expand Rail Button */}
          <button
            onClick={() => setExpanded(!expanded)}
            className="p-1.5 rounded-xl hover:bg-white/10 text-slate-400 hover:text-white transition-colors border-b border-white/10 mb-0.5 w-full flex items-center justify-center"
            title={expanded ? 'Collapse Tool Rail' : 'Expand Tool Rail'}
          >
            {expanded ? (
              <ChevronRight className="w-3.5 h-3.5" />
            ) : (
              <ChevronLeft className="w-3.5 h-3.5" />
            )}
          </button>

          {/* Tools Stack */}
          <div className="flex flex-col gap-1 w-full">
            {tools.map((tool) => {
              const Icon = tool.icon;
              const isHazard = tool.isHazard;
              const isActive = activeTool === tool.id;

              return (
                <div key={tool.id} className="relative group">
                  <button
                    onClick={() => handleToolClick(tool.id)}
                    className={`relative p-2.5 rounded-xl transition-all duration-150 flex items-center gap-2.5 ${
                      isHazard
                        ? isActive
                          ? 'bg-rose-500/20 text-rose-400 border border-rose-500/40 shadow-[0_0_12px_rgba(244,63,94,0.3)]'
                          : 'text-rose-400/80 hover:text-rose-300 hover:bg-rose-500/10'
                        : isActive
                        ? 'bg-cyan-500/20 text-cyan-300 font-semibold border border-cyan-500/40 shadow-[0_0_12px_rgba(34,211,238,0.25)]'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-white/10'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />

                    {/* Pulsing indicator dot for storm hazard */}
                    {isHazard && (
                      <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-rose-500 animate-ping" />
                    )}

                    {/* Expanded Rail Label */}
                    {expanded && (
                      <span className="text-[10px] uppercase font-mono tracking-wider truncate pr-1 whitespace-nowrap">
                        {tool.label}
                      </span>
                    )}
                  </button>

                  {/* Elegant Floating Hover Tooltip (Appears on Hover in both Collapsed and Expanded states) */}
                  <div className="absolute right-14 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-all duration-150 flex items-center gap-2.5 bg-[#080c14]/95 backdrop-blur-xl border border-white/15 px-3 py-1.5 rounded-xl shadow-2xl whitespace-nowrap pointer-events-none z-40 font-mono">
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        isHazard
                          ? 'bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.8)] animate-pulse'
                          : 'bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.8)]'
                      }`}
                    />
                    <div className="flex flex-col text-left">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-slate-100 font-sans">
                        {tool.label}
                      </span>
                      <span className="text-[8.5px] font-mono text-slate-400 tracking-wider">
                        {tool.detail}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Floating Tool Modals / Drawers (Rendered at z-30 adjacent to rail) */}
      <ToolModals
        activeTool={activeTool}
        onClose={() => onSelectTool(null)}
        onFlyTo={onFlyTo}
        cyclone={cyclone}
        hazard={hazard}
        currentPoint={currentPoint}
        astroData={astroData}
      />
    </>
  );
};
