'use client';

/**
 * Reveals its children the first time they scroll into view.
 *
 * A scroll listener would run on every frame for every block on the page. An
 * IntersectionObserver hands the work to the browser and disconnects as soon as
 * the element has been seen, so the page does no scroll work afterwards.
 *
 * Under prefers-reduced-motion the children render immediately and stay put:
 * the content must never depend on an animation to become visible.
 */

import { useEffect, useRef, useState, type ElementType, type ReactNode } from 'react';
import { usePrefersReducedMotion } from '../../hooks/usePrefersReducedMotion';

export default function Reveal({
  children,
  delay = 0,
  className,
  as: Tag = 'div',
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
  /**
   * Element to render. Must be set when the wrapper sits inside a list, or the
   * <ol>/<ul> and its <li> children get separated by a <div> and a screen
   * reader announces the list as empty.
   */
  as?: ElementType;
}) {
const ref = useRef<HTMLDivElement | null>(null);
  const [seen, setSeen] = useState(false);
  const reducedMotion = usePrefersReducedMotion();

  // The content must never depend on an animation to become visible, so
  // reduced-motion reveals unconditionally. This is deliberately NOT extended
  // with a `typeof IntersectionObserver === 'undefined'` check: that reads true
  // on the server and false in the browser, so the two renders disagree and
  // hydration patches nothing.
  const revealed = seen || reducedMotion;

  useEffect(() => {
    const node = ref.current;
    if (!node || revealed) return;

    if (typeof IntersectionObserver === 'undefined') {
      // Nothing will ever observe this element, so reveal it on the next frame
      // rather than synchronously inside the effect body, which would cascade
      // an extra render.
      const frame = requestAnimationFrame(() => setSeen(true));
      return () => cancelAnimationFrame(frame);
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setSeen(true);
          observer.disconnect();
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -8% 0px' }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [revealed]);

  return (
    <Tag
      ref={ref}
      style={revealed ? { transitionDelay: `${delay}ms` } : undefined}
      data-revealed={revealed ? 'true' : 'false'}
      className={`transition-[opacity,transform] duration-700 ease-out motion-reduce:transition-none motion-reduce:translate-y-0 motion-reduce:opacity-100 ${
        revealed ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
      } ${className ?? ''}`}
    >
      {children}
    </Tag>
  );
}