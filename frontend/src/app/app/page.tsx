'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { apiProvider, DepthSlicePayload } from '../../services/ApiProvider';
import { demoProvider } from '../../services/DemoProvider';
import {
  Cyclone,
  Hazard,
  GISLayer,
  KPIMetrics,
  AppMode,
  OceanMode,
  DataStatus,
  DataModeType,
  ArgoMatchupResponse,
  ArgoProfile,
  CycloneTrackPoint,
  AstronomicalData,
  RiskAssessment,
  type FlyToTarget,
} from '../../types/oceanlens';

import { Header } from '../../components/Header';
import { LayerControl } from '../../components/LayerControl';
import { DepthSliceControl, DepthSliceSelection } from '../../components/DepthSliceControl';
import { ArgoProfileRibbonControl } from '../../components/ArgoProfileRibbonControl';
import {
  buildArgoRibbonSceneData,
  RIBBON_DEFAULT_EXAGGERATION,
  type RibbonVariable,
} from '../../utils/argoProfileRibbon';
import { modelFileLabelDepth } from '../../utils/modelDepthLabel';
import { CLASSIC_PALETTE_ID } from '../../utils/scientificPalettes';
import { ToolRail, ActiveRightTool } from '../../components/ToolRail';
import { Timeline } from '../../components/Timeline';
import { CesiumGlobe } from '../../components/CesiumGlobe';
import { ArgoMatchupDrawer } from '../../components/ArgoMatchupDrawer';
import { DataInspector, InspectionData } from '../../components/DataInspector';

import {
  DEFAULT_DEPTH_SLICE_DISPLAY,
  DepthSliceDisplaySettings,
  resolveDepthSliceRender,
} from '../../utils/depthSliceViz';
import {
  buildModelTimeline,
  filterProfilesToWindow,
  latestModelTimestamp,
  modelTimeBadgeText,
} from '../../utils/modelTime';
import { CurrentFieldDataStatus, EnvironmentalFlowField } from '../../types/flow';
import { normalizeHycomCurrentField } from '../../services/FlowFieldProvider';

export default function Home() {
  const [mode, setMode] = useState<AppMode>('OPERATIONS');
  // Global Ocean Mode Single Source of Truth (Requirement #1).
  //
  // LIVE is the default because it is the only mode whose clock is the
  // dataset's own: the timeline spans the real HYCOM model times and no
  // cyclone is shown. HISTORICAL is opt-in.
  const [oceanMode, setOceanMode] = useState<OceanMode>('LIVE');
  const [dataStatus, setDataStatus] = useState<DataStatus>('SIMULATED');
  const [backendConnected, setBackendConnected] = useState(false);
  // Phase 3: explicit data mode state
  const [dataMode, setDataMode] = useState<DataModeType>('REAL');
  const [datasetSynthetic, setDatasetSynthetic] = useState(false);
  const [datasetLoaded, setDatasetLoaded] = useState(false);

  // Single unified active tool state for all right-side tools
  const [activeRightTool, setActiveRightTool] = useState<ActiveRightTool>('storm');

  const [cyclone, setCyclone] = useState<Cyclone | null>(null);
  const [layers, setLayers] = useState<GISLayer[]>([]);
  const [argoProfiles, setArgoProfiles] = useState<ArgoProfile[]>([]);
  const [selectedArgoProfile, setSelectedArgoProfile] = useState<ArgoProfile | null>(null);
  // --- Selected-float profile ribbon (3D scene) -----------------------------
  // Computed here, once, so the 3D scene and the control panel read exactly the
  // same levels, range and model markers; neither side re-derives anything.
  const [ribbonVariable, setRibbonVariable] = useState<RibbonVariable>('temperature_c');
  const [ribbonExaggeration, setRibbonExaggeration] = useState(RIBBON_DEFAULT_EXAGGERATION);
  const [ribbonResetToken, setRibbonResetToken] = useState(0);
  const [selectedMatchup, setSelectedMatchup] = useState<ArgoMatchupResponse | null>(null);
  // Authoritative heuristic score, fetched from GET /risk/{cycloneId}?index=N.
  // null until the first response arrives; never recomputed on the client.
  // The score is stored together with the request it answers, so a response
  // that arrives after the user has scrubbed to another track point is
  // recognised as stale rather than displayed as the current cyclone's score.
  const [riskState, setRiskState] = useState<{ key: string; value: RiskAssessment | null } | null>(null);

  // -1 = not positioned yet; effectiveTrackIndex resolves the per-mode default.
  const [currentTrackIndex, setCurrentTrackIndex] = useState<number>(-1);
  const [targetLocation, setTargetLocation] = useState<FlyToTarget | null>(null);

  // Inspection Data State & Dynamic Legend Bounds
  const [inspectedCoords, setInspectedCoords] = useState<{ lat: number; lon: number } | null>({ lat: 18.2247, lon: 88.4000 });
  const [inspectionData, setInspectionData] = useState<InspectionData | null>(null);
  const [legendBounds, setLegendBounds] = useState<{ min: number; mid: number; max: number; unit: string; layerName: string; timestamp?: string } | null>(null);
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
  // The depth-resolved HYCOM file is a DIFFERENT run from the surface file and
  // has its own window, so each layer is asked for a time its own dataset
  // really has — and each is labelled with the date it came from.
  const [datasetDepthTimestamps, setDatasetDepthTimestamps] = useState<string[]>([]);

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
      const ly = await provider.getLayers();
      const argos = await provider.getArgoProfiles();

      if (cyclones.length > 0) {
        setCyclone(cyclones[0]);
      }
      const cycloneLayer: GISLayer = {
        id: 'cyclone',
        name: 'Cyclone Track & Forecast',
        category: 'hazard',
        active: true,
        status: cyclones.length > 0 ? (cyclones[0].dataStatus || 'REAL') : 'NOT CURRENTLY INTEGRATED',
        description: 'NOAA IBTrACS best-track history and intensity markers',
      };
      const finalLayers = ly.some((l) => l.id === 'cyclone')
        ? ly
        : [...ly, cycloneLayer];

      setLayers(finalLayers);
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
        timelineSource: 'HYCOM model times (LIVE) / NOAA IBTrACS track timestamps (HISTORICAL REPLAY)',
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
        if (!cancelled && Array.isArray(data.available_depth_timestamps)) {
          setDatasetDepthTimestamps(data.available_depth_timestamps);
        }
      } catch {
        // Backend unreachable: picker stays empty; slice requests still work
        // (backend defaults to its latest available model time).
      }
    }
    if (backendConnected) loadTimestamps();
    return () => {
      cancelled = true;
    };
  }, [backendConnected]);

  // ============================================================
  // Timeline: one per mode, each on its own real clock.
  //
  // LIVE  -> the real HYCOM model times the backend reported. No cyclone is
  //          shown and no track point is invented: the model simply has a
  //          finite set of times, and those are them.
  // HISTORICAL REPLAY -> the NOAA IBTrACS best-track timestamps.
  // ============================================================
  const modelTimeline = useMemo(() => buildModelTimeline(datasetTimestamps), [datasetTimestamps]);

  const activeTrack: CycloneTrackPoint[] = useMemo(
    () => (oceanMode === 'LIVE' ? modelTimeline : (cyclone?.track ?? [])),
    [oceanMode, modelTimeline, cyclone?.track]
  );

  // -1 means "not positioned yet": each mode then opens on its own real
  // default — LIVE on the newest model time, HISTORICAL REPLAY on the storm's
  // peak fix. Deriving it (rather than setting it in an effect) means the
  // first model-layer request already carries the final timestamp instead of
  // firing once at a stale index and again at the real one.
  const effectiveTrackIndex =
    currentTrackIndex < 0
      ? oceanMode === 'LIVE'
        ? Math.max(0, modelTimeline.length - 1)
        : (cyclone?.currentTrackIndex ?? 0)
      : currentTrackIndex;

  const currentPoint =
    activeTrack[Math.min(effectiveTrackIndex, activeTrack.length - 1)] || activeTrack[0];

  const riskKey =
    oceanMode === 'LIVE' || !cyclone || !activeTrack.length
      ? null
      : `${cyclone.id}:${Math.min(effectiveTrackIndex, activeTrack.length - 1)}`;

  // Derived, not stored: when no risk request is in scope, or the answer on
  // hand belongs to a different track point, there is no current score to show.
  // This is also what stops the previous cyclone's score lingering on screen
  // while the next one is still being fetched.
  const riskAssessment = riskState?.key === riskKey && riskKey !== null ? riskState.value : null;

  // Single source of truth for the ocean-data timestamp. The legend effect and
  // the Cesium raster overlay MUST resolve to the same key or Phase 2B's
  // layer-data cache would key them separately and fetch the full grid twice.
  //
  // It is ALWAYS a model time the dataset really has:
  //   LIVE       -> the model time the marker sits on;
  //   HISTORICAL -> the newest model time available, because no model time
  //                 corresponds to a 2020-2025 replay point. That substitution
  //                 is not hidden: the model-time badge states the model date
  //                 and the replay date side by side.
  const modelDataTimestamp = useMemo<string | undefined>(() => {
    if (oceanMode === 'LIVE') return modelTimeline[effectiveTrackIndex]?.timestamp;
    return latestModelTimestamp(datasetTimestamps) ?? undefined;
  }, [oceanMode, modelTimeline, effectiveTrackIndex, datasetTimestamps]);

  // Time the depth-resolved instrument and the current field are requested at.
  // Same reasoning as modelDataTimestamp, applied to the depth run's calendar:
  // asking a depth dataset for a surface-file time is a guaranteed miss.
  const depthModelTimestamp = useMemo<string | undefined>(
    () => latestModelTimestamp(datasetDepthTimestamps) ?? undefined,
    [datasetDepthTimestamps]
  );

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
      // A request is outstanding when one is in scope and the answer on hand
      // is not its response. Deriving it keeps the flag from ever disagreeing
      // with the score's own identity.
      coastalRiskLoading: riskKey !== null && riskState?.key !== riskKey,
      coastalRiskUnavailableReason:
        riskKey !== null && riskState?.key !== riskKey
          ? null
          : riskAvailable
            ? null
            : riskAssessment?.unavailableReason ?? 'No risk assessment received from the backend.',
      coastalRiskWeights: riskAvailable ? riskAssessment!.weights : null,
      // The score was computed from the model's ocean state at ITS date, which
      // is not necessarily the storm's. Both travel with the number so the
      // chip can label the mismatch instead of implying a match.
      coastalRiskModelTimestamp: riskAvailable ? riskAssessment!.modelTimestamp ?? null : null,
      coastalRiskTimeMatched: riskAvailable ? riskAssessment!.timeMatched === true : null,
      dataConfidencePct: oceanMode === 'SCENARIO' ? 75 : 92,
      forecastConfidencePct: currentPoint.forecastConfidencePct || 92,
    };
  }, [
    cyclone,
    currentPoint,
    oceanMode,
    riskAssessment,
    avgSSTFromRisk,
    riskKey,
    riskState?.key,
  ]);

  // Memoized callbacks: stable references prevent cascading re-renders of the
  // memoized CesiumGlobe subtree on unrelated top-level state changes.
  const handleOceanModeChange = useCallback((newMode: OceanMode) => {
    setOceanMode(newMode);
    // Back to "not positioned": the incoming mode picks its own real default.
    setCurrentTrackIndex(-1);
    if (newMode === 'LIVE') {
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


  const handleSelectArgoProfile = useCallback((profile: ArgoProfile | null) => {
    setSelectedArgoProfile(profile);
    // A matchup belongs to exactly one float; carrying it across a selection
    // would put another float's model levels beside this one's ribbon.
    setSelectedMatchup(null);
  }, []);

  /** Ribbon scene data for the selected float: measured levels + model markers. */
  const argoRibbonData = useMemo(
    () =>
      selectedArgoProfile
        ? buildArgoRibbonSceneData(
            selectedArgoProfile.observations ?? null,
            ribbonVariable,
            selectedMatchup?.comparisons ?? null,
            selectedMatchup
              ? {
                  modelDepths: selectedMatchup.modelDepths,
                  storedFileDepths: selectedMatchup.storedFileDepths,
                }
              : null,
            (depthM) =>
              selectedMatchup
                ? modelFileLabelDepth(depthM, {
                    modelDepths: selectedMatchup.modelDepths,
                    storedFileDepths: selectedMatchup.storedFileDepths,
                  })
                : null
          )
        : null,
    [selectedArgoProfile, ribbonVariable, selectedMatchup]
  );

  // ============================================================
  // Argo in-situ profiles, filtered to the time on screen.
  //
  // A float that profiled on 3 October is real data, but it does not belong to
  // 8 October. In LIVE the marker sits on a model time, so only profiles
  // observed within ARGO_WINDOW_DAYS of it are drawn and the count is shown.
  // In HISTORICAL REPLAY the marker is a cyclone fix from years away from the
  // observations, so every profile stays visible and nothing claims a match.
  // ============================================================
  const visibleArgoProfiles = useMemo<ArgoProfile[]>(
    () =>
      oceanMode === 'LIVE'
        ? filterProfilesToWindow(argoProfiles, modelTimeline[effectiveTrackIndex]?.timestamp)
        : argoProfiles,
    [argoProfiles, oceanMode, modelTimeline, effectiveTrackIndex]
  );
  const argoProfileCount = visibleArgoProfiles.length;

  // LIVE OCEAN shows no cyclone. Dropping the cyclone layer here — rather than
  // only hiding the track entity — keeps it out of the layer panel and stops
  // it from becoming the inspector's active layer, which would put a cyclone
  // card on screen in a mode that has no cyclone.
  const visibleLayers = useMemo<GISLayer[]>(
    () => (oceanMode === 'LIVE' ? layers.filter((l) => l.id !== 'cyclone') : layers),
    [layers, oceanMode]
  );

  const activeLayer =
    visibleLayers.find((l) => l.active && ['sst', 'salinity', 'currents', 'tchp'].includes(l.id)) ||
    visibleLayers.find((l) => l.active) ||
    null;

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
  }, [cyclone, currentPoint, oceanMode, riskAssessment]);

  // Fetch the unvalidated heuristic score from the backend for the cyclone
  // point currently on screen. Aborted on rapid scrubbing so a slow response
  // cannot overwrite a newer one.
useEffect(() => {
    if (oceanMode === 'LIVE' || !cyclone || !activeTrack.length) return;
    const idx = Math.min(effectiveTrackIndex, activeTrack.length - 1);
    const key = `${cyclone.id}:${idx}`;
    const controller = new AbortController();
    let cancelled = false;
    apiProvider
      .getRiskAssessment(cyclone.id, idx, controller.signal)
      .then((r) => {
        if (!cancelled) setRiskState({ key, value: r });
      })
      .catch(() => {
        if (!cancelled) setRiskState({ key, value: null });
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [cyclone, effectiveTrackIndex, activeTrack, oceanMode]);

  // Fetch Dynamic Legend Bounds from API (Requirement #16)
  // Aborts in-flight layer queries on rapid layer/timeline toggling.
  useEffect(() => {
    const abortController = new AbortController();

    async function fetchLayerLegend() {
      if (!activeLayer || !['sst', 'salinity', 'currents', 'tchp'].includes(activeLayer.id)) {
        setLegendBounds(null);
        return;
      }
      // No model time means no dateable data. Requesting anyway would download
      // the whole grid for the backend's default time — a second full fetch
      // under a different cache key, for a layer whose legend would carry no
      // date.
      if (!modelDataTimestamp) {
        setLegendBounds(null);
        return;
      }
      try {
        // Phase 2B: this shares the ApiProvider layer-data cache/dedup with the
        // Cesium raster overlay, so the same layer + timestamp is fetched once
        // (no duplicate HTTP request and no second full-grid download).
        const data = await apiProvider.getLayerData(activeLayer.id, modelDataTimestamp, 3, abortController.signal);
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
              // The model time the grid REALLY holds. The backend resolves an
              // unmatched request to the nearest time it has, so this is the
              // only date the legend may be labelled with.
              timestamp: data.timestamp,
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
  }, [activeLayer?.id, modelDataTimestamp, activeLayer]);

  // HYCOM model depth slice fetch (Phase 1B). Aborts in-flight requests on
  // rapid depth/variable/timestamp changes; the latest selection wins.
  //
  // The request time is the user's explicit choice, or the depth run's newest
  // real time. It is never left to the server default: a slice that arrived
  // without a stated time could not be labelled with one.
  const depthRequestTimestamp = depthSliceSelection.timestamp ?? depthModelTimestamp;

  useEffect(() => {
    if (!depthSliceVisible) {
      void Promise.resolve().then(() => {
        setDepthSliceMetadata(null);
        setDepthSliceLoading(false);
        setDepthSliceUnavailable(null);
      });
      return;
    }

    if (!depthRequestTimestamp) {
      void Promise.resolve().then(() => {
        setDepthSliceMetadata(null);
        setDepthSliceLoading(false);
        setDepthSliceUnavailable(
          'The HYCOM depth-resolved run reports no available model times, so no depth slice can be requested or dated.'
        );
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
        depthRequestTimestamp,
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
  }, [depthSliceVisible, depthSliceSelection, depthRequestTimestamp]);

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
  // - following the depth-slice instrument: its depth + its explicit timestamp
  // - otherwise: surface (0 m) at the depth run's newest real time, because the
  //   UVEL/VVEL endpoint is served from the depth-resolved file, whose window
  //   is not the surface file's.
  const currentFlowDepthM = currentFlowFollowsSlice ? depthSliceSelection.depthM : 0;
  //
  // The old version compared a timeline timestamp against the dataset bounds by
  // STRING and answered with ``datasetTimestamps[0]`` on any mismatch - a
  // silent clamp that could put a different day's field on screen under the
  // replay date. The request time is now always a real time the serving
  // dataset has, so there is nothing left to clamp.
  const currentFlowTimestamp = useMemo(
    () =>
      currentFlowFollowsSlice
        ? (depthSliceSelection.timestamp ?? depthModelTimestamp)
        : depthModelTimestamp,
    [
      currentFlowFollowsSlice,
      depthSliceSelection.timestamp,
      depthModelTimestamp,
    ]
  );

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

    // UVEL/VVEL is served from the depth-resolved file. Until that file's own
    // time range is known there is no dateable request to make, and asking
    // without one would silently take the server's default instead.
    if (!currentFlowTimestamp) {
      void Promise.resolve().then(() => {
        setCurrentField(null);
        setCurrentFieldMetadata(null);
        setCurrentFieldStatus('UNAVAILABLE');
        setCurrentFieldStatusReason('The HYCOM depth-resolved run time range is not known yet.');
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

  // Turning the depth instrument on without naming a time would make the picker
  // display one time while the request (and the returned data) used another.
  // The default is therefore written into the selection, so the control and the
  // data always agree.
  const handleToggleDepthSliceVisible = useCallback(() => {
    if (!depthSliceVisible && depthModelTimestamp) {
      setDepthSliceSelection((selection) =>
        selection.timestamp ? selection : { ...selection, timestamp: depthModelTimestamp }
      );
    }
    setDepthSliceVisible(!depthSliceVisible);
  }, [depthSliceVisible, depthModelTimestamp]);

  // Map Click Inspector Dispatcher (Requirement #5, #7, #8)
  // Aborts in-flight inspection queries when the user clicks another point
  // or moves the timeline, so only the latest response reaches the UI.
  useEffect(() => {
    const abortController = new AbortController();
    const { signal } = abortController;

    async function inspectMapPoint() {
      if (!inspectedCoords) return;
      const layerId = activeLayer?.id || 'cyclone';
      const isModelLayer = ['sst', 'salinity', 'currents', 'tchp'].includes(layerId);
      // A model layer is inspected at the model time it is drawn at; a cyclone
      // is inspected at the replay fix. Mixing the two is what produced an
      // ocean reading stamped with a cyclone date.
      const ts = isModelLayer ? modelDataTimestamp : currentPoint?.timestamp;

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
        } else if (currentPoint?.latitude !== undefined) {
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
            dataStatus: 'REAL',
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
  }, [
    inspectedCoords,
    effectiveTrackIndex,
    activeLayer?.id,
    backendConnected,
    modelDataTimestamp,
    cyclone?.id,
    cyclone?.name,
    oceanMode,
    activeLayer,
    hazard,
    currentPoint?.timestamp,
    currentPoint?.latitude,
    currentPoint?.longitude,
    currentPoint?.maxWindKts,
    currentPoint?.centralPressureMb,
    currentPoint?.category,
    currentPoint?.distanceToCoastKm,
  ]);

  // ============================================================
  // Model-time badge (HISTORICAL REPLAY only)
  //
  // Built from the timestamps the payloads actually reported, never from the
  // requested time: the backend may have resolved the request to a different
  // day, and that is the day the pixels belong to.
  // ============================================================
  const modelDatesOnScreen = useMemo<string[]>(() => {
    const dates: string[] = [];
    if (depthSliceVisible && depthSliceMetadata?.timestamp) dates.push(depthSliceMetadata.timestamp);
    if (currentFieldMetadata?.timestamp) dates.push(currentFieldMetadata.timestamp);
    if (legendBounds?.timestamp) dates.push(legendBounds.timestamp);
    return dates;
  }, [depthSliceVisible, depthSliceMetadata, currentFieldMetadata, legendBounds]);

  const modelTimeBadge =
    oceanMode === 'LIVE' ? null : modelTimeBadgeText(modelDatesOnScreen, currentPoint?.timestamp);

  // Both published windows. They belong to two different HYCOM runs and
  // routinely differ, so neither is allowed to stand in for the other.
  const modelDateRange = useMemo(() => {
    if (datasetTimestamps.length === 0) return null;
    return {
      start: datasetTimestamps[0],
      end: datasetTimestamps[datasetTimestamps.length - 1],
      steps: datasetTimestamps.length,
    };
  }, [datasetTimestamps]);

  const modelDepthDateRange = useMemo(() => {
    if (datasetDepthTimestamps.length === 0) return null;
    return {
      start: datasetDepthTimestamps[0],
      end: datasetDepthTimestamps[datasetDepthTimestamps.length - 1],
      steps: datasetDepthTimestamps.length,
    };
  }, [datasetDepthTimestamps]);

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
        modelDateRange={modelDateRange}
        modelDepthDateRange={modelDepthDateRange}
        argoProfileCount={argoProfileCount}
      />

      {/* 2. Main 3D Cesium Earth Viewport */}
      <main className="flex-1 relative w-full h-full bg-[#05070a]">
        {/* Model-time badge: the model layers on screen are real data from a
            real date, and in HISTORICAL REPLAY that date is not the replay
            date. This states both, so no value is ever read as contemporaneous
            with the storm. LIVE needs no badge — there the model date IS the
            timeline date. */}
        {modelTimeBadge && (
          <div
            role="status"
            data-testid="model-time-badge"
            className="absolute top-[152px] left-1/2 -translate-x-1/2 z-30 max-w-[90vw] px-3 py-1.5 rounded-xl bg-amber-950/85 backdrop-blur-xl border border-amber-400/50 text-amber-200 font-mono text-[10px] font-bold tracking-wider shadow-2xl truncate"
            title="These model layers are real HYCOM data, but from the model date shown — not from the cyclone replay date."
          >
            {modelTimeBadge}
          </div>
        )}
        <CesiumGlobe
          cyclone={oceanMode === 'LIVE' ? null : cyclone}
          currentTrackIndex={effectiveTrackIndex}
          layers={visibleLayers}
          argoProfiles={visibleArgoProfiles}
          selectedArgoProfile={selectedArgoProfile}
          depthSliceVisible={depthSliceVisible}
          depthSlicePayload={depthSliceMetadata}
          depthSliceRender={depthSliceRender}
          depthSliceOpacity={depthSliceDisplay.opacity}
          currentField={currentField}
          currentFieldStatus={currentFieldStatus}
          currentFieldStatusReason={currentFieldStatusReason}
          currentFieldMetadata={currentFieldMetadata}
          argoRibbon={argoRibbonData}
          argoRibbonMatchup={selectedMatchup}
          ribbonVariable={ribbonVariable}
          ribbonPalette={CLASSIC_PALETTE_ID}
          ribbonExaggeration={ribbonExaggeration}
          ribbonResetToken={ribbonResetToken}
          onSelectArgoProfile={handleSelectArgoProfile}
          onInspectPoint={handleInspectPoint}
          onAstronomicalUpdate={setAstroData}
          targetLocation={targetLocation}
          timestamp={modelDataTimestamp}
        />

        {/* Vertical Rotated Margin Caption */}
        <div className="absolute left-6 top-1/2 -translate-y-1/2 z-10 hidden xl:block text-[9px] font-mono tracking-widest text-slate-500 uppercase writing-mode-vertical pointer-events-none opacity-40">
          BAY OF BENGAL HAZARD INTELLIGENCE PLATFORM
        </div>

        {/* 3. Left GIS Layer Instrument (Internal Scrollbar, Safe Height) */}
        <LayerControl
          layers={visibleLayers}
          onToggleLayer={handleToggleLayer}
          cyclone={oceanMode === 'LIVE' ? null : cyclone}
        />

        {/* HYCOM Model Depth Slice instrument (Phase 1B/1C) */}
        <DepthSliceControl
          visible={depthSliceVisible}
          onToggleVisible={handleToggleDepthSliceVisible}
          selection={depthSliceSelection}
          onChange={handleDepthSliceSelectionChange}
          display={depthSliceDisplay}
          onDisplayChange={handleDepthSliceDisplayChange}
          onResetDisplay={handleResetDepthSliceDisplay}
          render={depthSliceRender}
          loading={depthSliceLoading}
          unavailable={depthSliceUnavailable}
          metadata={depthSliceMetadata}
          datasetTimestamps={datasetDepthTimestamps}
          defaultTimestamp={depthModelTimestamp}
          availableDepthsM={depthSliceMetadata?.available_depths_m ?? null}
        />

        <ArgoProfileRibbonControl
          visible={Boolean(selectedArgoProfile)}
          floatId={selectedArgoProfile?.float_id ?? null}
          data={argoRibbonData}
          variable={ribbonVariable}
          paletteId={CLASSIC_PALETTE_ID}
          exaggeration={ribbonExaggeration}
          onVariableChange={setRibbonVariable}
          onExaggerationChange={setRibbonExaggeration}
          onResetView={() => setRibbonResetToken((token) => token + 1)}
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
          isDemo={!backendConnected}
          onClose={() => handleSelectArgoProfile(null)}
          onMatchupLoaded={setSelectedMatchup}
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
          currentIndex={effectiveTrackIndex}
          onIndexChange={setCurrentTrackIndex}
          oceanMode={oceanMode}
          isHistorical={oceanMode === 'HISTORICAL'}
          footerNote={
            oceanMode === 'LIVE'
              ? `${argoProfileCount} ARGO PROFILES ±5 d OF MODEL TIME`
              : `${argoProfileCount} ARGO PROFILES (ALL DATES)`
          }
        />
      </main>

    </div>
  );
}
