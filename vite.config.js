import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import cesium from 'vite-plugin-cesium';

// CesiumJS under Vite: vite-plugin-cesium copies the Cesium static assets
// (Workers, Assets, ThirdParty, Widgets) and injects CESIUM_BASE_URL so the
// library resolves its workers and resources correctly in dev and build.
export default defineConfig({
  plugins: [react(), cesium()],
  build: {
    chunkSizeWarningLimit: 6000
  }
});
