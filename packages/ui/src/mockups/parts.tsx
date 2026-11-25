/** DEVELOPMENT ONLY — small shared parts of the direction mock-ups. */
import { useEffect, useRef, useState, type ReactNode } from "react";

/** The reward: a blue tick drawn once (320 ms) when an action completes. */
export function RewardTick({ label = "Done" }: { label?: string }) {
  return (
    <svg className="dx-reward" viewBox="0 0 18 18" role="img" aria-label={label}>
      <path d="M3.5 9.5 7.5 13.5 14.5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Adds .is-in once the element scrolls into view (the reveal is CSS; reduced motion shows it at once). */
export function useReveal<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const root = el.closest(".dx");
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          io.disconnect();
        }
      },
      { root: root instanceof HTMLElement ? root : null, threshold: 0.15 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return { ref, className: inView ? "is-in" : "" };
}

/** A reveal wrapper. `image` scales and fades the picture inside; otherwise text only fades. */
export function Reveal({ children, image = false, className = "", as: Tag = "div" }: { children: ReactNode; image?: boolean; className?: string; as?: "div" | "section" | "article" | "li" }) {
  const { ref, className: state } = useReveal<HTMLDivElement>();
  if (image) {
    return (
      <Tag ref={ref as never} className={`dx-reveal-img ${state} ${className}`}>
        <div className="dx-reveal-inner">{children}</div>
      </Tag>
    );
  }
  return (
    <Tag ref={ref as never} className={`dx-reveal ${state} ${className}`}>
      {children}
    </Tag>
  );
}
