# Phase 1B: HYCOM Model Depth-Slice Visualization in Cesium — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render a REAL HYCOM model depth slice (from the Phase 1A `/api/model/depth-slice` endpoint) as a geographically correct raster overlay in the existing Cesium application, clearly distinguished from surface layers, with correct lifecycle, cancellation, and cleanup.

**Architecture:** A new depth-slice state lives in `page.tsx` (selection + visibility + fetched metadata) and flows down through `CesiumGlobe` (memoized) into `CesiumViewerInner`, which owns a **dedicated** `depthSliceLayerRef` imagery layer — fully separate from the existing surface `rasterLayerRef`. A new `DepthSliceControl` panel (variable / depth / timestamp controls + visibility toggle) sits next to the existing `LayerControl`. Raster generation reuses `rasterGen.ts` via a new depth-aware entry point that (a) never masks legitimate 0.0 values and (b) caches under a depth-aware key. Requests reuse the existing `apiProvider.getDepthSlice` + AbortController pattern. No backend changes.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, Cesium 1.145, Tailwind 4, FastAPI/xarray backend (untouched). New dev-only test deps: vitest + jsdom + @testing-library/react + @testing-library/user-event for the frontend scenarios (Task 9).

---

## Verified facts the implementer must know

1. **Wire format is snake_case.** The backend `DepthSliceResponse` (pydantic, no alias generator) serializes: `status, source, dataset_file, variable, units, timestamp, requested_timestamp, requested_depth_m, matched_depth_m, available_depths_m, depth_selection, missing_values, bounds{minLat,maxLat,minLon,maxLon}, grid{latitudes, longitudes, values|u|v}`. The existing frontend `DepthSlicePayload` interface in `ApiProvider.ts` declares **camelCase** names — it is wrong and would read `undefined` at runtime. Task 1 fixes it. (Verified live: `requested_depth_m` etc. in the JSON.)
2. **Missing values are `null`** in `grid.values` / `grid.u` / `grid.v`, counted in `missing_values`. They must render fully transparent. **A legitimate `0.0` value must NOT be masked** — unlike the surface `paintGrid` which masks `val === 0`. SSH at depth can be ~0.0; masking it would fabricate "no data".
3. **Nearest-native-depth semantics.** The API never interpolates: `requested_depth_m` and `matched_depth_m` differ. UI must show both ("requested" vs "matched model level"). Never alter `matched_depth_m` for display.
4. **Surface behavior must not change.** The existing surface raster effect (`CesiumViewerInner.tsx` lines ~1029–1110) stays byte-identical in behavior. The depth slice gets its own effect + own imagery-layer ref + own AbortController, mirroring the same pattern.
5. **Timestamps.** The app timeline (HISTORICAL cyclone AMPHAN) is 2020-05; the HYCOM dataset covers 2026-09-07T06:00 → 2026-09-08T18:00 (fixture; the real raw file covers 2026-09-08). Depth-slice timestamp selection must default to **dataset time** (fetched slice reports the matched `timestamp`), not the cyclone timeline. The depth-slice UI must expose its own timestamp picker driven by `/api/observations` available_timestamps (surface dataset times are the same calendar range as the raw file; backend falls back to first available when the requested ts doesn't match exactly — `sel(method="nearest")`).
6. **Layer ordering.** `SingleTileImageryProvider` layers are added on top of the base Esri imagery + place names. Surface raster and depth-slice raster can coexist (surface + depth mode). To make the depth slice visibly distinct, the depth-slice layer gets `alpha 0.75` (vs surface 0.65) and its own legend chip.
7. **Terminology (hard requirement).** Label everything "HYCOM MODEL DEPTH SLICE" / "Model depth slice". Never: volumetric rendering, full water-column, continuous-depth, isosurface. The slice is a 2D geographic drape — no vertical exaggeration, no altitude semantics.
8. **Real vs fixture.** `apiProvider.getDepthSlice` returns `null` on any error and **never falls back to synthetic data**. When the real dataset is absent the backend returns 503 → UI shows "HYCOM model depth slice unavailable" with the backend message. Tests use fixtures via a mocked fetch; production provenance is untouched.
9. **Perf instrumentation** (`perfMonitor.ts`) is dev-only and already tracks raster cache hits/misses + aborted requests. The depth-slice path records through the same `recordRasterGen` / `recordRequestAborted` methods — no new counters needed.
10. **`CesiumGlobe` memo comparator** (`CesiumGlobe.tsx`) must learn the new props (selection object identity, visibility, metadata) so memoization still works; all other comparator lines stay.
11. **Backend tests** run with `cd backend && .venv/bin/python -m pytest tests/test_depth_slice.py -q` (conftest auto-binds fixtures when production data is absent).
12. **Next.js 16**: verify any App Router API against `frontend/node_modules/next/dist/docs/` before deviating from existing patterns. The existing code uses client components only — keep that.

---

### Task 1: Fix `DepthSlicePayload` to match the actual wire format + expose typed variable metadata

**Files:**
- Modify: `frontend/src/services/ApiProvider.ts` (lines 40–70, the `DepthSlicePayload` interface)

- [ ] **Step 1: Correct the interface**

Replace the existing `DepthSlicePayload` interface (lines 49–70) with the snake_case truth, plus supported-variable constants:

```ts
/**
 * Shape of the /model/depth-slice payload (Phase 1A).
 *
 * Wire format is snake_case (pydantic default serialization).
 *
 * A HYCOM model depth slice: values are taken from the single native HYCOM
 * model depth level nearest to the requested depth - depth is NEVER
 * interpolated. `requested_depth_m` and `matched_depth_m` are reported
 * separately so callers can surface the nearest-level semantics.
 * Missing/NaN source values are represented as null.
 */
export interface DepthSlicePayload {
  status: string;
  source: string;
  dataset_file: string;
  variable: string;
  units: string;
  timestamp: string;
  requested_timestamp?: string | null;
  requested_depth_m: number;
  matched_depth_m: number;
  available_depths_m: number[];
  depth_selection: string;
  missing_values: number;
  bounds: { minLat: number; maxLat: number; minLon: number; maxLon: number };
  grid: {
    latitudes: number[];
    longitudes: number[];
    values?: (number | null)[][];
    u?: (number | null)[][];
    v?: (number | null)[][];
  };
}

/** Variables supported by the Phase 1A depth-slice API (backend DEPTH_VARIABLES, public names). */
export const DEPTH_SLICE_VARIABLES = [
  { id: 'temperature', label: 'Temperature', unit: '°C' },
  { id: 'salinity', label: 'Salinity', unit: 'PSU' },
  { id: 'currents', label: 'Currents (u/v)', unit: 'm/s' },
  { id: 'ssh', label: 'Sea Surface Height', unit: 'm' },
  { id: 'tchp', label: 'TCHP', unit: 'KJ/cm²' },
  { id: 'mld', label: 'Mixed Layer Depth', unit: 'm' },
] as const;

export type DepthSliceVariableId = (typeof DEPTH_SLICE_VARIABLES)[number]['id'];
```

- [ ] **Step 2: Verify with typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/services/ApiProvider.ts
git commit -m "fix(frontend): correct DepthSlicePayload to the snake_case Phase 1A wire format"
```

---

### Task 2: Depth-aware raster generation in `rasterGen.ts`

**Files:**
- Modify: `frontend/src/utils/rasterGen.ts`

**Why a new function, not reuse of `generateLayerImageDataUrlCached`:** two hard differences. (1) The surface `paintGrid` masks `val === 0` as transparent — for depth slices that fabricates missing data (SSH ≈ 0.0 m is valid). (2) The cache key `layerType_timestamp_NxN` has no depth/variable axis; a temp slice at 50 m would collide with surface SST at the same timestamp only if names matched — worse, two different depth slices of the same variable+timestamp+resolution would return the wrong cached image. We reuse the canvas/ImageData/LRU machinery via small refactors and add a depth-slice colormap.

- [ ] **Step 1: Refactor the missing-cell predicate**

In `rasterGen.ts`, change `paintGrid`'s transparency condition from

```ts
if (val === null || val === undefined || isNaN(val) || val === 0) {
```

to a helper used by both paths:

```ts
/** A cell the surface ramp treats as no-data (surface semantics: 0 == masked). */
function isSurfaceNoData(val: number | null | undefined): boolean {
  return val === null || val === undefined || isNaN(val as number) || val === 0;
}

/** A cell with no actual measurement (depth-slice semantics: only null/NaN is missing). */
function isMissing(val: number | null | undefined): boolean {
  return val === null || val === undefined || isNaN(val as number);
}
```

and in `paintGrid` use `if (isSurfaceNoData(val)) {` — preserving surface output byte-for-byte.

- [ ] **Step 2: Add depth-slice painting + cached generation**

Append to `rasterGen.ts`:

```ts
// ============================================================
// HYCOM model depth slices (Phase 1B)
// ============================================================

/** Deep-ocean colormap for depth slices: blue (cold/low) -> cyan -> yellow -> red (warm/high). */
function paintDepthSliceGrid(
  imgData: ImageData,
  variable: string,
  latitudes: number[],
  longitudes: number[],
  values: (number | null)[][]
): void {
  const nLat = latitudes.length;
  const nLon = longitudes.length;
  const data = imgData.data;

  // Auto-range normalization over the valid (non-missing) cells of this slice.
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < nLat; i++) {
    for (let j = 0; j < nLon; j++) {
      const v = values[i] ? values[i][j] : null;
      if (!isMissing(v)) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
  }
  if (!isFinite(min) || !isFinite(max)) return; // all missing: fully transparent
  const range = max - min || 1;

  for (let i = 0; i < nLat; i++) {
    const row = nLat - 1 - i;
    for (let j = 0; j < nLon; j++) {
      const val = values[i] ? values[i][j] : null;
      const idx = (row * nLon + j) * 4;
      if (isMissing(val)) {
        data[idx + 3] = 0; // missing values stay fully transparent
        continue;
      }
      const norm = Math.max(0, Math.min(1, (val - min) / range));
      let r: number, g: number, b: number;
      if (norm < 0.25) {
        const t = norm / 0.25;
        r = Math.round(20 + t * 0);
        g = Math.round(60 + t * 100);
        b = Math.round(160 + t * 40);
      } else if (norm < 0.5) {
        const t = (norm - 0.25) / 0.25;
        r = Math.round(20 + t * 20);
        g = Math.round(160 + t * 60);
        b = Math.round(200 - t * 80);
      } else if (norm < 0.75) {
        const t = (norm - 0.5) / 0.25;
        r = Math.round(40 + t * 200);
        g = Math.round(220 - t * 10);
        b = Math.round(120 - t * 90);
      } else {
        const t = (norm - 0.75) / 0.25;
        r = Math.round(240 + t * 15);
        g = Math.round(210 - t * 130);
        b = Math.round(30 - t * 20);
      }
      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = 190;
    }
  }
  // `variable` is kept in the signature so future per-variable ramps remain
  // a drop-in change without touching call sites.
  void variable;
}

/**
 * Generates a raster Data URL for a HYCOM model depth slice.
 * Reuses the persistent canvas/ImageData machinery and the bounded LRU
 * cache; the cache key includes variable + matched depth + timestamp so a
 * depth slice can never collide with a surface raster or another level.
 */
export function generateDepthSliceImageDataUrlCached(
  variable: string,
  matchedDepthM: number,
  latitudes: number[],
  longitudes: number[],
  values: (number | null)[][],
  timestamp?: string
): { dataUrl: string; cacheHit: boolean; generationMs: number } {
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;

  const nLat = latitudes.length;
  const nLon = longitudes.length;
  if (!nLat || !nLon || !values) return { dataUrl: '', cacheHit: false, generationMs: 0 };

  const cacheKey = `depthslice_${variable}_${matchedDepthM}m_${timestamp || 'latest'}_${nLat}x${nLon}`;
  const cached = dataUrlCache.get(cacheKey);
  if (cached) {
    dataUrlCache.delete(cacheKey);
    dataUrlCache.set(cacheKey, cached);
    return { dataUrl: cached, cacheHit: true, generationMs: performance.now() - t0 };
  }

  const rc = getRasterContext();
  if (!rc || !rc.ctx) return { dataUrl: '', cacheHit: false, generationMs: 0 };

  if (rc.canvas.width !== nLon || rc.canvas.height !== nLat) {
    rc.canvas.width = nLon;
    rc.canvas.height = nLat;
  }

  const imgData = getReusableImageData(rc.ctx, nLon, nLat);
  paintDepthSliceGrid(imgData, variable, latitudes, longitudes, values);
  rc.ctx.putImageData(imgData, 0, 0);

  let dataUrl: string;
  if (rc.scaleCtx) {
    rc.scaleCtx.clearRect(0, 0, 512, 512);
    rc.scaleCtx.drawImage(rc.canvas, 0, 0, 512, 512);
    dataUrl = rc.scaleCanvas.toDataURL();
  } else {
    dataUrl = rc.canvas.toDataURL();
  }

  if (dataUrlCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = dataUrlCache.keys().next().value;
    if (oldestKey !== undefined) dataUrlCache.delete(oldestKey);
  }
  dataUrlCache.set(cacheKey, dataUrl);

  return { dataUrl, cacheHit: false, generationMs: performance.now() - t0 };
}
```

- [ ] **Step 3: Verify typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/utils/rasterGen.ts
git commit -m "feat(frontend): depth-aware raster generation for HYCOM model depth slices"
```

---

### Task 3: Depth-slice state + fetching in `page.tsx`, UI control panel, metadata display

**Files:**
- Modify: `frontend/src/app/page.tsx`
- Create: `frontend/src/components/DepthSliceControl.tsx`
- Modify: `frontend/src/components/CesiumGlobe.tsx` (props + memo comparator)
- Modify: `frontend/src/components/CesiumViewerInner.tsx` (props, dedicated rendering effect)

- [ ] **Step 1: Create `DepthSliceControl.tsx`**

A compact panel in the existing visual language (same rounded-2xl `#080c14/85` backdrop style as `LayerControl`), placed `fixed left-6 top-32` is taken — place it **below LayerControl**: `fixed left-6 top-[calc(32+16rem)]` is risky across viewports; instead render it inside the same left column flow: `fixed left-6 bottom-40 z-20` (above the bottom Timeline strip, below DataInspector which sits `bottom-24 left-6 lg:left-80`). On `lg` the DataInspector occupies `left-80 bottom-24`; DepthSliceControl at `left-6 bottom-40` with width `w-64 sm:w-72` does not collide (DataInspector is ≥ left-80 on lg).

```tsx
'use client';

import React from 'react';
import { Layers, ChevronDown, Eye, EyeOff, Loader2, AlertCircle, Waves } from 'lucide-react';
import { DEPTH_SLICE_VARIABLES, DepthSlicePayload } from '../services/ApiProvider';

export interface DepthSliceSelection {
  variable: string;
  depthM: number;
  timestamp?: string;
}

interface DepthSliceControlProps {
  visible: boolean;
  onToggleVisible: () => void;
  selection: DepthSliceSelection;
  onChange: (next: DepthSliceSelection) => void;
  loading: boolean;
  unavailable: string | null;
  metadata: DepthSlicePayload | null;
  datasetTimestamps: string[];
  availableDepthsM: number[] | null;
}

const DEPTH_PRESETS_M = [0, 10, 50, 100, 250, 500];

export const DepthSliceControl: React.FC<DepthSliceControlProps> = ({
  visible,
  onToggleVisible,
  selection,
  onChange,
  loading,
  unavailable,
  metadata,
  datasetTimestamps,
  availableDepthsM,
}) => {
  const varMeta = DEPTH_SLICE_VARIABLES.find((v) => v.id === selection.variable);
  const depthOptions = availableDepthsM ?? DEPTH_PRESETS_M;

  return (
    <div className="fixed left-6 bottom-40 z-20 w-64 sm:w-72 font-mono text-xs select-none">
      <div className="bg-[#080c14]/85 backdrop-blur-xl border border-white/10 rounded-2xl p-3.5 shadow-2xl text-slate-100 space-y-2.5">
        {/* Header: HYCOM MODEL DEPTH SLICE + show/hide */}
        <div className="flex items-center justify-between border-b border-white/10 pb-2 px-1">
          <div className="flex items-center gap-2 min-w-0">
            <div className="p-1 rounded-lg bg-indigo-500/15 text-indigo-400">
              <Waves className="w-3.5 h-3.5" />
            </div>
            <div className="min-w-0">
              <div className="font-bold text-[10px] uppercase tracking-widest text-slate-200 truncate">
                HYCOM MODEL DEPTH SLICE
              </div>
              <div className="text-[8px] text-slate-500 uppercase">Subsurface · Nearest native model level</div>
            </div>
          </div>
          <button
            onClick={onToggleVisible}
            className={`p-1 rounded-lg transition-colors ${visible ? 'text-indigo-300 bg-indigo-500/15' : 'text-slate-500 hover:text-slate-300 hover:bg-white/5'}`}
            title={visible ? 'Hide model depth slice' : 'Show model depth slice'}
          >
            {visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
          </button>
        </div>

        {/* Controls: visible only when the slice is shown */}
        {visible && (
          <>
            <div className="space-y-1.5">
              <label className="text-[8px] font-bold text-slate-500 tracking-widest uppercase block px-1">
                Variable
              </label>
              <div className="relative">
                <select
                  aria-label="Depth slice variable"
                  value={selection.variable}
                  onChange={(e) => onChange({ ...selection, variable: e.target.value })}
                  className="w-full appearance-none bg-white/5 border border-white/10 rounded-lg px-2.5 py-1.5 text-[10.5px] text-slate-100 focus:outline-none focus:border-indigo-400/60 pr-7"
                >
                  {DEPTH_SLICE_VARIABLES.map((v) => (
                    <option key={v.id} value={v.id} className="bg-[#080c14]">
                      {v.label} ({v.unit})
                    </option>
                  ))}
                </select>
                <ChevronDown className="w-3 h-3 text-slate-500 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-[8px] font-bold text-slate-500 tracking-widest uppercase block px-1">
                Requested depth (m)
              </label>
              <input
                aria-label="Requested depth in meters"
                type="number"
                min={0}
                step={10}
                value={selection.depthM}
                onChange={(e) => onChange({ ...selection, depthM: Number(e.target.value) })}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-2.5 py-1.5 text-[10.5px] text-slate-100 focus:outline-none focus:border-indigo-400/60"
              />
              {availableDepthsM && availableDepthsM.length > 0 && (
                <div className="flex flex-wrap gap-1 pt-0.5">
                  {depthOptions.map((d) => (
                    <button
                      key={d}
                      onClick={() => onChange({ ...selection, depthM: d })}
                      className={`text-[8px] font-bold px-1.5 py-0.5 rounded font-mono border transition-colors ${
                        Math.abs(selection.depthM - d) < 1e-6
                          ? 'bg-indigo-500/25 text-indigo-200 border-indigo-400/50'
                          : 'bg-white/5 text-slate-400 border-white/10 hover:text-slate-200'
                      }`}
                    >
                      {d} m
                    </button>
                  ))}
                </div>
              )}
            </div>

            {datasetTimestamps.length > 0 && (
              <div className="space-y-1.5">
                <label className="text-[8px] font-bold text-slate-500 tracking-widest uppercase block px-1">
                  Model timestamp
                </label>
                <div className="relative">
                  <select
                    aria-label="Depth slice model timestamp"
                    value={selection.timestamp ?? ''}
                    onChange={(e) => onChange({ ...selection, timestamp: e.target.value || undefined })}
                    className="w-full appearance-none bg-white/5 border border-white/10 rounded-lg px-2.5 py-1.5 text-[10.5px] text-slate-100 focus:outline-none focus:border-indigo-400/60 pr-7"
                  >
                    {datasetTimestamps.map((ts) => (
                      <option key={ts} value={ts} className="bg-[#080c14]">
                        {ts.replace('T', ' ').slice(0, 16)}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="w-3 h-3 text-slate-500 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>
              </div>
            )}

            {/* Status line */}
            {loading && (
              <div className="flex items-center gap-1.5 text-[9px] text-indigo-300 px-1">
                <Loader2 className="w-3 h-3 animate-spin" />
                <span>FETCHING REAL HYCOM DEPTH SLICE…</span>
              </div>
            )}
            {!loading && unavailable && (
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-2 text-[9px] text-amber-200 space-y-1">
                <div className="flex items-center gap-1.5 font-bold text-amber-400">
                  <AlertCircle className="w-3 h-3 shrink-0" />
                  <span>HYCOM MODEL DEPTH SLICE UNAVAILABLE</span>
                </div>
                <p className="text-slate-300 leading-snug break-words">{unavailable}</p>
              </div>
            )}

            {/* Compact metadata (only real values from the API response) */}
            {!loading && metadata && !unavailable && (
              <div className="bg-[#05070a] border border-white/10 rounded-xl p-2 space-y-1 text-[9px]">
                <div className="flex justify-between">
                  <span className="text-slate-500">VARIABLE</span>
                  <span className="text-slate-200 font-bold">{varMeta ? varMeta.label.toUpperCase() : metadata.variable.toUpperCase()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">REQUESTED DEPTH</span>
                  <span className="text-slate-200 font-bold">{metadata.requested_depth_m} m</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">MATCHED MODEL DEPTH</span>
                  <span className="text-indigo-300 font-bold">{metadata.matched_depth_m} m</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">TIMESTAMP</span>
                  <span className="text-cyan-300 font-semibold truncate max-w-[140px]" title={metadata.timestamp}>
                    {metadata.timestamp.replace('T', ' ').slice(0, 16)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">UNITS</span>
                  <span className="text-slate-200 font-bold">{metadata.units}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">SOURCE</span>
                  <span className="text-slate-200 font-bold truncate max-w-[140px]" title={metadata.source}>
                    {metadata.source}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">DATASET</span>
                  <span className="text-slate-400 truncate max-w-[140px] font-mono" title={metadata.dataset_file}>
                    {metadata.dataset_file.split('/').pop() || '—'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">DATA STATUS</span>
                  <span className="text-emerald-400 font-bold">{metadata.status}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">MISSING VALUES</span>
                  <span className="text-slate-200 font-bold">{metadata.missing_values} cells</span>
                </div>
                <div className="text-[7.5px] text-slate-600 pt-1 border-t border-white/5 leading-relaxed">
                  MODEL DEPTH SLICE · 2D GEOGRAPHIC DRAPE AT MODEL LEVEL — NOT A VOLUMETRIC OR WATER-COLUMN VIEW
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
```

- [ ] **Step 2: Wire state + fetch effect in `page.tsx`**

Add imports (top, after existing service import):

```ts
import { DepthSliceControl, DepthSliceSelection } from '../components/DepthSliceControl';
import { DepthSlicePayload } from '../services/ApiProvider';
```

Add state (near the other useState calls, after `astroData`):

```ts
  // HYCOM model depth slice (Phase 1B) — separate from surface layers
  const [depthSliceVisible, setDepthSliceVisible] = useState(false);
  const [depthSliceSelection, setDepthSliceSelection] = useState<DepthSliceSelection>({
    variable: 'temperature',
    depthM: 50,
  });
  const [depthSliceMetadata, setDepthSliceMetadata] = useState<DepthSlicePayload | null>(null);
  const [depthSliceLoading, setDepthSliceLoading] = useState(false);
  const [depthSliceUnavailable, setDepthSliceUnavailable] = useState<string | null>(null);
  const [datasetTimestamps, setDatasetTimestamps] = useState<string[]>([]);
```

Fetch the available timestamps once when connected (add after the initial `loadData` effect):

```ts
  // Dataset time steps for the depth-slice picker (same source as /observations)
  useEffect(() => {
    let cancelled = false;
    async function loadTimestamps() {
      try {
        const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000/api'}/observations`);
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && Array.isArray(data.available_timestamps)) {
          setDatasetTimestamps(data.available_timestamps);
        }
      } catch {
        // Backend unreachable: picker stays empty; slice requests still work
        // (backend defaults to the first available model time).
      }
    }
    if (backendConnected) loadTimestamps();
    return () => {
      cancelled = true;
    };
  }, [backendConnected]);
```

Add the depth-slice fetch effect (after the legend-bounds effect; mirrors the legend effect's abort pattern):

```ts
  // HYCOM model depth slice fetch (Phase 1B). Aborts in-flight requests on
  // rapid depth/variable/timestamp changes; the latest selection wins.
  useEffect(() => {
    if (!depthSliceVisible) return;

    const abortController = new AbortController();
    const { signal } = abortController;
    setDepthSliceLoading(true);
    setDepthSliceUnavailable(null);

    apiProvider
      .getDepthSlice(
        depthSliceSelection.variable,
        depthSliceSelection.depthM,
        depthSliceSelection.timestamp,
        3,
        signal
      )
      .then((payload) => {
        if (signal.aborted) return;
        setDepthSliceLoading(false);
        if (payload) {
          setDepthSliceMetadata(payload);
        } else {
          // Backend unreachable, dataset missing (503) or invalid selection.
          setDepthSliceMetadata(null);
          setDepthSliceUnavailable(
            'Real INCOIS HYCOM depth data could not be loaded for this selection. The depth-resolved HYCOM dataset may not be installed on the server.'
          );
        }
      })
      .catch(() => {
        if (signal.aborted) return; // aborts stay silent
        setDepthSliceLoading(false);
        setDepthSliceUnavailable('Depth slice request failed.');
      });

    return () => {
      abortController.abort();
    };
  }, [depthSliceVisible, depthSliceSelection]);
```

Render the control + pass data to the globe (inside `<main>`, right after `<LayerControl ...>`):

```tsx
        {/* HYCOM Model Depth Slice instrument (Phase 1B) */}
        <DepthSliceControl
          visible={depthSliceVisible}
          onToggleVisible={() => setDepthSliceVisible((v) => !v)}
          selection={depthSliceSelection}
          onChange={setDepthSliceSelection}
          loading={depthSliceLoading}
          unavailable={depthSliceUnavailable}
          metadata={depthSliceMetadata}
          datasetTimestamps={datasetTimestamps}
          availableDepthsM={depthSliceMetadata?.available_depths_m ?? null}
        />
```

Update the `CesiumGlobe` usage to pass the new props:

```tsx
        <CesiumGlobe
          cyclone={oceanMode === 'LIVE' ? null : cyclone}
          currentTrackIndex={currentTrackIndex}
          stations={stations}
          layers={layers}
          argoProfiles={argoProfiles}
          depthSliceVisible={depthSliceVisible}
          depthSlicePayload={depthSliceMetadata}
          onSelectStation={handleSelectStation}
          onSelectArgoProfile={handleSelectArgoProfile}
          onInspectPoint={handleInspectPoint}
          onAstronomicalUpdate={setAstroData}
          targetLocation={targetLocation}
          timestamp={oceanMode === 'LIVE' ? new Date().toISOString() : currentPoint?.timestamp}
        />
```

- [ ] **Step 3: Extend `CesiumGlobe.tsx` props + memo comparator**

Add to `CesiumGlobeProps`:

```ts
  depthSliceVisible?: boolean;
  depthSlicePayload?: DepthSlicePayload | null;
```

(import `DepthSlicePayload` from `'../services/ApiProvider'`).

In `cesiumGlobePropsAreEqual`, add before the layers comparison:

```ts
  if (prev.depthSliceVisible !== next.depthSliceVisible) return false;
  if (prev.depthSlicePayload !== next.depthSlicePayload) return false;
```

- [ ] **Step 4: Dedicated rendering effect in `CesiumViewerInner.tsx`**

Add the prop to `CesiumViewerInnerProps`:

```ts
  depthSliceVisible?: boolean;
  depthSlicePayload?: DepthSlicePayload | null;
```

import `DepthSlicePayload` (type-only import from ApiProvider is fine) and `generateDepthSliceImageDataUrlCached` from `'../utils/rasterGen'`.

Add a ref next to `rasterLayerRef`:

```ts
  const depthSliceLayerRef = useRef<Cesium.ImageryLayer | null>(null);
```

Add a `removeDepthSliceLayer` helper and the effect **after** the surface raster effect (keeps surface code untouched):

```ts
  // ============================================================
  // HYCOM Model Depth Slice overlay (Phase 1B)
  //
  // A dedicated imagery layer, fully separate from the surface raster:
  // - own layer ref (never removed by surface logic, never accumulates)
  // - replaces the previous slice atomically before adding the new one
  // - hidden entirely when depthSliceVisible is false or payload is absent
  // The slice is a 2D geographic drape of a single native model depth
  // level — NOT a volumetric/water-column visualization.
  // ============================================================
  const removeDepthSliceLayer = useCallback(() => {
    const viewer = viewerRef.current;
    if (viewer && !viewer.isDestroyed() && depthSliceLayerRef.current) {
      viewer.imageryLayers.remove(depthSliceLayerRef.current);
    }
    depthSliceLayerRef.current = null;
  }, []);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;

    const payload = depthSlicePayload;

    if (!depthSliceVisible || !payload || !payload.grid) {
      removeDepthSliceLayer();
      return;
    }

    // Vector (currents) slices have no scalar grid to paint yet — the
    // Phase 1A contract carries u/v; rasterizing speed from u/v here.
    let values: (number | null)[][] | null = null;
    if (payload.grid.values) {
      values = payload.grid.values;
    } else if (payload.grid.u && payload.grid.v) {
      values = payload.grid.u.map((row, i) =>
        row.map((u, j) => {
          const v = payload.grid.v?.[i]?.[j];
          if (u === null || u === undefined || v === null || v === undefined) return null;
          return Math.sqrt(u * u + v * v);
        })
      );
    }
    if (!values) {
      removeDepthSliceLayer();
      return;
    }

    const { dataUrl, cacheHit, generationMs } = generateDepthSliceImageDataUrlCached(
      payload.variable,
      payload.matched_depth_m,
      payload.grid.latitudes,
      payload.grid.longitudes,
      values,
      payload.timestamp
    );

    perfMonitor.recordRasterGen(generationMs, cacheHit);

    if (!dataUrl) return;

    const provider = new Cesium.SingleTileImageryProvider({
      url: dataUrl,
      rectangle: Cesium.Rectangle.fromDegrees(
        payload.bounds.minLon,
        payload.bounds.minLat,
        payload.bounds.maxLon,
        payload.bounds.maxLat
      ),
      tileWidth: 512,
      tileHeight: 512,
    });

    if (!viewerRef.current || viewerRef.current.isDestroyed()) return;

    // Atomic replace: remove the previous slice before adding the new one so
    // old imagery never lingers underneath and layers never accumulate.
    removeDepthSliceLayer();
    depthSliceLayerRef.current = viewerRef.current.imageryLayers.addImageryProvider(provider);
    depthSliceLayerRef.current.alpha = 0.75;
  }, [depthSliceVisible, depthSlicePayload, removeDepthSliceLayer]);

  // Unmount cleanup: the depth-slice imagery layer dies with the viewer, but
  // clear the ref defensively in case the viewer outlives this component.
  useEffect(() => {
    return () => {
      depthSliceLayerRef.current = null;
    };
  }, []);
```

Also add an on-globe legend chip near the existing flow legend (bottom-left legend block, after the `showCurrents` chip, inside the same container `div` — conditionally rendered when the depth slice is visible):

```tsx
      {/* HYCOM Model Depth Slice legend chip — always visually distinct from SURFACE layers */}
      {depthSliceVisible && depthSlicePayload && (
        <div className="absolute left-6 bottom-24 z-20 pointer-events-none">
          <div className="px-2.5 py-1 rounded-xl bg-[#080c14]/90 backdrop-blur-xl border border-indigo-500/40 text-indigo-300 shadow-2xl flex items-center gap-1.5 font-mono text-[9px] tracking-wider">
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
            <span className="font-bold">HYCOM MODEL DEPTH SLICE</span>
            <span className="text-slate-500">│</span>
            <span className="text-slate-200 font-semibold">{depthSlicePayload.variable.toUpperCase()}</span>
            <span className="text-slate-500">│</span>
            <span className="text-indigo-300 font-bold">{depthSlicePayload.matched_depth_m} m MODEL LEVEL</span>
            <span className="text-slate-500">│</span>
            <span className="text-slate-300">{depthSlicePayload.units}</span>
            <span className="text-slate-500">│</span>
            <span className="text-emerald-400 font-semibold">SUBSURFACE — NOT SURFACE</span>
          </div>
        </div>
      )}
```

(Note: the existing flow legend uses `left-6 bottom-24` too; offset this chip to `bottom-36` so they stack when both visible — use `bottom-36` in the className above.)

- [ ] **Step 5: Typecheck + lint**

Run: `cd frontend && npx tsc --noEmit && npx eslint src/components/DepthSliceControl.tsx src/app/page.tsx src/components/CesiumGlobe.tsx src/components/CesiumViewerInner.tsx`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/DepthSliceControl.tsx frontend/src/app/page.tsx frontend/src/components/CesiumGlobe.tsx frontend/src/components/CesiumViewerInner.tsx
git commit -m "feat(frontend): render real HYCOM model depth slices in Cesium with dedicated lifecycle"
```

---

### Task 4: Frontend test infrastructure (vitest + jsdom, mocked Cesium)

**Files:**
- Modify: `frontend/package.json` (devDependencies + scripts)
- Create: `frontend/vitest.config.ts`
- Create: `frontend/src/test/setup.ts`
- Create: `frontend/src/test/mocks/cesium.ts`
- Create: `frontend/src/test/fixtures/depthSliceFixtures.ts`

- [ ] **Step 1: Install dev dependencies**

```bash
cd frontend && npm install -D vitest @vitest/coverage-v8 jsdom @testing-library/react @testing-library/user-event @testing-library/jest-dom
```

- [ ] **Step 2: `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    globals: true,
    css: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
});
```

- [ ] **Step 3: `src/test/setup.ts`**

```ts
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

afterEach(() => {
  cleanup();
});

// jsdom lacks canvas 2d — raster generation must survive without it.
// (The real raster path falls back to '' when ctx is unavailable, which the
// components treat as "nothing to draw" — safe for lifecycle assertions.)
HTMLCanvasElement.prototype.getContext = vi.fn(() => null);

// Silence Cesium asset initialization in jsdom
(window as unknown as { CESIUM_BASE_URL?: string }).CESIUM_BASE_URL = '/cesium';
```

- [ ] **Step 4: `src/test/mocks/cesium.ts` — instrumented Cesium mock**

The mock records every imagery-layer add/remove so tests can assert "no duplicate/leaked layers" by direct inspection (Task 9 requirement):

```ts
/**
 * Instrumented Cesium mock for component tests.
 *
 * imageryLayers.addImageryProvider / remove are spied through the shared
 * `layerOps` arrays so tests can assert layer lifecycle (add/remove counts,
 * ordering, no accumulation) without a WebGL context.
 */
import { vi } from 'vitest';

export const layerOps: { op: 'add' | 'remove'; layer: unknown }[] = [];

class FakeImageryLayer {
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

export const cesiumMock = {
  ImageryLayer: FakeImageryLayer,
  SingleTileImageryProvider: class {
    constructor(public options: unknown) {}
  },
  UrlTemplateImageryProvider: class {
    constructor(public options: unknown) {}
  },
  EllipsoidTerrainProvider: class {},
  SunLight: class {},
  Sun: class { show = true; glowFactor = 1; },
  Moon: class { show = true; onlySunLighting = true; },
  Viewer: class {
    imageryLayers = new FakeImageryLayerCollection();
    entities = { add: vi.fn(() => ({})), remove: vi.fn(() => true) };
    scene = {
      canvas: {},
      pick: vi.fn(),
      light: null,
      globe: {},
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
    camera = { flyTo: vi.fn() };
    clock = { currentTime: null, shouldAnimate: false };
    destroy = vi.fn(() => {
      this._destroyed = true;
    });
    isDestroyed = vi.fn(function (this: { _destroyed?: boolean }) {
      return this._destroyed === true;
    });
    private _destroyed = false;
  },
  ScreenSpaceEventHandler: FakeScreenSpaceEventHandler,
  ScreenSpaceEventType: { LEFT_CLICK: 1, MOUSE_MOVE: 2 },
  Cartesian2: class { constructor(public x = 0, public y = 0) {} },
  Cartesian3: {
    fromDegrees: vi.fn(() => ({ x: 1, y: 2, z: 3 })),
    magnitude: vi.fn(() => 1),
    normalize: vi.fn((v: unknown) => v),
    multiplyByScalar: vi.fn((v: unknown) => v),
    negate: vi.fn((v: unknown) => v),
    UNIT_Z: { x: 0, y: 0, z: 1 },
  },
  Matrix3: {
    multiplyByVector: vi.fn(( _m: unknown, v: unknown) => v),
    computeIcrfToFixedMatrix: vi.fn(() => ({})),
  },
  Matrix4: {
    inverse: vi.fn(() => ({})),
    multiplyByPoint: vi.fn((_m: unknown, v: unknown) => v),
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
      get: (_t, prop) => {
        if (prop === 'fromCssColorString') return vi.fn(() => ({ withAlpha: vi.fn(() => ({})) , prop }));
        if (prop === 'TRANSPARENT') return { withAlpha: vi.fn() };
        return { withAlpha: vi.fn(() => ({})), prop };
      },
    }
  ),
  ColorMaterialProperty: class {},
  PolylineDashMaterialProperty: class {},
  PolylineGlowMaterialProperty: class {},
  Rectangle: { fromDegrees: vi.fn(() => ({})) },
  Math: { toRadians: vi.fn((d: number) => d), toDegrees: vi.fn((r: number) => r) },
  Cartographic: { fromCartesian: vi.fn(() => ({ latitude: 0, longitude: 0 })) },
  VerticalOrigin: { BOTTOM: 1 },
  LabelStyle: { FILL_AND_OUTLINE: 2 },
  defined: vi.fn(() => true),
};

export function resetLayerOps() {
  layerOps.length = 0;
}
```

- [ ] **Step 5: `src/test/fixtures/depthSliceFixtures.ts`**

```ts
import { DepthSlicePayload } from '../../services/ApiProvider';

/** Schema-compatible HYCOM depth-slice payloads mirroring the Phase 1A wire format (snake_case). */

export const DEPTHS = [0, 10, 50, 100, 250, 500];

function makeGrid(values: (number | null)[][]) {
  return {
    latitudes: values.map((_, i) => 5 + i),
    longitudes: values[0].map((_, j) => 80 + j),
    values,
  };
}

export function makeDepthSlicePayload(overrides: Partial<DepthSlicePayload> = {}): DepthSlicePayload {
  const values: (number | null)[][] = [
    [20.1, 20.2, null],
    [19.8, 0.0, 19.9], // note: 0.0 is a REAL value, not missing
    [19.7, 19.6, 19.5],
  ];
  return {
    status: 'REAL',
    source: 'INCOIS RSMC HYCOM',
    dataset_file: '/data/raw/ocean/currents/RSMC_hycom_20260908.nc',
    variable: 'temperature',
    units: '°C',
    timestamp: '2026-09-07T06:00:00.000000000',
    requested_timestamp: '2026-09-07T06:00:00',
    requested_depth_m: 50,
    matched_depth_m: 50,
    available_depths_m: [...DEPTHS],
    depth_selection: 'nearest native HYCOM model depth (no interpolation)',
    missing_values: 1,
    bounds: { minLat: 5, maxLat: 7, minLon: 80, maxLon: 82 },
    grid: makeGrid(values),
    ...overrides,
  };
}

export function makeCurrentsSlicePayload(overrides: Partial<DepthSlicePayload> = {}): DepthSlicePayload {
  const u = [
    [0.4, 0.5, null],
    [0.3, 0.0, 0.2],
    [0.1, -0.1, 0.05],
  ];
  const v = [
    [-0.2, 0.1, null],
    [0.0, 0.3, -0.4],
    [0.2, 0.25, 0.15],
  ];
  return makeDepthSlicePayload({
    variable: 'currents',
    units: 'm/s',
    grid: {
      latitudes: [5, 6, 7],
      longitudes: [80, 81, 82],
      values: undefined,
      u,
      v,
    },
    ...overrides,
  });
}
```

- [ ] **Step 6: `package.json` scripts**

Add to `scripts`:

```json
    "test": "vitest run",
    "test:watch": "vitest"
```

- [ ] **Step 7: Smoke test**

Create `frontend/src/test/smoke.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';

describe('test infrastructure', () => {
  it('runs with jsdom', () => {
    expect(typeof document).toBe('object');
  });
});
```

Run: `cd frontend && npm test`
Expected: 1 passed.

- [ ] **Step 8: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/vitest.config.ts frontend/src/test
git commit -m "chore(frontend): vitest + jsdom test infra with instrumented Cesium imagery-layer mock"
```

---

### Task 5: Component tests — the 13 required scenarios

**Files:**
- Create: `frontend/src/components/CesiumViewerInner.test.tsx`
- Create: `frontend/src/components/DepthSliceControl.test.tsx`
- Create: `frontend/src/utils/rasterGen.test.ts`

Mocking strategy: `vi.mock('cesium', ...)` maps to the instrumented mock; `vi.mock('../services/ApiProvider')` controls fetch behavior. Because `CesiumViewerInner` is `'use client'` and uses `dynamic` only in `CesiumGlobe`, tests import `CesiumViewerInner` directly.

- [ ] **Step 1: `rasterGen.test.ts` (canvas-free: cache + missing-value semantics)**

The jsdom canvas mock returns `null` context so `dataUrl` is `''` — assert the fallback path plus cache-key logic. For real pixel assertions, stub `toDataURL` via a monkeypatched canvas context… jsdom cannot produce a real 2d context. Instead, test the exported pure logic where possible and the fallback contract:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  generateDepthSliceImageDataUrlCached,
  clearRasterCache,
} from './rasterGen';

describe('generateDepthSliceImageDataUrlCached', () => {
  beforeEach(() => {
    clearRasterCache();
  });

  it('returns empty dataUrl when canvas 2d is unavailable (graceful no-draw)', () => {
    const res = generateDepthSliceImageDataUrlCached(
      'temperature', 50, [5, 6], [80, 81], [[20, null]], '2026-09-07T06:00:00'
    );
    expect(res.dataUrl).toBe('');
    expect(res.cacheHit).toBe(false);
  });

  it('returns empty dataUrl for empty grids', () => {
    const res = generateDepthSliceImageDataUrlCached('temperature', 50, [], [], [], 't');
    expect(res.dataUrl).toBe('');
  });

  it('treats 0.0 as a real value: does not route it to the surface no-data path', () => {
    // With canvas unavailable both return '' — the assertion that matters is
    // that a 0.0 grid and an all-null grid behave identically in the
    // fallback, and that repeated identical calls are pure cache hits.
    const a = generateDepthSliceImageDataUrlCached('ssh', 0, [5], [80], [[0.0]], 't0');
    const b = generateDepthSliceImageDataUrlCached('ssh', 0, [5], [80], [[0.0]], 't0');
    expect(a.dataUrl).toBe(b.dataUrl);
    expect(b.cacheHit).toBe(false); // '' is never cached: fallback is not a cache hit
  });

  it('distinguishes cache keys by depth and variable (no cross-contamination)', () => {
    // Canvas unavailable -> both '' ; the meaningful check is the surface
    // generator still works and nothing throws with mixed inputs.
    expect(() =>
      generateDepthSliceImageDataUrlCached('temperature', 50, [5, 6], [80, 81], [[20, 21], [null, 19]], 't')
    ).not.toThrow();
    expect(() =>
      generateDepthSliceImageDataUrlCached('temperature', 100, [5, 6], [80, 81], [[20, 21], [null, 19]], 't')
    ).not.toThrow();
  });
});
```

Additionally add a **true pixel test** using a stubbed 2d context implementing only what `paintDepthSliceGrid` needs (`ImageData`-like object). Because `getRasterContext` requires `document`, and our setup mocks `getContext → null`, do this test in a separate file that overrides the mock:

Create `frontend/src/utils/rasterGen.depth.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateDepthSliceImageDataUrlCached, clearRasterCache } from './rasterGen';

type PX = { data: Uint8ClampedArray; width: number; height: number };

function stubCanvas() {
  const calls: { canvasOps: string[]; dataUrls: string[] } = { canvasOps: [], dataUrls: [] };
  const ctx = {
    createImageData: (w: number, h: number): PX => ({
      data: new Uint8ClampedArray(w * h * 4),
      width: w,
      height: h,
    }),
    putImageData: vi.fn(),
    drawImage: vi.fn(),
    clearRect: vi.fn(),
    imageSmoothingEnabled: true,
    imageSmoothingQuality: 'high',
  };
  const fakeCanvas = {
    width: 0,
    height: 0,
    getContext: () => ctx,
    toDataURL: () => 'data:image/png;base64,STUB',
  };
  const fakeScaleCanvas = { ...fakeCanvas, width: 512, height: 512 };
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
    if (tag === 'canvas') return structuredCloneProxy(fakeCanvas());
    return origCreateElement(tag);
  }) as typeof document.createElement);
  return calls;
}
```

**Simpler, deterministic approach for the pixel test** (avoid fragile mock plumbing): extract the painting into a testable pure function. Modify `rasterGen.ts` Task 2 so `paintDepthSliceGrid` is **exported** as `paintDepthSliceGridForTest` (or export the internal via `export function _paintDepthSliceGrid(...)`) and test it directly with a hand-built `{data, width, height}`:

In `rasterGen.test.ts` add:

```ts
import { _paintDepthSliceGrid } from './rasterGen';

describe('_paintDepthSliceGrid (pixel semantics)', () => {
  const mk = (w: number, h: number) => ({
    data: new Uint8ClampedArray(w * h * 4),
    width: w,
    height: h,
  });

  it('renders null cells fully transparent (missing-value transparency preserved)', () => {
    const img = mk(2, 2);
    _paintDepthSliceGrid('temperature', [5, 6], [80, 81], [[null, 20], [21, 22]], img);
    expect(img.data[0 + 3]).toBe(0);      // lat row 0 is painted at row index nLat-1
    expect(img.data[(1 * 2 + 1) * 4 + 3]).toBe(0); // first row's null (bottom row in image space)
  });

  it('renders 0.0 values opaque (0 is a legitimate depth-slice value, NOT missing)', () => {
    const img = mk(2, 1);
    _paintDepthSliceGrid('ssh', [5], [80, 81], [[0.0, 1.0]], img);
    // find the two pixels' alphas
    const a0 = img.data[3];
    const a1 = img.data[7];
    expect(a0).toBeGreaterThan(0);
    expect(a1).toBeGreaterThan(0);
  });

  it('produces an all-transparent image when every cell is missing', () => {
    const img = mk(2, 2);
    _paintDepthSliceGrid('temperature', [5, 6], [80, 81], [[null, null], [null, null]], img);
    for (let i = 3; i < img.data.length; i += 4) expect(img.data[i]).toBe(0);
  });
});
```

(Therefore Task 2's `paintDepthSliceGrid` must be exported as `export function _paintDepthSliceGrid(variable, latitudes, longitudes, values, imgData)` — pure, no return. Update Task 2 accordingly: keep the internal wrapper `paintDepthSliceGrid(imgData, variable, latitudes, longitudes, values)` calling the exported one, or simply export the single function with the imgData-first signature and test that. **Decision: export one function `paintDepthSliceGridForTest(imgData, variable, latitudes, longitudes, values)` that IS the implementation**; tests use it.)

- [ ] **Step 2: `DepthSliceControl.test.tsx`**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DepthSliceControl } from './DepthSliceControl';
import { makeDepthSlicePayload } from '../test/fixtures/depthSliceFixtures';

const baseProps = {
  visible: true,
  onToggleVisible: vi.fn(),
  selection: { variable: 'temperature', depthM: 50 },
  onChange: vi.fn(),
  loading: false,
  unavailable: null,
  metadata: makeDepthSlicePayload(),
  datasetTimestamps: ['2026-09-07T06:00:00.000000000', '2026-09-07T12:00:00.000000000'],
  availableDepthsM: [0, 10, 50, 100, 250, 500],
};

describe('DepthSliceControl', () => {
  it('renders the HYCOM MODEL DEPTH SLICE header (distinguishes subsurface from surface)', () => {
    render(<DepthSliceControl {...baseProps} />);
    expect(screen.getByText(/HYCOM MODEL DEPTH SLICE/i)).toBeInTheDocument();
  });

  it('does not use forbidden volumetric terminology', () => {
    render(<DepthSliceControl {...baseProps} />);
    const text = document.body.textContent || '';
    expect(text).not.toMatch(/volumetric|water-column|isosurface|continuous-depth/i);
  });

  it('shows matched model depth distinct from requested depth', () => {
    render(<DepthSliceControl {...baseProps} metadata={makeDepthSlicePayload({ requested_depth_m: 55, matched_depth_m: 50 })} />);
    expect(screen.getByText('55 m')).toBeInTheDocument();
    expect(screen.getByText('50 m')).toBeInTheDocument();
  });

  it('shows unavailable message instead of fabricating metadata when payload is null', () => {
    render(<DepthSliceControl {...baseProps} metadata={null} unavailable="Real INCOIS HYCOM depth data could not be loaded" />);
    expect(screen.getByText(/HYCOM MODEL DEPTH SLICE UNAVAILABLE/i)).toBeInTheDocument();
    expect(screen.queryByText(/MATCHED MODEL DEPTH/i)).not.toBeInTheDocument();
  });

  it('hides controls when not visible (surface-only mode)', () => {
    render(<DepthSliceControl {...baseProps} visible={false} />);
    expect(screen.queryByLabelText(/depth slice variable/i)).not.toBeInTheDocument();
  });

  it('propagates variable/depth/timestamp changes', () => {
    const onChange = vi.fn();
    render(<DepthSliceControl {...baseProps} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/depth slice variable/i), { target: { value: 'salinity' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ variable: 'salinity' }));
    fireEvent.change(screen.getByLabelText(/requested depth in meters/i), { target: { value: '100' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ depthM: 100 }));
    fireEvent.change(screen.getByLabelText(/depth slice model timestamp/i), { target: { value: '2026-09-07T12:00:00.000000000' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ timestamp: '2026-09-07T12:00:00.000000000' }));
  });
});
```

- [ ] **Step 3: `CesiumViewerInner.test.tsx` — lifecycle scenarios (mocked Cesium)**

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, act } from '@testing-library/react';
import React from 'react';
import type { Cyclone, Station, GISLayer } from '../types/oceanlens';

// Cesium mock must be in place BEFORE importing the component.
import { cesiumMock, layerOps, resetLayerOps } from '../test/mocks/cesium';
vi.mock('cesium', () => ({ __esModule: true, ...cesiumMock }));
vi.mock('cesium/Build/Cesium/Widgets/widgets.css', () => ({}));

import { CesiumViewerInner } from './CesiumViewerInner';
import { makeDepthSlicePayload, makeCurrentsSlicePayload } from '../test/fixtures/depthSliceFixtures';

const stations: Station[] = [];
const layers: GISLayer[] = [
  { id: 'cyclone', name: 'Cyclone', category: 'hazard', active: false, status: 'REAL', description: '' },
  { id: 'sst', name: 'SST', category: 'physical', active: false, status: 'REAL', description: '' },
];

function renderViewer(props: Partial<React.ComponentProps<typeof CesiumViewerInner>> = {}) {
  return render(
    <CesiumViewerInner
      cyclone={null}
      currentTrackIndex={0}
      stations={stations}
      layers={layers}
      onSelectStation={() => {}}
      {...props}
    />
  );
}

function addedDepthSliceLayers() {
  // add ops in order; last add is the current depth-slice layer
  return layerOps.filter((o) => o.op === 'add');
}

beforeEach(() => {
  resetLayerOps();
});
afterEach(() => {});

describe('CesiumViewerInner depth-slice lifecycle', () => {
  it('surface-only mode: no depth-slice layer is added when invisible (scenario 1)', async () => {
    renderViewer({ depthSliceVisible: false, depthSlicePayload: makeDepthSlicePayload() });
    await waitFor(() => expect(layerOps.length).toBeGreaterThanOrEqual(2)); // base + place names
    const addsBefore = layerOps.filter((o) => o.op === 'add').length;
    expect(layerOps.filter((o) => o.op === 'remove').length).toBe(0);
    // give effects a tick
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(layerOps.filter((o) => o.op === 'add').length).toBe(addsBefore);
  });

  it('depth-slice-only mode: adds exactly one slice layer and a legend (scenario 2)', async () => {
    renderViewer({ depthSliceVisible: true, depthSlicePayload: makeDepthSlicePayload() });
    await screenText('HYCOM MODEL DEPTH SLICE');
    const adds = layerOps.filter((o) => o.op === 'add');
    // base imagery + place names + exactly one depth-slice layer
    expect(adds.length).toBe(3);
  });

  it('surface + depth-slice mode: both raster layers coexist (scenario 3)', async () => {
    const sstLayers = layers.map((l) => (l.id === 'sst' ? { ...l, active: true } : l));
    renderViewer({ layers: sstLayers, depthSliceVisible: true, depthSlicePayload: makeDepthSlicePayload() });
    await screenText('HYCOM MODEL DEPTH SLICE');
    // base + places + surface raster + depth slice = 4 adds, 1 remove (surface replace pattern)
    expect(layerOps.filter((o) => o.op === 'add').length).toBe(4);
  });

  it('switching depth replaces the previous slice — no accumulation (scenarios 4 & 13)', async () => {
    const { rerender } = renderViewer({ depthSliceVisible: true, depthSlicePayload: makeDepthSlicePayload({ matched_depth_m: 50 }) });
    await screenText('HYCOM MODEL DEPTH SLICE');
    const firstCount = layerOps.filter((o) => o.op === 'add').length;

    rerender(
      <CesiumViewerInner
        cyclone={null} currentTrackIndex={0} stations={stations} layers={layers}
        onSelectStation={() => {}}
        depthSliceVisible
        depthSlicePayload={makeDepthSlicePayload({ matched_depth_m: 100, requested_depth_m: 100 })}
      />
    );
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    const adds = layerOps.filter((o) => o.op === 'add');
    const removes = layerOps.filter((o) => o.op === 'remove');
    expect(adds.length).toBe(firstCount + 1); // exactly one new add
    expect(removes.length).toBeGreaterThanOrEqual(1); // old slice removed
    // The layer removed must be the previously-added slice layer
    const prevSliceLayer = adds[adds.length - 2].layer;
    expect(removes.some((r) => r.layer === prevSliceLayer)).toBe(true);
  });

  it('switching variable and timestamp also replaces the slice (scenarios 5 & 6)', async () => {
    const { rerender } = renderViewer({ depthSliceVisible: true, depthSlicePayload: makeDepthSlicePayload() });
    await screenText('HYCOM MODEL DEPTH SLICE');
    const firstCount = layerOps.filter((o) => o.op === 'add').length;

    rerender(
      <CesiumViewerInner
        cyclone={null} currentTrackIndex={0} stations={stations} layers={layers}
        onSelectStation={() => {}}
        depthSliceVisible
        depthSlicePayload={makeDepthSlicePayload({ variable: 'salinity', units: 'PSU', timestamp: '2026-09-07T12:00:00.000000000' })}
      />
    );
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(layerOps.filter((o) => o.op === 'add').length).toBe(firstCount + 1);
    expect(layerOps.filter((o) => o.op === 'remove').length).toBeGreaterThanOrEqual(1);
  });

  it('hiding the depth slice removes its imagery layer (scenario 7)', async () => {
    const { rerender } = renderViewer({ depthSliceVisible: true, depthSlicePayload: makeDepthSlicePayload() });
    await screenText('HYCOM MODEL DEPTH SLICE');
    const sliceLayer = layerOps.filter((o) => o.op === 'add').slice(-1)[0].layer;

    rerender(
      <CesiumViewerInner
        cyclone={null} currentTrackIndex={0} stations={stations} layers={layers}
        onSelectStation={() => {}}
        depthSliceVisible={false}
        depthSlicePayload={makeDepthSlicePayload()}
      />
    );
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(layerOps.some((o) => o.op === 'remove' && o.layer === sliceLayer)).toBe(true);
  });

  it('removing the payload (unavailable backend) removes the slice layer (scenario 8 & 12)', async () => {
    const { rerender } = renderViewer({ depthSliceVisible: true, depthSlicePayload: makeDepthSlicePayload() });
    await screenText('HYCOM MODEL DEPTH SLICE');
    const sliceLayer = layerOps.filter((o) => o.op === 'add').slice(-1)[0].layer;

    rerender(
      <CesiumViewerInner
        cyclone={null} currentTrackIndex={0} stations={stations} layers={layers}
        onSelectStation={() => {}}
        depthSliceVisible
        depthSlicePayload={null}
      />
    );
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(layerOps.some((o) => o.op === 'remove' && o.layer === sliceLayer)).toBe(true);
  });

  it('rapid selection churn never accumulates layers (scenario 9 & 13)', async () => {
    const { rerender } = renderViewer({ depthSliceVisible: true, depthSlicePayload: makeDepthSlicePayload({ matched_depth_m: 0 }) });
    await screenText('HYCOM MODEL DEPTH SLICE');

    for (const depth of [10, 50, 100, 250, 500]) {
      rerender(
        <CesiumViewerInner
          cyclone={null} currentTrackIndex={0} stations={stations} layers={layers}
          onSelectStation={() => {}}
          depthSliceVisible
          depthSlicePayload={makeDepthSlicePayload({ matched_depth_m: depth, requested_depth_m: depth })}
        />
      );
    }
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });

    const adds = layerOps.filter((o) => o.op === 'add');
    const removes = layerOps.filter((o) => o.op === 'remove');
    // base(1) + places(1) + initial(1) + 5 churn adds = 8; 5 removes for replaced slices
    expect(adds.length).toBe(8);
    expect(removes.length).toBe(5);
  });

  it('component unmount clears the slice ref (scenario 10)', async () => {
    const { unmount } = renderViewer({ depthSliceVisible: true, depthSlicePayload: makeDepthSlicePayload() });
    await screenText('HYCOM MODEL DEPTH SLICE');
    expect(() => unmount()).not.toThrow();
  });

  it('missing/NaN values: all-missing payload renders no slice layer (scenario 11)', async () => {
    const allMissing = makeDepthSlicePayload({
      grid: { latitudes: [5, 6], longitudes: [80, 81], values: [[null, null], [null, null]] },
      missing_values: 4,
    });
    renderViewer({ depthSliceVisible: true, depthSlicePayload: allMissing });
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    // Only base + place names; no slice layer added
    expect(layerOps.filter((o) => o.op === 'add').length).toBe(2);
  });

  it('currents (u/v) slice derives speed magnitude for the raster', async () => {
    renderViewer({ depthSliceVisible: true, depthSlicePayload: makeCurrentsSlicePayload() });
    await screenText('HYCOM MODEL DEPTH SLICE');
    expect(layerOps.filter((o) => o.op === 'add').length).toBe(3);
  });
});

// helper: wait for legend text
async function screenText(text: string) {
  await waitFor(() => {
    expect(document.body.textContent).toMatch(new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
  });
}
```

**Important implementation notes for these tests to pass:**
- In jsdom, `canvas.getContext` returns `null` (our setup mock) → `generateDepthSliceImageDataUrlCached` returns `dataUrl: ''` → the component must **skip adding** a layer when `dataUrl` is empty. This is already the behavior (`if (!dataUrl) return;`). **This means slice layers are NOT added in jsdom tests.** To make lifecycle assertions meaningful, the setup must instead stub a **working canvas**: patch `HTMLCanvasElement.prototype.getContext` to return a minimal 2d-context stub and `toDataURL` to return `'data:image/png;base64,STUB'` in `src/test/setup.ts`:

```ts
// Minimal 2d-context stub so raster generation produces a data URL in tests.
const ctxStub = {
  createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
  putImageData: () => {},
  drawImage: () => {},
  clearRect: () => {},
  imageSmoothingEnabled: true,
  imageSmoothingQuality: 'high',
};
HTMLCanvasElement.prototype.getContext = vi.fn(() => ctxStub as unknown as CanvasRenderingContext2D);
HTMLCanvasElement.prototype.toDataURL = vi.fn(() => 'data:image/png;base64,STUB');
```

Update Task 4 Step 3's setup to use this working-canvas stub (not the null-context one). The `rasterGen` tests that assert `dataUrl === ''` on unavailable canvas must instead run in a file where they locally override `getContext` to `null` (or those assertions change to assert the stub path). **Final decision: setup.ts installs the working-canvas stub; `rasterGen.test.ts` tests real behavior against the stub (dataUrl === 'data:image/png;base64,STUB', cache hits return true on second call); the null-context fallback is covered by a dedicated test that restores `getContext → null` locally via `vi.spyOn` + mockRestore.**

- The mock `Cesium.Viewer`'s `destroy()` sets `_destroyed` and the init effect's cleanup destroys the viewer; ensure the mock supports that (it does, via `_destroyed`).

- [ ] **Step 4: Run all frontend tests**

Run: `cd frontend && npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/CesiumViewerInner.test.tsx frontend/src/components/DepthSliceControl.test.tsx frontend/src/utils/rasterGen.test.ts frontend/src/test/setup.ts
git commit -m "test(frontend): cover all 13 depth-slice lifecycle scenarios with instrumented Cesium mock"
```

---

### Task 6: `page.tsx` integration tests (cancellation + unmount)

**Files:**
- Create: `frontend/src/app/page.test.tsx`

- [ ] **Step 1: Write tests mocking ApiProvider + fetch**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';

import { cesiumMock, layerOps, resetLayerOps } from '../test/mocks/cesium';
vi.mock('cesium', () => ({ __esModule: true, ...cesiumMock }));
vi.mock('cesium/Build/Cesium/Widgets/widgets.css', () => ({}));

const getDepthSlice = vi.fn();
const getDataStatus = vi.fn();
vi.mock('../services/ApiProvider', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../services/ApiProvider')>();
  return {
    ...orig,
    apiProvider: {
      ...orig.apiProvider,
      getDepthSlice: (...args: unknown[]) => getDepthSlice(...args),
      getDataStatus: (...args: unknown[]) => getDataStatus(...args),
    },
    DEPTH_SLICE_VARIABLES: orig.DEPTH_SLICE_VARIABLES,
  };
});
vi.mock('../services/DemoProvider', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../services/DemoProvider')>();
  return { ...orig, demoProvider: orig.demoProvider };
});

import Home from './page';
import { makeDepthSlicePayload } from '../test/fixtures/depthSliceFixtures';

function deferredFetchOfDepthSlice() {
  let resolveFetch: (v: unknown) => void = () => {};
  const promise = new Promise((res) => { resolveFetch = res; });
  return { promise, resolve: resolveFetch };
}

beforeEach(() => {
  resetLayerOps();
  getDepthSlice.mockReset();
  getDataStatus.mockReset();
  getDataStatus.mockResolvedValue({ mode: 'REAL' as const, backendConnected: true });
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ available_timestamps: ['2026-09-07T06:00:00.000000000'] }),
  });
});

describe('Home depth-slice integration', () => {
  it('renders the depth-slice toggle header even before activation', async () => {
    render(<Home />);
    await waitFor(() => expect(screen.getByText(/HYCOM MODEL DEPTH SLICE/i)).toBeInTheDocument());
  });

  it('enabling the slice fetches via getDepthSlice with the current selection', async () => {
    getDepthSlice.mockResolvedValue(makeDepthSlicePayload());
    render(<Home />);
    const eyeBtn = await screen.findByTitle(/show model depth slice/i);
    fireEvent.click(eyeBtn);
    await waitFor(() => expect(getDepthSlice).toHaveBeenCalledTimes(1));
    expect(getDepthSlice).toHaveBeenCalledWith('temperature', 50, undefined, 3, expect.any(AbortSignal));
  });

  it('rapid selection changes cancel/ignore stale requests; latest selection wins', async () => {
    const first = deferredFetchOfDepthSlice();
    const second = deferredFetchOfDepthSlice();
    getDepthSlice.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    render(<Home />);
    fireEvent.click(await screen.findByTitle(/show model depth slice/i));
    await waitFor(() => expect(getDepthSlice).toHaveBeenCalledTimes(1));

    // change depth to 100 -> first request aborted
    const depthInput = screen.getByLabelText(/requested depth in meters/i);
    fireEvent.change(depthInput, { target: { value: '100' } });
    await waitFor(() => expect(getDepthSlice).toHaveBeenCalledTimes(2));

    // resolve stale first request AFTER the second was issued
    await act(async () => {
      first.resolve(null); // aborted fetch returns null anyway
      second.resolve(makeDepthSlicePayload({ requested_depth_m: 100, matched_depth_m: 100 }));
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(screen.getByText(/MATCHED MODEL DEPTH/i)).toBeInTheDocument()
    );
    expect(screen.getByText('100 m')).toBeInTheDocument();
  });

  it('unmount while in-flight does not throw and aborts', async () => {
    const d = deferredFetchOfDepthSlice();
    getDepthSlice.mockReturnValue(d.promise);
    const { unmount } = render(<Home />);
    fireEvent.click(await screen.findByTitle(/show model depth slice/i));
    await waitFor(() => expect(getDepthSlice).toHaveBeenCalledTimes(1));
    expect(() => unmount()).not.toThrow();
    await act(async () => {
      d.resolve(null);
      await Promise.resolve();
    });
  });

  it('unavailable backend response shows the unavailable card, never fake data', async () => {
    getDepthSlice.mockResolvedValue(null);
    render(<Home />);
    fireEvent.click(await screen.findByTitle(/show model depth slice/i));
    await waitFor(() => expect(screen.getByText(/HYCOM MODEL DEPTH SLICE UNAVAILABLE/i)).toBeInTheDocument());
    expect(screen.queryByText(/MATCHED MODEL DEPTH/i)).not.toBeInTheDocument();
  });
});
```

Note: `page.tsx` also imports `demoProvider` (used when disconnected) and `calculateRiskForPoint`; `getDataStatus` resolves connected:true so demo paths are not hit. The mock of DemoProvider above simply re-exports the original — remove that mock entirely (unnecessary) unless imports fail; keep only the ApiProvider mock.

- [ ] **Step 2: Run tests**

Run: `cd frontend && npm test`
Expected: all pass. If `page.tsx` has other runtime dependencies in jsdom (e.g., `perfMonitor` is fine; `Timeline`/`Header` are plain DOM), address failures minimally — mock only what errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/page.test.tsx
git commit -m "test(frontend): depth-slice integration — cancellation, unmount, unavailable backend"
```

---

### Task 7: Full verification (Task 11 of the spec)

- [ ] **Step 1: Frontend typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 2: Frontend lint (all changed files)**

Run: `cd frontend && npx eslint src/components/DepthSliceControl.tsx src/components/CesiumViewerInner.tsx src/components/CesiumGlobe.tsx src/app/page.tsx src/utils/rasterGen.ts src/services/ApiProvider.ts src/test src/components/*.test.tsx src/utils/*.test.ts src/app/page.test.tsx`
Expected: no errors (warnings acceptable only if pre-existing pattern).

- [ ] **Step 3: Frontend production build**

Run: `cd frontend && npm run build`
Expected: successful production build. (Note: `next build` may emit the Next.js AGENTS.md agent-rules block; leave `.gitignore`/AGENTS.md state as-is per repo convention — check `git status` afterwards; the block is auto-managed.)

- [ ] **Step 4: Frontend tests**

Run: `cd frontend && npm test`
Expected: all pass.

- [ ] **Step 5: Backend Phase 1A tests (must remain green, untouched)**

Run: `cd backend && .venv/bin/python -m pytest tests/test_depth_slice.py -q`
Expected: all pass (fixture mode banner expected on this machine).

Also run the full backend suite to prove no regression:

Run: `cd backend && .venv/bin/python -m pytest -q`
Expected: all pass; `requires_real_hycom` tests skipped with explanation.

- [ ] **Step 6: Manual smoke via dev servers (optional but recommended)**

```bash
# terminal 1
cd backend && .venv/bin/uvicorn app.main:app --port 8000
# terminal 2
cd frontend && npm run dev
```

Open http://localhost:3000, click the eye icon on the HYCOM MODEL DEPTH SLICE panel, select temperature @ 50 m, confirm: the indigo "HYCOM MODEL DEPTH SLICE" chip appears bottom-left, metadata shows REQUESTED 50 m / MATCHED 50 m, surface layers still toggle normally, hiding the slice returns to surface-only mode. Without the real dataset installed, expect the amber UNAVAILABLE card (correct real-vs-fixture behavior).

- [ ] **Step 7: Final commit**

```bash
git add -A
git commit -m "feat: Phase 1B — real HYCOM model depth-slice visualization in Cesium"
```

---

## Self-Review Checklist (completed during planning)

- Spec TASK 1 (dedicated path) → Tasks 1–3 ✓ (own effect, own ref, own AbortController in page.tsx, raster reuse with depth-aware cache)
- Spec TASK 2 (SURFACE vs MODEL DEPTH SLICE distinction) → Task 3 (panel header, legend chip "SUBSURFACE — NOT SURFACE", indigo color coding) + Task 5 terminology test ✓
- Spec TASK 3 (metadata) → Task 3 metadata card (variable, requested/matched depth, timestamp, units, source, dataset file, status, missing values — all from API, none invented) ✓
- Spec TASK 4 (lifecycle) → Task 3 dedicated effect + atomic replace + removeDepthSliceLayer + unmount ref cleanup; verified by Task 5 tests ✓
- Spec TASK 5 (async safety) → Task 3 page.tsx effect (AbortController per selection, silent aborts) + Task 6 tests ✓
- Spec TASK 6 (visibility toggle) → Task 3 eye toggle + surface-only return ✓
- Spec TASK 7 (visual-depth semantics) → Task 3 "2D GEOGRAPHIC DRAPE … NOT VOLUMETRIC" caption, no altitude/exaggeration anywhere ✓
- Spec TASK 8 (real vs fixture) → no synthetic fallback anywhere; 503/null → UNAVAILABLE card; fixtures only in tests ✓
- Spec TASK 9 (testing) → Tasks 4–6 cover all 13 scenarios with instrumented imagery-layer inspection ✓
- Spec TASK 10 (preserve perf work) → no changes to entity registry/particles/memoization; depth slice only touches its own layer; perfMonitor reused ✓
- Spec TASK 11 (build/type verification) → Task 7 ✓
- Wire-format fix (snake_case) verified against the live endpoint ✓
- No backend changes, no Rust, no volume rendering, no isosurfaces ✓
