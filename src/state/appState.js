/* ================================================================
   OCEAN-X — application state model (single source of truth).
   Mirrors the frozen prototype's `state` object exactly.
   ================================================================ */
import { FieldEngine } from '../engine/fieldEngine.js';

export const DEFAULT_VSCALE = 92;   // slider position -> ~300× exaggeration
export const EXAG_MAX = 500;

export const exagFromSlider = v => Math.max(1, Math.round(Math.pow(EXAG_MAX, v / 100)));

export const INITIAL_STATE = {
  variable: 'temperature', timeIdx: 0, depthIdx: 10,
  vscaleSlider: DEFAULT_VSCALE,
  exaggeration: exagFromSlider(DEFAULT_VSCALE), opacity: 0.85,
  showArgo: true, showField: true, showBathy: true, showCurrents: false, showBounds: true,
  selectedId: null, provenanceOpen: false, trayOpen: false, trayTab: 'profile',
  depth: FieldEngine.DEPTHS[10], time: FieldEngine.TIMES[0]
};
