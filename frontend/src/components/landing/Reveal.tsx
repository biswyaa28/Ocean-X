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
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    if (
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      setShown(true);
      return;
    }

    if (typeof IntersectionObserver === 'undefined') {
      setShown(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setShown(true);
          observer.disconnect();
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -8% 0px' }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <Tag
      ref={ref}
      style={shown ? { transitionDelay: `${delay}ms` } : undefined}
      data-revealed={shown ? 'true' : 'false'}
      className={`transition-[opacity,transform] duration-700 ease-out motion-reduce:transition-none motion-reduce:translate-y-0 motion-reduce:opacity-100 ${
        shown ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
      } ${className ?? ''}`}
    >
      {children}
    </Tag>
  );
}