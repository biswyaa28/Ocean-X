import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ToolRail } from './ToolRail';
import { Timeline } from './Timeline';
import type { CycloneTrackPoint } from '../types/oceanlens';

/**
 * Every control has to announce itself.
 *
 * An icon-only button with no accessible name is announced as just "button", so
 * a screen-reader user hears seven identical, unidentifiable controls on the
 * tool rail and two on the timeline. It is invisible to sighted mouse use and
 * to every test that queries by role, which is why it survived a suite of 646.
 */

function accessibleNames(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('button'))
    .filter((b) => !(b.getAttribute('aria-label') || b.getAttribute('title') || b.textContent || '').trim())
    .map((b) => String(b.className).slice(0, 40));
}

describe('icon-only controls carry an accessible name', () => {
  it('ToolRail exposes a name for every tool button', () => {
    const { container } = render(
      <ToolRail
        activeTool={null}
        onSelectTool={vi.fn()}
        onFlyTo={vi.fn()}
      />
    );

    expect(accessibleNames(container)).toEqual([]);

    // Spot-check that the names are meaningful, not placeholder text.
    expect(screen.getByRole('button', { name: /storm intelligence/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /measure radius/i })).toBeTruthy();
  });

  it('ToolRail marks its buttons as toggles with aria-pressed', () => {
    render(
      <ToolRail activeTool={null} onSelectTool={vi.fn()} onFlyTo={vi.fn()} />
    );

    const storm = screen.getByRole('button', { name: /storm intelligence/i });
    expect(storm.getAttribute('aria-pressed')).toBe('false');
  });

  it('Timeline exposes names for its skip controls', () => {
    const track: CycloneTrackPoint[] = [
      { id: 'a', timestamp: '2026-10-04T06:00:00Z', latitude: 18, longitude: 88 },
      { id: 'b', timestamp: '2026-10-04T18:00:00Z', latitude: 18.5, longitude: 88.5 },
    ].map((p) => ({
      ...p,
      maxWindKts: null,
      centralPressureMb: null,
      category: null,
      status: 'OBSERVATION' as const,
      distanceToCoastKm: null,
      stormSpeedKts: null,
      stormDirDeg: null,
    }));

    const { container } = render(
      <Timeline track={track} currentIndex={1} onIndexChange={vi.fn()} />
    );

    expect(accessibleNames(container)).toEqual([]);
    expect(screen.getByRole('button', { name: /previous/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /next/i })).toBeTruthy();
  });
});