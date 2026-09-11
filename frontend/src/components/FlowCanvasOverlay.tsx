'use client';

import React, { useEffect, useRef } from 'react';
import * as Cesium from 'cesium';
import { FlowParticle, EnvironmentalFlowField } from '../types/flow';
import { generateBayOfBengalFlowField, sampleFlowVelocity } from '../services/FlowFieldProvider';

interface FlowCanvasOverlayProps {
  viewer: Cesium.Viewer | null;
  showWind: boolean;
  showCurrents: boolean;
  cycloneLat?: number;
  cycloneLon?: number;
  maxWindKts?: number;
  timestamp?: string;
}

export const FlowCanvasOverlay: React.FC<FlowCanvasOverlayProps> = ({
  viewer,
  showWind,
  showCurrents,
  cycloneLat = 18.2,
  cycloneLon = 88.4,
  maxWindKts = 125,
  timestamp = '2026-09-08T12:00:00Z',
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationFrameIdRef = useRef<number | null>(null);

  const windFieldRef = useRef<EnvironmentalFlowField | null>(null);
  const currentFieldRef = useRef<EnvironmentalFlowField | null>(null);

  const windParticlesRef = useRef<FlowParticle[]>([]);
  const currentParticlesRef = useRef<FlowParticle[]>([]);

  // 1. Generate/Update Environmental Flow Fields on prop/timeline change
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
      currentFieldRef.current = generateBayOfBengalFlowField(
        'current',
        cycloneLat,
        cycloneLon,
        maxWindKts,
        timestamp
      );
    } else {
      currentFieldRef.current = null;
      currentParticlesRef.current = [];
    }
  }, [showWind, showCurrents, cycloneLat, cycloneLon, maxWindKts, timestamp]);

  // 2. Initialize Particles with Coordinate History for Continuous Streams
  const initParticle = (
    bounds: { minLat: number; maxLat: number; minLon: number; maxLon: number },
    isWind: boolean
  ): FlowParticle => {
    const lat = bounds.minLat + Math.random() * (bounds.maxLat - bounds.minLat);
    const lon = bounds.minLon + Math.random() * (bounds.maxLon - bounds.minLon);
    const maxAge = isWind ? 50 + Math.random() * 50 : 70 + Math.random() * 70;

    return {
      lat,
      lon,
      history: [{ lat, lon }],
      age: Math.floor(Math.random() * maxAge),
      maxAge,
      speed: 0,
    };
  };

  // 3. Main High-Performance Animation Loop
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
      }
    };
    updateCanvasSize();

    // Populate particles (High Density: Req #2)
    if (showWind && windFieldRef.current && windParticlesRef.current.length === 0) {
      const b = windFieldRef.current.bounds;
      const count = 3200; // High INCOIS-level particle density
      const particles: FlowParticle[] = [];
      for (let i = 0; i < count; i++) {
        particles.push(initParticle(b, true));
      }
      windParticlesRef.current = particles;
    }

    if (showCurrents && currentFieldRef.current && currentParticlesRef.current.length === 0) {
      const b = currentFieldRef.current.bounds;
      const count = 2400; // Dense ocean current flow stream
      const particles: FlowParticle[] = [];
      for (let i = 0; i < count; i++) {
        particles.push(initParticle(b, false));
      }
      currentParticlesRef.current = particles;
    }

    const renderFrame = () => {
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

      // Project WGS84 (lat, lon) to window pixel coordinates
      const projectToPixel = (lat: number, lon: number): { x: number; y: number } | null => {
        try {
          const cartesian = Cesium.Cartesian3.fromDegrees(lon, lat, 0);
          const pixel = Cesium.SceneTransforms.worldToWindowCoordinates(scene, cartesian);
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

      // --- 1. RENDER WIND FLOW STREAMLINES (INCOIS STYLE) ---
      if (showWind && windFieldRef.current) {
        const field = windFieldRef.current;
        const particles = windParticlesRef.current;
        const maxTrailLength = 7; // Continuous trailing stream history

        for (let i = 0; i < particles.length; i++) {
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

          // Convert history trail coordinates to screen pixels
          const screenPoints: { x: number; y: number }[] = [];
          for (let k = 0; k < p.history.length; k++) {
            const pt = projectToPixel(p.history[k].lat, p.history[k].lon);
            if (pt) screenPoints.push(pt);
            else break;
          }

          if (screenPoints.length >= 2) {
            // Particle lifecycle alpha fade curve
            const alphaProgress = p.age / p.maxAge;
            const alpha = alphaProgress < 0.15
              ? alphaProgress / 0.15
              : alphaProgress > 0.85
              ? (1 - alphaProgress) / 0.15
              : 1.0;

            // Speed-proportional width & color (INCOIS scientific color ramp)
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
        const maxTrailLength = 9; // Longer smooth trailing history for ocean current flow

        for (let i = 0; i < particles.length; i++) {
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

          const screenPoints: { x: number; y: number }[] = [];
          for (let k = 0; k < p.history.length; k++) {
            const pt = projectToPixel(p.history[k].lat, p.history[k].lon);
            if (pt) screenPoints.push(pt);
            else break;
          }

          if (screenPoints.length >= 2) {
            const alphaProgress = p.age / p.maxAge;
            const alpha = alphaProgress < 0.15
              ? alphaProgress / 0.15
              : alphaProgress > 0.85
              ? (1 - alphaProgress) / 0.15
              : 0.9;

            const speedRatio = Math.min(vel.speed / 3.0, 1.0);
            ctx.lineWidth = 1.4 + speedRatio * 1.4;

            // Hydrodynamic marine teal color ramp (Req #6)
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
