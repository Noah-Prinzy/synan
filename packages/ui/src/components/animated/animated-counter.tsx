import { useEffect, useRef } from "react";

export interface AnimatedCounterProps {
  value: number;
  /** milliseconds, default 600 */
  duration?: number;
  className?: string;
  format?: (value: number) => string;
}

const defaultFormat = (value: number) => value.toLocaleString("en-GB");

/** cubic-bezier(.2,0,0,1) is close to an ease-out cubic; computed here without a solver. */
function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/**
 * A number that interpolates from its previous value to the new one on
 * requestAnimationFrame, writing to the DOM directly — React renders once per value,
 * never per frame (docs/02 §9). Paused while the tab is hidden; reduced motion jumps.
 */
export function AnimatedCounter({ value, duration = 600, className, format = defaultFormat }: AnimatedCounterProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useRef(value);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const from = shown.current;
    const to = value;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced || duration <= 0 || from === to || document.visibilityState === "hidden") {
      shown.current = to;
      node.textContent = format(to);
      return;
    }

    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      const current = Math.round(from + (to - from) * easeOut(progress));
      shown.current = current;
      node.textContent = format(current);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      shown.current = to;
    };
  }, [value, duration, format]);

  return (
    <span ref={ref} className={className}>
      {format(shown.current)}
    </span>
  );
}
