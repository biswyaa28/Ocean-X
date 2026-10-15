'use client';

import { useState, type PointerEvent } from 'react';
import Image from 'next/image';

export default function DashboardPreview({
  className = '',
  loading = 'lazy',
  priority = false,
}: {
  className?: string;
  loading?: 'eager' | 'lazy';
  priority?: boolean;
}) {
  const [tilt, setTilt] = useState({ x: 0, y: 0 });

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const rect = event.currentTarget.getBoundingClientRect();
    setTilt({
      x: ((event.clientX - rect.left) / rect.width - 0.5) * 4,
      y: ((event.clientY - rect.top) / rect.height - 0.5) * -3,
    });
  }

  return (
    <div
      className={`dashboard-preview ${className}`}
      data-testid="dashboard-preview"
      onPointerMove={handlePointerMove}
      onPointerLeave={() => setTilt({ x: 0, y: 0 })}
      style={{ '--tilt-x': `${tilt.x}deg`, '--tilt-y': `${tilt.y}deg` } as React.CSSProperties}
    >
      <div className="dashboard-preview__glow" aria-hidden="true" />
      <div className="dashboard-preview__frame">
        <div className="dashboard-preview__bar" aria-hidden="true">
          <span />
          <span />
          <span />
          <small>OCEANLENS / BAY OF BENGAL</small>
        </div>
        <Image
          src="/landing/hero.webp"
          alt="OceanLens 3D globe showing Argo float positions, observation radii and the Bay of Bengal model view."
          width={1800}
          height={1013}
          sizes="(max-width: 800px) 100vw, 68vw"
          loading={priority ? undefined : loading}
          priority={priority}
          data-hero-image={priority ? 'true' : undefined}
          decoding="async"
        />
      </div>
    </div>
  );
}
