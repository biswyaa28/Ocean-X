'use client';

/**
 * Hero background: a small canvas of particles drifting along a smooth flow
 * field, with trailing fades. Hand-written against Canvas2D — no animation
 * library, because the whole effect is a few dozen lines of physics and adding a
 * dependency for it would cost far more than it saves.
 *
 * The rules this component exists to enforce:
 *
 * - Particle count is capped by SCREEN AREA, not by a fixed number, so a phone
 *   does not try to run a desktop's worth of them.
 * - The backing store is scaled by devicePixelRatio, capped at 2: beyond that
 *   the extra pixels cost fill rate and buy nothing visible.
 * - The loop stops when the tab is hidden (a hidden tab must burn no battery)
 *   and when the hero scrolls out of view (nothing is animating offscreen).
 * - requestAnimationFrame is always cancelled on unmount.
 * - prefers-reduced-motion is respected completely: no animation, no particles,
 *   just a static gradient.
 */

import { useEffect, useRef, useState } from 'react';

/** Never draw finer than 2x, however dense the display is. */
const MAX_DEVICE_PIXEL_RATIO = 2;

/** Particles per megapixel of CSS pixels. */
const PARTICLES_PER_MEGAPIXEL = 46;

/** Hard ceilings, so the count stays sane at either extreme. */
const MIN_PARTICLES = 40;
const MAX_PARTICLES = 340;

/** Trail persistence: lower means a longer trail. */
const TRAIL_FADE_ALPHA = 0.045;

type Particle = {
  x: number;
  y: number;
  /** Life in frames; particles respawn when it runs out. */
  life: number;
  maxLife: number;
  /** Slight per-particle speed variation so the field does not look rigid. */
  speed: number;
  depth: 'front' | 'back';
};

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Particle count for a viewport.
 *
 * Exported so the cap can be asserted directly: the animation must never scale
 * linearly with a huge 4K display, and must never drop to nothing on a phone.
 */
export function particleCountFor(width: number, height: number): number {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return 0;
  }
  const megapixels = (width * height) / 1_000_000;
  const count = Math.round(megapixels * PARTICLES_PER_MEGAPIXEL);
  return Math.max(MIN_PARTICLES, Math.min(MAX_PARTICLES, count));
}

/**
 * The flow field: a cheap, smooth, divergence-light vector field.
 *
 * Two out-of-phase sine terms in x and y give a swirling but coherent drift.
 * It is deterministic, so nothing needs to be stored per particle beyond a
 * position, and there is no noise texture to load.
 */
function flowAt(x: number, y: number, t: number): { vx: number; vy: number } {
  const scale = 0.0016;
  const angle =
    Math.sin((x + t * 26) * scale) * 1.15 +
    Math.cos((y - t * 19) * scale) * 0.95 +
    Math.sin((x + y) * scale * 0.45 + t * 0.12) * 0.6;
  return { vx: Math.cos(angle), vy: Math.sin(angle) };
}

export function particleDepth(index: number): 'front' | 'back' {
  return index % 3 === 0 ? 'back' : 'front';
}

function spawnParticle(
  width: number,
  height: number,
  depth: 'front' | 'back'
): Particle {
  const maxLife = 90 + Math.random() * 190;
  return {
    x: Math.random() * width,
    y: Math.random() * height,
    life: Math.random() * maxLife,
    maxLife,
    speed: 0.55 + Math.random() * 0.95,
    depth,
  };
}

/** Static gradient shown instead of the animation under reduced motion. */
function paintStaticGradient(ctx: CanvasRenderingContext2D, width: number, height: number) {
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, '#04121c');
  gradient.addColorStop(0.45, '#062636');
  gradient.addColorStop(1, '#04101a');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  // A few soft teal blooms, drawn once. Static by definition.
  const blooms: Array<[number, number, number]> = [
    [0.22, 0.32, 0.34],
    [0.68, 0.58, 0.28],
    [0.45, 0.82, 0.22],
  ];
  for (const [fx, fy, radius] of blooms) {
    const glow = ctx.createRadialGradient(
      width * fx,
      height * fy,
      0,
      width * fx,
      height * fy,
      Math.max(width, height) * radius
    );
    glow.addColorStop(0, 'rgba(34, 211, 238, 0.16)');
    glow.addColorStop(1, 'rgba(34, 211, 238, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);
  }
}

export default function OceanCanvas() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Read the preference during the FIRST render, not in an effect. Starting at
  // `false` would let the animation loop start before the effect learns the
  // preference, so a reduced-motion visitor would still get motion they asked
  // not to have.
  const [reduced, setReduced] = useState(() => prefersReducedMotion());

  useEffect(() => {
    const query =
      typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-reduced-motion: reduce)')
        : null;
    if (!query) return;
    const sync = () => setReduced(query.matches);
    sync();
    // Safari < 14 only has addListener; both are guarded so this is safe.
    if (typeof query.addEventListener === 'function') {
      query.addEventListener('change', sync);
      return () => query.removeEventListener('change', sync);
    }
    query.addListener?.(sync);
    return () => query.removeListener?.(sync);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Reduced motion: paint one static frame and never start a loop.
    if (reduced) {
      const ratio = Math.min(window.devicePixelRatio || 1, MAX_DEVICE_PIXEL_RATIO);
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.floor(rect.width * ratio));
      canvas.height = Math.max(1, Math.floor(rect.height * ratio));
      paintStaticGradient(ctx, canvas.width, canvas.height);
      return;
    }

    let width = 0;
    let height = 0;
    let particles: Particle[] = [];
    let frame = 0;
    let running = true;
    let lastTime = 0;
    let parallaxX = 0;
    let parallaxY = 0;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, MAX_DEVICE_PIXEL_RATIO);
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      canvas.width = Math.floor(width * ratio);
      canvas.height = Math.floor(height * ratio);
      // Draw in CSS pixels; the transform handles the devicePixelRatio.
      if (typeof ctx.setTransform === 'function') {
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      }

      const target = particleCountFor(width, height);
      if (particles.length === 0) {
        particles = Array.from({ length: target }, (_, index) =>
          spawnParticle(width, height, particleDepth(index))
        );
      } else if (particles.length > target) {
        particles.length = target;
      } else {
        while (particles.length < target) {
          particles.push(spawnParticle(width, height, particleDepth(particles.length)));
        }
      }
    };

    const draw = (time: number) => {
      if (!running) return;
      // Seconds since the previous frame, clamped so a backgrounded tab does
      // not teleport every particle on the first frame back.
      const delta = lastTime ? Math.min((time - lastTime) / 1000, 0.05) : 0.016;
      lastTime = time;

      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = `rgba(4, 16, 26, ${TRAIL_FADE_ALPHA})`;
      ctx.fillRect(0, 0, width, height);

      ctx.globalCompositeOperation = 'lighter';
      for (const particle of particles) {
        const { vx, vy } = flowAt(particle.x, particle.y, time / 1000);
        // Gentle mouse parallax, bounded so it never fights the flow field.
        const depthSpeed = particle.depth === 'back' ? 0.48 : 1;
        particle.x += vx * particle.speed * 34 * depthSpeed * delta + parallaxX * 6 * delta;
        particle.y += vy * particle.speed * 34 * depthSpeed * delta + parallaxY * 6 * delta;

        if (particle.x < -20) particle.x = width + 20;
        if (particle.x > width + 20) particle.x = -20;
        if (particle.y < -20) particle.y = height + 20;
        if (particle.y > height + 20) particle.y = -20;

        particle.life -= 1;
        if (particle.life <= 0) {
          Object.assign(particle, spawnParticle(width, height, particle.depth));
        }

        // Fade in and out across the particle's life, so respawns do not pop.
        const lifeRatio = particle.life / particle.maxLife;
        const depthAlpha = particle.depth === 'back' ? 0.22 : 0.55;
        const alpha = Math.min(1, (1 - lifeRatio) * 6) * Math.min(1, lifeRatio * 6) * depthAlpha;
        if (alpha <= 0.01) continue;

        const rgb =
          40 + Math.round(particle.speed * 60) + Math.round(particle.y * 0.02);
        ctx.fillStyle = `rgba(${Math.min(120, rgb)}, ${Math.min(230, 150 + Math.round(particle.x * 0.05))}, 238, ${alpha})`;
        const size = particle.depth === 'back' ? 1 : 1.6;
        ctx.fillRect(particle.x, particle.y, size, size);
      }

      frame = requestAnimationFrame(draw);
    };

    const start = () => {
      if (running) return;
      running = true;
      lastTime = 0;
      frame = requestAnimationFrame(draw);
    };
    const stop = () => {
      running = false;
      cancelAnimationFrame(frame);
    };

    const onVisibility = () => {
      if (document.hidden) stop();
      else start();
    };

    // An IntersectionObserver beats a scroll listener: the browser does the
    // work, and nothing runs while the hero is offscreen.
    let observer: IntersectionObserver | null = null;
    const visible = { current: true };
    if (typeof IntersectionObserver !== 'undefined') {
      observer = new IntersectionObserver(
        (entries) => {
          visible.current = entries[0]?.isIntersecting ?? true;
          if (document.hidden || !visible.current) stop();
          else start();
        },
        { threshold: 0 }
      );
      observer.observe(canvas);
    }

    const onPointerMove = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      // Normalised to -1..1 and gently damped by the draw loop's own scaling.
      parallaxX = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
      parallaxY = ((event.clientY - rect.top) / rect.height - 0.5) * 2;
    };
    const onPointerLeave = () => {
      parallaxX = 0;
      parallaxY = 0;
    };

    resize();
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', onVisibility);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerleave', onPointerLeave);
    if (!document.hidden) frame = requestAnimationFrame(draw);

    return () => {
      running = false;
      cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVisibility);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerleave', onPointerLeave);
    };
  }, [reduced]);

  return (
    <canvas
      ref={canvasRef}
      data-testid="ocean-canvas"
      aria-hidden="true"
      className="absolute inset-0 h-full w-full"
    />
  );
}