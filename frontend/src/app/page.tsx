'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
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
  DataModeType,
  ArgoProfile,
  CycloneTrackPoint,
  AstronomicalData,
  RiskAssessment,
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

import {
  DEFAULT_DEPTH_SLICE_DISPLAY,
  DepthSliceDisplaySettings,
  resolveDepthSliceRender,
} from '../utils/depthSliceViz';
import { CurrentFieldDataStatus, EnvironmentalFlowField } from '../types/flow';
import { normalizeHycomCurrentField } from '../services/FlowFieldProvider';

const DEMO_TRACK_TIMESTEPS: CycloneTrackPoint[] = [
  { id: 'demo-ts-0', timestamp: '2026-09-07T06:00:00', latitude: 18.2, longitude: 88.4, maxWindKts: 0, centralPressureMb: 1012, category: 'Depression', status: 'OBSERVATION', distanceToCoastKm: 300, stormSpeedKts: 0, stormDirDeg: 0 },
  { id: 'demo-ts-1', timestamp: '2026-09-08T12:00:00', latitude: 18.2, longitude: 88.4, maxWindKts: 0, centralPressureMb: 1012, category: 'Depression', status: 'OBSERVATION', distanceToCoastKm: 300, stormSpeedKts: 0, stormDirDeg: 0 },
  { id: 'demo-ts-2', timestamp: '2026-09-09T18:00:00', latitude: 18.2, longitude: 88.4, maxWindKts: 0, centralPressureMb: 1012, category: 'Depression', status: 'OBSERVATION', distanceToCoastKm: 300, stormSpeedKts: 0, stormDirDeg: 0 },
  { id: 'demo-ts-3', timestamp: '2026-09-11T00:00:00', latitude: 18.2, longitude: 88.4, maxWindKts: 0, centralPressureMb: 1012, category: 'Depression', status: 'OBSERVATION', distanceToCoastKm: 300, stormSpeedKts: 0, stormDirDeg: 0 },
  { id: 'demo-ts-4', timestamp: '2026-09-12T06:00:00', latitude: 18.2, longitude: 88.4, maxWindKts: 0, centralPressureMb: 1012, category: 'Depression', status: 'OBSERVATION', distanceToCoastKm: 300, stormSpeedKts: 0, stormDirDeg: 0 },
  { id: 'demo-ts-5', timestamp: '2026-09-14T00:00:00', latitude: 18.2, longitude: 88.4, maxWindKts: 0, centralPressureMb: 1012, category: 'Depression', status: 'OBSERVATION', distanceToCoastKm: 300, stormSpeedKts: 0, stormDirDeg: 0 },
];

export default function Home() {
  const [mode, setMode] = useState<AppMode>('OPERATIONS');
  // Global Ocean Mode Single Source of Truth (Requirement #1)
  const [oceanMode, setOceanMode] = useState<OceanMode>('HISTORICAL');
  const [dataStatus, setDataStatus] = useState<DataStatus>('SIMULATED');
  const [backendConnected, setBackendConnected] = useState(false);
  // Phase 3: explicit data mode state
  const [dataMode, setDataMode] = useState<DataModeType>('REAL');
  const [datasetSynthetic, setDatasetSynthetic] = useState(false);
  const [datasetLoaded, setDatasetLoaded] = useState(false);
  const [liveTimestamp, setLiveTimestamp] = useState(() => new Date().toISOString());

  // Single unified active tool state for all right-side tools
  const [activeRightTool, setActiveRightTool] = useState<ActiveRightTool>('storm');

  const [cyclone, setCyclone] = useState<Cyclone | null>(null);
  const [stations, setStations] = useState<Station[]>([]);
  const [layers, setLayers] = useState<GISLayer[]>([]);
  const [argoProfiles, setArgoProfiles] = useState<ArgoProfile[]>([]);
  const [selectedArgoProfile, setSelectedArgoProfile] = useState<ArgoProfile | null>(null);
  // Authoritative heuristic score, fetched from GET /risk/{cycloneId}?index=N.
  // null until the first response arrives; never recomputed on the client.
  const [riskAssessment, setRiskAssessment] = useState<RiskAssessment | null>(null);
  const [riskLoading, setRiskLoading] = useState(false);

  const [currentTrackIndex, setCurrentTrackIndex] = useState<number>(5);
  const [selectedStation, setSelectedStation] = useState<Station | null>(null);
  const [targetLocation, setTargetLocation] = useState<{ lat: number; lon: number; height?: number } | null>(null);

  // Inspection Data State & Dynamic Legend Bounds
  const [inspectedCoords, setInspectedCoords] = useState<{ lat: number; lon: number } | null>({ lat: 18.2247, lon: 88.4000 });
  const [inspectionData, setInspectionData] = useState<InspectionData | null>(null);
  const [legendBounds, setLegendBounds] = useState<{ min: number; mid: number; max: number; unit: string; layerName: string } | null>(null);
  const [astroData, setAstroData] = useState<AstronomicalData | null>(null);

  // HYCOM model depth slice (Phase 1B/1C) — separate from surface layers.
  // Single source of truth for the scientific visualization:
  // - depthSliceSelection: data coordinates (variable/depth/timestamp) —
  //   changes trigger a (abortable) backend fetch
  // - depthSliceDisplay: display-only settings (palette/range/scale/
  //   opacity) — changes NEVER refetch or modify scientific data
  const [depthSliceVisible, setDepthSliceVisible] = useState(false);
  const [depthSliceSelection, setDepthSliceSelection] = useState<DepthSliceSelection>({
    variable: 'temperature',
    depthM: 50,
  });
  const [depthSliceDisplay, setDepthSliceDisplay] = useState<DepthSliceDisplaySettings>({
    ...DEFAULT_DEPTH_SLICE_DISPLAY,
  });
  const [depthSliceMetadata, setDepthSliceMetadata] = useState<DepthSlicePayload | null>(null);
  const [depthSliceLoading, setDepthSliceLoading] = useState(false);
  const [depthSliceUnavailable, setDepthSliceUnavailable] = useState<string | null>(null);
  const [datasetTimestamps, setDatasetTimestamps] = useState<string[]>([]);

  // ============================================================
  // Real HYCOM current field (Phase 1E) — UVEL/VVEL particles.
  //
  // The current field reuses the scientific depth control: when the model
  // depth-slice instrument is active AND its variable is `currents`, the
  // flow particles follow that instrument's depth/timestamp selection.
  // Otherwise the field is surface (0 m) at the timeline timestamp.
  //
  // Status machine (drives the visible provenance):
  // - REAL: payload normalized into a valid field (real UVEL/VVEL vectors)
  // - SIMULATED: no real payload (backend down / unavailable / malformed) —
  //   the existing labelled synthetic fallback renders
  // - UNAVAILABLE: backend answered with a structurally valid payload that
  //   contains NO valid vectors (e.g. all cells missing at that depth/time)
  //
  // Rapid selection changes abort obsolete requests; the newest wins.
  // ============================================================
  const [currentField, setCurrentField] = useState<EnvironmentalFlowField | null>(null);
  const [currentFieldStatus, setCurrentFieldStatus] = useState<CurrentFieldDataStatus>('SIMULATED');
  const [currentFieldStatusReason, setCurrentFieldStatusReason] = useState<string | null>(null);
  const [currentFieldMetadata, setCurrentFieldMetadata] = useState<DepthSlicePayload | null>(null);

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
      // Phase 3: propagate data mode
      setDataMode(status.dataMode ?? 'REAL');
      setDatasetSynthetic(status.datasetSynthetic ?? false);
      setDatasetLoaded(status.datasetLoaded ?? false);

      console.log('%c[OCEANLENS DATA]', 'color: #06b6d4; font-weight: bold;', {
        provider: status.backendConnected ? 'API / REAL BACKEND' : 'DEMO FALLBACK',
        apiBase: process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000/api',
        cycloneSource: cyclones[0]?.sourceAttribution || 'Demo Track',
        currentSource: status.backendConnected ? 'INCOIS RSMC HYCOM (UVEL/VVEL, per-status in legend)' : 'Simulated Vector Field',
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
  const liveAuthoritative = backendConnected && dataStatus === 'REAL' && dataMode === 'REAL' && !datasetSynthetic && datasetLoaded;
  const activeTrack: CycloneTrackPoint[] = oceanMode === 'LIVE'
    ? (liveAuthoritative ? (cyclone?.track || []) : [])
    : (cyclone?.track || DEMO_TRACK_TIMESTEPS);

  const currentPoint = activeTrack[Math.min(currentTrackIndex, activeTrack.length - 1)] || activeTrack[0];

  // Single source of truth for the ocean-data timestamp. The legend effect and
  // the Cesium raster overlay MUST resolve to the same key or Phase 2B's
  // layer-data cache would key them separately and fetch the full grid twice.
  const effectiveTimestamp =
    oceanMode === 'LIVE' ? liveTimestamp : currentPoint?.timestamp;

  // The header SST chip shows the basin-mean SST the backend actually used for
  // the heuristic, rather than a client-invented constant.
  const avgSSTFromRisk = useMemo<number | null>(() => {
    if (riskAssessment?.status !== 'OK') return null;
    const item = riskAssessment.evidence.find((e) => e.variable.includes('Sea Surface Temp'));
    const v = item?.value;
    if (v === null || v === undefined) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }, [riskAssessment]);

  const metrics = useMemo<KPIMetrics | null>(() => {
    if (oceanMode === 'LIVE') return null;

    if (!cyclone || !currentPoint) return null;

    // The heuristic is scored by the BACKEND (/risk/{id}), which has the real
    // TCHP/SST. The client never recomputes it — doing so is what produced a
    // score from invented constants when model data was absent.
    const wind = currentPoint.maxWindKts;
    const riskAvailable = riskAssessment?.status === 'OK';

    return {
      activeCyclones: oceanMode === 'HISTORICAL' ? 0 : 1,
      maxWindKts: wind,
      maxWaveHeightM: wind === null ? null : Number((wind * 0.075 + 2.1).toFixed(1)),
      avgSSTC: avgSSTFromRisk,
      coastalRiskLevel: riskAvailable ? riskAssessment!.category : null,
      coastalRiskScore: riskAvailable ? riskAssessment!.heuristicDemoScore : null,
      coastalRiskUnavailableReason: riskAvailable
        ? null
        : riskAssessment?.unavailableReason ?? 'No risk assessment received from the backend.',
      coastalRiskWeights: riskAvailable ? riskAssessment!.weights : null,
      dataConfidencePct: oceanMode === 'SCENARIO' ? 75 : 92,
      forecastConfidencePct: currentPoint.forecastConfidencePct || 92,
    };
  }, [cyclone, currentPoint, oceanMode, liveAuthoritative, riskAssessment, avgSSTFromRisk]);

  // Memoized callbacks: stable references prevent cascading re-renders of the
  // memoized CesiumGlobe subtree on unrelated top-level state changes.
  const handleOceanModeChange = useCallback((newMode: OceanMode) => {
    setOceanMode(newMode);
    setCurrentTrackIndex(0);
    if (newMode === 'LIVE') {
      setLiveTimestamp(new Date().toISOString());
      setLayers((prev) =>
        prev.map((l) => {
          if (l.id === 'sst') return { ...l, active: true };
          if (['salinity', 'currents', 'tchp'].includes(l.id)) return { ...l, active: false };
          return l;
        })
      );
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

  const hazard = useMemo<Hazard | null>(() => {
    if (oceanMode === 'LIVE' || !cyclone || !currentPoint || !riskAssessment) return null;
    return {
      id: `hazard-${cyclone.id}`,
      title: `Cyclonic Warning: ${cyclone.name}`,
      type: 'cyclone',
      severity: riskAssessment.category,
      location: cyclone.basin,
      dataStatus: oceanMode === 'SCENARIO' ? 'SIMULATED' : cyclone.dataStatus,
      riskAssessment,
    };
  }, [cyclone, currentPoint, oceanMode]);

  // Fetch the unvalidated heuristic score from the backend for the cyclone
  // point currently on screen. Aborted on rapid scrubbing so a slow response
  // cannot overwrite a newer one.
  useEffect(() => {
    if (oceanMode === 'LIVE' || !cyclone || !activeTrack.length) {
      setRiskAssessment(null);
      return;
    }
    const idx = Math.min(currentTrackIndex, activeTrack.length - 1);
    const controller = new AbortController();
    let cancelled = false;
    setRiskLoading(true);
    apiProvider
      .getRiskAssessment(cyclone.id, idx, controller.signal)
      .then((r) => {
        if (!cancelled) setRiskAssessment(r);
      })
      .catch(() => {
        if (!cancelled) setRiskAssessment(null);
      })
      .finally(() => {
        if (!cancelled) setRiskLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [cyclone, currentTrackIndex, activeTrack, oceanMode]);

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
        // Phase 2B: this shares the ApiProvider layer-data cache/dedup with the
        // Cesium raster overlay, so the same layer + timestamp is fetched once
        // (no duplicate HTTP request and no second full-grid download).
        const data = await apiProvider.getLayerData(activeLayer.id, effectiveTimestamp, 3, abortController.signal);
        if (abortController.signal.aborted) return;
        if (data && data.grid && (data.grid.values || data.grid.u)) {
          // Single-pass bounds over the valid cells. Deliberately NOT
          // Math.min(...vals) / Math.max(...vals): spreading a full-stride grid
          // into an argument list overflows the engine argument limit on large
          // slices (RangeError) and allocates a second array.
          let min = Infinity;
          let max = -Infinity;
          if (data.grid.values) {
            for (const row of data.grid.values) {
              if (!row) continue;
              for (const v of row) {
                // Only masked (null/NaN) cells are excluded. A genuine 0 is a
                // real reading and must set the bounds — skipping it would
                // both hide real slack water / cool water and shift the scale.
                if (v === null || v === undefined || isNaN(v)) continue;
                if (v < min) min = v;
                if (v > max) max = v;
              }
            }
          } else if (data.grid.u && data.grid.v) {
            for (let i = 0; i < data.grid.u.length; i++) {
              const uRow = data.grid.u[i];
              const vRow = data.grid.v[i];
              if (!uRow || !vRow) continue;
              for (let j = 0; j < uRow.length; j++) {
                const u = uRow[j];
                const v = vRow[j];
                if (u === null || u === undefined || v === null || v === undefined) continue;
                if (isNaN(u) || isNaN(v)) continue;
                const speed = Math.sqrt(u * u + v * v);
                if (speed < min) min = speed;
                if (speed > max) max = speed;
              }
            }
          }
          if (isFinite(min) && isFinite(max)) {
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
  }, [activeLayer?.id, effectiveTimestamp, activeLayer]);

  // HYCOM model depth slice fetch (Phase 1B). Aborts in-flight requests on
  // rapid depth/variable/timestamp changes; the latest selection wins.
  useEffect(() => {
    if (!depthSliceVisible) {
      void Promise.resolve().then(() => {
        setDepthSliceMetadata(null);
        setDepthSliceLoading(false);
        setDepthSliceUnavailable(null);
      });
      return;
    }

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
      setDepthSliceMetadata(null);
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

  // ============================================================
  // Real current-field fetch (Phase 1E).
  //
  // Reuses the Phase 1A depth-slice endpoint (variable=currents) through
  // apiProvider.getRealCurrentFieldPayload. Requests are abortable and the
  // newest selection wins; the response is normalized (never relabelled)
  // into the particle renderer's field structure.
  // ============================================================
  const currentsLayerActive = layers.some((l) => l.id === 'currents' && l.active);
  const currentFlowFollowsSlice =
    depthSliceVisible && depthSliceSelection.variable === 'currents';

  // Data coordinates of the current field request:
  // - following the depth-slice instrument: its depth + timestamp
  // - otherwise: surface (0 m) at the timeline timestamp
  const currentFlowDepthM = currentFlowFollowsSlice ? depthSliceSelection.depthM : 0;
  const currentFlowTimestamp = currentFlowFollowsSlice
    ? depthSliceSelection.timestamp
    : effectiveTimestamp;

  useEffect(() => {
    if (!currentsLayerActive) {
      void Promise.resolve().then(() => {
        setCurrentField(null);
        setCurrentFieldMetadata(null);
        setCurrentFieldStatus('SIMULATED');
        setCurrentFieldStatusReason(null);
      });
      return;
    }

    const abortController = new AbortController();
    const { signal } = abortController;
    let settled = false;

    const settle = (status: CurrentFieldDataStatus, reason: string | null) => {
      if (settled || signal.aborted) return;
      settled = true;
      setCurrentFieldStatus(status);
      setCurrentFieldStatusReason(reason);
    };

    const started = Promise.resolve().then(() => {
      if (signal.aborted) return null;
      setCurrentField(null);
      setCurrentFieldMetadata(null);
      setCurrentFieldStatus('UNAVAILABLE');
      setCurrentFieldStatusReason('Loading real HYCOM UVEL/VVEL for this selection.');
      return apiProvider.getRealCurrentFieldPayload(
        currentFlowDepthM,
        currentFlowTimestamp,
        3,
        signal
      );
    });

    started
      .then((payload) => {
        if (signal.aborted) return; // stale request: latest selection wins

        if (payload) {
          const field = normalizeHycomCurrentField(payload);
          if (field) {
            // Real UVEL/VVEL vectors at the matched native model depth.
            setCurrentField(field);
            setCurrentFieldMetadata(payload);
            setCurrentFieldStatusReason(field.statusReason || null);
            settle('REAL', field.statusReason || null);
            return;
          }
          // Structurally valid payload with zero usable vectors: honest
          // unavailable — never synthetic vectors relabelled as real.
          setCurrentField(null);
          setCurrentFieldMetadata(payload);
          settle(
            'UNAVAILABLE',
            'HYCOM returned no valid UVEL/VVEL vectors for this depth/timestamp.'
          );
          return;
        }

        // No payload (backend unreachable / dataset absent / 503 / error):
        // the existing intentional SIMULATED fallback, visibly labelled.
        setCurrentField(null);
        setCurrentFieldMetadata(null);
        settle(
          'SIMULATED',
          'Real HYCOM UVEL/VVEL unavailable for this selection — analytical fallback field.'
        );
      })
      .catch(() => {
        if (signal.aborted) return;
        setCurrentField(null);
        setCurrentFieldMetadata(null);
        settle('SIMULATED', 'Current-field request failed — analytical fallback field.');
      });

    return () => {
      abortController.abort();
    };
  }, [currentsLayerActive, currentFlowDepthM, currentFlowTimestamp]);

  // ============================================================
  // Phase 1C scientific visualization resolution (pure, memoized)
  // ============================================================
  // The render configuration derives from the fetched payload + the
  // display settings. Memoized on exactly the render-relevant fields so
  // opacity-only changes reuse the same object (no raster/legend churn).
  // A requested log scale that cannot be honored (zero/negative data or
  // range) resolves to LINEAR here — the control surfaces the reason.
  const {
    paletteId: dsPaletteId,
    min: dsMin,
    max: dsMax,
    scale: dsScale,
  } = depthSliceDisplay;
  const depthSliceRender = useMemo(
    () => resolveDepthSliceRender(depthSliceMetadata, { paletteId: dsPaletteId, min: dsMin, max: dsMax, scale: dsScale }),
    [depthSliceMetadata, dsPaletteId, dsMin, dsMax, dsScale]
  );

  // Variable changes alter the scientific meaning of the display settings
  // (units, palette, range): reset them to that variable's defaults,
  // preserving only the pure-UI opacity preference. Handled at selection
  // time (not in an effect) so no cascading renders can occur. Deliberately
  // not memoized: it must read the current selection, and it is not a
  // CesiumGlobe prop so the memoized globe subtree is unaffected.
  const handleDepthSliceSelectionChange = (next: DepthSliceSelection) => {
    if (next.variable !== depthSliceSelection.variable) {
      setDepthSliceDisplay((d) => ({ ...DEFAULT_DEPTH_SLICE_DISPLAY, opacity: d.opacity }));
    }
    setDepthSliceSelection(next);
  };

  // Stable display-settings callbacks (prevent cascading re-renders of the
  // memoized Cesium subtree).
  const handleDepthSliceDisplayChange = useCallback((next: DepthSliceDisplaySettings) => {
    setDepthSliceDisplay(next);
  }, []);
  const handleResetDepthSliceDisplay = useCallback(() => {
    setDepthSliceDisplay({ ...DEFAULT_DEPTH_SLICE_DISPLAY });
  }, []);

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
          customLabel: 'COASTAL RISK (UNVALIDATED DEMO HEURISTIC)',
          // Never substitute a band or a score when the heuristic declined to
          // produce one — show the real state instead.
          customValue:
            hazard?.riskAssessment?.status === 'OK'
              ? hazard.riskAssessment.category ?? 'UNAVAILABLE'
              : 'UNAVAILABLE',
          customUnit:
            hazard?.riskAssessment?.status === 'OK' &&
            hazard.riskAssessment.heuristicDemoScore !== null &&
            hazard.riskAssessment.heuristicDemoScore !== undefined
              ? `· DEMO SCORE ${hazard.riskAssessment.heuristicDemoScore}/100 · NOT VALIDATED`
              : `· ${hazard?.riskAssessment?.unavailableReason ?? 'No score computed'}`,
          dataStatus: oceanMode === 'SCENARIO' ? 'SIMULATED' : 'DERIVED ANALYTICS',
          source: 'OceanLens Hazard Risk Engine (unvalidated demo heuristic — not for operational use)',
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
        dataMode={dataMode}
        datasetSynthetic={datasetSynthetic}
        datasetLoaded={datasetLoaded}
        liveKpiAuthoritative={false}
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
          depthSliceRender={depthSliceRender}
          depthSliceOpacity={depthSliceDisplay.opacity}
          currentField={currentField}
          currentFieldStatus={currentFieldStatus}
          currentFieldStatusReason={currentFieldStatusReason}
          currentFieldMetadata={currentFieldMetadata}
          onSelectStation={handleSelectStation}
          onSelectArgoProfile={handleSelectArgoProfile}
          onInspectPoint={handleInspectPoint}
          onAstronomicalUpdate={setAstroData}
          targetLocation={targetLocation}
          timestamp={effectiveTimestamp}
        />

        {/* Vertical Rotated Margin Caption */}
        <div className="absolute left-6 top-1/2 -translate-y-1/2 z-10 hidden xl:block text-[9px] font-mono tracking-widest text-slate-500 uppercase writing-mode-vertical pointer-events-none opacity-40">
          BAY OF BENGAL HAZARD INTELLIGENCE PLATFORM
        </div>

        {/* 3. Left GIS Layer Instrument (Internal Scrollbar, Safe Height) */}
        <LayerControl layers={layers} onToggleLayer={handleToggleLayer} />

        {/* HYCOM Model Depth Slice instrument (Phase 1B/1C) */}
        <DepthSliceControl
          visible={depthSliceVisible}
          onToggleVisible={() => setDepthSliceVisible((v) => !v)}
          selection={depthSliceSelection}
          onChange={handleDepthSliceSelectionChange}
          display={depthSliceDisplay}
          onDisplayChange={handleDepthSliceDisplayChange}
          onResetDisplay={handleResetDepthSliceDisplay}
          render={depthSliceRender}
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
              <span className="text-emerald-400">DATA CONFIDENCE: {metrics?.dataConfidencePct ?? 'N/A'}</span>
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
