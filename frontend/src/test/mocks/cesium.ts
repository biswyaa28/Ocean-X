/**
 * Instrumented Cesium mock for component tests.
 *
 * imageryLayers.addImageryProvider / remove are recorded in the shared
 * `layerOps` array so tests can assert layer lifecycle (add/remove counts,
 * ordering, no accumulation) without a WebGL context.
 */
import { vi } from 'vitest';

export const layerOps: { op: 'add' | 'remove'; layer: unknown }[] = [];

export class FakeImageryLayer {
  alpha = 1;
  show = true;
}

class FakeImageryLayerCollection {
  private layers: FakeImageryLayer[] = [];
  addImageryProvider(_provider: unknown): FakeImageryLayer {
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
  setInputAction = vi.fn();
  destroy = vi.fn();
}

function fakeJulian(date?: string) {
  return { toString: () => `jd:${date ?? 'now'}`, isStart: true };
}

function fakeColor() {
  const c = { withAlpha: vi.fn(() => ({})) };
  return c;
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
  Viewer: class {
    imageryLayers = new FakeImageryLayerCollection();
    entities = { add: vi.fn(() => ({})), remove: vi.fn(() => true) };
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
      postRender: { addEventListener: vi.fn(), removeEventListener: vi.fn() },
      preRender: { addEventListener: vi.fn(), removeEventListener: vi.fn() },
      camera: { getPickRay: vi.fn(), flyTo: vi.fn() },
    };
    camera = {
      flyTo: vi.fn(),
      moveStart: { addEventListener: vi.fn(), removeEventListener: vi.fn() },
      moveEnd: { addEventListener: vi.fn(), removeEventListener: vi.fn() },
    };
    clock = { currentTime: null, shouldAnimate: false };
    destroy = vi.fn();
    isDestroyed = vi.fn(() => false);
  },
  ScreenSpaceEventHandler: FakeScreenSpaceEventHandler,
  ScreenSpaceEventType: { LEFT_CLICK: 1, MOUSE_MOVE: 2 },
  Cartesian2: class {
    constructor(public x = 0, public y = 0) {}
  },
  Cartesian3: {
    fromDegrees: vi.fn(() => ({ x: 1, y: 2, z: 3 })),
    magnitude: vi.fn(() => 1),
    normalize: vi.fn((v: unknown) => v),
    multiplyByScalar: vi.fn((v: unknown) => v),
    negate: vi.fn((v: unknown) => v),
    UNIT_Z: { x: 0, y: 0, z: 1 },
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
  defined: vi.fn(() => true),
};

export function resetLayerOps() {
  layerOps.length = 0;
}
