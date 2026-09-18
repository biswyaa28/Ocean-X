import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StationModal } from './StationModal';

describe('StationModal provenance labels', () => {
  it('does not label simulated station measurements as real-time telemetry', () => {
    render(
      <StationModal
        station={{
          id: 'station-1',
          name: 'Test Station',
          latitude: 18,
          longitude: 88,
          region: 'Bay of Bengal',
          status: 'active',
          type: 'buoy',
          dataStatus: 'SIMULATED',
          currentMeasurements: { sstC: 30 },
        }}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText('SIMULATED TELEMETRY')).toBeInTheDocument();
    expect(screen.queryByText('REAL-TIME TELEMETRY')).not.toBeInTheDocument();
  });
});
