/**
 * OCEAN-X SIH26067 - Performance Instrumentation Utility
 * Lightweight metrics collector active in development mode.
 * Exposes metrics under `window.__OCEANX_PERF__` for profiling without noisy console logs.
 */

export interface OceanXPerfMetrics {
  particleFps: number;
  particleFrameTimeMs: number;
  particleSimDurationMs: number;
  particleDrawDurationMs: number;
  activeParticleCount: number;
  canvasStrokeCount: number;
  cachedTransformsSaved: number;
  hoverPickCallsCount: number;
  hoverPickCallsPerSec: number;
  cesiumEntityCount: number;
  cesiumGlobeRenders: number;
  lastTimelineUpdateMs: number;
  rasterGenerationTimeMs: number;
  rasterCacheHits: number;
  rasterCacheMisses: number;
  abortedRequestsCount: number;
  // ---- Phase 2B: Cesium on-demand (requestRenderMode) rendering ----
  /** Explicit scene.requestRender() calls made by application state changes. */
  cesiumRenderRequests: number;
  /** Frames Cesium actually drew (scene.postRender). Idle ⇒ no growth. */
  cesiumFramesRendered: number;
  // ---- Phase 2B: raster serialization ----
  /** Wall-clock ms of the last canvas encode step. */
  rasterSerializationTimeMs: number;
  /** Rasters encoded to an async PNG Blob (object URL, no Base64). */
  rasterBlobSerializations: number;
  /** Rasters encoded through the canvas.toDataURL() fallback. */
  rasterDataUrlSerializations: number;
  // ---- Phase 2B: layer-data cache / request deduplication ----
  /** HTTP requests actually issued for layer/depth-slice data. */
  apiLayerDataRequests: number;
  /** Layer/depth-slice responses served from the bounded LRU cache. */
  apiLayerDataCacheHits: number;
  apiLayerDataCacheMisses: number;
  /** Concurrent identical requests served by one shared in-flight Promise. */
  apiLayerDataDedupHits: number;
}

class PerfMonitor {
  private metrics: OceanXPerfMetrics = {
    particleFps: 60,
    particleFrameTimeMs: 0,
    particleSimDurationMs: 0,
    particleDrawDurationMs: 0,
    activeParticleCount: 0,
    canvasStrokeCount: 0,
    cachedTransformsSaved: 0,
    hoverPickCallsCount: 0,
    hoverPickCallsPerSec: 0,
    cesiumEntityCount: 0,
    cesiumGlobeRenders: 0,
    lastTimelineUpdateMs: 0,
    rasterGenerationTimeMs: 0,
    rasterCacheHits: 0,
    rasterCacheMisses: 0,
    abortedRequestsCount: 0,
    cesiumRenderRequests: 0,
    cesiumFramesRendered: 0,
    rasterSerializationTimeMs: 0,
    rasterBlobSerializations: 0,
    rasterDataUrlSerializations: 0,
    apiLayerDataRequests: 0,
    apiLayerDataCacheHits: 0,
    apiLayerDataCacheMisses: 0,
    apiLayerDataDedupHits: 0,
  };

  private frameTimes: number[] = [];
  private lastFrameTimestamp = 0;
  private pickTimestamps: number[] = [];

  constructor() {
    if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
      (window as unknown as { __OCEANX_PERF__: OceanXPerfMetrics }).__OCEANX_PERF__ = this.metrics;
    }
  }

  recordParticleFrame(
    durationMs: number,
    particleCount: number,
    savedTransforms = 0,
    simDurationMs = 0,
    drawDurationMs = 0,
    strokeCount = 0
  ) {
    this.metrics.particleFrameTimeMs = Math.round(durationMs * 100) / 100;
    this.metrics.particleSimDurationMs = Math.round(simDurationMs * 100) / 100;
    this.metrics.particleDrawDurationMs = Math.round(drawDurationMs * 100) / 100;
    this.metrics.activeParticleCount = particleCount;
    this.metrics.canvasStrokeCount = strokeCount;
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

  recordHoverPick() {
    this.metrics.hoverPickCallsCount++;
    const now = performance.now();
    this.pickTimestamps.push(now);
    while (this.pickTimestamps.length > 0 && now - this.pickTimestamps[0] > 1000) {
      this.pickTimestamps.shift();
    }
    this.metrics.hoverPickCallsPerSec = this.pickTimestamps.length;
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

  /**
   * Phase 2B: counts a canvas encode (PNG) and how it was serialized.
   * `kind` distinguishes the object-URL Blob path from the Data URL fallback.
   */
  recordRasterSerialization(durationMs: number, kind: 'blob' | 'dataurl') {
    this.metrics.rasterSerializationTimeMs = Math.round(durationMs * 100) / 100;
    if (kind === 'blob') {
      this.metrics.rasterBlobSerializations++;
    } else {
      this.metrics.rasterDataUrlSerializations++;
    }
  }

  /** Phase 2B: an explicit scene.requestRender() was issued. */
  recordCesiumRenderRequest() {
    this.metrics.cesiumRenderRequests++;
  }

  /**
   * Phase 2B: Cesium drew a frame (scene.postRender). The delta over a time
   * window is the real render frequency — including while the app is idle.
   */
  recordCesiumFrame() {
    this.metrics.cesiumFramesRendered++;
  }

  /** Phase 2B: a layer/depth-slice HTTP request was actually issued. */
  recordApiLayerDataRequest() {
    this.metrics.apiLayerDataRequests++;
  }

  /** Phase 2B: a layer/depth-slice response was served from the shared cache. */
  recordApiLayerDataCacheHit() {
    this.metrics.apiLayerDataCacheHits++;
  }

  /** Phase 2B: a layer/depth-slice response was not cached and had to be fetched. */
  recordApiLayerDataCacheMiss() {
    this.metrics.apiLayerDataCacheMisses++;
  }

  /** Phase 2B: a concurrent identical request reused the shared in-flight Promise. */
  recordApiLayerDataDedupHit() {
    this.metrics.apiLayerDataDedupHits++;
  }

  recordCesiumGlobeRender() {
    this.metrics.cesiumGlobeRenders++;
  }

  getMetrics(): Readonly<OceanXPerfMetrics> {
    return this.metrics;
  }
}

export const perfMonitor = new PerfMonitor();
