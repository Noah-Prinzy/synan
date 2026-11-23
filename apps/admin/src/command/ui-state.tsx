/**
 * D1's own pointer and focus state, shared between the map and the rail without
 * re-rendering either: `highlight` outlines a room in both places, `card` is the
 * room whose hover card is open on the map.
 */
import { useEffect, useRef } from "react";
import { formatNumber } from "@synan/ui/data";
import type { OccupancyLevel } from "@synan/contracts/ws";
import type { SignalState } from "@synan/ui/data";
import { useCommand } from "../live/context";
import { Slice } from "../live/slice";

export const highlight = new Slice<string | null>(null);
export const card = new Slice<string | null>(null);

export function levelState(level: OccupancyLevel): SignalState {
  return level === "block" ? "stop" : level === "warn" ? "warn" : "ok";
}

export function levelWords(level: OccupancyLevel, warnAt: number, blockAt: number): string {
  if (level === "block") return `At capacity (stop at ${blockAt}%)`;
  if (level === "warn") return `Near capacity (warn at ${warnAt}%)`;
  return `Under ${warnAt}%`;
}

/** A number driven by the interpolator: React renders the element once, the frame loop writes it. */
export function LiveNumber({ k, className }: { k: string; className?: string }) {
  const { store } = useCommand();
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(
    () =>
      store.interp.bind(k, (display) => {
        if (ref.current) ref.current.textContent = formatNumber(display);
      }),
    [store, k],
  );
  return <span ref={ref} className={className} />;
}
