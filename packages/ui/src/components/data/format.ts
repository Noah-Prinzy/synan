/**
 * Number and time formatting for data. One formatter per shape, cached: formatting
 * runs inside live render paths, so it must not allocate an Intl object per call.
 */

const numberFormat = new Intl.NumberFormat("en-GB");

/** 1,184 · −12 · +38 (with `signed`). Uses a true minus sign. */
export function formatNumber(value: number, options: { signed?: boolean } = {}): string {
  const body = numberFormat.format(Math.abs(Math.round(value)));
  if (value < 0) return `−${body}`;
  if (options.signed && value > 0) return `+${body}`;
  return body;
}

/** 92% — rounded down, so a room shows 100% only when it is at capacity. */
export function formatPercent(ratio: number): string {
  return `${Math.floor(ratio * 100)}%`;
}

const clockFormats = new Map<string, Intl.DateTimeFormat>();

function clockFormat(timeZone: string, seconds: boolean): Intl.DateTimeFormat {
  const key = `${timeZone}|${seconds}`;
  let format = clockFormats.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      second: seconds ? "2-digit" : undefined,
      hourCycle: "h23",
    });
    clockFormats.set(key, format);
  }
  return format;
}

/** 11:47:02 in the venue's time zone. */
export function formatClock(at: number | string | Date, timeZone: string, options: { seconds?: boolean } = {}): string {
  return clockFormat(timeZone, options.seconds ?? true).format(new Date(at));
}

/** UTC+3 — the zone's current offset, for labelling a venue-local clock. */
export function formatUtcOffset(at: number, timeZone: string): string {
  const local = new Date(new Date(at).toLocaleString("en-US", { timeZone }));
  const utc = new Date(new Date(at).toLocaleString("en-US", { timeZone: "UTC" }));
  const minutes = Math.round((local.getTime() - utc.getTime()) / 60_000);
  const sign = minutes < 0 ? "−" : "+";
  const h = Math.floor(Math.abs(minutes) / 60);
  const m = Math.abs(minutes) % 60;
  return `UTC${sign}${h}${m ? `:${String(m).padStart(2, "0")}` : ""}`;
}

/** An elapsed time, compact: 0.4 s · 12 s · 4m 05s · 1h 07m. */
export function formatAge(ms: number, options: { fine?: boolean } = {}): string {
  const safe = Math.max(0, ms);
  if (options.fine && safe < 10_000) return `${(safe / 1000).toFixed(1)} s`;
  const s = Math.floor(safe / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${String(m % 60).padStart(2, "0")}m`;
}

/** A signed clock offset: +3m 05s, −40 s. */
export function formatOffset(ms: number): string {
  const sign = ms < 0 ? "−" : "+";
  return `${sign}${formatAge(Math.abs(ms))}`;
}
