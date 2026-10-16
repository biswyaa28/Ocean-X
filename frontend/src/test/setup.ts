import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

afterEach(() => {
  cleanup();
});

// jsdom has no real canvas rasterizer. Install a minimal 2d-context stub so
// the raster generation utilities produce data URLs in tests (the components
// treat an empty dataUrl as "nothing to draw", which would make imagery-layer
// lifecycle assertions vacuous). Includes the path-drawing methods used by
// the particle overlay's per-frame canvas work.
const ctxStub = {
  createImageData: (w: number, h: number) => ({
    data: new Uint8ClampedArray(w * h * 4),
    width: w,
    height: h,
  }),
  putImageData: () => {},
  drawImage: () => {},
  clearRect: () => {},
  save: () => {},
  restore: () => {},
  fillRect: () => {},
  beginPath: () => {},
  moveTo: () => {},
  lineTo: () => {},
  stroke: () => {},
  imageSmoothingEnabled: true,
  imageSmoothingQuality: 'high',
  globalCompositeOperation: 'source-over',
  fillStyle: '',
  strokeStyle: '',
  lineWidth: 1,
} as unknown as CanvasRenderingContext2D;

HTMLCanvasElement.prototype.getContext = vi.fn(
  () => ctxStub
) as unknown as HTMLCanvasElement['getContext'];
HTMLCanvasElement.prototype.toDataURL = vi.fn(() => 'data:image/png;base64,STUB');

// rasterGen prefers an async PNG Blob via URL.createObjectURL and falls back to
// canvas.toDataURL() when object URLs are unavailable — a capability check it
// documents as existing for jsdom. Vitest 3's jsdom has no createObjectURL, so
// the fallback was the path every raster test exercised.
//
// Vitest 5 ships a jsdom that DOES provide createObjectURL. The raster code
// therefore takes the Blob path, and that path can never complete under jsdom:
// nothing decodes the Blob into an image, so the promise never settles and the
// depth-slice layer is silently never added. That showed up as 32 failures
// reading "expected 1 to be 2" — the surface layer was added and the slice was
// not.
//
// Removing the API puts jsdom back on the documented fallback, which is the
// behaviour this suite is written against. A real browser keeps the Blob path.
if (typeof URL.createObjectURL === 'function') {
  Object.defineProperty(URL, 'createObjectURL', {
    value: undefined,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    value: undefined,
    configurable: true,
    writable: true,
  });
}

// Cesium asset base path (mirrors the component's own runtime assignment)
(window as unknown as { CESIUM_BASE_URL?: string }).CESIUM_BASE_URL = '/cesium';
