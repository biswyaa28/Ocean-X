'use client';

import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';

export default function FeatureLightbox({
  src,
  alt,
  width,
  height,
}: {
  src: string;
  alt: string;
  width: number;
  height: number;
}) {
  const [open, setOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        return;
      }
      if (event.key !== 'Tab') return;

      // Focus stays inside the dialog, but it MOVES: the only focusable
      // element is the Close button, so Tab wraps back onto it and
      // Shift+Tab likewise. Preventing default unconditionally used to pin
      // focus there and make the dialog a dead end for keyboard users.
      const panel = panelRef.current;
      const focusable = panel?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (!focusable || focusable.length === 0) {
        event.preventDefault();
        closeRef.current?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    closeRef.current?.focus();
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  useEffect(() => {
    if (!open) triggerRef.current?.focus();
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="feature-lightbox-trigger"
        aria-label={`Enlarge image: ${alt}`}
        onClick={() => setOpen(true)}
      >
        <Image src={src} alt={alt} width={width} height={height} sizes="(max-width: 800px) 100vw, 60vw" loading="lazy" />
        <span aria-hidden="true">⌕</span>
      </button>
      {open ? (
        <div className="lightbox" role="dialog" aria-modal="true" aria-label={alt} onClick={() => setOpen(false)}>
          <div ref={panelRef} className="lightbox__panel" onClick={(event) => event.stopPropagation()}>
            <button ref={closeRef} type="button" className="lightbox__close" onClick={() => setOpen(false)}>
              Close <span aria-hidden="true">×</span>
            </button>
            <Image src={src} alt={alt} width={width} height={height} sizes="90vw" />
          </div>
        </div>
      ) : null}
    </>
  );
}
