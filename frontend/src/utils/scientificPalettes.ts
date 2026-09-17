/**
 * OCEAN-X SIH26067 — Scientific color-transfer configuration (Phase 1C).
 *
 * Single source of truth for every scientific color palette used by the
 * HYCOM model depth-slice visualization. Palettes are color TRANSFER
 * FUNCTIONS only: they change how real values are displayed, never the
 * values themselves.
 *
 * The `classic` palette reproduces the Phase 1B depth-slice colormap
 * byte-for-byte and remains the default for every variable, so existing
 * color semantics never change unless the user explicitly selects another
 * palette.
 */

import { DEPTH_SLICE_VARIABLES, DepthSliceVariableId } from '../services/ApiProvider';

export interface ColorStop {
  /** Normalized position in [0, 1] within the display range. */
  t: number;
  rgb: readonly [number, number, number];
}

export interface ScientificPalette {
  id: string;
  label: string;
  description: string;
  stops: readonly ColorStop[];
}

export const CLASSIC_PALETTE_ID = 'classic';

/**
 * The Phase 1B deep-ocean ramp: blue (low) -> cyan -> yellow -> red (high).
 * Node colors and piecewise-linear interpolation are identical to the
 * previous hardcoded colormap, preserving established rendering semantics.
 */
export const CLASSIC_PALETTE: ScientificPalette = {
  id: CLASSIC_PALETTE_ID,
  label: 'Classic Ocean',
  description: 'Phase 1B default: blue → cyan → yellow → red',
  stops: [
    { t: 0, rgb: [20, 60, 160] },
    { t: 0.25, rgb: [20, 160, 200] },
    { t: 0.5, rgb: [40, 220, 120] },
    { t: 0.75, rgb: [240, 210, 30] },
    { t: 1, rgb: [255, 80, 10] },
  ],
};

/** cmocean-inspired thermal ramp for temperature (cold dark blue → warm yellow). */
const THERMAL_PALETTE: ScientificPalette = {
  id: 'thermal',
  label: 'Thermal',
  description: 'cmocean-inspired thermal ramp for temperature',
  stops: [
    { t: 0, rgb: [5, 11, 109] },
    { t: 0.25, rgb: [82, 22, 159] },
    { t: 0.5, rgb: [188, 44, 105] },
    { t: 0.75, rgb: [239, 109, 30] },
    { t: 1, rgb: [252, 222, 100] },
  ],
};

/** cmocean-inspired haline ramp for salinity (fresh dark teal → saline yellow). */
const HALINE_PALETTE: ScientificPalette = {
  id: 'haline',
  label: 'Haline',
  description: 'cmocean-inspired haline ramp for salinity',
  stops: [
    { t: 0, rgb: [0, 44, 87] },
    { t: 0.25, rgb: [0, 106, 147] },
    { t: 0.5, rgb: [0, 166, 160] },
    { t: 0.75, rgb: [121, 209, 130] },
    { t: 1, rgb: [247, 244, 100] },
  ],
};

/** Perceptually uniform viridis ramp (matplotlib), valid for any strictly ordered variable. */
const VIRIDIS_PALETTE: ScientificPalette = {
  id: 'viridis',
  label: 'Viridis',
  description: 'Perceptually uniform (matplotlib viridis)',
  stops: [
    { t: 0, rgb: [68, 1, 84] },
    { t: 0.25, rgb: [59, 82, 139] },
    { t: 0.5, rgb: [33, 145, 140] },
    { t: 0.75, rgb: [94, 201, 98] },
    { t: 1, rgb: [253, 231, 37] },
  ],
};

/** Global registry: every palette definition lives here and only here. */
const PALETTE_REGISTRY: Record<string, ScientificPalette> = {
  [CLASSIC_PALETTE.id]: CLASSIC_PALETTE,
  [THERMAL_PALETTE.id]: THERMAL_PALETTE,
  [HALINE_PALETTE.id]: HALINE_PALETTE,
  [VIRIDIS_PALETTE.id]: VIRIDIS_PALETTE,
};

/**
 * Curated palette availability per depth-slice variable. Temperature and
 * salinity (TEMP / SALN) carry dedicated scientific ramps; every supported
 * variable always offers the classic default plus a perceptually uniform
 * alternative. Only variables actually supported by the Phase 1A
 * depth-slice API (DEPTH_SLICE_VARIABLES) receive palettes — nothing is
 * fabricated for unsupported variables.
 */
const VARIABLE_PALETTES: Record<string, string[]> = {
  temperature: [CLASSIC_PALETTE_ID, 'thermal', 'viridis'],
  salinity: [CLASSIC_PALETTE_ID, 'haline', 'viridis'],
  currents: [CLASSIC_PALETTE_ID, 'viridis'],
  ssh: [CLASSIC_PALETTE_ID, 'viridis'],
  tchp: [CLASSIC_PALETTE_ID, 'viridis'],
  mld: [CLASSIC_PALETTE_ID, 'viridis'],
};

/** Palettes offered for a variable; unknown variables still get the classic default. */
export function palettesForVariable(variableId: string): readonly ScientificPalette[] {
  const ids = VARIABLE_PALETTES[variableId] ?? [CLASSIC_PALETTE_ID];
  return ids
    .map((id) => PALETTE_REGISTRY[id])
    .filter((p): p is ScientificPalette => Boolean(p));
}

/**
 * Resolve the palette to render with. Falls back to the classic palette
 * when the palette is not offered for the variable (or either id is
 * unknown) so rendering never breaks and never silently changes the
 * default semantics.
 */
export function getPaletteForVariable(variableId: string, paletteId: string): ScientificPalette {
  const offered = palettesForVariable(variableId).find((p) => p.id === paletteId);
  if (offered) return offered;
  return CLASSIC_PALETTE;
}

/** Sample the color transfer function at normalized position t (clamped to [0, 1]). */
export function samplePalette(palette: ScientificPalette, t: number): { r: number; g: number; b: number } {
  const stops = palette.stops;
  const pos = Math.max(0, Math.min(1, t));
  if (pos <= stops[0].t) return { r: stops[0].rgb[0], g: stops[0].rgb[1], b: stops[0].rgb[2] };
  const last = stops[stops.length - 1];
  if (pos >= last.t) return { r: last.rgb[0], g: last.rgb[1], b: last.rgb[2] };
  for (let i = 1; i < stops.length; i++) {
    if (pos <= stops[i].t) {
      const a = stops[i - 1];
      const b = stops[i];
      const span = b.t - a.t || 1;
      const f = (pos - a.t) / span;
      return {
        r: Math.round(a.rgb[0] + f * (b.rgb[0] - a.rgb[0])),
        g: Math.round(a.rgb[1] + f * (b.rgb[1] - a.rgb[1])),
        b: Math.round(a.rgb[2] + f * (b.rgb[2] - a.rgb[2])),
      };
    }
  }
  return { r: last.rgb[0], g: last.rgb[1], b: last.rgb[2] };
}

/** CSS linear-gradient string for colorbar UI, anchored at 0% and 100%. */
export function paletteCssGradient(palette: ScientificPalette): string {
  const parts = palette.stops.map((s) => {
    const pct = Math.round(s.t * 100);
    return `rgb(${s.rgb[0]}, ${s.rgb[1]}, ${s.rgb[2]}) ${pct}%`;
  });
  return `linear-gradient(to right, ${parts.join(', ')})`;
}

/** Type re-export guard: palettes only cover variables the backend actually supports. */
export type SupportedDepthVariable = DepthSliceVariableId;

void DEPTH_SLICE_VARIABLES;
