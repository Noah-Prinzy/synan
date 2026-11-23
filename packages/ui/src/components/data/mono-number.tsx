import type { Ref } from "react";
import { cn } from "../../lib/cn";
import { formatClock, formatNumber } from "./format";

/**
 * Data in mono with tabular figures, so a changing value never shifts its
 * neighbours (docs/05 §4). `textRef` lets a frame loop write the text directly.
 */
export function MonoNumber({
  value,
  signed,
  className,
  textRef,
}: {
  value: number;
  signed?: boolean;
  className?: string;
  textRef?: Ref<HTMLSpanElement>;
}) {
  return (
    <span ref={textRef} className={cn("font-mono tabular-nums", className)}>
      {formatNumber(value, { signed })}
    </span>
  );
}

/** A clock time in the venue's zone, as a `<time>` element. */
export function Timestamp({
  at,
  timeZone,
  seconds = true,
  className,
}: {
  at: number | string;
  timeZone: string;
  seconds?: boolean;
  className?: string;
}) {
  const iso = new Date(at).toISOString();
  return (
    <time dateTime={iso} className={cn("font-mono tabular-nums", className)}>
      {formatClock(at, timeZone, { seconds })}
    </time>
  );
}
