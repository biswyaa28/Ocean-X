'use client';

import React, { useEffect, useRef } from 'react';
import * as Cesium from 'cesium';
import { FlowParticle, EnvironmentalFlowField, CurrentFieldDataStatus } from '../types/flow';
import { generateBayOfBengalFlowField, sampleFlowVelocity } from '../services/FlowFieldProvider';
import { perfMonitor } from '../utils/perfMonitor';

/**
 * Centralized particle configuration for OCEAN-X scientific flow simulation.
 * Balances visual streamline density with main-thread frame budget.
 */
export const PARTICLE_CONFIG = {
  // Baseline count for smooth visual streams at 60 FPS
  WIND_PARTICLES: 1200,
  CURRENT_PARTICLES: 900,
  // Dynamic reduction when camera is actively moving/zooming
  CAMERA_MOVE_WIND_PARTICLES: 600,
  CAMERA_MOVE_CURRENT_PARTICLES: 450,
  WIND_MAX_TRAIL: 7,
  CURRENT_MAX_TRAIL: 9,
  CAMERA_MOVE_MAX_TRAIL: 3,
};

interface CachedFlowParticle extends FlowParticle {
  screenTrail: { x: number; y: number }[];
  cameraVersion: number;
}

interface FlowCanvasOverlayProps {
  viewer: Cesium.Viewer | null;
  showWind: boolean;
  showCurrents: boolean;
  /**
   * Real HYCOM UVEL/VVEL current field (Phase 1E), already normalized by
   * FlowFieldProvider. When null the existing intentional synthetic
   * fallback (clearly labelled SIMULATED) is used.
   */
  currentField?: EnvironmentalFlowField | null;
  /** Data status of the current field: drives the visible provenance. */
  currentFieldStatus?: CurrentFieldDataStatus;
  cycloneLat?: number;
  cycloneLon?: number;
  maxWindKts?: number;
  timestamp?: string;
}

export const FlowCanvasOverlay: React.FC<FlowCanvasOverlayProps> = ({
  viewer,
  showWind,
  showCurrents,
  currentField = null,
  currentFieldStatus = 'SIMULATED',
  cycloneLat = 18.2,
  cycloneLon = 88.4,
  maxWindKts = 125,
  timestamp = '2026-09-08T12:00:00Z',
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationFrameIdRef = useRef<number | null>(null);

  const windFieldRef = useRef<EnvironmentalFlowField | null>(null);
  const currentFieldRef = useRef<EnvironmentalFlowField | null>(null);

  // Bounds signature of the currently-seeded current field: particles are
  // re-seeded ONLY when the active field's geographic bounds change.
  const currentBoundsKeyRef = useRef<string>('');

  const windParticlesRef = useRef<CachedFlowParticle[]>([]);
  const currentParticlesRef = useRef<CachedFlowParticle[]>([]);

  // Camera interaction & projection cache invalidation tracking
  const isCameraMovingRef = useRef(false);
  const cameraVersionRef = useRef(1);
  const lastCameraPositionRef = useRef<Cesium.Cartesian3 | null>(null);

  // 1. Hook Cesium camera events for adaptive workload during interaction
  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return;

    const camera = viewer.camera;
    const onMoveStart = () => {
      isCameraMovingRef.current = true;
      cameraVersionRef.current++;
    };
    const onMoveEnd = () => {
      isCameraMovingRef.current = false;
      cameraVersionRef.current++;
    };

    camera.moveStart.addEventListener(onMoveStart);
    camera.moveEnd.addEventListener(onMoveEnd);

    return () => {
      if (!viewer.isDestroyed()) {
        camera.moveStart.removeEventListener(onMoveStart);
        camera.moveEnd.removeEventListener(onMoveEnd);
      }
    };
  }, [viewer]);

  // 2. Generate/Update Environmental Flow Fields on prop/timeline change
  // Real HYCOM UVEL/VVEL fields (Phase 1E) take priority for the current
  // layer; the labelled synthetic field remains the intentional fallback
  // when no real field is available. When the real field is UNAVAILABLE
  // (backend up but no valid vectors), the current layer renders nothing.
  useEffect(() => {
    if (showWind) {
      windFieldRef.current = generateBayOfBengalFlowField(
        'wind',
        cycloneLat,
        cycloneLon,
        maxWindKts,
        timestamp
      );
    } else {
      windFieldRef.current = null;
      windParticlesRef.current = [];
    }

    if (showCurrents) {
      if (currentField && currentFieldStatus === 'REAL') {
        // Real HYCOM field: use as-is (already normalized, values untouched).
        currentFieldRef.current = currentField;
      } else if (currentFieldStatus === 'UNAVAILABLE') {
        // Honest unavailable state: no current vectors are rendered at all —
        // neither real nor synthetic. Missing regions stay missing.
        currentFieldRef.current = null;
        currentParticlesRef.current = [];
      } else {
        // SIMULATED fallback (existing intentional behaviour, visibly labelled).
        currentFieldRef.current = generateBayOfBengalFlowField(
          'current',
          cycloneLat,
          cycloneLon,
          maxWindKts,
          timestamp
        );
      }
    } else {
      currentFieldRef.current = null;
      currentParticlesRef.current = [];
    }
  }, [showWind, showCurrents, currentField, currentFieldStatus, cycloneLat, cycloneLon, maxWindKts, timestamp]);

  // 3. Initialize Particles with Screen Projection Cache
  const initParticle = (
    bounds: { minLat: number; maxLat: number; minLon: number; maxLon: number },
    isWind: boolean
  ): CachedFlowParticle => {
    const lat = bounds.minLat + Math.random() * (bounds.maxLat - bounds.minLat);
    const lon = bounds.minLon + Math.random() * (bounds.maxLon - bounds.minLon);
    const maxAge = isWind ? 50 + Math.random() * 50 : 70 + Math.random() * 70;

    return {
      lat,
      lon,
      history: [{ lat, lon }],
      screenTrail: [],
      cameraVersion: 0,
      age: Math.floor(Math.random() * maxAge),
      maxAge,
      speed: 0,
    };
  };

  // 3b. Re-seed current particles when the ACTIVE field's spatial bounds
  // change (synthetic Bay grid -> real HYCOM grid, or a different HYCOM
  // geographic window). Equivalent fields (same bounds, new timestamp or
  // depth) keep their particles: velocities update smoothly with no re-seed
  // churn. Particles live in refs and the animation loop is untouched.
  useEffect(() => {
    const field = currentFieldRef.current;
    if (!field) return;
    const bounds = field.bounds;
    const key = `${bounds.minLat}|${bounds.maxLat}|${bounds.minLon}|${bounds.maxLon}`;
    if (key === currentBoundsKeyRef.current) return;
    currentBoundsKeyRef.current = key;
    const particles: CachedFlowParticle[] = [];
    for (let i = 0; i < PARTICLE_CONFIG.CURRENT_PARTICLES; i++) {
      particles.push(initParticle(bounds, false));
    }
    currentParticlesRef.current = particles;
  }, [currentField, currentFieldStatus, showCurrents]);

  // 4. Main High-Performance Animation Loop with Coordinate Caching
  useEffect(() => {
    if (!showWind && !showCurrents) {
      if (canvasRef.current) {
        const ctx = canvasRef.current.getContext('2d');
        if (ctx) ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      }
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    // Handle canvas resizing
    const updateCanvasSize = () => {
      if (!canvas) return;
      const width = canvas.parentElement?.clientWidth || window.innerWidth;
      const height = canvas.parentElement?.clientHeight || window.innerHeight;
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        cameraVersionRef.current++; // Invalidate screen cache on canvas resize
      }
    };
    updateCanvasSize();

    // Populate particles with configured budget
    if (showWind && windFieldRef.current && windParticlesRef.current.length === 0) {
      const b = windFieldRef.current.bounds;
      const count = PARTICLE_CONFIG.WIND_PARTICLES;
      const particles: CachedFlowParticle[] = [];
      for (let i = 0; i < count; i++) {
        particles.push(initParticle(b, true));
      }
      windParticlesRef.current = particles;
    }

    if (showCurrents && currentFieldRef.current && currentParticlesRef.current.length === 0) {
      const b = currentFieldRef.current.bounds;
      const count = PARTICLE_CONFIG.CURRENT_PARTICLES;
      const particles: CachedFlowParticle[] = [];
      for (let i = 0; i < count; i++) {
        particles.push(initParticle(b, false));
      }
      currentParticlesRef.current = particles;
    }

    // Reusable Cartesian scratch object to avoid per-frame GC allocations
    const scratchCartesian = new Cesium.Cartesian3();

    const renderFrame = () => {
      const frameStartTime = performance.now();
      updateCanvasSize();

      // Clear canvas with subtle trail fade for silky continuous streams
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = 'rgba(0, 0, 0, 0.16)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.restore();

      if (!viewer || viewer.isDestroyed()) {
        animationFrameIdRef.current = requestAnimationFrame(renderFrame);
        return;
      }

      const scene = viewer.scene;
      const camera = viewer.camera;

      // Invalidate the screen-space projection cache whenever the camera is
      // actively moving (pan/zoom/rotate) or its world position changed since
      // the last frame. During active motion every frame is re-projected — the
      // reduced particle budget keeps that affordable — so trails never lag the
      // globe. When the camera is static the cache stays valid (head-only work).
      const isCameraMoving = isCameraMovingRef.current;
      if (!lastCameraPositionRef.current) {
        lastCameraPositionRef.current = Cesium.Cartesian3.clone(camera.positionWC);
      } else if (isCameraMoving || !Cesium.Cartesian3.equalsEpsilon(lastCameraPositionRef.current, camera.positionWC, 0.0, 1.0)) {
        Cesium.Cartesian3.clone(camera.positionWC, lastCameraPositionRef.current);
        cameraVersionRef.current++;
      }

      const currentCameraVersion = cameraVersionRef.current;

      // Single projected coordinate converter using scratch cartesian
      const projectToPixel = (lat: number, lon: number): { x: number; y: number } | null => {
        try {
          Cesium.Cartesian3.fromDegrees(lon, lat, 0, Cesium.Ellipsoid.WGS84, scratchCartesian);
          const pixel = Cesium.SceneTransforms.worldToWindowCoordinates(scene, scratchCartesian);
          if (
            pixel &&
            pixel.x >= -100 &&
            pixel.x <= canvas.width + 100 &&
            pixel.y >= -100 &&
            pixel.y <= canvas.height + 100
          ) {
            return { x: pixel.x, y: pixel.y };
          }
        } catch {
          return null;
        }
        return null;
      };

      let transformsSaved = 0;
      let totalActiveRendered = 0;

      // --- 1. RENDER WIND FLOW STREAMLINES ---
      if (showWind && windFieldRef.current) {
        const field = windFieldRef.current;
        const particles = windParticlesRef.current;
        // Adaptive budget: during fast camera motion, reduce active count & trail length
        const activeCount = isCameraMoving
          ? Math.min(particles.length, PARTICLE_CONFIG.CAMERA_MOVE_WIND_PARTICLES)
          : particles.length;
        const maxTrailLength = isCameraMoving
          ? PARTICLE_CONFIG.CAMERA_MOVE_MAX_TRAIL
          : PARTICLE_CONFIG.WIND_MAX_TRAIL;

        totalActiveRendered += activeCount;

        for (let i = 0; i < activeCount; i++) {
          const p = particles[i];

          // Sample velocity at particle position
          const vel = sampleFlowVelocity(field, p.lat, p.lon);
          p.speed = vel.speed;

          // Push current location to history trail
          p.history.unshift({ lat: p.lat, lon: p.lon });
          if (p.history.length > maxTrailLength) {
            p.history.pop();
          }

          // RK2 Advection step for smooth curvature around cyclone eye
          const scale = 0.00075;
          const k1_lat = vel.v * scale;
          const k1_lon = vel.u * scale;

          const mid_lat = p.lat + k1_lat * 0.5;
          const mid_lon = p.lon + k1_lon * 0.5;
          const mid_vel = sampleFlowVelocity(field, mid_lat, mid_lon);

          p.lat += mid_vel.v * scale;
          p.lon += mid_vel.u * scale;
          p.age++;

          // Check boundary / lifetime respawn
          if (
            p.age >= p.maxAge ||
            p.lat < field.bounds.minLat ||
            p.lat > field.bounds.maxLat ||
            p.lon < field.bounds.minLon ||
            p.lon > field.bounds.maxLon ||
            vel.speed < 0.1
          ) {
            particles[i] = initParticle(field.bounds, true);
            continue;
          }

          // Screen-space trail projection with caching
          const newHeadScreen = projectToPixel(p.lat, p.lon);
          if (!newHeadScreen) {
            p.screenTrail = [];
            continue;
          }

          if (p.cameraVersion === currentCameraVersion && p.screenTrail.length > 0) {
            // Camera hasn't moved: reuse existing screen points and prepend new head
            p.screenTrail.unshift(newHeadScreen);
            if (p.screenTrail.length > maxTrailLength) {
              p.screenTrail.pop();
            }
            transformsSaved += Math.max(0, p.screenTrail.length - 1);
          } else {
            // Camera moved or new particle: re-project history
            const pts: { x: number; y: number }[] = [newHeadScreen];
            for (let k = 0; k < p.history.length && pts.length < maxTrailLength; k++) {
              const pt = projectToPixel(p.history[k].lat, p.history[k].lon);
              if (pt) pts.push(pt);
              else break;
            }
            p.screenTrail = pts;
            p.cameraVersion = currentCameraVersion;
          }

          const screenPoints = p.screenTrail;
          if (screenPoints.length >= 2) {
            // Particle lifecycle alpha fade curve
            const alphaProgress = p.age / p.maxAge;
            const alpha =
              alphaProgress < 0.15
                ? alphaProgress / 0.15
                : alphaProgress > 0.85
                ? (1 - alphaProgress) / 0.15
                : 1.0;

            const speedRatio = Math.min(vel.speed / 35, 1.0);
            ctx.lineWidth = 1.0 + speedRatio * 1.4;

            const r = Math.round(200 + 55 * speedRatio);
            const g = Math.round(235 + 20 * speedRatio);
            const b = 255;

            ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${(alpha * 0.75).toFixed(2)})`;
            ctx.beginPath();
            ctx.moveTo(screenPoints[0].x, screenPoints[0].y);
            for (let k = 1; k < screenPoints.length; k++) {
              ctx.lineTo(screenPoints[k].x, screenPoints[k].y);
            }
            ctx.stroke();
          }
        }
      }

      // --- 2. RENDER OCEAN CURRENT FLOW STREAMLINES ---
      if (showCurrents && currentFieldRef.current) {
        const field = currentFieldRef.current;
        const particles = currentParticlesRef.current;
        const activeCount = isCameraMoving
          ? Math.min(particles.length, PARTICLE_CONFIG.CAMERA_MOVE_CURRENT_PARTICLES)
          : particles.length;
        const maxTrailLength = isCameraMoving
          ? PARTICLE_CONFIG.CAMERA_MOVE_MAX_TRAIL
          : PARTICLE_CONFIG.CURRENT_MAX_TRAIL;

        totalActiveRendered += activeCount;

        for (let i = 0; i < activeCount; i++) {
          const p = particles[i];

          const vel = sampleFlowVelocity(field, p.lat, p.lon);
          p.speed = vel.speed;

          p.history.unshift({ lat: p.lat, lon: p.lon });
          if (p.history.length > maxTrailLength) {
            p.history.pop();
          }

          const scale = 0.0005;
          const k1_lat = vel.v * scale;
          const k1_lon = vel.u * scale;

          const mid_lat = p.lat + k1_lat * 0.5;
          const mid_lon = p.lon + k1_lon * 0.5;
          const mid_vel = sampleFlowVelocity(field, mid_lat, mid_lon);

          p.lat += mid_vel.v * scale;
          p.lon += mid_vel.u * scale;
          p.age++;

          if (
            p.age >= p.maxAge ||
            p.lat < field.bounds.minLat ||
            p.lat > field.bounds.maxLat ||
            p.lon < field.bounds.minLon ||
            p.lon > field.bounds.maxLon ||
            vel.speed < 0.04
          ) {
            particles[i] = initParticle(field.bounds, false);
            continue;
          }

          const newHeadScreen = projectToPixel(p.lat, p.lon);
          if (!newHeadScreen) {
            p.screenTrail = [];
            continue;
          }

          if (p.cameraVersion === currentCameraVersion && p.screenTrail.length > 0) {
            p.screenTrail.unshift(newHeadScreen);
            if (p.screenTrail.length > maxTrailLength) {
              p.screenTrail.pop();
            }
            transformsSaved += Math.max(0, p.screenTrail.length - 1);
          } else {
            const pts: { x: number; y: number }[] = [newHeadScreen];
            for (let k = 0; k < p.history.length && pts.length < maxTrailLength; k++) {
              const pt = projectToPixel(p.history[k].lat, p.history[k].lon);
              if (pt) pts.push(pt);
              else break;
            }
            p.screenTrail = pts;
            p.cameraVersion = currentCameraVersion;
          }

          const screenPoints = p.screenTrail;
          if (screenPoints.length >= 2) {
            const alphaProgress = p.age / p.maxAge;
            const alpha =
              alphaProgress < 0.15
                ? alphaProgress / 0.15
                : alphaProgress > 0.85
                ? (1 - alphaProgress) / 0.15
                : 0.9;

            // Display-only color mapping: real HYCOM current magnitudes
            // (typically 0.05-1.5 m/s) use a finer scale than the synthetic
            // fallback (up to ~3 m/s) so real fields stay visually readable.
            // This maps color only — the scientific values are untouched.
            const speedReference = field.status === 'REAL' ? 1.5 : 3.0;
            const speedRatio = Math.min(vel.speed / speedReference, 1.0);
            ctx.lineWidth = 1.4 + speedRatio * 1.4;

            ctx.strokeStyle = `rgba(20, 184, 166, ${(alpha * 0.65).toFixed(2)})`;
            ctx.beginPath();
            ctx.moveTo(screenPoints[0].x, screenPoints[0].y);
            for (let k = 1; k < screenPoints.length; k++) {
              ctx.lineTo(screenPoints[k].x, screenPoints[k].y);
            }
            ctx.stroke();
          }
        }
      }

      const frameDuration = performance.now() - frameStartTime;
      perfMonitor.recordParticleFrame(frameDuration, totalActiveRendered, transformsSaved);

      animationFrameIdRef.current = requestAnimationFrame(renderFrame);
    };

    animationFrameIdRef.current = requestAnimationFrame(renderFrame);

    return () => {
      if (animationFrameIdRef.current) {
        cancelAnimationFrame(animationFrameIdRef.current);
      }
    };
  }, [showWind, showCurrents, viewer]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-none z-10"
    />
  );
};
