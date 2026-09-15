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
    expect(screen.getByText(/subsurface/i)).toBeInTheDocument();
  });

  it('never labels the slice as volumetric/water-column/isosurface — only the explicit negation', () => {
    render(<DepthSliceControl {...baseProps} />);
    const text = document.body.textContent || '';
    // The only allowed occurrence of these terms is the explicit disclaimer
    // that the slice is NOT them.
    expect(text).toMatch(/NOT A VOLUMETRIC OR WATER-COLUMN VIEW/);
    // No positive feature labels / standalone uses beyond the disclaimer:
    expect(text).not.toMatch(/volumetric rendering|isosurface|continuous-depth|full water-column/i);
  });

  it('shows matched model depth distinct from requested depth', () => {
    render(
      <DepthSliceControl
        {...baseProps}
        metadata={makeDepthSlicePayload({ requested_depth_m: 77, matched_depth_m: 50 })}
      />
    );
    expect(screen.getByText('77 m')).toBeInTheDocument(); // requested (unique, not a preset)
    expect(screen.getAllByText('50 m').length).toBeGreaterThanOrEqual(1); // matched model level
  });

  it('shows unavailable message instead of fabricating metadata when payload is null', () => {
    render(
      <DepthSliceControl
        {...baseProps}
        metadata={null}
        unavailable="Real INCOIS HYCOM depth data could not be loaded"
      />
    );
    expect(screen.getByText(/HYCOM MODEL DEPTH SLICE UNAVAILABLE/i)).toBeInTheDocument();
    expect(screen.queryByText(/MATCHED MODEL DEPTH/i)).not.toBeInTheDocument();
  });

  it('hides controls when not visible (surface-only mode)', () => {
    render(<DepthSliceControl {...baseProps} visible={false} />);
    expect(screen.queryByLabelText(/depth slice variable/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/requested depth in meters/i)).not.toBeInTheDocument();
  });

  it('propagates variable/depth/timestamp changes', () => {
    const onChange = vi.fn();
    render(<DepthSliceControl {...baseProps} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText(/depth slice variable/i), { target: { value: 'salinity' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ variable: 'salinity' }));

    fireEvent.change(screen.getByLabelText(/requested depth in meters/i), { target: { value: '100' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ depthM: 100 }));

    fireEvent.change(screen.getByLabelText(/depth slice model timestamp/i), {
      target: { value: '2026-09-07T12:00:00.000000000' },
    });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ timestamp: '2026-09-07T12:00:00.000000000' })
    );
  });

  it('exposes only real API metadata fields (variable, depths, timestamp, units, source, dataset, status, missing)', () => {
    render(<DepthSliceControl {...baseProps} />);
    expect(screen.getByText('REQUESTED DEPTH')).toBeInTheDocument();
    expect(screen.getByText('MATCHED MODEL DEPTH')).toBeInTheDocument();
    expect(screen.getByText('TIMESTAMP')).toBeInTheDocument();
    expect(screen.getByText('UNITS')).toBeInTheDocument();
    expect(screen.getByText('SOURCE')).toBeInTheDocument();
    expect(screen.getByText('DATASET')).toBeInTheDocument();
    expect(screen.getByText('DATA STATUS')).toBeInTheDocument();
    expect(screen.getByText('MISSING VALUES')).toBeInTheDocument();
    expect(screen.getByText('1 cells')).toBeInTheDocument(); // from fixture payload
    expect(screen.getByText('RSMC_hycom_20260908.nc')).toBeInTheDocument(); // dataset file identifier
  });

  it('declares the 2D geographic drape semantics explicitly (no vertical exaggeration claims)', () => {
    render(<DepthSliceControl {...baseProps} />);
    expect(screen.getByText(/2D GEOGRAPHIC DRAPE AT MODEL LEVEL/i)).toBeInTheDocument();
  });

  it('toggles visibility through the eye control', () => {
    const onToggleVisible = vi.fn();
    render(<DepthSliceControl {...baseProps} onToggleVisible={onToggleVisible} />);
    fireEvent.click(screen.getByTitle(/hide model depth slice/i));
    expect(onToggleVisible).toHaveBeenCalledTimes(1);
  });
});
