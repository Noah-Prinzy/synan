/**
 * DEVELOPMENT ONLY — parts the admin mock-ups share: the venue map (rooms shaded by how full they
 * are, no figures on it), the headline figures, the rooms list and the signal words.
 */
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { OctagonExclamationPoint, TriangleExclamationPoint } from "lucide-react";
import { LEVEL_WORD, busiest, levelOf, num, pct, type DxData, type Level, type RoomView } from "./data";
import { useNarrow } from "./frame";

const SIG = { size: 14, strokeWidth: 1.75 } as const;

/** The shape that goes with a signal colour, so colour is never the only cue. */
export function SignalShape({ level }: { level: Level }) {
  if (level === "near") return <TriangleExclamationPoint {...SIG} aria-hidden="true" className="dxc-shape" />;
  if (level === "full" || level === "over") return <OctagonExclamationPoint {...SIG} aria-hidden="true" className="dxc-shape" />;
  return null;
}

const signalled = (level: Level) => level === "near" || level === "full" || level === "over";

/* ---------------------------------------------------------------- the venue map */

const box = (r: { x: number; y: number; w: number; h: number }, g: { w: number; h: number }, inset = 0): CSSProperties => ({
  left: `calc(${(r.x / g.w) * 100}% + ${inset}px)`,
  top: `calc(${(r.y / g.h) * 100}% + ${inset}px)`,
  width: `calc(${(r.w / g.w) * 100}% - ${inset * 2}px)`,
  height: `calc(${(r.h / g.h) * 100}% - ${inset * 2}px)`,
});

export function VenueMap({ data, rooms, label }: { data: DxData; rooms: RoomView[]; label?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const narrow = useNarrow();
  const g = data.grid;
  const u = width / g.w;
  const near = rooms.filter((r) => signalled(levelOf(r))).map((r) => `${r.name} ${LEVEL_WORD[levelOf(r)].toLowerCase()}`);
  const summary = `${label ?? `${data.venueName}, rooms by how full they are`}${narrow && near.length ? `: ${near.join(", ")}` : ""}`;
  return (
    <div className="dxc-map-pad">
      <div ref={ref} className="dxc-map" style={{ aspectRatio: `${g.w} / ${g.h}` }} role={narrow ? "img" : "group"} aria-label={summary}>
        {width > 0
          ? data.zones.map((z) => (
              <div key={z.id} className="dxc-zone" style={box(z, g)}>
                {u * 3.5 >= 22 ? (
                  <span className="dxc-zone-label">
                    {z.name}
                    <span className="dxc-zone-floor"> · {z.floor}</span>
                  </span>
                ) : null}
              </div>
            ))
          : null}
        {width > 0
          ? rooms.map((r) => {
              const level = levelOf(r);
              const pw = r.w * u;
              const ph = r.h * u;
              const showName = pw >= r.name.length * 7.4 + 20 && ph >= 34;
              const showWord = signalled(level) && pw >= LEVEL_WORD[level].length * 7 + 40 && ph >= 58;
              const fill = Math.min(1, r.capacity > 0 ? r.occupancy / r.capacity : 0);
              /* at phone width the rooms are too small to touch: the map is a picture and the rooms list is the control */
              const Tag = narrow ? "span" : "button";
              return (
                <Tag
                  key={r.id}
                  {...(narrow ? { "aria-hidden": true } : { type: "button" as const, "aria-label": `${r.name}: ${LEVEL_WORD[level].toLowerCase()}, ${r.occupancy} of ${r.capacity}` })}
                  className="dxc-room"
                  data-level={level}
                  data-small={showName ? undefined : ""}
                  style={{ ...box(r, g, 2), ["--fill" as string]: fill }}
                >
                  <span className="dxc-room-fill" aria-hidden="true" />
                  {showName ? <span className="dxc-room-name">{r.name}</span> : null}
                  {signalled(level) ? (
                    <span className="dxc-room-sig">
                      <SignalShape level={level} />
                      {showWord ? <span>{LEVEL_WORD[level]}</span> : null}
                    </span>
                  ) : null}
                  <span className="dxc-room-card" aria-hidden="true">
                    <span className="dxc-room-card-name">{r.name}</span>
                    <span className="dxc-room-card-line">
                      <span className="dx-mono">{r.occupancy}</span> of <span className="dx-mono">{r.capacity}</span>{" "}
                      · {LEVEL_WORD[level]}
                    </span>
                  </span>
                </Tag>
              );
            })
          : null}
        {width > 0
          ? data.gates.map((gate) => (
              <span key={gate.id} className="dxc-gate" style={{ left: `${(gate.x / g.w) * 100}%`, top: `${(gate.y / g.h) * 100}%` }} title={gate.label}>
                {gate.code}
              </span>
            ))
          : null}
      </div>
    </div>
  );
}

/** The map's key: words with the shade, so nothing is colour alone. */
export function MapKey() {
  const items: { level: Level; word: string }[] = [
    { level: "quiet", word: "Space" },
    { level: "busy", word: "Busy" },
    { level: "near", word: "Nearly full" },
    { level: "full", word: "Full" },
  ];
  return (
    <ul className="dxc-key" aria-label="Key">
      {items.map((i) => (
        <li key={i.level} data-level={i.level}>
          <span className="dxc-key-swatch" aria-hidden="true">
            <SignalShape level={i.level} />
          </span>
          {i.word}
        </li>
      ))}
    </ul>
  );
}

/* ---------------------------------------------------------------- figures */

export interface Figure {
  label: string;
  value: string;
  note?: string;
}

export function Figures({ items }: { items: Figure[] }) {
  return (
    <dl className="dxc-figs">
      {items.map((f) => (
        <div key={f.label} className="dxc-fig">
          <dt className="dxc-fig-label">{f.label}</dt>
          <dd className="dxc-fig-value dx-mono">{f.value}</dd>
          {f.note ? <dd className="dxc-fig-note">{f.note}</dd> : null}
        </div>
      ))}
    </dl>
  );
}

export function commandFigures(data: DxData, rooms: RoomView[], openAlerts: number, acked = 0): Figure[] {
  const near = rooms.filter((r) => signalled(levelOf(r))).length;
  return [
    { label: "On site now", value: num(data.summary.on_site), note: "inside the perimeter" },
    { label: "Checked in today", value: num(data.summary.checked_in), note: `of ${num(data.summary.registered)} registered` },
    { label: "Rooms nearly full", value: String(near), note: `of ${rooms.length} rooms` },
    { label: "Open alerts", value: String(openAlerts), note: openAlerts ? "needs you now" : acked ? `${acked} acknowledged` : "all clear" },
  ];
}

/* ---------------------------------------------------------------- rooms list */

export function RoomsList({ rooms, limit = 7 }: { rooms: RoomView[]; limit?: number }) {
  const top = busiest(rooms).slice(0, limit);
  return (
    <ul className="dxc-roomlist">
      {top.map((r) => {
        const level = levelOf(r);
        const fill = Math.min(1, r.occupancy / r.capacity);
        return (
          <li key={r.id} className="dxc-roomrow" data-level={level}>
            <span className="dxc-roomrow-name">{r.name}</span>
            <span className="dxc-roomrow-word">
              <SignalShape level={level} />
              {LEVEL_WORD[level]}
            </span>
            <span className="dxc-roomrow-sub">
              {r.zone} · {r.floor}
            </span>
            <span className="dxc-roomrow-pct dx-mono">{pct(r.occupancy, r.capacity)}</span>
            <span className="dxc-bar" aria-hidden="true">
              <span style={{ width: `${fill * 100}%` }} />
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/* ---------------------------------------------------------------- small things */

export function Tone({ tone, children }: { tone: "ok" | "warn" | "stop" | "quiet" | "live"; children: ReactNode }) {
  const cls = tone === "quiet" ? "dxc-quietword" : tone === "live" ? "dx-live" : `dxc-sig-${tone}`;
  return (
    <span className={`dxc-state ${cls}`}>
      <span className={`dx-dot ${tone === "quiet" ? "dxc-dot-quiet" : ""}`} aria-hidden="true" />
      {children}
    </span>
  );
}

export function Panel({ children, className = "", label }: { children: ReactNode; className?: string; label?: string }) {
  return (
    <section className={`dxc-panel ${className}`} aria-label={label}>
      {children}
    </section>
  );
}
