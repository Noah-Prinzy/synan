/** DEVELOPMENT ONLY — parts shared by the attendee mock-up screens. */
import type { ReactNode } from "react";
import { useDx } from "../frame";
import { n, occupancy, sessionsExcerpt, time, type MockEvent } from "../data";

export function LiveChip({ children = "Live now" }: { children?: ReactNode }) {
  return (
    <span className="dx-chip dxp-live">
      <span className="dx-live">
        <span className="dx-dot" />
      </span>
      {children}
    </span>
  );
}

/** How full, in words first; the figure is secondary. A soft track, no rules. */
export function Fullness({ pct, words, note, onGlass = false }: { pct: number; words: string; note?: string; onGlass?: boolean }) {
  const level = pct >= 100 ? "stop" : pct >= 85 ? "warn" : "ok";
  return (
    <div className={`dxp-full ${onGlass ? "is-glass" : ""}`} data-level={level}>
      <div className="dxp-full-row">
        <span className="dxp-full-words">{words}</span>
        {note ? <span className="dx-meta dx-muted">{note}</span> : null}
      </div>
      <span className="dxp-track" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={`${words}, ${pct} percent`}>
        <span style={{ transform: `scaleX(${Math.min(1, pct / 100)})` }} />
      </span>
    </div>
  );
}

/** The next sessions: time, title, room. Rhythm and space, no rules. */
export function SessionList({ event, count = 4 }: { event: MockEvent; count?: number }) {
  const dx = useDx();
  const rows = sessionsExcerpt(event, count);
  return (
    <ol className="dxp-sessions">
      {rows.map((s) => (
        <li key={s.id} className="dxp-session" data-now={s.now || undefined}>
          <span className="dxp-session-time dx-mono">
            {time(s.starts_at)}
            {dx.d === 3 ? <span className="dx-faint">{"–"}{time(s.ends_at)}</span> : null}
          </span>
          <span className="dxp-session-body">
            <span className="dxp-session-title">{s.title}</span>
            <span className="dx-small dx-muted">{s.room}</span>
          </span>
          {s.now ? <LiveChip>On now</LiveChip> : null}
        </li>
      ))}
    </ol>
  );
}

const roomWords = (pct: number) => (pct >= 100 ? "Full" : pct >= 85 ? "Nearly full" : pct >= 60 ? "Busy" : "Space");

/** Rooms right now: words, a soft bar, the percentage quiet beside it. */
export function RoomsNow({ event, compact = false }: { event: MockEvent; compact?: boolean }) {
  const rooms = occupancy(event);
  if (!rooms.length) return null;
  return (
    <ul className={`dxp-rooms ${compact ? "is-compact" : ""}`}>
      {rooms.map((room) => {
        const level = room.pct >= 100 ? "stop" : room.pct >= 85 ? "warn" : "ok";
        return (
          <li key={room.room_id} className="dxp-room" data-level={level}>
            <span className="dxp-room-name">{room.name}</span>
            <span className="dxp-room-words">{roomWords(room.pct)}</span>
            <span className="dxp-track" aria-hidden="true">
              <span style={{ transform: `scaleX(${Math.min(1, room.pct / 100)})` }} />
            </span>
            <span className="dx-mono dx-meta dx-muted dxp-room-pct">{room.pct}%</span>
          </li>
        );
      })}
    </ul>
  );
}

/** Field only: the small "live now" panel. Arrivals per quarter hour as soft bars, two counts. */
export function LivePanel({ events, title = "Live now" }: { events: MockEvent[]; title?: string }) {
  const bars = [18, 26, 34, 52, 71, 64, 58, 44, 38, 47];
  const total = events.length;
  return (
    <aside className="dx-glass dxp-livepanel" aria-label="Live now">
      <div className="dxp-lp-head">
        <span className="dx-eyebrow">{title}</span>
        <span className="dx-live dx-mono dxp-lp-count">
          <span className="dx-dot" /> {String(total).padStart(2, "0")}
        </span>
      </div>
      <div className="dxp-lp-bars" aria-hidden="true">
        {bars.map((b, i) => (
          <span key={i} style={{ height: `${b}%` }} />
        ))}
      </div>
      <p className="dx-meta dx-muted dxp-lp-cap">Arrivals, last 2½ hours</p>
      <ul className="dxp-lp-rows">
        {events.map((event) => (
          <li key={event.id}>
            <span>{event.title.replace(" 2026", "")}</span>
            <span className="dx-mono">{n(event.on_site ?? 0)}</span>
          </li>
        ))}
      </ul>
      <p className="dx-meta dx-muted dx-mono dxp-lp-foot">On site · updated 11:45</p>
    </aside>
  );
}
