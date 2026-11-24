/**
 * The occupancy curve across an event (D13c): one line, hairline grid, mono axes, the
 * peak marked. Days are drawn as separate segments with the overnight gap removed, so
 * a two-day event reads as two days rather than a long flat night.
 */
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { formatClock, formatNumber } from "@synan/ui/data";

interface Point {
  at: string;
  on_site: number;
}

const H = 220;
const PAD = { top: 20, right: 24, bottom: 28, left: 52 };

function niceMax(value: number): number {
  if (value <= 0) return 10;
  const exp = Math.pow(10, Math.floor(Math.log10(value)));
  for (const step of [1, 2, 2.5, 5, 10]) if (step * exp >= value) return step * exp;
  return 10 * exp;
}

export function OccupancyCurve({
  points,
  peakAt,
  timeZone,
  bucketMs = 5 * 60_000,
}: {
  points: Point[];
  peakAt: string | null;
  timeZone: string;
  bucketMs?: number;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const model = useMemo(() => {
    // Segments break where consecutive points are more than two buckets apart.
    const segments: number[][] = [];
    points.forEach((p, i) => {
      const previous = points[i - 1];
      if (!previous || Date.parse(p.at) - Date.parse(previous.at) > bucketMs * 2) segments.push([]);
      segments[segments.length - 1]?.push(i);
    });
    const max = niceMax(Math.max(0, ...points.map((p) => p.on_site)));
    return { segments, max };
  }, [points, bucketMs]);

  const plotW = Math.max(0, width - PAD.left - PAD.right);
  const plotH = H - PAD.top - PAD.bottom;
  const gap = 12; // px between day segments
  const n = points.length;
  const usable = plotW - gap * Math.max(0, model.segments.length - 1);
  const step = n > 1 ? usable / (n - 1 - Math.max(0, model.segments.length - 1)) : 0;
  const xs: number[] = [];
  {
    let x = PAD.left;
    model.segments.forEach((segment, s) => {
      if (s > 0) x += gap;
      segment.forEach((index, k) => {
        if (k > 0) x += step;
        xs[index] = x;
      });
    });
  }
  const y = (v: number) => PAD.top + (1 - v / model.max) * plotH;
  const peakIndex = peakAt ? points.findIndex((p) => p.at === peakAt) : -1;
  const peak = peakIndex >= 0 ? points[peakIndex] : undefined;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(model.max * f));

  // Hour labels every two hours of venue time, plus a day label at each segment start.
  const hourLabels: { x: number; text: string }[] = [];
  const dayLabels: { x: number; text: string }[] = [];
  model.segments.forEach((segment) => {
    const first = segment[0];
    if (first === undefined) return;
    dayLabels.push({
      x: xs[first] as number,
      text: new Date(points[first]!.at).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone }),
    });
    let lastHour = -1;
    for (const index of segment) {
      const label = formatClock(points[index]!.at, timeZone, { seconds: false });
      const hour = Number(label.slice(0, 2));
      if (label.endsWith(":00") && hour % 2 === 0 && hour !== lastHour) {
        hourLabels.push({ x: xs[index] as number, text: label });
        lastHour = hour;
      }
    }
  });

  // On a narrow plot, keep only labels that have room for themselves (a mono "10:00" is ~40px).
  const spacedHours: { x: number; text: string }[] = [];
  for (const label of hourLabels) {
    const last = spacedHours[spacedHours.length - 1];
    if (!last || label.x - last.x >= 52) spacedHours.push(label);
  }

  return (
    <div ref={wrap} className="relative w-full">
      {width > 0 && n > 1 ? (
        <svg width={width} height={H} role="img" aria-labelledby="curve-title curve-desc" className="block">
          <title id="curve-title">On site across the event</title>
          <desc id="curve-desc">
            {peak
              ? `Peak ${formatNumber(peak.on_site)} on site at ${formatClock(peak.at, timeZone, { seconds: false })}.`
              : "No peak recorded."}
          </desc>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={width - PAD.right} y1={Math.round(y(t)) + 0.5} y2={Math.round(y(t)) + 0.5} className="stroke-border" />
              <text x={PAD.left - 10} y={y(t) + 4} textAnchor="end" className="fill-muted-foreground font-mono text-12">
                {formatNumber(t)}
              </text>
            </g>
          ))}
          {model.segments.slice(1).map((segment) => {
            const x = (xs[segment[0] as number] as number) - gap / 2;
            return <line key={x} x1={x} x2={x} y1={PAD.top} y2={PAD.top + plotH} className="stroke-foreground/25" strokeDasharray="2 3" />;
          })}
          {model.segments.map((segment) => (
            <polyline
              key={segment[0]}
              fill="none"
              strokeWidth={1.25}
              strokeLinejoin="round"
              className="stroke-foreground"
              points={segment.map((i) => `${(xs[i] as number).toFixed(1)},${y(points[i]!.on_site).toFixed(1)}`).join(" ")}
            />
          ))}
          {spacedHours.map((label) => (
            <text key={`${label.x}`} x={label.x} y={H - 6} textAnchor="middle" className="fill-muted-foreground font-mono text-12">
              {label.text}
            </text>
          ))}
          {peak ? (
            <g>
              <line
                x1={Math.round(xs[peakIndex] as number) + 0.5}
                x2={Math.round(xs[peakIndex] as number) + 0.5}
                y1={y(peak.on_site)}
                y2={PAD.top + plotH}
                className="stroke-foreground/50"
              />
              <rect x={(xs[peakIndex] as number) - 3} y={y(peak.on_site) - 3} width={6} height={6} className="fill-foreground" />
            </g>
          ) : null}
        </svg>
      ) : (
        <div style={{ height: H }} />
      )}
      {width > 0 && n > 1 ? (
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0">
          {dayLabels.map((label) => (
            <span key={label.x} className="absolute top-0 pl-1.5 text-12 text-muted-foreground" style={{ left: label.x }}>
              {label.text}
            </span>
          ))}
          {peak ? (
            <span
              className={`absolute bg-background px-1.5 font-mono text-12 whitespace-nowrap tabular-nums ${
                (xs[peakIndex] ?? 0) > width - 110 ? "-translate-x-full" : (xs[peakIndex] ?? 0) < PAD.left + 60 ? "" : "-translate-x-1/2"
              }`}
              style={{ left: xs[peakIndex], top: Math.max(0, y(peak.on_site) - 22) }}
            >
              Peak {formatNumber(peak.on_site)} · {formatClock(peak.at, timeZone, { seconds: false })}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
