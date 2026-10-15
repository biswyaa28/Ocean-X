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

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
      if (event.key === 'Tab') {
        event.preventDefault();
        closeRef.current?.focus();
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
          <div className="lightbox__panel" onClick={(event) => event.stopPropagation()}>
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
