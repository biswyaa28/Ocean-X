import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import FeatureLightbox from './FeatureLightbox';

afterEach(() => vi.restoreAllMocks());

const props = {
  src: '/landing/globe.webp',
  alt: 'OceanLens 3D globe',
  width: 1800,
  height: 1013,
};

describe('FeatureLightbox', () => {
  it('opens on click and moves focus into the dialog', () => {
    render(<FeatureLightbox {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /Enlarge image/i }));

    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /Close/i }));
  });

  it('closes on Escape', () => {
    render(<FeatureLightbox {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /Enlarge image/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('returns focus to the trigger when closed', () => {
    render(<FeatureLightbox {...props} />);
    const trigger = screen.getByRole('button', { name: /Enlarge image/i });
    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(document.activeElement).toBe(trigger);
  });

  // The dialog declares aria-modal, so keeping focus inside is correct. What
  // matters is that the trap is boundary-aware rather than unconditional: with
  // a single focusable element, Tab and Shift+Tab both wrap onto it, which is
  // the only behaviour available here. A blanket preventDefault would behave
  // identically today but would strand a second focusable element if one were
  // ever added.
  it.each(['Tab', 'Shift+Tab'] as const)(
    'keeps %s inside the dialog',
    (key) => {
      render(<FeatureLightbox {...props} />);
      fireEvent.click(screen.getByRole('button', { name: /Enlarge image/i }));

      const close = screen.getByRole('button', { name: /Close/i });
      expect(document.activeElement).toBe(close);

      fireEvent.keyDown(document, { key, shiftKey: key === 'Shift+Tab' });

      expect(document.activeElement).toBe(close);
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    }
  );

  it('closes on Escape from anywhere in the dialog', () => {
    render(<FeatureLightbox {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /Enlarge image/i }));

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});