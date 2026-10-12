/**
 * Instrumented Cesium mock for component tests.
 *
 * imageryLayers.addImageryProvider / remove are recorded in the shared
 * `layerOps` array so tests can assert layer lifecycle (add/remove counts,
 * ordering, no accumulation) without a WebGL context.
 */
import { vi } from 'vitest';

export const layerOps: { op: 'add' | 'remove'; layer: unknown }[] = [];

/** Viewer constructor options, in creation order (Phase 2B assertions). */
export const viewerOptions: unknown[] = [];

/** Every Viewer created since the last reset (Phase 2B assertions). */
export const createdViewers: FakeViewer[] = [];

/** Explicit scene.requestRender() calls recorded across all viewers. */
export const requestRenderCalls: unknown[] = [];

export function resetViewerOptions() {
  viewerOptions.length = 0;
  createdViewers.length = 0;
  requestRenderCalls.length = 0;
  inputActions.length = 0;
}

/** Registered ScreenSpaceEventHandler input actions, in registration order. */
export const inputActions: { type: number; action: (arg: unknown) => void }[] = [];

export class FakeImageryLayer {
  alpha = 1;
  show = true;
}

class FakeImageryLayerCollection {
  private layers: FakeImageryLayer[] = [];
  addImageryProvider(provider: unknown): FakeImageryLayer {
    void provider;
    const layer = new FakeImageryLayer();
    this.layers.push(layer);
    layerOps.push({ op: 'add', layer });
    return layer;
  }
  remove(layer: FakeImageryLayer): boolean {
    const idx = this.layers.indexOf(layer);
    if (idx === -1) return false;
    this.layers.splice(idx, 1);
    layerOps.push({ op: 'remove', layer });
    return true;
  }
  get length(): number {
    return this.layers.length;
  }
  contains(layer: FakeImageryLayer): boolean {
    return this.layers.includes(layer);
  }
}

class FakeScreenSpaceEventHandler {
  setInputAction = vi.fn((action: (arg: unknown) => void, type: number) => {
    inputActions.push({ type, action });
  });
  destroy = vi.fn();
}

/** Constructable Cartesian3 stand-in (FlowCanvasOverlay allocates scratch
 * Cartesians and clones camera positions per frame). */
class FakeCartesian3 {
  x = 0;
  y = 0;
  z = 0;
  constructor(x = 0, y = 0, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }
  static clone(src: unknown, result?: FakeCartesian3): FakeCartesian3 {
    const s = src as { x: number; y: number; z: number };
    if (result) {
      result.x = s.x;
      result.y = s.y;
      result.z = s.z;
      return result;
    }
    return new FakeCartesian3(s.x, s.y, s.z);
  }
  static equalsEpsilon(
    a: { x: number; y: number; z: number },
    b: { x: number; y: number; z: number },
    epsilon: number
  ): boolean {
    return (
      Math.abs(a.x - b.x) <= epsilon &&
      Math.abs(a.y - b.y) <= epsilon &&
      Math.abs(a.z - b.z) <= epsilon
    );
  }
  static dot(
    a: { x: number; y: number; z: number },
    b: { x: number; y: number; z: number }
  ): number {
    return a.x * b.x + a.y * b.y + a.z * b.z;
  }
  static cross(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): FakeCartesian3 {
    return new FakeCartesian3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
  }
}

function fakeJulian(date?: string) {
  return { toString: () => `jd:${date ?? 'now'}`, isStart: true };
}

function fakeColor() {
  const c = { withAlpha: vi.fn(() => ({})) };
  return c;
}

/**
 * Fake Cesium Viewer. Records constructor options (Phase 2B asserts
 * `requestRenderMode`), explicit `scene.requestRender()` invalidation calls and
 * the registered `scene.postRender` frame listeners.
 */
export class FakeViewer {
  imageryLayers = new FakeImageryLayerCollection();
  entities = {
    add: vi.fn((opts?: unknown) => (opts && typeof opts === 'object' ? { ...(opts as Record<string, unknown>) } : {})),
    remove: vi.fn(() => true),
  };
  postRenderListeners: Array<() => void> = [];
  scene = {
    canvas: {},
    pick: vi.fn(),
    light: null,
    globe: {} as Record<string, unknown>,
    skyBox: null,
    sun: null,
    moon: null,
    skyAtmosphere: null,
    fog: null,
    backgroundColor: null,
    requestRender: vi.fn(() => {
      requestRenderCalls.push(this);
    }),
    postRender: {
      addEventListener: vi.fn((listener: () => void) => {
        this.postRenderListeners.push(listener);
        return () => {
          const idx = this.postRenderListeners.indexOf(listener);
          if (idx >= 0) this.postRenderListeners.splice(idx, 1);
        };
      }),
      removeEventListener: vi.fn(),
    },
    preRender: { addEventListener: vi.fn(() => () => {}), removeEventListener: vi.fn() },
    camera: { getPickRay: vi.fn(), flyTo: vi.fn() },
  };
  camera = {
    flyTo: vi.fn(),
    positionWC: new FakeCartesian3(1, 2, 3),
    moveStart: { addEventListener: vi.fn(), removeEventListener: vi.fn() },
    moveEnd: { addEventListener: vi.fn(), removeEventListener: vi.fn() },
  };
  clock = { currentTime: null, shouldAnimate: false };
  destroy = vi.fn();
  isDestroyed = vi.fn(() => false);
  /** The container element the viewer was constructed with (Cesium's 1st arg). */
  container: unknown = null;

  constructor(container?: unknown, options?: unknown) {
    this.container = container;
    viewerOptions.push(options);
    createdViewers.push(this);
  }

  /** Test helper mirroring Cesium's postRender frame notification. */
  emitPostRender() {
    for (const listener of [...this.postRenderListeners]) listener();
  }
}

export const cesiumMock = {
  Ion: { defaultAccessToken: '' },
  ImageryLayer: FakeImageryLayer,
  SingleTileImageryProvider: class {
    constructor(public options: unknown) {}
  },
  UrlTemplateImageryProvider: class {
    constructor(public options: unknown) {}
  },
  EllipsoidTerrainProvider: class {},
  SunLight: class {},
  Sun: class {
    show = true;
    glowFactor = 1;
  },
  Moon: class {
    show = true;
    onlySunLighting = true;
  },
  Viewer: FakeViewer,
  ScreenSpaceEventHandler: FakeScreenSpaceEventHandler,
  ScreenSpaceEventType: { LEFT_CLICK: 1, MOUSE_MOVE: 2 },
  Cartesian2: class {
    constructor(public x = 0, public y = 0) {}
  },
  Cartesian3: Object.assign(FakeCartesian3, {
    fromDegrees: vi.fn(() => new FakeCartesian3(1, 2, 3)),
    magnitude: vi.fn(() => 1),
    normalize: vi.fn((v: unknown) => v),
    multiplyByScalar: vi.fn((v: unknown) => v),
    negate: vi.fn((v: unknown) => v),
    UNIT_Z: new FakeCartesian3(0, 0, 1),
  }),
  Ellipsoid: { WGS84: {} },
  SceneTransforms: {
    worldToWindowCoordinates: vi.fn(() => ({ x: 100, y: 100 })),
  },
  Matrix3: class {
    static multiplyByVector = vi.fn((_m: unknown, v: unknown) => v);
    static computeIcrfToFixedMatrix = vi.fn(() => ({}));
  },
  Matrix4: class {
    static inverse = vi.fn(() => ({}));
    static multiplyByPoint = vi.fn((_m: unknown, v: unknown) => v);
  },
  Transforms: {
    eastNorthUpToFixedFrame: vi.fn(() => ({})),
    computeIcrfToFixedMatrix: vi.fn(() => ({})),
  },
  Simon1994PlanetaryPositions: {
    computeSunPositionInEarthInertialFrame: vi.fn(() => ({ x: 1, y: 0, z: 0 })),
    computeMoonPositionInEarthInertialFrame: vi.fn(() => ({ x: 0, y: 1, z: 0 })),
  },
  JulianDate: {
    now: vi.fn(() => fakeJulian()),
    fromIso8601: vi.fn(() => fakeJulian()),
    fromDate: vi.fn(() => fakeJulian()),
  },
  Color: new Proxy(
    {},
    {
      get: (_target, prop) => {
        if (prop === 'fromCssColorString') {
          return vi.fn(() => fakeColor());
        }
        if (prop === 'TRANSPARENT') return fakeColor();
        const c = fakeColor();
        return c;
      },
    }
  ),
  ColorMaterialProperty: class {},
  PolylineDashMaterialProperty: class {},
  PolylineGlowMaterialProperty: class {},
  Rectangle: { fromDegrees: vi.fn(() => ({})) },
  Math: {
    toRadians: vi.fn((d: number) => d),
    toDegrees: vi.fn((r: number) => r),
  },
  Cartographic: { fromCartesian: vi.fn(() => ({ latitude: 0, longitude: 0 })) },
  VerticalOrigin: { BOTTOM: 1 },
  LabelStyle: { FILL_AND_OUTLINE: 2 },
  // Mirrors Cesium.defined: false for null/undefined (short-circuits pick guards).
  defined: vi.fn((value: unknown) => value !== undefined && value !== null),
};

export function resetLayerOps() {
  layerOps.length = 0;
}
