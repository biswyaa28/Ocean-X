'use client';

import React from 'react';
import { DataStatus, GISLayer } from '../types/oceanlens';
import { Activity, AlertCircle, MousePointerClick } from 'lucide-react';

export interface InspectionData {
  latitude: number;
  longitude: number;
  timestamp: string;
  tempC?: number | null;
  salnPSU?: number | null;
  uvelMS?: number | null;
  vvelMS?: number | null;
  currentSpeedMS?: number | null;
  currentDirectionDeg?: number | null;
  sshM?: number | null;
  tchpKJ?: number | null;
  mldM?: number | null;
  depthM?: number;
  status?: string;
  dataStatus?: DataStatus;
  message?: string;
  requestedTimestamp?: string;
  availableStart?: string;
  availableEnd?: string;
  source?: string;
  provider?: string;
  customLabel?: string;
  customValue?: string;
  customUnit?: string;
  cycloneName?: string;
  maxWindKts?: number | null;
  centralPressureMb?: number | null;
  category?: string | null;
  distanceToCoastKm?: number | null;
  observationType?: string;
}

interface DataInspectorProps {
  activeLayer: GISLayer | null;
  inspection: InspectionData | null;
  legendBounds?: { min: number; mid: number; max: number; unit: string; layerName: string } | null;
  onClose?: () => void;
}

export const DataInspector: React.FC<DataInspectorProps> = ({
  activeLayer,
  inspection,
  legendBounds,
  onClose,
}) => {
  if (!activeLayer) return null;

  const layerId = activeLayer.id;
  const isNotIntegrated = ['storm_surge', 'chlorophyll', 'rainfall'].includes(layerId);
  const isSimulated = activeLayer.status === 'SIMULATED';
  const isDerived = layerId === 'risk_zones';
  const isPending = activeLayer.status === 'REAL SOURCE — INGESTION PENDING';
  const isTimestampUnavailable = inspection?.status === 'NO_REAL_MODEL_DATA' || inspection?.dataStatus === 'REAL DATASET — TIMESTAMP UNAVAILABLE';
  const isCyclone = layerId === 'cyclone';

  // Determine badge text and colors
  let badgeText = 'REAL';
  let badgeStyle = 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';

  if (isNotIntegrated) {
    badgeText = 'NOT CURRENTLY INTEGRATED';
    badgeStyle = 'bg-amber-500/15 text-amber-300 border-amber-500/30';
  } else if (isTimestampUnavailable) {
    badgeText = 'REAL DATASET — TIMESTAMP UNAVAILABLE';
    badgeStyle = 'bg-purple-500/15 text-purple-300 border-purple-500/30';
  } else if (isSimulated) {
    badgeText = 'SIMULATED';
    badgeStyle = 'bg-yellow-500/15 text-yellow-300 border-yellow-500/30';
  } else if (isDerived) {
    badgeText = 'DERIVED ANALYTICS';
    badgeStyle = 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30';
  } else if (isPending) {
    badgeText = 'REAL SOURCE — INGESTION PENDING';
    badgeStyle = 'bg-purple-500/15 text-purple-300 border-purple-500/30';
  } else if (isCyclone) {
    badgeText = inspection?.observationType || 'HISTORICAL OBSERVATION';
    badgeStyle = 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
  }

  // Format timestamp helper
  const formatTime = (ts?: string) => {
    if (!ts) return 'N/A';
    try {
      const dt = new Date(ts);
      if (isNaN(dt.getTime())) return ts;
      return dt.toUTCString().replace('GMT', 'UTC');
    } catch {
      return ts;
    }
  };

  // Determine source label explicitly
  let sourceLabel = inspection?.source;
  if (!sourceLabel || isCyclone) {
    if (isCyclone) sourceLabel = 'NOAA IBTrACS v04r01';
    else if (isDerived) sourceLabel = 'OceanLens Hazard Risk Engine';
    else if (isSimulated) sourceLabel = 'Simulated Parametric Field';
    else sourceLabel = 'INCOIS RSMC HYCOM';
  }

  // Dominant reading values
  let mainValue = '—';
  let unitLabel = activeLayer.unit || '';
  let varName = 'PARAMETER';

  if (inspection && !isTimestampUnavailable && !isCyclone) {
    if (layerId === 'sst' && inspection.tempC !== undefined && inspection.tempC !== null) {
      mainValue = `${inspection.tempC.toFixed(2)}`;
      unitLabel = '°C';
      varName = 'SEA SURFACE TEMP (TEMP)';
    } else if (layerId === 'salinity' && inspection.salnPSU !== undefined && inspection.salnPSU !== null) {
      mainValue = `${inspection.salnPSU.toFixed(2)}`;
      unitLabel = 'PSU';
      varName = 'SURFACE SALINITY (SALN)';
    } else if (layerId === 'currents') {
      if (inspection.currentSpeedMS !== undefined && inspection.currentSpeedMS !== null) {
        mainValue = `${inspection.currentSpeedMS.toFixed(2)}`;
        unitLabel = 'm/s';
        if (inspection.currentDirectionDeg !== undefined && inspection.currentDirectionDeg !== null) {
          unitLabel += ` · ${inspection.currentDirectionDeg.toFixed(0)}°`;
        }
      }
      varName = 'OCEAN VELOCITY (UVEL/VVEL)';
    } else if (layerId === 'tchp' && inspection.tchpKJ !== undefined && inspection.tchpKJ !== null) {
      mainValue = `${inspection.tchpKJ.toFixed(1)}`;
      unitLabel = 'kJ/cm²';
      varName = 'TROPICAL CYCLONE HEAT POTENTIAL (TCHP)';
    } else if (inspection.customValue) {
      mainValue = inspection.customValue;
      unitLabel = inspection.customUnit || '';
      varName = inspection.customLabel || 'PARAMETER';
    }
  }

  return (
    <div className="fixed left-6 lg:left-80 bottom-24 z-20 font-mono text-xs select-none pointer-events-auto transition-all duration-300">
      <div className="bg-[#080c14]/90 backdrop-blur-xl border border-white/15 rounded-2xl p-4 shadow-2xl w-72 sm:w-80 text-slate-100 font-sans space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 pb-2.5 font-mono gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className={`p-1 rounded-lg shrink-0 ${badgeStyle}`}>
              <Activity className="w-3.5 h-3.5" />
            </div>
            <div className="min-w-0">
              <div className="font-bold text-[10.5px] uppercase tracking-widest text-slate-200 truncate">
                {activeLayer.name}
              </div>
              <div className="text-[8.5px] text-slate-400 uppercase font-mono">SCIENTIFIC DATA INSPECTOR</div>
            </div>
          </div>

          <span className={`text-[8.5px] font-bold px-2 py-0.5 rounded-full border uppercase font-mono shrink-0 max-w-[140px] truncate ${badgeStyle}`}>
            {badgeText}
          </span>
        </div>

        {/* Content Body based on Selection State */}
        {!inspection ? (
          /* Unselected State */
          <div className="bg-white/5 border border-white/10 rounded-xl p-4 text-center space-y-2 font-mono text-slate-400">
            <MousePointerClick className="w-6 h-6 text-cyan-400 mx-auto animate-bounce" />
            <div className="text-[11px] font-bold text-slate-200 uppercase">INSPECTOR READY</div>
            <p className="text-[9.5px] text-slate-400 font-sans">
              Click an active map layer to inspect a location.
            </p>
          </div>
        ) : isCyclone ? (
          /* Cyclone Inspection Card */
          <div className="bg-cyan-950/30 border border-cyan-500/20 rounded-xl p-3 space-y-2 font-mono">
            <div className="flex justify-between items-center text-[9px] text-cyan-400 font-bold border-b border-cyan-500/20 pb-1">
              <span>CYCLONE OBSERVATION</span>
              <span>{inspection.cycloneName || 'AMPHAN'}</span>
            </div>

            <div className="grid grid-cols-2 gap-2 text-[9.5px] pt-1">
              <div>
                <div className="text-[8px] text-slate-400 uppercase">CATEGORY</div>
                <div className="text-rose-400 font-bold mt-0.5">{inspection.category || 'Super Cyclone'}</div>
              </div>
              <div className="text-right">
                <div className="text-[8px] text-slate-400 uppercase">MAX SUSTAINED WIND</div>
                <div className={`font-bold mt-0.5 ${inspection.maxWindKts === null || inspection.maxWindKts === undefined ? 'text-slate-500' : 'text-cyan-300'}`}>{inspection.maxWindKts === null || inspection.maxWindKts === undefined ? 'NOT OBSERVED' : `${inspection.maxWindKts} KTS`}</div>
              </div>
              <div>
                <div className="text-[8px] text-slate-400 uppercase">CENTRAL PRESSURE</div>
                <div className={`font-bold mt-0.5 ${inspection.centralPressureMb === null || inspection.centralPressureMb === undefined ? 'text-slate-500' : 'text-slate-200'}`}>{inspection.centralPressureMb === null || inspection.centralPressureMb === undefined ? 'NOT OBSERVED' : `${inspection.centralPressureMb} MB`}</div>
              </div>
              <div className="text-right">
                <div className="text-[8px] text-slate-400 uppercase">COASTAL DISTANCE</div>
                <div className={`font-bold mt-0.5 ${inspection.distanceToCoastKm === null || inspection.distanceToCoastKm === undefined ? 'text-slate-500' : 'text-amber-300'}`}>{inspection.distanceToCoastKm === null || inspection.distanceToCoastKm === undefined ? 'NOT OBSERVED' : `${inspection.distanceToCoastKm} KM`}</div>
              </div>
            </div>
          </div>
        ) : isTimestampUnavailable ? (
          /* HYCOM Timestamp Unavailable Warning Card */
          <div className="bg-purple-950/30 border border-purple-500/30 rounded-xl p-3 text-[10.5px] font-mono text-purple-200 space-y-2">
            <div className="flex items-center gap-1.5 font-bold text-purple-300">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>NO REAL HYCOM MODEL DATA FOR THIS HISTORICAL TIMESTAMP</span>
            </div>
            <div className="text-[9px] space-y-1 text-slate-300 font-sans border-t border-purple-500/20 pt-1.5">
              <div className="flex justify-between font-mono">
                <span className="text-slate-400">Requested:</span>
                <span className="text-purple-300 font-bold">{formatTime(inspection?.requestedTimestamp || inspection?.timestamp)}</span>
              </div>
              <div className="flex justify-between font-mono">
                <span className="text-slate-400">Available HYCOM:</span>
                <span className="text-cyan-300 font-bold">
                  {formatTime(inspection?.availableStart)} – {formatTime(inspection?.availableEnd)}
                </span>
              </div>
            </div>
          </div>
        ) : isNotIntegrated ? (
          /* Not Integrated Card */
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 text-[10.5px] font-mono text-amber-200 space-y-1">
            <div className="flex items-center gap-1.5 font-bold text-amber-400">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>DATASET NOT CURRENTLY INTEGRATED</span>
            </div>
            <p className="text-[9.5px] text-slate-300 font-sans pt-1">
              No live numerical dataset is currently integrated for {activeLayer.name} in this prototype version.
            </p>
          </div>
        ) : layerId === 'currents' ? (
          /* Ocean Currents Detailed Card (Requirement #5) */
          <div className="bg-white/5 border border-white/10 rounded-xl p-3 space-y-2 font-mono">
            <div className="text-[8.5px] text-slate-400 uppercase tracking-widest">OCEAN VELOCITY (UVEL / VVEL)</div>
            <div className="grid grid-cols-2 gap-2 text-[9.5px]">
              <div>
                <div className="text-[8px] text-slate-400 uppercase">CURRENT SPEED</div>
                <div className="text-2xl font-black text-cyan-300 tracking-tight">
                  {inspection.currentSpeedMS !== undefined && inspection.currentSpeedMS !== null ? inspection.currentSpeedMS.toFixed(2) : '—'} <span className="text-xs font-normal text-slate-400">m/s</span>
                </div>
              </div>
              <div className="text-right">
                <div className="text-[8px] text-slate-400 uppercase">DIRECTION</div>
                <div className="text-2xl font-black text-teal-300 tracking-tight">
                  {inspection.currentDirectionDeg !== undefined && inspection.currentDirectionDeg !== null ? inspection.currentDirectionDeg.toFixed(1) : '—'}°
                </div>
              </div>
              <div>
                <div className="text-[8px] text-slate-500 uppercase">U (EASTWARD)</div>
                <div className="text-slate-200 font-bold mt-0.5">{inspection.uvelMS !== undefined && inspection.uvelMS !== null ? inspection.uvelMS.toFixed(3) : '—'} m/s</div>
              </div>
              <div className="text-right">
                <div className="text-[8px] text-slate-500 uppercase">V (NORTHWARD)</div>
                <div className="text-slate-200 font-bold mt-0.5">{inspection.vvelMS !== undefined && inspection.vvelMS !== null ? inspection.vvelMS.toFixed(3) : '—'} m/s</div>
              </div>
            </div>
            <div className="text-[9px] text-slate-400 pt-1 flex items-center justify-between border-t border-white/10 mt-1">
              <span>VERTICAL LEVEL:</span>
              <span className="text-slate-200 font-bold">Surface · 0 m</span>
            </div>
          </div>
        ) : (
          /* Standard Active Numerical Reading Card */
          <div className="bg-white/5 border border-white/10 rounded-xl p-3 space-y-1 font-mono">
            <div className="text-[8.5px] text-slate-400 uppercase tracking-widest">{varName}</div>
            <div className="flex items-baseline gap-2 pt-0.5">
              <span className="text-3xl font-black font-display text-white tracking-tight">
                {mainValue}
              </span>
              <span className="text-xs font-bold text-cyan-300 font-mono">
                {unitLabel}
              </span>
            </div>
            <div className="text-[9px] text-slate-400 pt-1 flex items-center justify-between border-t border-white/10 mt-1">
              <span>VERTICAL LEVEL:</span>
              <span className="text-slate-200 font-bold">Surface · 0 m</span>
            </div>
          </div>
        )}

        {/* Geolocation & Coordinates */}
        {inspection && (
          <div className="grid grid-cols-2 gap-2 font-mono text-[9.5px] bg-[#05070a] border border-white/10 rounded-xl p-2.5">
            <div>
              <div className="text-[8px] text-slate-500 uppercase">INSPECTED LAT</div>
              <div className="text-slate-200 font-bold mt-0.5">{inspection.latitude.toFixed(2)}° N</div>
            </div>
            <div className="text-right">
              <div className="text-[8px] text-slate-500 uppercase">INSPECTED LON</div>
              <div className="text-slate-200 font-bold mt-0.5">{inspection.longitude.toFixed(2)}° E</div>
            </div>
          </div>
        )}

        {/* Provenance Box */}
        <div className="bg-[#05070a] border border-white/10 rounded-xl p-2.5 font-mono text-[9px] space-y-1">
          <div className="flex items-center justify-between text-slate-400">
            <span>SOURCE:</span>
            <span className="text-slate-200 font-bold truncate max-w-[180px]">
              {sourceLabel}
            </span>
          </div>

          <div className="flex items-center justify-between text-slate-400">
            <span>TIMESTAMP:</span>
            <span className="text-cyan-300 font-semibold truncate">
              {formatTime(inspection?.timestamp)}
            </span>
          </div>

          <div className="flex items-center justify-between text-slate-400 pt-0.5 border-t border-white/10">
            <span>DATA STATUS:</span>
            <span className={`font-bold ${
              isNotIntegrated ? 'text-amber-400' :
              isTimestampUnavailable ? 'text-purple-400' :
              isSimulated ? 'text-yellow-400' :
              isDerived ? 'text-cyan-400' :
              'text-emerald-400'
            }`}>
              {isTimestampUnavailable ? 'REAL DATASET — TIMESTAMP UNAVAILABLE' : (inspection?.dataStatus || activeLayer.status)}
            </span>
          </div>
        </div>

        {/* Dynamic Legends (Requirement #16) */}
        {!isNotIntegrated && !isCyclone && (
          <div className="pt-1 font-mono text-[8.5px] space-y-1 border-t border-white/10">
            <div className="flex justify-between text-slate-400 uppercase">
              <span>DYNAMIC LEGEND ({legendBounds?.unit || activeLayer.unit || 'UNITS'})</span>
              <span className="text-slate-300 font-bold">
                {isSimulated ? 'PARAMETRIC RANGE' : 'INCOIS REAL DATA BOUNDS'}
              </span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-gradient-to-r from-blue-600 via-teal-400 to-rose-500 opacity-80" />
            <div className="flex justify-between text-[8px] text-slate-400 font-mono">
              <span>MIN {legendBounds ? legendBounds.min.toFixed(1) : layerId === 'sst' ? '26.0' : layerId === 'salinity' ? '28.0' : '0.0'} {activeLayer.unit}</span>
              <span>MID {legendBounds ? legendBounds.mid.toFixed(1) : layerId === 'sst' ? '28.5' : layerId === 'salinity' ? '31.5' : '1.0'} {activeLayer.unit}</span>
              <span>MAX {legendBounds ? legendBounds.max.toFixed(1) : layerId === 'sst' ? '31.5' : layerId === 'salinity' ? '35.0' : '2.5'} {activeLayer.unit}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
