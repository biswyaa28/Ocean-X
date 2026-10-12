"use client";

import React, { useEffect, useRef } from "react";
import Cesium from "../lib/cesiumRuntime";
// Type-only namespace import: fully erased at compile time, so Cesium is never bundled.
import type * as CesiumTypes from 'cesium';
import { EnvironmentalFlowField, CurrentFieldDataStatus } from "../types/flow";
import {
  generateBayOfBengalFlowField,
  sampleFlowVelocity,
  FlowVelocityResult,
} from "../services/FlowFieldProvider";
import { perfMonitor } from "../utils/perfMonitor";

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

const MAX_TRAIL_CAPACITY = 16;
const NUM_SPEED_BUCKETS = 8;
const NUM_ALPHA_BUCKETS = 4;
const TOTAL_BUCKETS = NUM_SPEED_BUCKETS * NUM_ALPHA_BUCKETS; // 32
const MAX_PARTICLES = Math.max(
  PARTICLE_CONFIG.WIND_PARTICLES,
  PARTICLE_CONFIG.CURRENT_PARTICLES
);

interface BucketStyle {
  strokeStyle: string;
  lineWidth: number;
}

// Precompute Wind bucket styles (8 speed buckets x 4 alpha levels)
const WIND_BUCKET_STYLES: BucketStyle[] = [];
for (let s = 0; s < NUM_SPEED_BUCKETS; s++) {
  const speedRatio = (s + 0.5) / NUM_SPEED_BUCKETS;
  const lineWidth = 1.0 + speedRatio * 1.4;
  const r = Math.round(200 + 55 * speedRatio);
  const g = Math.round(235 + 20 * speedRatio);
  const b = 255;
  for (let a = 0; a < NUM_ALPHA_BUCKETS; a++) {
    const alphaVal = (a + 0.5) / NUM_ALPHA_BUCKETS;
    const alpha = (alphaVal * 0.75).toFixed(2);
    WIND_BUCKET_STYLES.push({
      strokeStyle: `rgba(${r}, ${g}, ${b}, ${alpha})`,
      lineWidth,
    });
  }
}

// Precompute Current bucket styles (8 speed buckets x 4 alpha levels)
const CURRENT_BUCKET_STYLES: BucketStyle[] = [];
for (let s = 0; s < NUM_SPEED_BUCKETS; s++) {
  const speedRatio = (s + 0.5) / NUM_SPEED_BUCKETS;
  const lineWidth = 1.4 + speedRatio * 1.4;
  for (let a = 0; a < NUM_ALPHA_BUCKETS; a++) {
    const alphaVal = (a + 0.5) / NUM_ALPHA_BUCKETS;
    const alpha = (alphaVal * 0.65).toFixed(2);
    CURRENT_BUCKET_STYLES.push({
      strokeStyle: `rgba(20, 184, 166, ${alpha})`,
      lineWidth,
    });
  }
}

interface ParticleBuffers {
  capacity: number;
  lat: Float32Array;
  lon: Float32Array;
  age: Float32Array;
  maxAge: Float32Array;
  speed: Float32Array;
  cameraVersion: Uint32Array;
  historyHead: Uint8Array;
  historyLen: Uint8Array;
  historyLat: Float32Array;
  historyLon: Float32Array;
  screenHead: Uint8Array;
  screenLen: Uint8Array;
  screenX: Float32Array;
  screenY: Float32Array;
}

function allocateParticleBuffers(capacity: number): ParticleBuffers {
  return {
    capacity,
    lat: new Float32Array(capacity),
    lon: new Float32Array(capacity),
    age: new Float32Array(capacity),
    maxAge: new Float32Array(capacity),
    speed: new Float32Array(capacity),
    cameraVersion: new Uint32Array(capacity),
    historyHead: new Uint8Array(capacity),
    historyLen: new Uint8Array(capacity),
    historyLat: new Float32Array(capacity * MAX_TRAIL_CAPACITY),
    historyLon: new Float32Array(capacity * MAX_TRAIL_CAPACITY),
    screenHead: new Uint8Array(capacity),
    screenLen: new Uint8Array(capacity),
    screenX: new Float32Array(capacity * MAX_TRAIL_CAPACITY),
    screenY: new Float32Array(capacity * MAX_TRAIL_CAPACITY),
  };
}

function initParticleState(
  buffers: ParticleBuffers,
  i: number,
  bounds: { minLat: number; maxLat: number; minLon: number; maxLon: number },
  isWind: boolean
) {
  const lat = bounds.minLat + Math.random() * (bounds.maxLat - bounds.minLat);
  const lon = bounds.minLon + Math.random() * (bounds.maxLon - bounds.minLon);
  const maxAge = isWind ? 50 + Math.random() * 50 : 70 + Math.random() * 70;
  const age = Math.floor(Math.random() * maxAge);

  buffers.lat[i] = lat;
  buffers.lon[i] = lon;
  buffers.age[i] = age;
  buffers.maxAge[i] = maxAge;
  buffers.speed[i] = 0;
  buffers.cameraVersion[i] = 0;

  buffers.historyHead[i] = 0;
  buffers.historyLen[i] = 1;
  const base = i * MAX_TRAIL_CAPACITY;
  buffers.historyLat[base] = lat;
  buffers.historyLon[base] = lon;

  buffers.screenHead[i] = 0;
  buffers.screenLen[i] = 0;
}

interface FlowCanvasOverlayProps {
  viewer: CesiumTypes.Viewer | null;
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
  currentFieldStatus = "SIMULATED",
  cycloneLat = 18.2,
  cycloneLon = 88.4,
  maxWindKts = 125,
  timestamp = "2026-09-08T12:00:00Z",
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationFrameIdRef = useRef<number | null>(null);

  const windFieldRef = useRef<EnvironmentalFlowField | null>(null);
  const currentFieldRef = useRef<EnvironmentalFlowField | null>(null);

  // Bounds signature of the currently-seeded current field
  const currentBoundsKeyRef = useRef<string>("");

  const windBuffersRef = useRef<ParticleBuffers>(
    allocateParticleBuffers(PARTICLE_CONFIG.WIND_PARTICLES)
  );
  const currentBuffersRef = useRef<ParticleBuffers>(
    allocateParticleBuffers(PARTICLE_CONFIG.CURRENT_PARTICLES)
  );
  const windInitializedRef = useRef(false);
  const currentInitializedRef = useRef(false);

  // Camera interaction & projection cache invalidation tracking
  const isCameraMovingRef = useRef(false);
  const cameraVersionRef = useRef(1);
  const lastCameraPositionRef = useRef<CesiumTypes.Cartesian3 | null>(null);

  // 1. Hook Cesium camera events for adaptive workload during interaction
  //
  // Phase 2B note: this overlay owns its own requestAnimationFrame loop and
  // draws into an independent 2D canvas, so it never needs a Cesium frame —
  // and it must NOT call scene.requestRender() per frame (that would defeat
  // requestRenderMode). Screen projection below uses the live camera through
  // SceneTransforms, which is pure math and independent of Cesium rendering,
  // so the particles stay correctly positioned while Cesium is idle.
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
  useEffect(() => {
    if (showWind) {
      windFieldRef.current = generateBayOfBengalFlowField(
        "wind",
        cycloneLat,
        cycloneLon,
        maxWindKts,
        timestamp
      );
    } else {
      windFieldRef.current = null;
      windInitializedRef.current = false;
    }

    if (showCurrents) {
      if (currentField && currentFieldStatus === "REAL") {
        currentFieldRef.current = currentField;
      } else if (currentFieldStatus === "UNAVAILABLE") {
        currentFieldRef.current = null;
        currentInitializedRef.current = false;
      } else {
        currentFieldRef.current = generateBayOfBengalFlowField(
          "current",
          cycloneLat,
          cycloneLon,
          maxWindKts,
          timestamp
        );
      }
    } else {
      currentFieldRef.current = null;
      currentInitializedRef.current = false;
    }
  }, [
    showWind,
    showCurrents,
    currentField,
    currentFieldStatus,
    cycloneLat,
    cycloneLon,
    maxWindKts,
    timestamp,
  ]);

  // 3. Re-seed current particles when active field spatial bounds change
  useEffect(() => {
    const field = currentFieldRef.current;
    if (!field) return;
    const bounds = field.bounds;
    const key = `${bounds.minLat}|${bounds.maxLat}|${bounds.minLon}|${bounds.maxLon}`;
    if (key === currentBoundsKeyRef.current) return;
    currentBoundsKeyRef.current = key;

    const buffers = currentBuffersRef.current;
    for (let i = 0; i < PARTICLE_CONFIG.CURRENT_PARTICLES; i++) {
      initParticleState(buffers, i, bounds, false);
    }
    currentInitializedRef.current = true;
  }, [currentField, currentFieldStatus, showCurrents]);

  // 4. Main High-Performance Animation Loop
  useEffect(() => {
    if (!showWind && !showCurrents) {
      if (canvasRef.current) {
        const ctx = canvasRef.current.getContext("2d");
        if (ctx)
          ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      }
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    const updateCanvasSize = () => {
      if (!canvas) return;
      const width = canvas.parentElement?.clientWidth || window.innerWidth;
      const height = canvas.parentElement?.clientHeight || window.innerHeight;
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        cameraVersionRef.current++;
      }
    };
    updateCanvasSize();

    // Initialize particles once if needed
    if (showWind && windFieldRef.current && !windInitializedRef.current) {
      const b = windFieldRef.current.bounds;
      const count = PARTICLE_CONFIG.WIND_PARTICLES;
      const buffers = windBuffersRef.current;
      for (let i = 0; i < count; i++) {
        initParticleState(buffers, i, b, true);
      }
      windInitializedRef.current = true;
    }

    if (showCurrents && currentFieldRef.current && !currentInitializedRef.current) {
      const b = currentFieldRef.current.bounds;
      const count = PARTICLE_CONFIG.CURRENT_PARTICLES;
      const buffers = currentBuffersRef.current;
      for (let i = 0; i < count; i++) {
        initParticleState(buffers, i, b, false);
      }
      currentInitializedRef.current = true;
    }

    // Preallocated scratch variables for zero-allocation frame loop
    const scratchCartesian = new Cesium.Cartesian3();
    const scratchPixel = new Cesium.Cartesian2();
    const scratchVel1: FlowVelocityResult = { u: 0, v: 0, speed: 0 };
    const scratchVel2: FlowVelocityResult = { u: 0, v: 0, speed: 0 };
    const tempProjX = new Float32Array(MAX_TRAIL_CAPACITY);
    const tempProjY = new Float32Array(MAX_TRAIL_CAPACITY);

    const bucketCounts = new Int32Array(TOTAL_BUCKETS);
    const bucketParticles = new Int32Array(TOTAL_BUCKETS * MAX_PARTICLES);

    const renderFrame = () => {
      const frameStartTime = performance.now();
      updateCanvasSize();

      // Clear canvas with subtle trail fade
      ctx.save();
      ctx.globalCompositeOperation = "destination-out";
      ctx.fillStyle = "rgba(0, 0, 0, 0.16)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.restore();

      if (!viewer || viewer.isDestroyed()) {
        animationFrameIdRef.current = requestAnimationFrame(renderFrame);
        return;
      }

      const scene = viewer.scene;
      const camera = viewer.camera;

      const isCameraMoving = isCameraMovingRef.current;
      if (!lastCameraPositionRef.current) {
        lastCameraPositionRef.current = Cesium.Cartesian3.clone(camera.positionWC);
      } else if (
        isCameraMoving ||
        !Cesium.Cartesian3.equalsEpsilon(
          lastCameraPositionRef.current,
          camera.positionWC,
          0.0,
          1.0
        )
      ) {
        Cesium.Cartesian3.clone(camera.positionWC, lastCameraPositionRef.current);
        cameraVersionRef.current++;
      }

      const currentCameraVersion = cameraVersionRef.current;

      const projectToPixel = (
        lat: number,
        lon: number
      ): CesiumTypes.Cartesian2 | null => {
        try {
          Cesium.Cartesian3.fromDegrees(
            lon,
            lat,
            0,
            Cesium.Ellipsoid.WGS84,
            scratchCartesian
          );
          const pixel = Cesium.SceneTransforms.worldToWindowCoordinates(
            scene,
            scratchCartesian,
            scratchPixel
          );
          if (
            pixel &&
            pixel.x >= -100 &&
            pixel.x <= canvas.width + 100 &&
            pixel.y >= -100 &&
            pixel.y <= canvas.height + 100
          ) {
            return pixel;
          }
        } catch {
          return null;
        }
        return null;
      };

      let transformsSaved = 0;
      let totalActiveRendered = 0;
      let totalStrokeCalls = 0;

      const simStartTime = performance.now();

      // --- 1. SIMULATE & DRAW WIND PARTICLES ---
      if (showWind && windFieldRef.current && windInitializedRef.current) {
        const field = windFieldRef.current;
        const buffers = windBuffersRef.current;
        const activeCount = isCameraMoving
          ? Math.min(PARTICLE_CONFIG.WIND_PARTICLES, PARTICLE_CONFIG.CAMERA_MOVE_WIND_PARTICLES)
          : PARTICLE_CONFIG.WIND_PARTICLES;
        const maxTrailLength = isCameraMoving
          ? PARTICLE_CONFIG.CAMERA_MOVE_MAX_TRAIL
          : PARTICLE_CONFIG.WIND_MAX_TRAIL;

        totalActiveRendered += activeCount;
        bucketCounts.fill(0);

        for (let i = 0; i < activeCount; i++) {
          sampleFlowVelocity(field, buffers.lat[i], buffers.lon[i], scratchVel1);
          const speed = scratchVel1.speed;
          buffers.speed[i] = speed;

          const base = i * MAX_TRAIL_CAPACITY;
          const hHead = buffers.historyHead[i];
          const nextHHead = (hHead + 1) % MAX_TRAIL_CAPACITY;
          buffers.historyLat[base + nextHHead] = buffers.lat[i];
          buffers.historyLon[base + nextHHead] = buffers.lon[i];
          buffers.historyHead[i] = nextHHead;
          if (buffers.historyLen[i] < maxTrailLength) {
            buffers.historyLen[i]++;
          } else if (buffers.historyLen[i] > maxTrailLength) {
            buffers.historyLen[i] = maxTrailLength;
          }

          // RK2 Advection
          const scale = 0.00075;
          const k1_lat = scratchVel1.v * scale;
          const k1_lon = scratchVel1.u * scale;

          const mid_lat = buffers.lat[i] + k1_lat * 0.5;
          const mid_lon = buffers.lon[i] + k1_lon * 0.5;
          sampleFlowVelocity(field, mid_lat, mid_lon, scratchVel2);

          buffers.lat[i] += scratchVel2.v * scale;
          buffers.lon[i] += scratchVel2.u * scale;
          buffers.age[i]++;

          if (
            buffers.age[i] >= buffers.maxAge[i] ||
            buffers.lat[i] < field.bounds.minLat ||
            buffers.lat[i] > field.bounds.maxLat ||
            buffers.lon[i] < field.bounds.minLon ||
            buffers.lon[i] > field.bounds.maxLon ||
            speed < 0.1
          ) {
            initParticleState(buffers, i, field.bounds, true);
            continue;
          }

          // Screen coordinate projection with caching
          if (
            buffers.cameraVersion[i] === currentCameraVersion &&
            buffers.screenLen[i] > 0
          ) {
            const headPixel = projectToPixel(buffers.lat[i], buffers.lon[i]);
            if (!headPixel) {
              buffers.screenLen[i] = 0;
              continue;
            }
            const sHead = buffers.screenHead[i];
            const nextSHead = (sHead + 1) % MAX_TRAIL_CAPACITY;
            buffers.screenX[base + nextSHead] = headPixel.x;
            buffers.screenY[base + nextSHead] = headPixel.y;
            buffers.screenHead[i] = nextSHead;
            if (buffers.screenLen[i] < maxTrailLength) {
              buffers.screenLen[i]++;
            } else if (buffers.screenLen[i] > maxTrailLength) {
              buffers.screenLen[i] = maxTrailLength;
            }
            transformsSaved += Math.max(0, buffers.screenLen[i] - 1);
          } else {
            const headPixel = projectToPixel(buffers.lat[i], buffers.lon[i]);
            if (!headPixel) {
              buffers.screenLen[i] = 0;
              continue;
            }
            tempProjX[0] = headPixel.x;
            tempProjY[0] = headPixel.y;
            let count = 1;

            const curHHead = buffers.historyHead[i];
            const hLen = Math.min(buffers.historyLen[i], maxTrailLength);

            for (let k = 0; k < hLen && count < maxTrailLength; k++) {
              const hIdx = (curHHead - k + MAX_TRAIL_CAPACITY) % MAX_TRAIL_CAPACITY;
              const pt = projectToPixel(
                buffers.historyLat[base + hIdx],
                buffers.historyLon[base + hIdx]
              );
              if (pt) {
                tempProjX[count] = pt.x;
                tempProjY[count] = pt.y;
                count++;
              } else {
                break;
              }
            }

            for (let j = 0; j < count; j++) {
              buffers.screenX[base + j] = tempProjX[count - 1 - j];
              buffers.screenY[base + j] = tempProjY[count - 1 - j];
            }
            buffers.screenHead[i] = count - 1;
            buffers.screenLen[i] = count;
            buffers.cameraVersion[i] = currentCameraVersion;
          }

          if (buffers.screenLen[i] >= 2) {
            const alphaProgress = buffers.age[i] / buffers.maxAge[i];
            const alpha =
              alphaProgress < 0.15
                ? alphaProgress / 0.15
                : alphaProgress > 0.85
                ? (1 - alphaProgress) / 0.15
                : 1.0;

            const speedRatio = Math.min(speed / 35, 1.0);
            const sBucket = Math.min(
              NUM_SPEED_BUCKETS - 1,
              Math.floor(speedRatio * NUM_SPEED_BUCKETS)
            );
            const aBucket = Math.min(
              NUM_ALPHA_BUCKETS - 1,
              Math.floor(alpha * NUM_ALPHA_BUCKETS)
            );
            const bIdx = sBucket * NUM_ALPHA_BUCKETS + aBucket;

            const bCount = bucketCounts[bIdx]++;
            bucketParticles[bIdx * MAX_PARTICLES + bCount] = i;
          }
        }

        // Draw batched wind buckets
        for (let b = 0; b < TOTAL_BUCKETS; b++) {
          const count = bucketCounts[b];
          if (count === 0) continue;

          const style = WIND_BUCKET_STYLES[b];
          ctx.strokeStyle = style.strokeStyle;
          ctx.lineWidth = style.lineWidth;
          ctx.beginPath();

          for (let c = 0; c < count; c++) {
            const pIdx = bucketParticles[b * MAX_PARTICLES + c];
            const sLen = buffers.screenLen[pIdx];
            const base = pIdx * MAX_TRAIL_CAPACITY;
            const sHead = buffers.screenHead[pIdx];

            const idx0 = (sHead + MAX_TRAIL_CAPACITY) % MAX_TRAIL_CAPACITY;
            ctx.moveTo(buffers.screenX[base + idx0], buffers.screenY[base + idx0]);
            for (let k = 1; k < sLen; k++) {
              const idxK = (sHead - k + MAX_TRAIL_CAPACITY) % MAX_TRAIL_CAPACITY;
              ctx.lineTo(buffers.screenX[base + idxK], buffers.screenY[base + idxK]);
            }
          }

          ctx.stroke();
          totalStrokeCalls++;
        }
      }

      // --- 2. SIMULATE & DRAW CURRENT PARTICLES ---
      if (showCurrents && currentFieldRef.current && currentInitializedRef.current) {
        const field = currentFieldRef.current;
        const buffers = currentBuffersRef.current;
        const activeCount = isCameraMoving
          ? Math.min(PARTICLE_CONFIG.CURRENT_PARTICLES, PARTICLE_CONFIG.CAMERA_MOVE_CURRENT_PARTICLES)
          : PARTICLE_CONFIG.CURRENT_PARTICLES;
        const maxTrailLength = isCameraMoving
          ? PARTICLE_CONFIG.CAMERA_MOVE_MAX_TRAIL
          : PARTICLE_CONFIG.CURRENT_MAX_TRAIL;

        totalActiveRendered += activeCount;
        bucketCounts.fill(0);

        for (let i = 0; i < activeCount; i++) {
          sampleFlowVelocity(field, buffers.lat[i], buffers.lon[i], scratchVel1);
          const speed = scratchVel1.speed;
          buffers.speed[i] = speed;

          const base = i * MAX_TRAIL_CAPACITY;
          const hHead = buffers.historyHead[i];
          const nextHHead = (hHead + 1) % MAX_TRAIL_CAPACITY;
          buffers.historyLat[base + nextHHead] = buffers.lat[i];
          buffers.historyLon[base + nextHHead] = buffers.lon[i];
          buffers.historyHead[i] = nextHHead;
          if (buffers.historyLen[i] < maxTrailLength) {
            buffers.historyLen[i]++;
          } else if (buffers.historyLen[i] > maxTrailLength) {
            buffers.historyLen[i] = maxTrailLength;
          }

          const scale = 0.0005;
          const k1_lat = scratchVel1.v * scale;
          const k1_lon = scratchVel1.u * scale;

          const mid_lat = buffers.lat[i] + k1_lat * 0.5;
          const mid_lon = buffers.lon[i] + k1_lon * 0.5;
          sampleFlowVelocity(field, mid_lat, mid_lon, scratchVel2);

          buffers.lat[i] += scratchVel2.v * scale;
          buffers.lon[i] += scratchVel2.u * scale;
          buffers.age[i]++;

          if (
            buffers.age[i] >= buffers.maxAge[i] ||
            buffers.lat[i] < field.bounds.minLat ||
            buffers.lat[i] > field.bounds.maxLat ||
            buffers.lon[i] < field.bounds.minLon ||
            buffers.lon[i] > field.bounds.maxLon ||
            speed < 0.04
          ) {
            initParticleState(buffers, i, field.bounds, false);
            continue;
          }

          if (
            buffers.cameraVersion[i] === currentCameraVersion &&
            buffers.screenLen[i] > 0
          ) {
            const headPixel = projectToPixel(buffers.lat[i], buffers.lon[i]);
            if (!headPixel) {
              buffers.screenLen[i] = 0;
              continue;
            }
            const sHead = buffers.screenHead[i];
            const nextSHead = (sHead + 1) % MAX_TRAIL_CAPACITY;
            buffers.screenX[base + nextSHead] = headPixel.x;
            buffers.screenY[base + nextSHead] = headPixel.y;
            buffers.screenHead[i] = nextSHead;
            if (buffers.screenLen[i] < maxTrailLength) {
              buffers.screenLen[i]++;
            } else if (buffers.screenLen[i] > maxTrailLength) {
              buffers.screenLen[i] = maxTrailLength;
            }
            transformsSaved += Math.max(0, buffers.screenLen[i] - 1);
          } else {
            const headPixel = projectToPixel(buffers.lat[i], buffers.lon[i]);
            if (!headPixel) {
              buffers.screenLen[i] = 0;
              continue;
            }
            tempProjX[0] = headPixel.x;
            tempProjY[0] = headPixel.y;
            let count = 1;

            const curHHead = buffers.historyHead[i];
            const hLen = Math.min(buffers.historyLen[i], maxTrailLength);

            for (let k = 0; k < hLen && count < maxTrailLength; k++) {
              const hIdx = (curHHead - k + MAX_TRAIL_CAPACITY) % MAX_TRAIL_CAPACITY;
              const pt = projectToPixel(
                buffers.historyLat[base + hIdx],
                buffers.historyLon[base + hIdx]
              );
              if (pt) {
                tempProjX[count] = pt.x;
                tempProjY[count] = pt.y;
                count++;
              } else {
                break;
              }
            }

            for (let j = 0; j < count; j++) {
              buffers.screenX[base + j] = tempProjX[count - 1 - j];
              buffers.screenY[base + j] = tempProjY[count - 1 - j];
            }
            buffers.screenHead[i] = count - 1;
            buffers.screenLen[i] = count;
            buffers.cameraVersion[i] = currentCameraVersion;
          }

          if (buffers.screenLen[i] >= 2) {
            const alphaProgress = buffers.age[i] / buffers.maxAge[i];
            const alpha =
              alphaProgress < 0.15
                ? alphaProgress / 0.15
                : alphaProgress > 0.85
                ? (1 - alphaProgress) / 0.15
                : 0.9;

            const speedReference = field.status === "REAL" ? 1.5 : 3.0;
            const speedRatio = Math.min(speed / speedReference, 1.0);
            const sBucket = Math.min(
              NUM_SPEED_BUCKETS - 1,
              Math.floor(speedRatio * NUM_SPEED_BUCKETS)
            );
            const aBucket = Math.min(
              NUM_ALPHA_BUCKETS - 1,
              Math.floor(alpha * NUM_ALPHA_BUCKETS)
            );
            const bIdx = sBucket * NUM_ALPHA_BUCKETS + aBucket;

            const bCount = bucketCounts[bIdx]++;
            bucketParticles[bIdx * MAX_PARTICLES + bCount] = i;
          }
        }

        // Draw batched current buckets
        for (let b = 0; b < TOTAL_BUCKETS; b++) {
          const count = bucketCounts[b];
          if (count === 0) continue;

          const style = CURRENT_BUCKET_STYLES[b];
          ctx.strokeStyle = style.strokeStyle;
          ctx.lineWidth = style.lineWidth;
          ctx.beginPath();

          for (let c = 0; c < count; c++) {
            const pIdx = bucketParticles[b * MAX_PARTICLES + c];
            const sLen = buffers.screenLen[pIdx];
            const base = pIdx * MAX_TRAIL_CAPACITY;
            const sHead = buffers.screenHead[pIdx];

            const idx0 = (sHead + MAX_TRAIL_CAPACITY) % MAX_TRAIL_CAPACITY;
            ctx.moveTo(buffers.screenX[base + idx0], buffers.screenY[base + idx0]);
            for (let k = 1; k < sLen; k++) {
              const idxK = (sHead - k + MAX_TRAIL_CAPACITY) % MAX_TRAIL_CAPACITY;
              ctx.lineTo(buffers.screenX[base + idxK], buffers.screenY[base + idxK]);
            }
          }

          ctx.stroke();
          totalStrokeCalls++;
        }
      }

      const frameEndTime = performance.now();
      const frameDuration = frameEndTime - frameStartTime;
      const simAndDrawDuration = frameEndTime - simStartTime;

      perfMonitor.recordParticleFrame(
        frameDuration,
        totalActiveRendered,
        transformsSaved,
        simAndDrawDuration,
        0,
        totalStrokeCalls
      );

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
