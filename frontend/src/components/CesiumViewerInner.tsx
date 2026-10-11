'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { Cyclone, Station, GISLayer, ArgoProfile, AstronomicalData } from '../types/oceanlens';
import { CurrentFieldDataStatus, EnvironmentalFlowField } from '../types/flow';
import { FlowCanvasOverlay } from './FlowCanvasOverlay';
import { apiProvider, DepthSlicePayload } from '../services/ApiProvider';
import {
  DepthSliceRenderConfig,
  extractDepthSliceValues,
} from '../utils/depthSliceViz';
import {
  DepthSliceRenderOptions,
  generateLayerImageSourceCached,
  generateDepthSliceImageSourceCached,
} from '../utils/rasterGen';
import { perfMonitor } from '../utils/perfMonitor';
import { observedRadii, cycloneEyeLabel } from '../utils/cycloneObservation';

if (typeof window !== 'undefined') {
  (window as unknown as { CESIUM_BASE_URL: string }).CESIUM_BASE_URL = '/cesium';
}

export function safeJulianDate(timestampStr: string): Cesium.JulianDate {
  if (!timestampStr) return Cesium.JulianDate.now();
  try {
    let formatted = timestampStr.trim();
    if (!formatted.includes('T')) {
      formatted = formatted.replace(' ', 'T');
    }
    if (!formatted.endsWith('Z') && !formatted.includes('+') && !formatted.includes('-')) {
      formatted += 'Z';
    }
    return Cesium.JulianDate.fromIso8601(formatted);
  } catch {
    try {
      const parsed = new Date(timestampStr);
      if (isNaN(parsed.getTime())) return Cesium.JulianDate.now();
      return Cesium.JulianDate.fromDate(parsed);
    } catch {
      return Cesium.JulianDate.now();
    }
  }
}

export function computeAstronomicalData(timestampStr: string, latDeg: number, lonDeg: number): AstronomicalData {
  const julianDate = safeJulianDate(timestampStr);

  const cartesian = Cesium.Cartesian3.fromDegrees(lonDeg, latDeg, 0);
  const enuTransform = Cesium.Transforms.eastNorthUpToFixedFrame(cartesian);
  const fixedToEnu = Cesium.Matrix4.inverse(enuTransform, new Cesium.Matrix4());
  const icrfToFixed = Cesium.Transforms.computeIcrfToFixedMatrix(julianDate) || new Cesium.Matrix3();

  // 1. SUN CALCULATIONS
  const sunPosIcrf = Cesium.Simon1994PlanetaryPositions.computeSunPositionInEarthInertialFrame(julianDate);
  const sunPosEcef = Cesium.Matrix3.multiplyByVector(icrfToFixed, sunPosIcrf, new Cesium.Cartesian3());
  const sunPosEnu = Cesium.Matrix4.multiplyByPoint(fixedToEnu, sunPosEcef, new Cesium.Cartesian3());

  const sunDistance = Cesium.Cartesian3.magnitude(sunPosEnu);
  const sunElevationRad = Math.asin(sunPosEnu.z / Math.max(1, sunDistance));
  const sunAzimuthRad = Math.atan2(sunPosEnu.x, sunPosEnu.y);

  const sunElevationDeg = Math.round(((sunElevationRad * 180) / Math.PI) * 100) / 100;
  const sunAzimuthDeg = Math.round((((sunAzimuthRad * 180) / Math.PI + 360) % 360) * 100) / 100;
  const isDaylight = sunElevationDeg > -0.833;

  // Compute Sunrise & Sunset for target location on simulation date (UTC)
  const dateObj = new Date(timestampStr);
  const year = dateObj.getUTCFullYear();
  const month = dateObj.getUTCMonth();
  const day = dateObj.getUTCDate();

  let sunriseUtc = 'N/A';
  let sunsetUtc = 'N/A';

  let prevElev: number | null = null;
  for (let min = 0; min <= 1440; min += 20) {
    const testDate = new Date(Date.UTC(year, month, day, 0, min, 0));
    const testJulian = Cesium.JulianDate.fromDate(testDate);
    const testIcrfToFixed = Cesium.Transforms.computeIcrfToFixedMatrix(testJulian) || new Cesium.Matrix3();
    const testSunIcrf = Cesium.Simon1994PlanetaryPositions.computeSunPositionInEarthInertialFrame(testJulian);
    const testSunEcef = Cesium.Matrix3.multiplyByVector(testIcrfToFixed, testSunIcrf, new Cesium.Cartesian3());
    const testSunEnu = Cesium.Matrix4.multiplyByPoint(fixedToEnu, testSunEcef, new Cesium.Cartesian3());
    const testElev = (Math.asin(testSunEnu.z / Math.max(1, Cesium.Cartesian3.magnitude(testSunEnu))) * 180) / Math.PI;

    if (prevElev !== null) {
      if (prevElev < -0.833 && testElev >= -0.833 && sunriseUtc === 'N/A') {
        sunriseUtc = testDate.toISOString().substring(11, 16) + ' UTC';
      } else if (prevElev >= -0.833 && testElev < -0.833 && sunsetUtc === 'N/A') {
        sunsetUtc = testDate.toISOString().substring(11, 16) + ' UTC';
      }
    }
    prevElev = testElev;
  }

  // 2. MOON CALCULATIONS
  const moonPosIcrf = Cesium.Simon1994PlanetaryPositions.computeMoonPositionInEarthInertialFrame(julianDate);
  const moonPosEcef = Cesium.Matrix3.multiplyByVector(icrfToFixed, moonPosIcrf, new Cesium.Cartesian3());
  const moonPosEnu = Cesium.Matrix4.multiplyByPoint(fixedToEnu, moonPosEcef, new Cesium.Cartesian3());

  const moonDistance = Cesium.Cartesian3.magnitude(moonPosEnu);
  const moonElevationRad = Math.asin(moonPosEnu.z / Math.max(1, moonDistance));
  const moonAzimuthRad = Math.atan2(moonPosEnu.x, moonPosEnu.y);

  const moonElevationDeg = Math.round(((moonElevationRad * 180) / Math.PI) * 100) / 100;
  const moonAzimuthDeg = Math.round((((moonAzimuthRad * 180) / Math.PI + 360) % 360) * 100) / 100;

  const sunNorm = Cesium.Cartesian3.normalize(sunPosIcrf, new Cesium.Cartesian3());
  const moonNorm = Cesium.Cartesian3.normalize(moonPosIcrf, new Cesium.Cartesian3());
  const cosAngle = Cesium.Cartesian3.dot(sunNorm, moonNorm);
  const elongationAngleRad = Math.acos(Math.max(-1, Math.min(1, cosAngle)));
  const illuminationPercent = Math.round(0.5 * (1 - Math.cos(elongationAngleRad)) * 1000) / 10;

  let phaseName = 'New Moon';
  if (illuminationPercent < 5) phaseName = 'New Moon';
  else if (illuminationPercent < 45) phaseName = 'Waxing / Waning Crescent';
  else if (illuminationPercent < 55) phaseName = 'Quarter Moon';
  else if (illuminationPercent < 95) phaseName = 'Waxing / Waning Gibbous';
  else phaseName = 'Full Moon';

  return {
    sun: {
      elevationDeg: sunElevationDeg,
      azimuthDeg: sunAzimuthDeg,
      sunriseUtc,
      sunsetUtc,
      isDaylight,
    },
    moon: {
      elevationDeg: moonElevationDeg,
      azimuthDeg: moonAzimuthDeg,
      phaseName,
      illuminationPercent,
    },
    timestamp: timestampStr,
    location: {
      lat: latDeg,
      lon: lonDeg,
    },
  };
}

interface CesiumViewerInnerProps {
  cyclone: Cyclone | null;
  currentTrackIndex: number;
  stations: Station[];
  layers: GISLayer[];
  argoProfiles?: ArgoProfile[];
  onSelectStation: (station: Station) => void;
  onSelectArgoProfile?: (profile: ArgoProfile) => void;
  onInspectPoint?: (lat: number, lon: number) => void;
  onAstronomicalUpdate?: (data: AstronomicalData) => void;
  targetLocation?: { lat: number; lon: number; height?: number } | null;
  timestamp?: string;
  depthSliceVisible?: boolean;
  depthSlicePayload?: DepthSlicePayload | null;
  /** Resolved scientific render configuration (palette/range/scale) — Phase 1C. */
  depthSliceRender?: DepthSliceRenderConfig | null;
  /** Depth-slice imagery layer opacity 0..1 — this layer only. */
  depthSliceOpacity?: number;
  /** Real HYCOM UVEL/VVEL current field (Phase 1E), normalized. */
  currentField?: EnvironmentalFlowField | null;
  /** Data status of the current field (REAL / SIMULATED / UNAVAILABLE). */
  currentFieldStatus?: CurrentFieldDataStatus;
  /** Human-readable reason for the current field status. */
  currentFieldStatusReason?: string | null;
  /** Backend metadata for the current field (provenance chip). */
  currentFieldMetadata?: DepthSlicePayload | null;
}

export const CesiumViewerInner: React.FC<CesiumViewerInnerProps> = ({
  cyclone,
  currentTrackIndex,
  stations,
  layers,
  argoProfiles = [],
  onSelectStation,
  onSelectArgoProfile,
  onInspectPoint,
  onAstronomicalUpdate,
  targetLocation,
  timestamp,
  depthSliceVisible = false,
  depthSlicePayload = null,
  depthSliceRender = null,
  depthSliceOpacity = 0.75,
  currentField = null,
  currentFieldStatus = 'SIMULATED',
  currentFieldStatusReason = null,
  currentFieldMetadata = null,
}) => {

  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Cesium.Viewer | null>(null);
  const [viewerInstance, setViewerInstance] = useState<Cesium.Viewer | null>(null);
  const onInspectPointRef = useRef(onInspectPoint);
  const onSelectStationRef = useRef(onSelectStation);
  const onSelectArgoProfileRef = useRef(onSelectArgoProfile);
  const rasterLayerRef = useRef<Cesium.ImageryLayer | null>(null);
  // Dedicated imagery layer for the HYCOM model depth slice (Phase 1B).
  // Fully separate from the surface rasterLayerRef so surface behavior and
  // depth-slice behavior never remove each other's layers.
  const depthSliceLayerRef = useRef<Cesium.ImageryLayer | null>(null);

  // Phase 2B — on-demand rendering invalidation + raster resource lifecycle.
  //
  // `requestRenderRef` is the single explicit invalidation entry point used by
  // every state change that mutates the Cesium scene but that Cesium does NOT
  // detect by itself (in-place entity updates, imagery opacity, ...). It is
  // deliberately NOT called from the particle overlay's animation loop.
  const requestRenderRef = useRef<() => void>(() => {});
  // Removes the scene.postRender frame listener (instrumentation).
  const postRenderRemoveRef = useRef<(() => void) | null>(null);
  // Releases the object URL backing each raster imagery layer. Held per layer
  // so replacing/removing a layer frees its Blob URL exactly once.
  const rasterSourceReleaseRef = useRef<(() => void) | null>(null);
  const depthSliceSourceReleaseRef = useRef<(() => void) | null>(null);

  const releaseRasterSource = useCallback(() => {
    if (rasterSourceReleaseRef.current) {
      rasterSourceReleaseRef.current();
      rasterSourceReleaseRef.current = null;
    }
  }, []);

  // Persistent keyed entity registry: avoids destructive removeAll() churn.
  const entityRegistryRef = useRef<Map<string, Cesium.Entity>>(new Map());
  // Signatures used to detect when a keyed entity's *structure* changes
  // (e.g. a different cyclone) and must be rebuilt rather than updated in place.
  const entitySigRef = useRef<Map<string, string>>(new Map());

  // Keep callback refs current inside effects only (React 19 immutability).
  useEffect(() => {
    onInspectPointRef.current = onInspectPoint;
  }, [onInspectPoint]);
  useEffect(() => {
    onSelectStationRef.current = onSelectStation;
  }, [onSelectStation]);
  useEffect(() => {
    onSelectArgoProfileRef.current = onSelectArgoProfile;
  }, [onSelectArgoProfile]);

  // Dynamic Mouse Hover Tooltip State
  const [hoverTooltip, setHoverTooltip] = useState<{
    visible: boolean;
    x: number;
    y: number;
    title: string;
    cycloneName?: string;
    category?: string;
    maxWindKts?: number | null;
    centralPressureMb?: number | null;
    lat?: number;
    lon?: number;
    timestamp?: string;
    source?: string;
    dataStatus?: string;
  } | null>(null);

  const isLayerActive = useCallback((id: string) => layers.find((l) => l.id === id)?.active ?? false, [layers]);

  /**
   * Acquire (create once) or fetch an existing entity by stable key.
   * If the structure signature changes, the entity is rebuilt.
   */
  const acquireEntity = useCallback((
    viewer: Cesium.Viewer,
    key: string,
    signature: string,
    build: () => Cesium.Entity.ConstructorOptions
  ): Cesium.Entity => {
    const registry = entityRegistryRef.current;
    const sigs = entitySigRef.current;
    const existing = registry.get(key);

    if (existing && sigs.get(key) === signature) {
      return existing;
    }

    if (existing) {
      viewer.entities.remove(existing);
    }

    const entity = viewer.entities.add(build());
    registry.set(key, entity);
    sigs.set(key, signature);
    return entity;
  }, []);

  // Initialize 3D Globe with Living Atmospheric Visual Depth, Real Astronomical Engine, HD Satellite Imagery & Place Names Overlay
  useEffect(() => {
    if (!containerRef.current || viewerRef.current) return;

    Cesium.Ion.defaultAccessToken = process.env.NEXT_PUBLIC_CESIUM_TOKEN || '';

    try {
      const viewer = new Cesium.Viewer(containerRef.current, {
        terrainProvider: new Cesium.EllipsoidTerrainProvider(),
        baseLayer: new Cesium.ImageryLayer(
          new Cesium.UrlTemplateImageryProvider({
            url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
            maximumLevel: 19,
            credit: 'Esri World Imagery',
          })
        ),
        // Phase 2B — on-demand rendering. Cesium now only draws a frame when
        // something it can detect changed (camera, clock time, imagery/terrain
        // tile arrivals, explicit scene.requestRender()). Application state
        // changes that Cesium cannot detect are invalidated explicitly through
        // requestRenderRef below — see the "render invalidation" notes.
        //
        // maximumRenderTimeChange is 0 s (Cesium's default too): ANY change of
        // clock simulation time requests a frame, so the time-dependent scene
        // (sun light, celestial bodies, atmosphere) still redraws whenever the
        // timeline timestamp advances. The clock itself never animates —
        // shouldAnimate is always false and currentTime is only ever assigned
        // from the application timestamp — so a static clock requests zero idle
        // frames.
        requestRenderMode: true,
        maximumRenderTimeChange: 0.0,
        baseLayerPicker: false,
        geocoder: false,
        homeButton: false,
        infoBox: false,
        sceneModePicker: false,
        selectionIndicator: false,
        timeline: false,
        animation: false,
        navigationHelpButton: false,
        fullscreenButton: false,
      });

      // Phase 2B: single explicit invalidation entry point + real frame counter.
      // scene.postRender only fires for frames Cesium actually drew, so the
      // counter measures the idle/interaction render frequency directly.
      requestRenderRef.current = () => {
        const currentViewer = viewerRef.current;
        if (currentViewer && !currentViewer.isDestroyed()) {
          currentViewer.scene.requestRender();
          perfMonitor.recordCesiumRenderRequest();
        }
      };
      postRenderRemoveRef.current = viewer.scene.postRender.addEventListener(() => {
        perfMonitor.recordCesiumFrame();
      });

      // Add Place Names & Geographic Labels Overlay (Requirement 2)
      try {
        const placeNamesProvider = new Cesium.UrlTemplateImageryProvider({
          url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
          maximumLevel: 19,
          credit: 'Esri World Boundaries & Places',
        });
        viewer.imageryLayers.addImageryProvider(placeNamesProvider);
      } catch (err) {
        console.warn('Place names imagery overlay initialization:', err);
      }

      // Real Astronomical Scene & Atmospheric Environment (Requirement 3: Accurate Sun Light, Dark Night Shading & Space Stars)
      viewer.scene.light = new Cesium.SunLight();
      viewer.scene.globe.enableLighting = true;
      viewer.scene.globe.dynamicAtmosphereLighting = true;
      viewer.scene.globe.dynamicAtmosphereLightingFromSun = true;
      viewer.scene.globe.showGroundAtmosphere = true;
      viewer.scene.globe.atmosphereHueShift = -0.05;
      viewer.scene.globe.atmosphereSaturationShift = 0.15;
      viewer.scene.globe.atmosphereBrightnessShift = 0.05;

      // Enable Space Background Starfield SkyBox & Astronomical Bodies
      if (viewer.scene.skyBox) {
        viewer.scene.skyBox.show = true;
      }
      viewer.scene.backgroundColor = Cesium.Color.TRANSPARENT;

      if (!viewer.scene.sun) {
        viewer.scene.sun = new Cesium.Sun();
      }
      viewer.scene.sun.show = true;
      viewer.scene.sun.glowFactor = 3.5;

      if (!viewer.scene.moon) {
        viewer.scene.moon = new Cesium.Moon();
      }
      viewer.scene.moon.show = true;
      viewer.scene.moon.onlySunLighting = true;

      if (viewer.scene.skyAtmosphere) {
        viewer.scene.skyAtmosphere.show = true;
        viewer.scene.skyAtmosphere.brightnessShift = 0.1;
      }
      if (viewer.scene.fog) {
        viewer.scene.fog.enabled = true;
        viewer.scene.fog.density = 0.00012;
      }

      // Overhead Centered Frame: Bay of Bengal (Visual Anchor)
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(88.0, 18.0, 3600000.0),
        orientation: {
          heading: Cesium.Math.toRadians(0.0),
          pitch: Cesium.Math.toRadians(-88.0),
          roll: 0.0,
        },
        duration: 1.6,
      });

      viewer.scene.globe.depthTestAgainstTerrain = false;
      viewerRef.current = viewer;
      setViewerInstance(viewer);

      // Phase 2B: the scene properties above (lighting, atmosphere, sun/moon,
      // fog, sky box, background) are applied outside Cesium's change tracking,
      // so the first invalidation is explicit. Camera flyTo + tile arrivals
      // keep rendering afterwards until the globe is fully drawn.
      requestRenderRef.current();

      // Event Handler for Station/Argo Clicks, Inspection & Dynamic Canvas Tooltips
      const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

      // Click Handler
      handler.setInputAction((click: { position: Cesium.Cartesian2 }) => {
        const pickedObject = viewer.scene.pick(click.position);
        if (Cesium.defined(pickedObject) && pickedObject.id && pickedObject.id.properties) {
          const props = pickedObject.id.properties;
          if (props.stationData) {
            onSelectStationRef.current(props.stationData.getValue());
            return;
          } else if (props.argoData && onSelectArgoProfileRef.current) {
            onSelectArgoProfileRef.current(props.argoData.getValue());
            return;
          }
        }

        // Convert Map Click to Cartographic Lat/Lon for Scientific Inspector
        if (onInspectPointRef.current) {
          const ray = viewer.camera.getPickRay(click.position);
          if (ray) {
            const cartesian = viewer.scene.globe.pick(ray, viewer.scene);
            if (cartesian) {
              const cartographic = Cesium.Cartographic.fromCartesian(cartesian);
              const lat = Cesium.Math.toDegrees(cartographic.latitude);
              const lon = Cesium.Math.toDegrees(cartographic.longitude);
              onInspectPointRef.current(lat, lon);
            }
          }
        }
      }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

      // Mouse Move Handler for Dynamic Interactive Map Tooltips with RAF Throttling (Phase 2A)
      let pendingPickRaf: number | null = null;
      let latestEndPosition: Cesium.Cartesian2 | null = null;

      const processHoverPick = () => {
        pendingPickRaf = null;
        if (!latestEndPosition || !viewer || viewer.isDestroyed()) return;

        const endPosition = latestEndPosition;
        perfMonitor.recordHoverPick();

        const pickedObject = viewer.scene.pick(endPosition);
        if (Cesium.defined(pickedObject) && pickedObject.id && pickedObject.id.properties) {
          const props = pickedObject.id.properties;
          if (props.trackNodeData) {
            const node = props.trackNodeData.getValue();
            const nodeIdx = props.nodeIndex ? props.nodeIndex.getValue() : 1;
            const cName = props.cycloneName ? props.cycloneName.getValue() : 'AMPHAN';

            setHoverTooltip({
              visible: true,
              x: endPosition.x,
              y: endPosition.y,
              title: `TRACK NODE #${nodeIdx}`,
              cycloneName: cName,
              category: node.category ?? undefined,
              maxWindKts: node.maxWindKts,
              centralPressureMb: node.centralPressureMb,
              lat: node.latitude,
              lon: node.longitude,
              timestamp: node.timestamp,
              source: 'NOAA IBTrACS v04r01',
              dataStatus: 'HISTORICAL RECORD',
            });
            return;
          } else if (props.stationData) {
            const st = props.stationData.getValue();
            setHoverTooltip({
              visible: true,
              x: endPosition.x,
              y: endPosition.y,
              title: `STATION: ${st.name}`,
              lat: st.latitude,
              lon: st.longitude,
              source: 'INCOIS Coastal Buoy Network',
              dataStatus: st.dataStatus === 'SIMULATED' ? 'SIMULATED TELEMETRY' : `${st.dataStatus} TELEMETRY`,
            });
            return;
          } else if (props.argoData) {
            const argo = props.argoData.getValue();
            setHoverTooltip({
              visible: true,
              x: endPosition.x,
              y: endPosition.y,
              title: `ARGO FLOAT ${argo.float_id}`,
              lat: argo.latitude,
              lon: argo.longitude,
              timestamp: argo.observation_time,
              source: `Argo GDAC (${argo.institution})`,
              dataStatus: 'IN-SITU OBSERVATION',
            });
            return;
          }
        }

        setHoverTooltip(null);
      };

      handler.setInputAction((movement: { endPosition: Cesium.Cartesian2 }) => {
        if (!movement.endPosition) {
          if (pendingPickRaf !== null) {
            cancelAnimationFrame(pendingPickRaf);
            pendingPickRaf = null;
          }
          latestEndPosition = null;
          setHoverTooltip(null);
          return;
        }

        latestEndPosition = movement.endPosition;
        if (pendingPickRaf === null) {
          pendingPickRaf = requestAnimationFrame(processHoverPick);
        }
      }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

      return () => {
        if (pendingPickRaf !== null) {
          cancelAnimationFrame(pendingPickRaf);
          pendingPickRaf = null;
        }
        handler.destroy();
        // Phase 2B: stop the frame instrumentation and drop every raster
        // object URL so nothing outlives the viewer.
        if (postRenderRemoveRef.current) {
          postRenderRemoveRef.current();
          postRenderRemoveRef.current = null;
        }
        requestRenderRef.current = () => {};
        releaseRasterSource();
        if (depthSliceSourceReleaseRef.current) {
          depthSliceSourceReleaseRef.current();
          depthSliceSourceReleaseRef.current = null;
        }
        const registry = entityRegistryRef.current;
        const sigs = entitySigRef.current;
        if (viewerRef.current && !viewerRef.current.isDestroyed()) {
          viewerRef.current.destroy();
          viewerRef.current = null;
          setViewerInstance(null);
          registry.clear();
          sigs.clear();
        }
      };
    } catch (err) {
      console.error('Cesium Globe initialization fallback:', err);
    }
  }, [releaseRasterSource]);

  // Handle Dynamic Camera FlyTo on Target Location Selection (including Sun & Moon targeting)
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed() || !targetLocation) return;

    if ((targetLocation as { isSun?: boolean }).isSun && timestamp) {
      const julianDate = safeJulianDate(timestamp);
      const sunPosIcrf = Cesium.Simon1994PlanetaryPositions.computeSunPositionInEarthInertialFrame(julianDate);
      const icrfToFixed = Cesium.Transforms.computeIcrfToFixedMatrix(julianDate) || new Cesium.Matrix3();
      const sunPosEcef = Cesium.Matrix3.multiplyByVector(icrfToFixed, sunPosIcrf, new Cesium.Cartesian3());
      const sunNorm = Cesium.Cartesian3.normalize(sunPosEcef, new Cesium.Cartesian3());

      const camPos = Cesium.Cartesian3.multiplyByScalar(sunNorm, 22000000.0, new Cesium.Cartesian3());
      viewer.camera.flyTo({
        destination: camPos,
        orientation: {
          direction: Cesium.Cartesian3.negate(sunNorm, new Cesium.Cartesian3()),
          up: Cesium.Cartesian3.UNIT_Z,
        },
        duration: 2.0,
      });
      return;
    }

    if ((targetLocation as { isMoon?: boolean }).isMoon && timestamp) {
      const julianDate = safeJulianDate(timestamp);
      const moonPosIcrf = Cesium.Simon1994PlanetaryPositions.computeMoonPositionInEarthInertialFrame(julianDate);
      const icrfToFixed = Cesium.Transforms.computeIcrfToFixedMatrix(julianDate) || new Cesium.Matrix3();
      const moonPosEcef = Cesium.Matrix3.multiplyByVector(icrfToFixed, moonPosIcrf, new Cesium.Cartesian3());
      const moonNorm = Cesium.Cartesian3.normalize(moonPosEcef, new Cesium.Cartesian3());

      const camPos = Cesium.Cartesian3.multiplyByScalar(moonNorm, 22000000.0, new Cesium.Cartesian3());
      viewer.camera.flyTo({
        destination: camPos,
        orientation: {
          direction: Cesium.Cartesian3.negate(moonNorm, new Cesium.Cartesian3()),
          up: Cesium.Cartesian3.UNIT_Z,
        },
        duration: 2.0,
      });
      return;
    }

    const targetHeight = targetLocation.height || 1800000.0;
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(targetLocation.lon, targetLocation.lat, targetHeight),
      orientation: {
        heading: Cesium.Math.toRadians(0.0),
        pitch: Cesium.Math.toRadians(-88.0),
        roll: 0.0,
      },
      duration: 1.5,
    });
  }, [targetLocation, timestamp]);

  // Phase 2B — camera render invalidation.
  //
  // Camera movement / zoom / rotation needs no custom listener: Cesium's own
  // render loop (Scene.render → View.checkForCameraUpdates) detects any camera
  // change every frame and forces a frame, so interaction stays perfectly
  // smooth with zero added listeners or throttling. The effects above only
  // flyTo programmatically, which is camera movement too.
  //
  // Synchronize Cesium JulianDate Clock with OceanLens Timeline Timestamp (Requirements 2, 3, 4)
  //
  // Phase 2B (requestRenderMode): the application clock NEVER animates
  // (`shouldAnimate` is always false) — it is only ever set here from the
  // timeline timestamp. Scientific time semantics are unchanged; the explicit
  // requestRender below guarantees the time-dependent visuals (sun light,
  // celestial bodies, atmosphere) are redrawn on every timeline change.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed() || !timestamp) return;

    try {
      const julianDate = safeJulianDate(timestamp);
      viewer.clock.currentTime = julianDate;
      viewer.clock.shouldAnimate = false;
      requestRenderRef.current();
    } catch (err) {
      console.error('Error synchronizing Cesium JulianDate clock:', err);
    }
  }, [timestamp]);

  // Compute Real-time Astronomical Positions (Sun & Moon) for active location & timestamp
  useEffect(() => {
    if (!onAstronomicalUpdate) return;

    const currentTs = timestamp || '2026-09-08T12:00:00Z';
    const lat = targetLocation?.lat ?? 18.2247;
    const lon = targetLocation?.lon ?? 88.4000;

    try {
      const astroData = computeAstronomicalData(currentTs, lat, lon);
      onAstronomicalUpdate(astroData);
    } catch (err) {
      console.error('Error computing astronomical positions:', err);
    }
  }, [timestamp, targetLocation, onAstronomicalUpdate]);

  // ============================================================
  // Persistent Entity Synchronization
  //
  // Entities are created once per stable key and updated in place
  // (position/axis/text/visibility) instead of being destroyed and
  // recreated on every timeline tick or layer toggle.
  // ============================================================
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;

    const t0 = performance.now();
    const registry = entityRegistryRef.current;

    // Track which keys are still relevant this pass; anything not refreshed
    // below is hidden rather than destroyed (cheap to re-enable later).
    const activeKeys = new Set<string>();

    const showCycloneLayer = isLayerActive('cyclone');

    // 1. CYCLONE STORM VISUAL ANCHOR
    if (cyclone && showCycloneLayer) {
      const positions: Cesium.Cartesian3[] = [];
      const trackPoints = cyclone.track;

      trackPoints.forEach((pt) => {
        positions.push(Cesium.Cartesian3.fromDegrees(pt.longitude, pt.latitude));
      });

      // Forecast Track Vector Line (Muted Cyan Dashed)
      if (positions.length >= 2) {
        const trackEntity = acquireEntity(
          viewer,
          'cyclone-track-forecast',
          `forecast|${cyclone.id}|${trackPoints.length}`,
          () => ({
            name: `${cyclone.name} Forecast Track`,
            polyline: {
              positions: positions,
              width: 2.5,
              material: new Cesium.PolylineDashMaterialProperty({
                color: Cesium.Color.CYAN.withAlpha(0.65),
                dashLength: 10.0,
              }),
            },
          })
        );
        trackEntity.show = true;
        activeKeys.add('cyclone-track-forecast');
      }

      // Historical Observed Track Line (Smooth Crimson Red) - time-varying
      const historyPositions = currentTrackIndex > 0 ? positions.slice(0, currentTrackIndex + 1) : [];
      if (historyPositions.length >= 2) {
        const histEntity = acquireEntity(
          viewer,
          'cyclone-track-historical',
          `hist|${cyclone.id}`,
          () => ({
            name: `${cyclone.name} Historical Track`,
            polyline: {
              positions: historyPositions,
              width: 3.5,
              material: Cesium.Color.fromCssColorString('#f43f5e'),
            },
          })
        );
        // In-place update of positions on timeline scrub
        (histEntity.polyline?.positions as Cesium.ConstantProperty | undefined)?.setValue(historyPositions);
        histEntity.show = true;
        activeKeys.add('cyclone-track-historical');
      }

      // Track Nodes
      trackPoints.forEach((pt, idx) => {
        const key = `cyclone-node-${cyclone.id}-${idx}`;
        const isCurrent = idx === currentTrackIndex;
        const nodeEntity = acquireEntity(
          viewer,
          key,
          `node|${cyclone.id}|${idx}|${pt.latitude}|${pt.longitude}`,
          () => ({
            name: `Track Node ${idx + 1}`,
            position: Cesium.Cartesian3.fromDegrees(pt.longitude, pt.latitude),
            point: {
              pixelSize: isCurrent ? 12 : 7,
              color: isCurrent ? Cesium.Color.WHITE : Cesium.Color.fromCssColorString('#f43f5e').withAlpha(0.85),
              outlineColor: isCurrent ? Cesium.Color.fromCssColorString('#f43f5e') : Cesium.Color.BLACK,
              outlineWidth: isCurrent ? 3 : 1.5,
            },
            properties: {
              trackNodeData: pt,
              nodeIndex: idx + 1,
              cycloneName: cyclone.name,
            },
          })
        );

        // In-place style update for the "current" highlight
        if (nodeEntity.point) {
          (nodeEntity.point.pixelSize as Cesium.ConstantProperty).setValue(isCurrent ? 12 : 7);
          (nodeEntity.point.color as Cesium.ConstantProperty).setValue(
            isCurrent ? Cesium.Color.WHITE : Cesium.Color.fromCssColorString('#f43f5e').withAlpha(0.85)
          );
          (nodeEntity.point.outlineColor as Cesium.ConstantProperty).setValue(
            isCurrent ? Cesium.Color.fromCssColorString('#f43f5e') : Cesium.Color.BLACK
          );
          (nodeEntity.point.outlineWidth as Cesium.ConstantProperty).setValue(isCurrent ? 3 : 1.5);
        }
        nodeEntity.show = true;
        activeKeys.add(key);
      });

      // 3D Solar System Space Celestial Bodies (Sun, Moon & Solar Beam Vector in Space)
      try {
        const julianDate = safeJulianDate(timestamp || '2026-09-08T12:00:00Z');
        const icrfToFixed = Cesium.Transforms.computeIcrfToFixedMatrix(julianDate) || new Cesium.Matrix3();

        // 3D Sun Entity in Space
        const sunPosIcrf = Cesium.Simon1994PlanetaryPositions.computeSunPositionInEarthInertialFrame(julianDate);
        const sunPosEcef = Cesium.Matrix3.multiplyByVector(icrfToFixed, sunPosIcrf, new Cesium.Cartesian3());
        const sunMag = Cesium.Cartesian3.magnitude(sunPosEcef);

        if (sunMag > 100.0) {
          const sunNorm = Cesium.Cartesian3.normalize(sunPosEcef, new Cesium.Cartesian3());
          const sunSpacePos = Cesium.Cartesian3.multiplyByScalar(sunNorm, 40000000.0, new Cesium.Cartesian3());
          const earthSurfacePoint = Cesium.Cartesian3.multiplyByScalar(sunNorm, 6371000.0, new Cesium.Cartesian3());

          const sunEntity = acquireEntity(
            viewer,
            'celestial-sun',
            `sun|${julianDate.toString()}`,
            () => ({
              name: 'Sun 3D Celestial Body',
              position: sunSpacePos,
              point: {
                pixelSize: 28,
                color: Cesium.Color.fromCssColorString('#fbbf24'),
                outlineColor: Cesium.Color.fromCssColorString('#f59e0b'),
                outlineWidth: 5,
              },
              label: {
                text: '☉ THE SUN\nSOLAR SYSTEM CORE LIGHT SOURCE',
                font: '10px IBM Plex Mono, monospace',
                style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                outlineWidth: 2,
                outlineColor: Cesium.Color.BLACK,
                verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                pixelOffset: new Cesium.Cartesian2(0, -18),
                fillColor: Cesium.Color.fromCssColorString('#fef08a'),
                showBackground: true,
                backgroundColor: Cesium.Color.fromCssColorString('#080c14').withAlpha(0.9),
                backgroundPadding: new Cesium.Cartesian2(8, 5),
              },
            })
          );
          (sunEntity.position as Cesium.ConstantPositionProperty).setValue(sunSpacePos);
          sunEntity.show = true;
          activeKeys.add('celestial-sun');

          // Solar Rays Polyline (From Sun position to Earth surface position)
          const rayEntity = acquireEntity(
            viewer,
            'celestial-sun-rays',
            'sunrays',
            () => ({
              name: 'Solar Rays Vector Beam',
              polyline: {
                positions: [sunSpacePos, earthSurfacePoint],
                width: 2.0,
                material: new Cesium.PolylineGlowMaterialProperty({
                  glowPower: 0.3,
                  taperPower: 0.8,
                  color: Cesium.Color.fromCssColorString('#fde047').withAlpha(0.35),
                }),
              },
            })
          );
          (rayEntity.polyline?.positions as Cesium.ConstantProperty | undefined)?.setValue([sunSpacePos, earthSurfacePoint]);
          rayEntity.show = true;
          activeKeys.add('celestial-sun-rays');
        }

        // 3D Moon Entity in Space
        const moonPosIcrf = Cesium.Simon1994PlanetaryPositions.computeMoonPositionInEarthInertialFrame(julianDate);
        const moonPosEcef = Cesium.Matrix3.multiplyByVector(icrfToFixed, moonPosIcrf, new Cesium.Cartesian3());
        const moonMag = Cesium.Cartesian3.magnitude(moonPosEcef);

        if (moonMag > 100.0) {
          const moonNorm = Cesium.Cartesian3.normalize(moonPosEcef, new Cesium.Cartesian3());
          const moonSpacePos = Cesium.Cartesian3.multiplyByScalar(moonNorm, 24000000.0, new Cesium.Cartesian3());

          const moonEntity = acquireEntity(
            viewer,
            'celestial-moon',
            `moon|${julianDate.toString()}`,
            () => ({
              name: 'Moon 3D Celestial Body',
              position: moonSpacePos,
              point: {
                pixelSize: 14,
                color: Cesium.Color.fromCssColorString('#e2e8f0'),
                outlineColor: Cesium.Color.fromCssColorString('#94a3b8'),
                outlineWidth: 3,
              },
              label: {
                text: '☽ THE MOON\nEARTH NATURAL SATELLITE',
                font: '10px IBM Plex Mono, monospace',
                style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                outlineWidth: 2,
                outlineColor: Cesium.Color.BLACK,
                verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                pixelOffset: new Cesium.Cartesian2(0, -14),
                fillColor: Cesium.Color.fromCssColorString('#cbd5e1'),
                showBackground: true,
                backgroundColor: Cesium.Color.fromCssColorString('#080c14').withAlpha(0.9),
                backgroundPadding: new Cesium.Cartesian2(8, 5),
              },
            })
          );
          (moonEntity.position as Cesium.ConstantPositionProperty).setValue(moonSpacePos);
          moonEntity.show = true;
          activeKeys.add('celestial-moon');
        }
      } catch (e) {
        console.warn('3D Celestial bodies rendering:', e);
      }

      // Active Cyclone Eye Core Anchor & Concentric Intensity Rings (time-varying, updated in place)
      const activePt = trackPoints[Math.min(currentTrackIndex, trackPoints.length - 1)];
      if (activePt) {
        const eyePos = Cesium.Cartesian3.fromDegrees(activePt.longitude, activePt.latitude);

        // Core Eye Circle (Storm Visual Center Anchor)
        const eyeEntity = acquireEntity(
          viewer,
          'cyclone-eye-core',
          `eye|${cyclone.id}`,
          () => ({
            name: 'Cyclone Eye Core Anchor',
            position: eyePos,
            ellipse: {
              semiMajorAxis: 35000,
              semiMinorAxis: 35000,
              material: Cesium.Color.WHITE.withAlpha(0.25),
              outline: true,
              outlineColor: Cesium.Color.WHITE,
              outlineWidth: 2.0,
            },
          })
        );
        (eyeEntity.position as Cesium.ConstantPositionProperty).setValue(eyePos);
        eyeEntity.show = true;
        activeKeys.add('cyclone-eye-core');

        // Wind-radius rings are drawn ONLY from observed quadrant radii. IBTrACS
        // reports them for a minority of track points, so a null radius means
        // "not observed" and we draw nothing rather than inventing a ring size.
        const r50 = observedRadii(cyclone.windRadius).r50ktsKm;
        if (r50 !== null) {
          const ring50 = acquireEntity(
            viewer,
            'cyclone-ring-50kt',
            `r50|${cyclone.id}|${r50}`,
            () => ({
              name: 'Inner Core Intensity Ring (50kt, observed)',
              position: eyePos,
              ellipse: {
                semiMajorAxis: r50 * 1000,
                semiMinorAxis: r50 * 1000,
                material: Cesium.Color.fromCssColorString('#f43f5e').withAlpha(0.12),
                outline: true,
                outlineColor: Cesium.Color.fromCssColorString('#f43f5e').withAlpha(0.75),
                outlineWidth: 1.5,
              },
            })
          );
          (ring50.position as Cesium.ConstantPositionProperty).setValue(eyePos);
          ring50.show = true;
          activeKeys.add('cyclone-ring-50kt');
        }

        const r34 = observedRadii(cyclone.windRadius).r34ktsKm;
        if (r34 !== null) {
          const ring34 = acquireEntity(
            viewer,
            'cyclone-ring-34kt',
            `r34|${cyclone.id}|${r34}`,
            () => ({
              name: 'Outer Wind Intensity Ring (34kt, observed)',
              position: eyePos,
              ellipse: {
                semiMajorAxis: r34 * 1000,
                semiMinorAxis: r34 * 1000,
                material: Cesium.Color.TEAL.withAlpha(0.06),
                outline: true,
                outlineColor: Cesium.Color.TEAL.withAlpha(0.5),
                outlineWidth: 1.0,
              },
            })
          );
          (ring34.position as Cesium.ConstantPositionProperty).setValue(eyePos);
          ring34.show = true;
          activeKeys.add('cyclone-ring-34kt');
        }

        // Directional Movement Vector Indicator Tag Pin.
        // Category and wind are nullable: a missing observation must read as
        // "not observed" rather than "null KT" or a crash on .toUpperCase().
        const eyeLabelText = cycloneEyeLabel(cyclone.name, activePt);
        const pinEntity = acquireEntity(
          viewer,
          'cyclone-eye-pin',
          `pin|${cyclone.id}`,
          () => ({
            name: 'Cyclone Eye Pin Callout',
            position: eyePos,
            label: {
              text: eyeLabelText,
              font: '10px IBM Plex Mono, monospace',
              style: Cesium.LabelStyle.FILL_AND_OUTLINE,
              outlineWidth: 2,
              outlineColor: Cesium.Color.BLACK,
              verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
              pixelOffset: new Cesium.Cartesian2(40, -20),
              fillColor: Cesium.Color.WHITE,
              showBackground: true,
              backgroundColor: Cesium.Color.fromCssColorString('#080c14').withAlpha(0.88),
              backgroundPadding: new Cesium.Cartesian2(8, 5),
            },
          })
        );
        (pinEntity.position as Cesium.ConstantPositionProperty).setValue(eyePos);
        if (pinEntity.label?.text) {
          (pinEntity.label.text as Cesium.ConstantProperty).setValue(eyeLabelText);
        }
        pinEntity.show = true;
        activeKeys.add('cyclone-eye-pin');
      }

      // Forecast Uncertainty Region Circles (static per cyclone)
      cyclone.forecastCone.forEach((conePt, coneIdx) => {
        const key = `cyclone-cone-${cyclone.id}-${coneIdx}`;
        const coneEntity = acquireEntity(
          viewer,
          key,
          `cone|${cyclone.id}|${coneIdx}|${conePt.latitude}|${conePt.longitude}|${conePt.radiusKm}`,
          () => ({
            name: 'Forecast Cone Circle',
            position: Cesium.Cartesian3.fromDegrees(conePt.longitude, conePt.latitude),
            ellipse: {
              semiMajorAxis: conePt.radiusKm * 1000,
              semiMinorAxis: conePt.radiusKm * 1000,
              material: Cesium.Color.CYAN.withAlpha(0.04),
              outline: true,
              outlineColor: Cesium.Color.CYAN.withAlpha(0.25),
              outlineWidth: 1.0,
            },
          })
        );
        coneEntity.show = true;
        activeKeys.add(key);
      });
    }

    // 2. COASTAL HAZARD SECTOR POLYGONS
    if (isLayerActive('risk_zones')) {
      const riskEntity = acquireEntity(
        viewer,
        'risk-sundarbans-sector',
        'risk|sundarbans',
        () => ({
          name: 'Sundarbans Risk Sector',
          polygon: {
            hierarchy: Cesium.Cartesian3.fromDegreesArray([
              87.5, 21.2,
              89.8, 21.2,
              90.5, 22.6,
              88.0, 22.6,
            ]),
            material: Cesium.Color.fromCssColorString('#f43f5e').withAlpha(0.15),
            outline: true,
            outlineColor: Cesium.Color.fromCssColorString('#f43f5e').withAlpha(0.6),
          },
        })
      );
      riskEntity.show = true;
      activeKeys.add('risk-sundarbans-sector');
    }

    // 3. MONITORING STATIONS
    if (isLayerActive('stations')) {
      stations.forEach((st) => {
        const haloKey = `station-halo-${st.id}`;
        const haloEntity = acquireEntity(
          viewer,
          haloKey,
          `halo|${st.id}|${st.latitude}|${st.longitude}`,
          () => ({
            name: `${st.name} Outer Halo`,
            position: Cesium.Cartesian3.fromDegrees(st.longitude, st.latitude),
            ellipse: {
              semiMajorAxis: 18000,
              semiMinorAxis: 18000,
              material: Cesium.Color.WHITE.withAlpha(0.04),
              outline: true,
              outlineColor: Cesium.Color.WHITE.withAlpha(0.4),
              outlineWidth: 1.0,
            },
          })
        );
        haloEntity.show = true;
        activeKeys.add(haloKey);

        const pointKey = `station-${st.id}`;
        const pointEntity = acquireEntity(
          viewer,
          pointKey,
          `station|${st.id}|${st.latitude}|${st.longitude}`,
          () => ({
            name: st.name,
            position: Cesium.Cartesian3.fromDegrees(st.longitude, st.latitude),
            point: {
              pixelSize: 6,
              color: Cesium.Color.WHITE,
              outlineColor: Cesium.Color.BLACK,
              outlineWidth: 1.5,
            },
            properties: {
              stationData: st,
            },
          })
        );
        pointEntity.show = true;
        activeKeys.add(pointKey);
      });
    }

    // 4. REAL ARGO OBSERVATIONS LAYER
    if (isLayerActive('argo') && argoProfiles) {
      argoProfiles.forEach((p) => {
        const haloKey = `argo-halo-${p.profile_id}`;
        const haloEntity = acquireEntity(
          viewer,
          haloKey,
          `argoHalo|${p.profile_id}|${p.latitude}|${p.longitude}`,
          () => ({
            name: `Argo Float ${p.float_id} Halo`,
            position: Cesium.Cartesian3.fromDegrees(p.longitude, p.latitude),
            ellipse: {
              semiMajorAxis: 24000,
              semiMinorAxis: 24000,
              material: Cesium.Color.fromCssColorString('#06b6d4').withAlpha(0.08),
              outline: true,
              outlineColor: Cesium.Color.fromCssColorString('#06b6d4').withAlpha(0.6),
              outlineWidth: 1.5,
            },
          })
        );
        haloEntity.show = true;
        activeKeys.add(haloKey);

        const pointKey = `argo-${p.profile_id}`;
        const pointEntity = acquireEntity(
          viewer,
          pointKey,
          `argo|${p.profile_id}|${p.latitude}|${p.longitude}`,
          () => ({
            name: `Argo Float ${p.float_id}`,
            position: Cesium.Cartesian3.fromDegrees(p.longitude, p.latitude),
            point: {
              pixelSize: 8,
              color: Cesium.Color.fromCssColorString('#22d3ee'),
              outlineColor: Cesium.Color.BLACK,
              outlineWidth: 2,
            },
            label: {
              text: `ARGO FLOAT ${p.float_id}\nREAL SOURCE • INGESTION PENDING`,
              font: '9px IBM Plex Mono, monospace',
              style: Cesium.LabelStyle.FILL_AND_OUTLINE,
              outlineWidth: 2,
              outlineColor: Cesium.Color.BLACK,
              verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
              pixelOffset: new Cesium.Cartesian2(0, -12),
              fillColor: Cesium.Color.fromCssColorString('#38bdf8'),
              showBackground: true,
              backgroundColor: Cesium.Color.fromCssColorString('#080c14').withAlpha(0.88),
              backgroundPadding: new Cesium.Cartesian2(6, 4),
            },
            properties: {
              argoData: p,
            },
          })
        );
        pointEntity.show = true;
        activeKeys.add(pointKey);
      });
    }

    // Hide any registry entities not refreshed this pass (layer toggled off).
    // They stay alive for instant re-enable — no destroy/recreate churn.
    registry.forEach((entity, key) => {
      if (!activeKeys.has(key)) {
        entity.show = false;
      }
    });

    perfMonitor.setEntityCount(registry.size);
    perfMonitor.recordTimelineUpdate(performance.now() - t0);

    // Phase 2B (requestRenderMode): entity *in-place* updates (position,
    // visibility, pixel size, label text, ...) are NOT scene-invalidating
    // events in Cesium — EntityCollection.collectionChanged does not request a
    // frame — so cyclone geometry, track nodes, Sun/Moon, station and Argo
    // entity changes all invalidate here explicitly. (Add/remove of the entities
    // themselves and camera movement are auto-detected by Cesium.)
    requestRenderRef.current();
  }, [cyclone, currentTrackIndex, stations, layers, argoProfiles, timestamp, isLayerActive, acquireEntity]);

  // Dynamic Spatial Raster Heatmap Overlay (SST / Salinity / TCHP)
  // Phase 2B: raster encoding is now asynchronous (PNG Blob → object URL), so
  // superseded generations are discarded instead of briefly flashing, and the
  // layer's object URL is released on every replace/unmount.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;

    const showSST = isLayerActive('sst');
    const showSaln = isLayerActive('salinity');
    const showTCHP = isLayerActive('tchp');

    const abortController = new AbortController();
    let active = true;

    if (!showSST && !showSaln && !showTCHP) {
      if (rasterLayerRef.current) {
        viewer.imageryLayers.remove(rasterLayerRef.current);
        rasterLayerRef.current = null;
        requestRenderRef.current();
      }
      releaseRasterSource();
      return () => {
        abortController.abort();
      };
    }

    const targetLayer: 'sst' | 'salinity' | 'tchp' = showSST ? 'sst' : showSaln ? 'salinity' : 'tchp';

    async function loadRasterOverlay() {
      let data: Awaited<ReturnType<typeof apiProvider.getLayerData>> = null;
      try {
        // Shared with the legend bounds fetch in page.tsx: one request, one grid.
        data = await apiProvider.getLayerData(targetLayer, timestamp, 3, abortController.signal);
      } catch {
        return; // aborted or failed
      }
      if (!active || !data || !data.grid || !data.grid.values) return;

      // Cache hit ⇒ pure lookup; miss ⇒ paint + one async PNG encode.
      const source = await generateLayerImageSourceCached(
        targetLayer,
        data.grid.latitudes,
        data.grid.longitudes,
        data.grid.values,
        data.timestamp
      );
      perfMonitor.recordRasterGen(source.generationMs, source.cacheHit);
      perfMonitor.recordRasterSerialization(source.serializationMs, source.encoding);

      if (!active || !source.url || !viewerRef.current || viewerRef.current.isDestroyed()) {
        source.release();
        return;
      }

      const provider = new Cesium.SingleTileImageryProvider({
        url: source.url,
        rectangle: Cesium.Rectangle.fromDegrees(
          data.bounds.minLon,
          data.bounds.minLat,
          data.bounds.maxLon,
          data.bounds.maxLat
        ),
        tileWidth: 512,
        tileHeight: 512,
      });

      if (!active || !viewerRef.current || viewerRef.current.isDestroyed()) {
        source.release();
        return;
      }

      // Atomic replace: remove the previous layer, free its object URL, then add
      // the new one. The base imagery and the depth-slice layer are untouched.
      if (rasterLayerRef.current) {
        viewerRef.current.imageryLayers.remove(rasterLayerRef.current);
        rasterLayerRef.current = null;
      }
      releaseRasterSource();

      rasterLayerRef.current = viewerRef.current.imageryLayers.addImageryProvider(provider);
      rasterLayerRef.current.alpha = 0.65;
      rasterSourceReleaseRef.current = source.release;

      // Phase 2B: imagery layer add/remove is auto-invalidating in Cesium, but
      // the alpha assignment above is not — invalidate explicitly.
      requestRenderRef.current();
    }

    loadRasterOverlay();

    return () => {
      active = false;
      abortController.abort();
      if (viewerRef.current && !viewerRef.current.isDestroyed() && rasterLayerRef.current) {
        viewerRef.current.imageryLayers.remove(rasterLayerRef.current);
        rasterLayerRef.current = null;
        requestRenderRef.current();
      }
      releaseRasterSource();
    };
  }, [layers, timestamp, isLayerActive, releaseRasterSource]);


  // ============================================================
  // HYCOM Model Depth Slice overlay (Phase 1B, extended in Phase 1C)
  //
  // A dedicated imagery layer, fully separate from the surface raster:
  // - own layer ref (never removed by surface logic, never accumulates)
  // - replaces the previous slice atomically before adding the new one
  // - hidden entirely when depthSliceVisible is false or payload is absent
  // - Phase 1C: renders through the resolved scientific render config
  //   (palette / display range / scale) — display only, the payload's
  //   scientific values are never modified
  // The slice is a 2D geographic drape of a single native model depth
  // level — NOT a volumetric or water-column visualization.
  // ============================================================
  const removeDepthSliceLayer = useCallback(() => {
    const viewer = viewerRef.current;
    if (viewer && !viewer.isDestroyed() && depthSliceLayerRef.current) {
      viewer.imageryLayers.remove(depthSliceLayerRef.current);
      requestRenderRef.current();
    }
    depthSliceLayerRef.current = null;
    // Phase 2B: the imagery layer owned this raster's object URL — free it.
    if (depthSliceSourceReleaseRef.current) {
      depthSliceSourceReleaseRef.current();
      depthSliceSourceReleaseRef.current = null;
    }
  }, []);

  // Latest opacity for layer (re)creation without re-adding on change.
  const depthSliceOpacityRef = useRef(depthSliceOpacity);

  // Opacity-only updates mutate the existing imagery layer in place:
  // zero add/remove churn, and only THIS layer ever changes alpha.
  useEffect(() => {
    depthSliceOpacityRef.current = depthSliceOpacity;
    if (depthSliceLayerRef.current) {
      depthSliceLayerRef.current.alpha = depthSliceOpacity;
      // ImageryLayer.alpha is not a scene-invalidating change under
      // requestRenderMode — request the frame explicitly.
      requestRenderRef.current();
    }
  }, [depthSliceOpacity]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;

    const payload = depthSlicePayload;

    if (!depthSliceVisible || !payload || !payload.grid) {
      removeDepthSliceLayer();
      return;
    }

    // Scalar grid, or speed magnitude |(u,v)| for vector (currents) slices.
    // Missing components stay missing (shared with the resolve logic so the
    // legend and the raster can never disagree about the data).
    const values = extractDepthSliceValues(payload);
    if (!values) {
      removeDepthSliceLayer();
      return;
    }

    // Display-only render options from the resolved Phase 1C configuration.
    // Without a configuration the generator keeps the Phase 1B default
    // (classic palette, auto range over the slice, linear scale).
    const renderOptions: DepthSliceRenderOptions | undefined = depthSliceRender
      ? {
          palette: depthSliceRender.palette,
          rangeMin: depthSliceRender.rangeMin,
          rangeMax: depthSliceRender.rangeMax,
          scale: depthSliceRender.scale,
        }
      : undefined;

    // Phase 2B: encoding is asynchronous, so a generation that is superseded
    // (rapid depth/variable/palette/timestamp changes, slice hidden, unmount)
    // must NOT add its layer afterwards. This is what prevents a stale slice
    // from reappearing or lingering underneath the active one.
    let superseded = false;

    (async () => {
      const sliceLatitudes = payload.grid.latitudes;
      const sliceLongitudes = payload.grid.longitudes;

      const source = await generateDepthSliceImageSourceCached(
        payload.variable,
        payload.matched_depth_m,
        sliceLatitudes,
        sliceLongitudes,
        values,
        payload.timestamp,
        renderOptions
      );

      perfMonitor.recordRasterGen(source.generationMs, source.cacheHit);
      perfMonitor.recordRasterSerialization(source.serializationMs, source.encoding);

      if (superseded || !source.url) {
        source.release();
        return;
      }
      const currentViewer = viewerRef.current;
      if (!currentViewer || currentViewer.isDestroyed()) {
        source.release();
        return;
      }

      const provider = new Cesium.SingleTileImageryProvider({
        url: source.url,
        rectangle: Cesium.Rectangle.fromDegrees(
          payload.bounds.minLon,
          payload.bounds.minLat,
          payload.bounds.maxLon,
          payload.bounds.maxLat
        ),
        tileWidth: 512,
        tileHeight: 512,
      });

      // Atomic replace: remove the previous slice (and free its object URL)
      // before adding the new one so old imagery never lingers underneath.
      removeDepthSliceLayer();
      depthSliceLayerRef.current = currentViewer.imageryLayers.addImageryProvider(provider);
      depthSliceLayerRef.current.alpha = depthSliceOpacityRef.current;
      depthSliceSourceReleaseRef.current = source.release;
      requestRenderRef.current();
    })();

    return () => {
      superseded = true;
    };
  }, [depthSliceVisible, depthSlicePayload, depthSliceRender, removeDepthSliceLayer]);

  // Unmount cleanup: the depth-slice imagery layer dies with the viewer, but
  // clear the ref defensively in case the viewer outlives this component.
  useEffect(() => {
    return () => {
      depthSliceLayerRef.current = null;
    };
  }, []);


  const showWind = isLayerActive('wind');
  const showCurrents = isLayerActive('currents');
  const activePt = cyclone?.track[Math.min(currentTrackIndex, (cyclone?.track.length || 1) - 1)];

  return (
    <div className="w-full h-full absolute inset-0 bg-[#05070a] relative">
      <div ref={containerRef} className="w-full h-full absolute inset-0 bg-[#05070a]" />

      {/* Dynamic Map Hover Tooltip Overlay (Requirement 1) */}
      {hoverTooltip && hoverTooltip.visible && (
        <div
          className="absolute z-40 pointer-events-none transition-all duration-75 transform -translate-x-1/2 -translate-y-full mb-4"
          style={{ left: `${hoverTooltip.x}px`, top: `${hoverTooltip.y}px` }}
        >
          <div className="bg-[#080c14]/95 backdrop-blur-xl border border-cyan-500/40 rounded-xl p-3 shadow-2xl w-64 space-y-2 font-mono text-[10px] text-slate-100">
            <div className="flex items-center justify-between border-b border-cyan-500/20 pb-1.5 font-bold">
              <span className="text-cyan-300 truncate max-w-[140px] uppercase font-bold">{hoverTooltip.title}</span>
              <span className="text-[8px] px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 uppercase font-mono shrink-0">
                {hoverTooltip.dataStatus || 'SIMULATED'}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-1.5 text-[9.5px]">
              {hoverTooltip.category && (
                <div>
                  <span className="text-[8px] text-slate-400 block uppercase">CATEGORY</span>
                  <span className="text-rose-400 font-bold">{hoverTooltip.category}</span>
                </div>
              )}
              {hoverTooltip.maxWindKts !== undefined && hoverTooltip.maxWindKts !== null ? (
                <div className="text-right">
                  <span className="text-[8px] text-slate-400 block uppercase">MAX WIND</span>
                  <span className="text-cyan-300 font-bold">{hoverTooltip.maxWindKts} KTS</span>
                </div>
              ) : (
                <div className="text-right">
                  <span className="text-[8px] text-slate-400 block uppercase">MAX WIND</span>
                  <span className="text-slate-500 font-bold" title="WMO_WIND and NEWDELHI_WIND both blank for this point">
                    NOT OBSERVED
                  </span>
                </div>
              )}
              {hoverTooltip.centralPressureMb !== undefined && hoverTooltip.centralPressureMb !== null ? (
                <div>
                  <span className="text-[8px] text-slate-400 block uppercase">PRESSURE</span>
                  <span className="text-slate-200 font-bold">{hoverTooltip.centralPressureMb} MB</span>
                </div>
              ) : (
                <div>
                  <span className="text-[8px] text-slate-400 block uppercase">PRESSURE</span>
                  <span className="text-slate-500 font-bold" title="WMO_PRES and NEWDELHI_PRES both blank for this point">
                    NOT OBSERVED
                  </span>
                </div>
              )}
              {hoverTooltip.lat !== undefined && hoverTooltip.lon !== undefined && (
                <div className="text-right">
                  <span className="text-[8px] text-slate-400 block uppercase">COORDINATES</span>
                  <span className="text-amber-300 font-bold">{hoverTooltip.lat.toFixed(2)}°N, {hoverTooltip.lon.toFixed(2)}°E</span>
                </div>
              )}
            </div>

            <div className="border-t border-white/10 pt-1 text-[8.5px] text-slate-400 space-y-0.5">
              <div className="flex justify-between">
                <span>SOURCE:</span>
                <span className="text-slate-200 font-bold">{hoverTooltip.source || 'NOAA IBTrACS v04r01'}</span>
              </div>
              {hoverTooltip.timestamp && (
                <div className="flex justify-between">
                  <span>TIMESTAMP:</span>
                  <span className="text-cyan-300">{hoverTooltip.timestamp}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Scientific Flow Vector Particle Animation Canvas */}
      <FlowCanvasOverlay
        viewer={viewerInstance}
        showWind={showWind}
        showCurrents={showCurrents}
        currentField={currentField}
        currentFieldStatus={currentFieldStatus}
        cycloneLat={activePt?.latitude || 18.2}
        cycloneLon={activePt?.longitude || 88.4}
        maxWindKts={activePt?.maxWindKts ?? undefined}
        timestamp={activePt?.timestamp || '2026-09-08T12:00:00Z'}
      />

      {/* Section 11 & Section 7 Compact Data Context Legends (Corrected Source Label) */}
      {(showWind || showCurrents) && (
        <div className="absolute left-6 bottom-24 z-20 flex items-center gap-2 font-mono text-[9px] tracking-wider select-none pointer-events-none">
          {showWind && (
            <div className="px-2.5 py-1 rounded-xl bg-[#080c14]/90 backdrop-blur-xl border border-cyan-500/30 text-cyan-300 shadow-2xl flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
              <span className="font-bold">WIND FIELD</span>
              <span className="text-slate-500">│</span>
              <span className="text-slate-300">m/s</span>
              <span className="text-slate-500">│</span>
              <span className="text-amber-400 font-semibold">SURFACE WIND — SIMULATED VECTOR FIELD</span>
            </div>
          )}

          {showCurrents && (
            <div className="px-2.5 py-1 rounded-xl bg-[#080c14]/90 backdrop-blur-xl border border-teal-500/30 text-teal-300 shadow-2xl flex items-center gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full animate-pulse ${currentFieldStatus === 'UNAVAILABLE' ? 'bg-amber-400' : 'bg-teal-400'}`} />
              <span className="font-bold">OCEAN CURRENT</span>
              <span className="text-slate-500">│</span>
              <span className="text-slate-300">{(currentFieldMetadata?.units || currentField?.units || 'm/s')}</span>
              <span className="text-slate-500">│</span>
              {currentFieldStatus === 'REAL' && (
                <span className="text-emerald-400 font-semibold" title={currentFieldMetadata?.source || currentField?.source}>
                  REAL HYCOM CURRENT FIELD
                </span>
              )}
              {currentFieldStatus === 'SIMULATED' && (
                <span className="text-amber-400 font-semibold" title={currentFieldStatusReason || 'Analytical model (not HYCOM output)'}>
                  SIMULATED CURRENT FIELD
                </span>
              )}
              {currentFieldStatus === 'UNAVAILABLE' && (
                <span className="text-rose-400 font-semibold" title={currentFieldStatusReason || 'No valid HYCOM vectors for this selection'}>
                  CURRENT DATA UNAVAILABLE
                </span>
              )}
              {/* Timestamp / depth provenance: only what the data actually supports */}
              {currentFieldStatus !== 'UNAVAILABLE' && (
                <>
                  <span className="text-slate-500">│</span>
                  <span className="text-slate-300">
                    {currentFieldStatus === 'REAL' && currentFieldMetadata
                      ? `${(currentFieldMetadata.timestamp || '').replace('T', ' ').slice(0, 16)}`
                      : (currentField?.timestamp || '').replace('T', ' ').slice(0, 16)}
                  </span>
                  <span className="text-slate-500">│</span>
                  {currentFieldStatus === 'REAL' && currentFieldMetadata ? (
                    currentFieldMetadata.matched_depth_m === 0 ? (
                      <span className="text-cyan-300 font-semibold">SURFACE (0 m)</span>
                    ) : (
                      <span className="text-cyan-300 font-semibold" title={`Requested ${currentFieldMetadata.requested_depth_m} m — nearest native model level`}>
                        {currentFieldMetadata.matched_depth_m} m MODEL LEVEL
                      </span>
                    )
                  ) : (
                    <span className="text-cyan-300 font-semibold">SURFACE-ONLY</span>
                  )}
                  {currentFieldStatus === 'REAL' && currentFieldMetadata?.dataset_file && (
                    <>
                      <span className="text-slate-500">│</span>
                      <span
                        className="text-slate-400 truncate max-w-[150px]"
                        title={currentFieldMetadata.dataset_file}
                      >
                        {currentFieldMetadata.dataset_file.split('/').pop()}
                      </span>
                    </>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* HYCOM Model Depth Slice legend chip — always visually distinct from SURFACE layers */}
      {depthSliceVisible && depthSlicePayload && (
        <div className="absolute left-6 bottom-36 z-20 pointer-events-none">
          <div className="px-2.5 py-1 rounded-xl bg-[#080c14]/90 backdrop-blur-xl border border-indigo-500/40 text-indigo-300 shadow-2xl flex items-center gap-1.5 font-mono text-[9px] tracking-wider">
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
            <span className="font-bold">HYCOM MODEL DEPTH SLICE</span>
            <span className="text-slate-500">│</span>
            <span className="text-slate-200 font-semibold">{depthSlicePayload.variable.toUpperCase()}</span>
            <span className="text-slate-500">│</span>
            <span className="text-indigo-300 font-bold">{depthSlicePayload.matched_depth_m} m MODEL LEVEL</span>
            <span className="text-slate-500">│</span>
            <span className="text-slate-300">{depthSlicePayload.units}</span>
            {depthSliceRender && (
              <>
                <span className="text-slate-500">│</span>
                <span className="text-slate-300">{depthSliceRender.palette.label.toUpperCase()}</span>
                <span className="text-slate-500">│</span>
                <span className="text-slate-300 font-semibold">
                  {depthSliceRender.rangeMin.toFixed(2)}–{depthSliceRender.rangeMax.toFixed(2)} {depthSlicePayload.units}
                </span>
                <span className="text-slate-500">│</span>
                <span className={depthSliceRender.scale === 'log' ? 'text-amber-300 font-bold' : 'text-cyan-300 font-bold'}>
                  {depthSliceRender.scale === 'log' ? 'LOG' : 'LINEAR'}
                </span>
              </>
            )}
            <span className="text-slate-500">│</span>
            <span className="text-emerald-400 font-semibold">SUBSURFACE — NOT SURFACE</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default CesiumViewerInner;
