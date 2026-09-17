import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React, { useState } from 'react';
import { DepthSliceControl, DepthSliceSelection } from './DepthSliceControl';
import { DepthSlicePayload, DEPTH_SLICE_VARIABLES } from '../services/ApiProvider';
import { makeDepthSlicePayload } from '../test/fixtures/depthSliceFixtures';
import {
  DEFAULT_DEPTH_SLICE_DISPLAY,
  DepthSliceDisplaySettings,
  resolveDepthSliceRender,
} from '../utils/depthSliceViz';

const metadata = makeDepthSlicePayload();
const TIMESTAMP_OPTIONS = ['2026-09-07T06:00:00.000000000', '2026-09-07T12:00:00.000000000'];
const NATIVE_DEPTHS = [0, 10, 50, 100, 250, 500];

interface HarnessProps {
  metadata?: DepthSlicePayload | null;
  selection?: DepthSliceSelection;
  display?: Partial<DepthSliceDisplaySettings>;
  visible?: boolean;
  unavailable?: string | null;
  availableDepthsM?: number[] | null;
  datasetTimestamps?: string[];
  onToggleVisible?: () => void;
}

/**
 * Stateful harness mirroring the real page wiring: display settings live in
 * parent state, the render configuration is resolved from (metadata,
 * display), and commits flow back through onDisplayChange.
 */
function Harness({
  metadata: metadataOverride = metadata,
  selection: selectionOverride,
  display: displayOverride,
  visible = true,
  unavailable = null,
  availableDepthsM = NATIVE_DEPTHS,
  datasetTimestamps = TIMESTAMP_OPTIONS,
  onToggleVisible = vi.fn(),
}: HarnessProps) {
  const [selection, setSelection] = useState<DepthSliceSelection>(
    selectionOverride ?? { variable: 'temperature', depthM: 50 }
  );
  const [display, setDisplay] = useState<DepthSliceDisplaySettings>({
    ...DEFAULT_DEPTH_SLICE_DISPLAY,
    ...displayOverride,
  });
  const render = resolveDepthSliceRender(metadataOverride, display);
  return (
    <DepthSliceControl
      visible={visible}
      onToggleVisible={onToggleVisible}
      selection={selection}
      onChange={setSelection}
      display={display}
      onDisplayChange={setDisplay}
      onResetDisplay={() => setDisplay({ ...DEFAULT_DEPTH_SLICE_DISPLAY })}
      render={render}
      loading={false}
      unavailable={unavailable}
      metadata={metadataOverride}
      datasetTimestamps={datasetTimestamps}
      availableDepthsM={availableDepthsM}
    />
  );
}

const colorbar = () => screen.getByLabelText(/depth slice colorbar/i);

describe('DepthSliceControl — Phase 1B behavior preserved', () => {
  it('renders the HYCOM MODEL DEPTH SLICE header (distinguishes subsurface from surface)', () => {
    render(<Harness />);
    expect(screen.getByText(/HYCOM MODEL DEPTH SLICE/i)).toBeInTheDocument();
    expect(screen.getByText(/subsurface/i)).toBeInTheDocument();
  });

  it('never labels the slice as volumetric/water-column/isosurface — only the explicit negation', () => {
    render(<Harness />);
    const text = document.body.textContent || '';
    expect(text).toMatch(/NOT A VOLUMETRIC OR WATER-COLUMN VIEW/);
    expect(text).not.toMatch(/volumetric rendering|isosurface|continuous-depth|full water-column/i);
  });

  it('shows matched model depth distinct from requested depth', () => {
    render(
      <Harness metadata={makeDepthSlicePayload({ requested_depth_m: 77, matched_depth_m: 50 })} />
    );
    expect(screen.getByText('77 m')).toBeInTheDocument();
    expect(screen.getAllByText('50 m').length).toBeGreaterThanOrEqual(1);
  });

  it('shows unavailable message instead of fabricating metadata when payload is null', () => {
    render(<Harness metadata={null} unavailable="Real INCOIS HYCOM depth data could not be loaded" />);
    expect(screen.getByText(/HYCOM MODEL DEPTH SLICE UNAVAILABLE/i)).toBeInTheDocument();
    expect(screen.queryByText(/MATCHED MODEL DEPTH/i)).not.toBeInTheDocument();
  });

  it('hides controls when not visible (surface-only mode)', () => {
    render(<Harness visible={false} />);
    expect(screen.queryByLabelText(/depth slice variable/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/depth slice model depth level/i)).not.toBeInTheDocument();
  });

  it('propagates variable and timestamp selection', () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText(/depth slice variable/i), { target: { value: 'salinity' } });
    expect((screen.getByLabelText(/depth slice variable/i) as HTMLSelectElement).value).toBe('salinity');

    fireEvent.change(screen.getByLabelText(/depth slice model timestamp/i), {
      target: { value: '2026-09-07T12:00:00.000000000' },
    });
    expect((screen.getByLabelText(/depth slice model timestamp/i) as HTMLSelectElement).value).toBe(
      '2026-09-07T12:00:00.000000000'
    );
  });

  it('exposes only real API metadata fields (variable, depths, timestamp, units, source, dataset, status, missing)', () => {
    render(<Harness />);
    expect(screen.getByText('REQUESTED DEPTH')).toBeInTheDocument();
    expect(screen.getByText('MATCHED MODEL DEPTH')).toBeInTheDocument();
    expect(screen.getByText('TIMESTAMP')).toBeInTheDocument();
    expect(screen.getByText('UNITS')).toBeInTheDocument();
    expect(screen.getByText('SOURCE')).toBeInTheDocument();
    expect(screen.getByText('DATASET')).toBeInTheDocument();
    expect(screen.getByText('DATA STATUS')).toBeInTheDocument();
    expect(screen.getByText('MISSING VALUES')).toBeInTheDocument();
    expect(screen.getByText('1 cells')).toBeInTheDocument();
    expect(screen.getByText('RSMC_hycom_20260908.nc')).toBeInTheDocument();
  });

  it('declares the 2D geographic drape semantics explicitly (no vertical exaggeration claims)', () => {
    render(<Harness />);
    expect(screen.getByText(/2D GEOGRAPHIC DRAPE AT MODEL LEVEL/i)).toBeInTheDocument();
  });

  it('toggles visibility through the eye control', () => {
    const onToggleVisible = vi.fn();
    render(<Harness onToggleVisible={onToggleVisible} />);
    fireEvent.click(screen.getByTitle(/hide model depth slice/i));
    expect(onToggleVisible).toHaveBeenCalledTimes(1);
  });
});

describe('DepthSliceControl — native model depth selection (Phase 1C Task 3)', () => {
  it('offers only native model depth levels returned by the backend (no free-form depth input)', () => {
    render(<Harness />);
    const select = screen.getByLabelText(/depth slice model depth level/i) as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => Number(o.value))).toEqual(NATIVE_DEPTHS);
    expect(screen.queryByLabelText(/requested depth in meters/i)).not.toBeInTheDocument();
  });

  it('falls back to preset depths before the first payload delivers native levels', () => {
    render(<Harness availableDepthsM={null} />);
    const select = screen.getByLabelText(/depth slice model depth level/i) as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => Number(o.value))).toEqual([0, 10, 50, 100, 250, 500]);
  });

  it('keeps a non-native requested depth selectable (matched level still reported by the API)', () => {
    render(<Harness selection={{ variable: 'temperature', depthM: 77 }} />);
    const select = screen.getByLabelText(/depth slice model depth level/i) as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => Number(o.value))).toContain(77);
  });

  it('propagates native depth selection', () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText(/depth slice model depth level/i), { target: { value: '250' } });
    expect((screen.getByLabelText(/depth slice model depth level/i) as HTMLSelectElement).value).toBe('250');
  });
});

describe('DepthSliceControl — palette selection (Phase 1C Task 4)', () => {
  it('offers the curated scientific palettes for the active variable', () => {
    render(<Harness />);
    const select = screen.getByLabelText(/depth slice color palette/i) as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(['Classic Ocean', 'Thermal', 'Viridis']);
  });

  it('switches the palette list with the variable (salinity exposes Haline)', () => {
    render(<Harness selection={{ variable: 'salinity', depthM: 50 }} metadata={makeDepthSlicePayload({ variable: 'salinity', units: 'PSU' })} />);
    const select = screen.getByLabelText(/depth slice color palette/i) as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(['Classic Ocean', 'Haline', 'Viridis']);
  });

  it('commits palette changes and the colorbar follows', () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText(/depth slice color palette/i), { target: { value: 'thermal' } });
    expect((screen.getByLabelText(/depth slice color palette/i) as HTMLSelectElement).value).toBe('thermal');
    expect(withinColorbar(/THERMAL/i)).toBeInTheDocument(); // colorbar palette label
  });

  it('offers palettes for every backend-supported variable (capability-driven, nothing fabricated)', () => {
    for (const v of DEPTH_SLICE_VARIABLES) {
      const { unmount } = render(<Harness selection={{ variable: v.id, depthM: 50 }} />);
      const select = screen.getByLabelText(/depth slice color palette/i) as HTMLSelectElement;
      expect(Array.from(select.options).length).toBeGreaterThanOrEqual(1);
      expect(Array.from(select.options)[0].textContent).toBe('Classic Ocean');
      unmount();
    }
  });
});

describe('DepthSliceControl — display range with validation (Phase 1C Task 5)', () => {
  it('commits a valid min/max range and the colorbar reflects it', () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText(/depth slice display minimum/i), { target: { value: '19' } });
    fireEvent.change(screen.getByLabelText(/depth slice display maximum/i), { target: { value: '21' } });
    expect((screen.getByLabelText(/depth slice display minimum/i) as HTMLInputElement).value).toBe('19');
    expect(screen.getByText('CUSTOM RANGE')).toBeInTheDocument();
    expect(screen.getByText(/19\.00/)).toBeInTheDocument();
    expect(screen.getByText(/21\.00/)).toBeInTheDocument();
  });

  it('rejects min >= max: shows a validation state and never renders the invalid range', () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText(/depth slice display minimum/i), { target: { value: '25' } });
    fireEvent.change(screen.getByLabelText(/depth slice display maximum/i), { target: { value: '20' } });
    expect(screen.getByText(/MIN must be strictly less than MAX/i)).toBeInTheDocument();
    // invalid visualization prevented: the colorbar stays on the AUTO data range
    expect(screen.getByText('AUTO RANGE')).toBeInTheDocument();
    expect(screen.getByText(/20\.20/)).toBeInTheDocument(); // fixture data max, not 20
  });

  it('clearing both bounds returns to the auto (data-derived) range', () => {
    render(<Harness display={{ min: 19, max: 21 }} />);
    expect(screen.getByText('CUSTOM RANGE')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/depth slice display minimum/i), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText(/depth slice display maximum/i), { target: { value: '' } });
    expect(screen.getByText('AUTO RANGE')).toBeInTheDocument();
    expect((screen.getByLabelText(/depth slice display minimum/i) as HTMLInputElement).value).toBe('');
  });

  it('shows the auto-range data bounds while no custom range is set', () => {
    render(<Harness />);
    expect(screen.getByText('AUTO RANGE')).toBeInTheDocument();
  });
});

describe('DepthSliceControl — scale control with log safety (Phase 1C Task 6)', () => {
  it('defaults to LINEAR and marks it active', () => {
    render(<Harness />);
    expect(screen.getByTitle(/linear scale active/i)).toBeInTheDocument();
  });

  it('disables LOG with an explicit reason when the slice contains zero/negative values', () => {
    render(<Harness />); // fixture contains a legitimate 0.0
    const logBtn = screen.getByTitle(/^log scale/i) as HTMLButtonElement;
    expect(logBtn.disabled).toBe(true);
    expect(screen.getByText(/zero or negative/i)).toBeInTheDocument();
  });

  it('enables LOG for strictly positive data and reports it as the active scale', () => {
    const positive = makeDepthSlicePayload({
      grid: { latitudes: [5], longitudes: [80, 81], values: [[1, 100]] },
    });
    render(<Harness metadata={positive} />);
    const logBtn = screen.getByTitle(/^log scale/i) as HTMLButtonElement;
    expect(logBtn.disabled).toBe(false);
    fireEvent.click(logBtn);
    expect(screen.getByText('LOG', { selector: 'span' })).toBeInTheDocument(); // colorbar badge
    expect(screen.getByTitle(/log scale \(logarithmic/i)).toBeInTheDocument();
  });

  it('disables LOG while no data is loaded (nothing to validate against)', () => {
    render(<Harness metadata={null} />);
    expect((screen.getByTitle(/^log scale/i) as HTMLButtonElement).disabled).toBe(true);
  });

  it('states that the scale changes display mapping, not the data', () => {
    render(<Harness />);
    expect(screen.getByText(/mapping only/i)).toBeInTheDocument();
  });
});

describe('DepthSliceControl — opacity (Phase 1C Task 7)', () => {
  it('exposes an opacity slider bound to the display settings', () => {
    render(<Harness />);
    const slider = screen.getByLabelText(/depth slice opacity/i) as HTMLInputElement;
    expect(slider.value).toBe('75');
    fireEvent.change(slider, { target: { value: '40' } });
    expect((screen.getByLabelText(/depth slice opacity/i) as HTMLInputElement).value).toBe('40');
    expect(screen.getByText(/40%/)).toBeInTheDocument();
  });

  it('labels the opacity as layer-only (never other graphics)', () => {
    render(<Harness />);
    expect(screen.getByText(/this layer only/i)).toBeInTheDocument();
  });
});

describe('DepthSliceControl — reset to defaults (Phase 1C Task 12)', () => {
  it('offers a reset control that returns every display setting to defaults', () => {
    render(<Harness display={{ paletteId: 'thermal', min: 19, max: 21, scale: 'linear', opacity: 0.4 }} />);
    fireEvent.click(screen.getByTitle(/reset display settings/i));
    expect((screen.getByLabelText(/depth slice color palette/i) as HTMLSelectElement).value).toBe('classic');
    expect((screen.getByLabelText(/depth slice opacity/i) as HTMLInputElement).value).toBe('75');
    expect(screen.getByText('AUTO RANGE')).toBeInTheDocument();
  });
});

describe('DepthSliceControl — synchronized colorbar (Phase 1C Task 9)', () => {
  it('renders the colorbar from the resolved render configuration', () => {
    render(<Harness />);
    // fixture data range is 0.0 .. 20.2 °C on the classic palette
    expect(screen.getByText(/0\.00/)).toBeInTheDocument();
    expect(screen.getByText(/20\.20/)).toBeInTheDocument();
    expect(screen.getByText(/COLORBAR · TEMPERATURE/i)).toBeInTheDocument();
  });

  it('colorbar reflects a custom range and log scale', () => {
    const positive = makeDepthSlicePayload({
      grid: { latitudes: [5], longitudes: [80, 81], values: [[1, 100]] },
    });
    render(<Harness metadata={positive} display={{ min: 1, max: 100, scale: 'log' }} />);
    expect(screen.getByText('LOG', { selector: 'span' })).toBeInTheDocument();
    expect(screen.getByText('CUSTOM RANGE')).toBeInTheDocument();
    expect(screen.getByText(/10\.00/)).toBeInTheDocument(); // geometric mid of [1,100]
  });

  it('hides the colorbar when no render configuration exists', () => {
    render(<Harness metadata={null} unavailable="x" />);
    expect(screen.queryByLabelText(/depth slice colorbar/i)).not.toBeInTheDocument();
  });

  it('exposes the palette and range through the colorbar for legend synchronization', () => {
    render(<Harness />);
    expect(withinColorbar(/CLASSIC OCEAN/i)).toBeInTheDocument();
    expect(withinColorbar(/°C/i)).toBeInTheDocument();
  });
});

function withinColorbar(matcher: RegExp) {
  const el = colorbar();
  const found = Array.from(el.querySelectorAll('*')).find((n) => matcher.test(n.textContent || ''));
  if (!found) throw new Error(`no element matching ${matcher} inside the colorbar`);
  return found;
}
