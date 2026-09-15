'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { apiProvider, DepthSlicePayload } from '../services/ApiProvider';
import { demoProvider } from '../services/DemoProvider';
import {
  Cyclone,
  Hazard,
  Station,
  GISLayer,
  KPIMetrics,
  AppMode,
  OceanMode,
  DataStatus,
  ArgoProfile,
  CycloneTrackPoint,
  AstronomicalData,
} from '../types/oceanlens';

import { Header } from '../components/Header';
import { LayerControl } from '../components/LayerControl';
import { DepthSliceControl, DepthSliceSelection } from '../components/DepthSliceControl';
import { ToolRail, ActiveRightTool } from '../components/ToolRail';
import { Timeline } from '../components/Timeline';
import { IntelligencePanel } from '../components/IntelligencePanel';
import { StationModal } from '../components/StationModal';
import { CesiumGlobe } from '../components/CesiumGlobe';
import { ArgoMatchupDrawer } from '../components/ArgoMatchupDrawer';
import { DataInspector, InspectionData } from '../components/DataInspector';

import { calculateRiskForPoint } from '../utils/risk';

const LIVE_HYCOM_TIMESTEPS: CycloneTrackPoint[] = [
  { id: 'hycom-ts-0', timestamp: '2026-09-07T06:00:00', latitude: 18.2, longitude: 88.4, maxWindKts: 0, centralPressureMb: 1012, category: 'Depression', status: 'OBSERVATION', distanceToCoastKm: 300, stormSpeedKts: 0, stormDirDeg: 0 },
  { id: 'hycom-ts-1', timestamp: '2026-09-08T12:00:00', latitude: 18.2, longitude: 88.4, maxWindKts: 0, centralPressureMb: 1012, category: 'Depression', status: 'OBSERVATION', distanceToCoastKm: 300, stormSpeedKts: 0, stormDirDeg: 0 },
  { id: 'hycom-ts-2', timestamp: '2026-09-09T18:00:00', latitude: 18.2, longitude: 88.4, maxWindKts: 0, centralPressureMb: 1012, category: 'Depression', status: 'OBSERVATION', distanceToCoastKm: 300, stormSpeedKts: 0, stormDirDeg: 0 },
  { id: 'hycom-ts-3', timestamp: '2026-09-11T00:00:00', latitude: 18.2, longitude: 88.4, maxWindKts: 0, centralPressureMb: 1012, category: 'Depression', status: 'OBSERVATION', distanceToCoastKm: 300, stormSpeedKts: 0, stormDirDeg: 0 },
  { id: 'hycom-ts-4', timestamp: '2026-09-12T06:00:00', latitude: 18.2, longitude: 88.4, maxWindKts: 0, centralPressureMb: 1012, category: 'Depression', status: 'OBSERVATION', distanceToCoastKm: 300, stormSpeedKts: 0, stormDirDeg: 0 },
  { id: 'hycom-ts-5', timestamp: '2026-09-14T00:00:00', latitude: 18.2, longitude: 88.4, maxWindKts: 0, centralPressureMb: 1012, category: 'Depression', status: 'OBSERVATION', distanceToCoastKm: 300, stormSpeedKts: 0, stormDirDeg: 0 },
];

export default function Home() {
  const [mode, setMode] = useState<AppMode>('OPERATIONS');
  // Global Ocean Mode Single Source of Truth (Requirement #1)
  const [oceanMode, setOceanMode] = useState<OceanMode>('HISTORICAL');
  const [dataStatus, setDataStatus] = useState<DataStatus>('SIMULATED');
  const [backendConnected, setBackendConnected] = useState(false);

  // Single unified active tool state for all right-side tools
  const [activeRightTool, setActiveRightTool] = useState<ActiveRightTool>('storm');

  const [cyclone, setCyclone] = useState<Cyclone | null>(null);
  const [hazard, setHazard] = useState<Hazard | null>(null);
  const [stations, setStations] = useState<Station[]>([]);
  const [layers, setLayers] = useState<GISLayer[]>([]);
  const [argoProfiles, setArgoProfiles] = useState<ArgoProfile[]>([]);
  const [selectedArgoProfile, setSelectedArgoProfile] = useState<ArgoProfile | null>(null);
  const [metrics, setMetrics] = useState<KPIMetrics | null>(null);

  const [currentTrackIndex, setCurrentTrackIndex] = useState<number>(5);
  const [selectedStation, setSelectedStation] = useState<Station | null>(null);
  const [targetLocation, setTargetLocation] = useState<{ lat: number; lon: number; height?: number } | null>(null);

  // Inspection Data State & Dynamic Legend Bounds
  const [inspectedCoords, setInspectedCoords] = useState<{ lat: number; lon: number } | null>({ lat: 18.2247, lon: 88.4000 });
  const [inspectionData, setInspectionData] = useState<InspectionData | null>(null);
  const [legendBounds, setLegendBounds] = useState<{ min: number; mid: number; max: number; unit: string; layerName: string } | null>(null);
  const [astroData, setAstroData] = useState<AstronomicalData | null>(null);

  // HYCOM model depth slice (Phase 1B) — separate from surface layers
  const [depthSliceVisible, setDepthSliceVisible] = useState(false);
  const [depthSliceSelection, setDepthSliceSelection] = useState<DepthSliceSelection>({
    variable: 'temperature',
    depthM: 50,
  });
  const [depthSliceMetadata, setDepthSliceMetadata] = useState<DepthSlicePayload | null>(null);
  const [depthSliceLoading, setDepthSliceLoading] = useState(false);
  const [depthSliceUnavailable, setDepthSliceUnavailable] = useState<string | null>(null);
  const [datasetTimestamps, setDatasetTimestamps] = useState<string[]>([]);

  // Initial Load from DataProvider
  useEffect(() => {
    async function loadData() {
      console.log('[OceanLens App] Initializing data loading from ApiProvider...');
      const status = await apiProvider.getDataStatus();
      const provider = status.backendConnected ? apiProvider : demoProvider;

      if (status.backendConnected) {
        console.log('%c[OceanLens App] CONNECTED TO REAL API BACKEND', 'color: #10b981; font-weight: bold;');
      } else {
        console.warn('[OceanLens App] BACKEND UNREACHABLE — USING DEMO FALLBACK');
      }

      const cyclones = await provider.getCyclones();
      const st = await provider.getStations();
      const ly = await provider.getLayers();
      const argos = await provider.getArgoProfiles();

      if (cyclones.length > 0) {
        setCyclone(cyclones[0]);
        setCurrentTrackIndex(cyclones[0].currentTrackIndex);
      }
      setStations(st);
      setLayers(ly);
      setArgoProfiles(argos);
      setDataStatus(status.mode);
      setBackendConnected(status.backendConnected);

      console.log('%c[OCEANLENS DATA]', 'color: #06b6d4; font-weight: bold;', {
        provider: status.backendConnected ? 'API / REAL BACKEND' : 'DEMO FALLBACK',
        apiBase: process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000/api',
        cycloneSource: cyclones[0]?.sourceAttribution || 'Demo Track',
        currentSource: status.backendConnected ? 'INCOIS HYCOM — REAL VECTOR FIELD' : 'Simulated Vector Field',
        timelineSource: 'NOAA IBTrACS Track Timestamp',
        riskSource: status.backendConnected ? 'Backend Risk Engine (0-39 LOW, 40-64 ELEVATED, 65-84 HIGH, 85-100 CRITICAL)' : 'Demo Risk Rules'
      });
    }

    loadData();
  }, []);

  // Dataset time steps for the depth-slice picker (same source as /observations)
  useEffect(() => {
    let cancelled = false;
    async function loadTimestamps() {
      try {
        const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000/api'}/observations`);
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && Array.isArray(data.available_timestamps)) {
          setDatasetTimestamps(data.available_timestamps);
        }
      } catch {
        // Backend unreachable: picker stays empty; slice requests still work
        // (backend defaults to the first available model time).
      }
    }
    if (backendConnected) loadTimestamps();
    return () => {
      cancelled = true;
    };
  }, [backendConnected]);

  // Mode-dependent track and point resolution (Requirement #1 & #11)
  const activeTrack: CycloneTrackPoint[] = oceanMode === 'LIVE'
    ? LIVE_HYCOM_TIMESTEPS
    : (cyclone?.track || LIVE_HYCOM_TIMESTEPS);

  const currentPoint = activeTrack[Math.min(currentTrackIndex, activeTrack.length - 1)] || activeTrack[0];

  // Auto-select initial active layer & location on LIVE ocean start (Requirement #6)
  useEffect(() => {
    if (oceanMode === 'LIVE') {
      setInspectedCoords({ lat: 18.2247, lon: 88.4000 });
      setLayers((prev) =>
        prev.map((l) => {
          if (l.id === 'sst') return { ...l, active: true };
          if (['salinity', 'currents', 'tchp'].includes(l.id)) return { ...l, active: false };
          return l;
        })
      );
    }
  }, [oceanMode]);

  // Memoized callbacks: stable references prevent cascading re-renders of the
  // memoized CesiumGlobe subtree on unrelated top-level state changes.
  const handleOceanModeChange = useCallback((newMode: OceanMode) => {
    setOceanMode(newMode);
    setCurrentTrackIndex(0);
    if (newMode === 'LIVE') {
      setInspectedCoords({ lat: 18.2247, lon: 88.4000 });
    } else {
      setInspectedCoords(null);
      setInspectionData(null);
    }
  }, []);

  const handleToggleLayer = useCallback((layerId: string) => {
    setLayers((prev) => {
      const isScientific = ['sst', 'salinity', 'currents', 'tchp'].includes(layerId);
      const currentlyActive = prev.find((l) => l.id === layerId)?.active ?? false;
      const targetState = !currentlyActive;

      return prev.map((l) => {
        if (l.id === layerId) {
          return { ...l, active: targetState };
        }
        // If enabling a scientific ocean layer, deactivate other scientific ocean layers
        if (targetState && isScientific && ['sst', 'salinity', 'currents', 'tchp'].includes(l.id)) {
          return { ...l, active: false };
        }
        return l;
      });
    });
  }, []);

  const handleInspectPoint = useCallback((lat: number, lon: number) => {
    setInspectedCoords({ lat, lon });
  }, []);

  const handleSelectStation = useCallback((station: Station | null) => {
    setSelectedStation(station);
  }, []);

  const handleSelectArgoProfile = useCallback((profile: ArgoProfile | null) => {
    setSelectedArgoProfile(profile);
  }, []);

  const activeLayer = layers.find((l) => l.active) || null;

  // Metrics calculation
  useEffect(() => {
    if (oceanMode === 'LIVE') {
      setMetrics({
        activeCyclones: 0,
        maxWindKts: 22,
        maxWaveHeightM: 2.1,
        avgSSTC: 30.2,
        coastalRiskLevel: 'LOW',
        dataConfidencePct: 98,
        forecastConfidencePct: 95,
      });
      return;
    }

    if (!cyclone || !currentPoint) return;

    const riskAssessment = calculateRiskForPoint(cyclone.name, currentPoint);

    setHazard({
      id: `hazard-${cyclone.id}`,
      title: `Cyclonic Warning: ${cyclone.name}`,
      type: 'cyclone',
      severity: riskAssessment.category,
      location: cyclone.basin,
      dataStatus: oceanMode === 'SCENARIO' ? 'SIMULATED' : cyclone.dataStatus,
      riskAssessment: riskAssessment,
    });

    setMetrics({
      activeCyclones: oceanMode === 'HISTORICAL' ? 0 : 1,
      maxWindKts: currentPoint.maxWindKts,
      maxWaveHeightM: Number((currentPoint.maxWindKts * 0.075 + 2.1).toFixed(1)),
      avgSSTC: 30.5,
      coastalRiskLevel: riskAssessment.category,
      dataConfidencePct: oceanMode === 'SCENARIO' ? 75 : 92,
      forecastConfidencePct: currentPoint.forecastConfidencePct || 92,
    });
  }, [cyclone, currentTrackIndex, currentPoint, oceanMode]);

  // Fetch Dynamic Legend Bounds from API (Requirement #16)
  // Aborts in-flight layer queries on rapid layer/timeline toggling.
  useEffect(() => {
    const abortController = new AbortController();

    async function fetchLayerLegend() {
      if (!activeLayer || !['sst', 'salinity', 'currents', 'tchp'].includes(activeLayer.id)) {
        setLegendBounds(null);
        return;
      }
      try {
        const data = await apiProvider.getLayerData(activeLayer.id, currentPoint?.timestamp, 3, abortController.signal);
        if (abortController.signal.aborted) return;
        if (data && data.grid && (data.grid.values || data.grid.u)) {
          let vals: number[] = [];
          if (data.grid.values) {
            vals = data.grid.values
              .flat()
              .filter((v): v is number => v !== null && v !== undefined && !isNaN(v) && v !== 0);
          } else if (data.grid.u && data.grid.v) {
            const uFlat = data.grid.u.flat();
            const vFlat = data.grid.v.flat();
            for (let i = 0; i < uFlat.length; i++) {
              const u = uFlat[i], v = vFlat[i];
              if (u !== null && v !== null && !isNaN(u) && !isNaN(v)) {
                vals.push(Math.sqrt(u * u + v * v));
              }
            }
          }
          if (vals.length > 0) {
            const min = Math.min(...vals);
            const max = Math.max(...vals);
            const mid = (min + max) / 2;
            setLegendBounds({
              min,
              mid,
              max,
              unit: data.units || activeLayer.unit || '',
              layerName: activeLayer.name,
            });
            return;
          }
        }
        if (!abortController.signal.aborted) setLegendBounds(null);
      } catch {
        // Aborted or failed: leave previous legend state intact
      }
    }

    fetchLayerLegend();

    return () => {
      abortController.abort();
    };
  }, [activeLayer?.id, currentPoint?.timestamp, activeLayer]);

  // HYCOM model depth slice fetch (Phase 1B). Aborts in-flight requests on
  // rapid depth/variable/timestamp changes; the latest selection wins.
  useEffect(() => {
    if (!depthSliceVisible) return;

    const abortController = new AbortController();
    const { signal } = abortController;
    let settled = false;

    const settle = (loading: boolean, unavailable: string | null) => {
      if (settled || signal.aborted) return;
      settled = true;
      setDepthSliceLoading(loading);
      setDepthSliceUnavailable(unavailable);
    };

    // Kick off async in a microtask so the effect body itself stays
    // side-effect free (no synchronous setState cascade).
    const started = Promise.resolve().then(() => {
      if (signal.aborted) return;
      setDepthSliceLoading(true);
      setDepthSliceUnavailable(null);
      return apiProvider.getDepthSlice(
        depthSliceSelection.variable,
        depthSliceSelection.depthM,
        depthSliceSelection.timestamp,
        3,
        signal
      );
    });

    started
      .then((payload) => {
        if (signal.aborted) return; // stale request: latest selection wins
        if (payload) {
          setDepthSliceMetadata(payload);
          settle(false, null);
        } else {
          // Backend unreachable, dataset missing (503) or invalid selection.
          // Never fall back to synthetic depth data.
          setDepthSliceMetadata(null);
          settle(false, 'Real INCOIS HYCOM depth data could not be loaded for this selection. The depth-resolved HYCOM dataset may not be installed on the server.');
        }
      })
      .catch(() => {
        if (signal.aborted) return; // aborts stay silent
        settle(false, 'Depth slice request failed.');
      });

    return () => {
      abortController.abort();
    };
  }, [depthSliceVisible, depthSliceSelection]);

  // Map Click Inspector Dispatcher (Requirement #5, #7, #8)
  // Aborts in-flight inspection queries when the user clicks another point
  // or moves the timeline, so only the latest response reaches the UI.
  useEffect(() => {
    const abortController = new AbortController();
    const { signal } = abortController;

    async function inspectMapPoint() {
      if (!inspectedCoords) return;
      const layerId = activeLayer?.id || 'cyclone';
      const ts = currentPoint?.timestamp;

      if (layerId === 'cyclone' && oceanMode !== 'LIVE') {
        const cRes = await apiProvider.inspectCyclone(inspectedCoords.lat, inspectedCoords.lon, ts, cyclone?.id, signal);
        if (signal.aborted) return;
        if (cRes) {
          setInspectionData({
            latitude: cRes.latitude ?? inspectedCoords.lat,
            longitude: cRes.longitude ?? inspectedCoords.lon,
            timestamp: cRes.timestamp || ts || '',
            cycloneName: cRes.cycloneName || cyclone?.name || 'AMPHAN',
            maxWindKts: cRes.maxWindKts ?? currentPoint?.maxWindKts,
            centralPressureMb: cRes.centralPressureMb ?? currentPoint?.centralPressureMb,
            category: cRes.category || currentPoint?.category,
            distanceToCoastKm: cRes.distanceToCoastKm ?? currentPoint?.distanceToCoastKm,
            observationType: oceanMode === 'SCENARIO' ? 'SIMULATED SCENARIO' : (cRes.observationType || 'HISTORICAL OBSERVATION'),
            dataStatus: oceanMode === 'SCENARIO' ? 'SIMULATED' : 'REAL',
            source: oceanMode === 'SCENARIO' ? 'Disaster Response Simulation Model' : 'NOAA IBTrACS v04r01',
          });
        } else if (currentPoint) {
          setInspectionData({
            latitude: currentPoint.latitude,
            longitude: currentPoint.longitude,
            timestamp: currentPoint.timestamp,
            cycloneName: cyclone?.name || 'AMPHAN',
            maxWindKts: currentPoint.maxWindKts,
            centralPressureMb: currentPoint.centralPressureMb,
            category: currentPoint.category,
            distanceToCoastKm: currentPoint.distanceToCoastKm,
            observationType: oceanMode === 'SCENARIO' ? 'SIMULATED SCENARIO' : 'HISTORICAL OBSERVATION',
            dataStatus: oceanMode === 'SCENARIO' ? 'SIMULATED' : 'REAL',
            source: oceanMode === 'SCENARIO' ? 'Disaster Response Simulation Model' : 'NOAA IBTrACS v04r01',
          });
        }
      } else if (['sst', 'salinity', 'currents', 'tchp'].includes(layerId)) {
        if (oceanMode === 'SCENARIO') {
          setInspectionData({
            latitude: inspectedCoords.lat,
            longitude: inspectedCoords.lon,
            timestamp: ts || new Date().toISOString(),
            tempC: 30.5,
            salnPSU: 32.8,
            currentSpeedMS: 0.85,
            currentDirectionDeg: 210,
            uvelMS: 0.42,
            vvelMS: -0.74,
            dataStatus: 'SIMULATED',
            source: 'Scenario Disaster Simulation Engine',
          });
          return;
        }

        const hRes = await apiProvider.inspectPoint(inspectedCoords.lat, inspectedCoords.lon, ts, signal);
        if (signal.aborted) return;
        if (hRes) {
          setInspectionData({
            latitude: hRes.latitude ?? inspectedCoords.lat,
            longitude: hRes.longitude ?? inspectedCoords.lon,
            timestamp: hRes.timestamp || ts || '',
            tempC: hRes.tempC ?? hRes.temp_c,
            salnPSU: hRes.salnPSU ?? hRes.saln_psu,
            uvelMS: hRes.uvelMS ?? hRes.uvel_ms,
            vvelMS: hRes.vvelMS ?? hRes.vvel_ms,
            currentSpeedMS: hRes.currentSpeedMS ?? hRes.current_speed_ms,
            currentDirectionDeg: hRes.currentDirectionDeg ?? hRes.current_direction_deg,
            sshM: hRes.sshM ?? hRes.ssh_m,
            tchpKJ: hRes.tchpKJ ?? hRes.tchp_kj_cm2,
            mldM: hRes.mldM ?? hRes.mld_m,
            depthM: hRes.depthM ?? hRes.depth_m ?? 0,
            status: hRes.status,
            dataStatus: hRes.dataStatus,
            message: hRes.message,
            requestedTimestamp: hRes.requestedTimestamp,
            availableStart: hRes.availableStart,
            availableEnd: hRes.availableEnd,
            source: hRes.source || 'INCOIS RSMC HYCOM',
          });
        }
      } else if (layerId === 'argo') {
        const aProfiles = await apiProvider.getArgoProfiles();
        if (signal.aborted) return;
        if (aProfiles && aProfiles.length > 0) {
          const p = aProfiles[0];
          setInspectionData({
            latitude: p.latitude,
            longitude: p.longitude,
            timestamp: p.observation_time,
            customLabel: 'IN-SITU OBSERVATION PROFILE',
            customValue: `FLOAT ${p.float_id}`,
            customUnit: `· ${p.observations_count} OBS LEVELS`,
            dataStatus: 'REAL SOURCE — INGESTION PENDING',
            source: `Official Argo GDAC (${p.institution})`,
          });
        }
      } else if (layerId === 'risk_zones') {
        setInspectionData({
          latitude: inspectedCoords.lat,
          longitude: inspectedCoords.lon,
          timestamp: ts || new Date().toISOString(),
          customLabel: 'COASTAL RISK EVALUATION',
          customValue: hazard?.severity || 'HIGH',
          customUnit: `· RISK SCORE ${hazard?.riskAssessment?.score || 78}/100`,
          dataStatus: oceanMode === 'SCENARIO' ? 'SIMULATED' : 'DERIVED ANALYTICS',
          source: 'OceanLens Hazard Risk Engine',
        });
      } else if (['wind', 'wave_height', 'stations', 'buoys'].includes(layerId)) {
        setInspectionData({
          latitude: inspectedCoords.lat,
          longitude: inspectedCoords.lon,
          timestamp: ts || new Date().toISOString(),
          dataStatus: 'SIMULATED',
          source: 'Simulated Analytical Model',
        });
      } else if (['storm_surge', 'chlorophyll', 'rainfall'].includes(layerId)) {
        setInspectionData({
          latitude: inspectedCoords.lat,
          longitude: inspectedCoords.lon,
          timestamp: ts || new Date().toISOString(),
          dataStatus: 'NOT CURRENTLY INTEGRATED',
          source: 'Data Stream Pending',
        });
      }
    }

    inspectMapPoint();

    return () => {
      abortController.abort();
    };
  }, [inspectedCoords, currentTrackIndex, activeLayer?.id, backendConnected, currentPoint?.timestamp, cyclone?.id, oceanMode, activeLayer, hazard]);

  return (
    <div className="w-screen h-screen overflow-hidden bg-[#05070a] flex flex-col relative font-sans text-slate-100 select-none">
      {/* 1. Top Header with Integrated OceanMode Switcher */}
      <Header
        mode={mode}
        onModeChange={setMode}
        oceanMode={oceanMode}
        onOceanModeChange={handleOceanModeChange}
        dataStatus={dataStatus}
        backendConnected={backendConnected}
        metrics={metrics}
        cyclone={oceanMode === 'LIVE' ? null : cyclone}
      />

      {/* 2. Main 3D Cesium Earth Viewport */}
      <main className="flex-1 relative w-full h-full bg-[#05070a]">
        <CesiumGlobe
          cyclone={oceanMode === 'LIVE' ? null : cyclone}
          currentTrackIndex={currentTrackIndex}
          stations={stations}
          layers={layers}
          argoProfiles={argoProfiles}
          depthSliceVisible={depthSliceVisible}
          depthSlicePayload={depthSliceMetadata}
          onSelectStation={handleSelectStation}
          onSelectArgoProfile={handleSelectArgoProfile}
          onInspectPoint={handleInspectPoint}
          onAstronomicalUpdate={setAstroData}
          targetLocation={targetLocation}
          timestamp={oceanMode === 'LIVE' ? new Date().toISOString() : currentPoint?.timestamp}
        />

        {/* Vertical Rotated Margin Caption */}
        <div className="absolute left-6 top-1/2 -translate-y-1/2 z-10 hidden xl:block text-[9px] font-mono tracking-widest text-slate-500 uppercase writing-mode-vertical pointer-events-none opacity-40">
          BAY OF BENGAL HAZARD INTELLIGENCE PLATFORM
        </div>

        {/* 3. Left GIS Layer Instrument (Internal Scrollbar, Safe Height) */}
        <LayerControl layers={layers} onToggleLayer={handleToggleLayer} />

        {/* HYCOM Model Depth Slice instrument (Phase 1B) */}
        <DepthSliceControl
          visible={depthSliceVisible}
          onToggleVisible={() => setDepthSliceVisible((v) => !v)}
          selection={depthSliceSelection}
          onChange={setDepthSliceSelection}
          loading={depthSliceLoading}
          unavailable={depthSliceUnavailable}
          metadata={depthSliceMetadata}
          datasetTimestamps={datasetTimestamps}
          availableDepthsM={depthSliceMetadata?.available_depths_m ?? null}
        />

        {/* 4. Right Map Tool Rail & Drawers */}
        <ToolRail
          activeTool={activeRightTool}
          onSelectTool={setActiveRightTool}
          cyclone={oceanMode === 'LIVE' ? null : cyclone}
          hazard={oceanMode === 'LIVE' ? null : hazard}
          currentPoint={currentPoint}
          astroData={astroData}
          onFlyTo={setTargetLocation}
        />

        {/* 5. Argo Model vs Observation Matchup Drawer */}
        <ArgoMatchupDrawer
          profile={selectedArgoProfile}
          onClose={() => handleSelectArgoProfile(null)}
        />

        {/* 6. Scientific Data Inspector Instrument (No Overlap) */}
        <DataInspector
          activeLayer={activeLayer}
          inspection={inspectionData}
          legendBounds={legendBounds}
          onClose={() => setInspectionData(null)}
        />

        {/* 7. Research Mode Technical Banner Overlay */}
        {mode === 'RESEARCH' && (
          <div className="absolute top-20 left-1/2 -translate-x-1/2 z-20 px-5 py-2 rounded-2xl bg-[#080c14]/90 backdrop-blur-xl border border-cyan-500/30 text-[11px] font-mono text-cyan-300 shadow-2xl flex items-center gap-3">
            <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
            <div className="flex items-center gap-4">
              <span>RESEARCH MODE ACTIVE</span>
              <span className="text-white/20">│</span>
              <span className="text-slate-300">MODE: {oceanMode}</span>
              <span className="text-white/20">│</span>
              <span className="text-emerald-400">DATA CONFIDENCE: {metrics?.dataConfidencePct || 92}%</span>
            </div>
          </div>
        )}

        {/* 8. Mode-Aware Bottom Time Axis Scrubber */}
        <Timeline
          track={activeTrack}
          currentIndex={currentTrackIndex}
          onIndexChange={setCurrentTrackIndex}
          oceanMode={oceanMode}
          isHistorical={oceanMode === 'HISTORICAL'}
        />
      </main>

      {/* 9. Station Inspection Modal */}
      <StationModal
        station={selectedStation}
        onClose={() => handleSelectStation(null)}
      />
    </div>
  );
}
