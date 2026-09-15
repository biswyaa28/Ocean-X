import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

afterEach(() => {
  cleanup();
});

// jsdom has no real canvas rasterizer. Install a minimal 2d-context stub so
// the raster generation utilities produce data URLs in tests (the components
// treat an empty dataUrl as "nothing to draw", which would make imagery-layer
// lifecycle assertions vacuous).
const ctxStub = {
  createImageData: (w: number, h: number) => ({
    data: new Uint8ClampedArray(w * h * 4),
    width: w,
    height: h,
  }),
  putImageData: () => {},
  drawImage: () => {},
  clearRect: () => {},
  imageSmoothingEnabled: true,
  imageSmoothingQuality: 'high',
} as unknown as CanvasRenderingContext2D;

HTMLCanvasElement.prototype.getContext = vi.fn(() => ctxStub);
HTMLCanvasElement.prototype.toDataURL = vi.fn(() => 'data:image/png;base64,STUB');

// Cesium asset base path (mirrors the component's own runtime assignment)
(window as unknown as { CESIUM_BASE_URL?: string }).CESIUM_BASE_URL = '/cesium';
