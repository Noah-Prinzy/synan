/**
 * BRAND BOARD — identity options (throwaway). Marks and wordmarks for the three
 * options. Ink is currentColor; the accent part is var(--brand). The same drawings,
 * with fixed colours, are in ./<option>/mark.svg and ./<option>/icon.svg.
 *
 * Nothing in the apps imports this folder except the dev-only brand board.
 */
import type { CSSProperties } from "react";

type MarkProps = { className?: string; title?: string };

/** 1 · Meeting point — two paths arrive from opposite corners and meet at one point. */
export function MeetingPointMark({ className = "", title = "Synan" }: MarkProps) {
  return (
    <svg viewBox="0 0 32 32" role="img" aria-label={title} className={className}>
      <path d="M28.5 3.5 A12.5 12.5 0 0 1 16 16" fill="none" stroke="currentColor" strokeWidth="4.6" />
      <path d="M3.5 28.5 A12.5 12.5 0 0 1 16 16" fill="none" stroke="currentColor" strokeWidth="4.6" />
      <rect x="11.5" y="11.5" width="9" height="9" fill="var(--brand)" />
    </svg>
  );
}

/** 2 · Open door — a frame with its door swung open toward you. */
export function OpenDoorMark({ className = "", title = "Synan" }: MarkProps) {
  return (
    <svg viewBox="0 0 32 32" role="img" aria-label={title} className={className}>
      <path d="M11 3.5 H27.5 V28.5 H11 Z" fill="none" stroke="currentColor" strokeWidth="3" />
      <path d="M11 3.5 L3 7 V31 L11 28.5 Z" fill="var(--brand)" />
    </svg>
  );
}

/** 3 · Long table — one table, people on both sides, one place laid for you. */
export function LongTableMark({ className = "", title = "Synan" }: MarkProps) {
  return (
    <svg viewBox="0 0 32 32" role="img" aria-label={title} className={className}>
      <rect x="3" y="13.5" width="26" height="5" fill="currentColor" />
      <rect x="5" y="6" width="5" height="5" fill="currentColor" />
      <rect x="13.5" y="6" width="5" height="5" fill="currentColor" />
      <rect x="22" y="6" width="5" height="5" fill="currentColor" />
      <rect x="5" y="21" width="5" height="5" fill="currentColor" />
      <rect x="13.5" y="21" width="5" height="5" fill="var(--brand)" />
      <rect x="22" y="21" width="5" height="5" fill="currentColor" />
    </svg>
  );
}

function lockup(
  Mark: (props: MarkProps) => React.JSX.Element,
  text: string,
  textStyle: CSSProperties,
  gap = "0.35em",
) {
  return function Wordmark({ className = "" }: { className?: string }) {
    return (
      <span className={`inline-flex items-center leading-none ${className}`} style={{ gap }}>
        <Mark className="h-[1.05em] w-[1.05em] shrink-0" title="" />
        <span style={textStyle}>{text}</span>
      </span>
    );
  };
}

export const MeetingPointWordmark = lockup(MeetingPointMark, "synan", {
  fontFamily: '"Bricolage Grotesque Variable", sans-serif',
  fontWeight: 640,
  letterSpacing: "-0.03em",
  fontVariationSettings: '"opsz" 32, "wdth" 100',
});

export const OpenDoorWordmark = lockup(OpenDoorMark, "Synan", {
  fontFamily: '"Newsreader Variable", serif',
  fontStyle: "italic",
  fontWeight: 500,
  letterSpacing: "-0.01em",
  fontSize: "1.12em",
});

export const LongTableWordmark = lockup(
  LongTableMark,
  "Synan",
  {
    fontFamily: '"Instrument Serif", serif',
    fontWeight: 400,
    letterSpacing: "0.01em",
    fontSize: "1.18em",
  },
  "0.4em",
);
