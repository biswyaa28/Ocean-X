/**
 * OCEAN-X SIH26067 - Performance Instrumentation Utility
 * Lightweight metrics collector active in development mode.
 * Exposes metrics under `window.__OCEANX_PERF__` for profiling without noisy console logs.
 */

export interface OceanXPerfMetrics {
  particleFps: number;
  particleFrameTimeMs: number;
  activeParticleCount: number;
  cachedTransformsSaved: number;
  cesiumEntityCount: number;
  cesiumGlobeRenders: number;
  lastTimelineUpdateMs: number;
  rasterGenerationTimeMs: number;
  rasterCacheHits: number;
  rasterCacheMisses: number;
  abortedRequestsCount: number;
}

class PerfMonitor {
  private metrics: OceanXPerfMetrics = {
    particleFps: 60,
    particleFrameTimeMs: 0,
    activeParticleCount: 0,
    cachedTransformsSaved: 0,
    cesiumEntityCount: 0,
    cesiumGlobeRenders: 0,
    lastTimelineUpdateMs: 0,
    rasterGenerationTimeMs: 0,
    rasterCacheHits: 0,
    rasterCacheMisses: 0,
    abortedRequestsCount: 0,
  };

  private frameTimes: number[] = [];
  private lastFrameTimestamp = 0;

  constructor() {
    if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') {
      (window as unknown as { __OCEANX_PERF__: OceanXPerfMetrics }).__OCEANX_PERF__ = this.metrics;
    }
  }

  recordParticleFrame(durationMs: number, particleCount: number, savedTransforms = 0) {
    this.metrics.particleFrameTimeMs = Math.round(durationMs * 100) / 100;
    this.metrics.activeParticleCount = particleCount;
    this.metrics.cachedTransformsSaved += savedTransforms;

    const now = performance.now();
    if (this.lastFrameTimestamp > 0) {
      const delta = now - this.lastFrameTimestamp;
      this.frameTimes.push(1000 / Math.max(1, delta));
      if (this.frameTimes.length > 30) this.frameTimes.shift();
      const avgFps = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
      this.metrics.particleFps = Math.round(avgFps);
    }
    this.lastFrameTimestamp = now;
  }

  setEntityCount(count: number) {
    this.metrics.cesiumEntityCount = count;
  }

  recordTimelineUpdate(durationMs: number) {
    this.metrics.lastTimelineUpdateMs = Math.round(durationMs * 100) / 100;
  }

  recordRasterGen(durationMs: number, isCacheHit: boolean) {
    this.metrics.rasterGenerationTimeMs = Math.round(durationMs * 100) / 100;
    if (isCacheHit) {
      this.metrics.rasterCacheHits++;
    } else {
      this.metrics.rasterCacheMisses++;
    }
  }

  recordRequestAborted() {
    this.metrics.abortedRequestsCount++;
  }

  recordCesiumGlobeRender() {
    this.metrics.cesiumGlobeRenders++;
  }

  getMetrics(): Readonly<OceanXPerfMetrics> {
    return this.metrics;
  }
}

export const perfMonitor = new PerfMonitor();
