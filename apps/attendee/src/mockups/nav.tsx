/**
 * DEVELOPMENT ONLY — attendee navigation for the three directions.
 * TopNav: the calm minimal bar (Calm everywhere; the calm screens of Stage and Field).
 * PillNav: the floating glass pill with one action (the stage screens of Stage and Field).
 * MenuSheet: the phone menu, open.
 */
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Wordmark } from "@synan/ui/brand";
import { useDx } from "./frame";
import { FEATURED, HOLDER } from "./data";
import { EventPicture } from "./scenes";

export function MenuIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M3 7h14M3 13h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function CloseIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M5 5l10 10M15 5 5 15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function Arrow({ className = "dx-arrow" }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 8h9M8.5 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const LINKS = [
  { label: "Events", screen: "showcase" },
  { label: "My pass", screen: "pass" },
  { label: "Agenda", screen: "pass" },
] as const;

/** True once the .dx root has scrolled past `offset` px from the bottom of the first screen. */
function usePastHero(enabled: boolean): boolean {
  const [past, setPast] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    const root = document.querySelector(".dx");
    if (!root) return;
    const on = () => setPast(root.scrollTop > root.clientHeight - 96);
    on();
    root.addEventListener("scroll", on, { passive: true });
    return () => root.removeEventListener("scroll", on);
  }, [enabled]);
  return past;
}

/**
 * The site's one top bar. Signed in shows the holder's initials; signed out shows Sign in; `action`
 * (the event page's Register) takes that place. `over` (Chosen event page): the same bar lies
 * fixed and clear over the picture and turns solid once you scroll off it.
 */
export function TopNav({
  signedIn = false,
  onMenu,
  current,
  over,
  action,
}: {
  signedIn?: boolean;
  onMenu?: () => void;
  current?: string;
  /** undefined: in the flow. true: fixed, clear over a picture. false: fixed and solid. */
  over?: boolean;
  action?: ReactNode;
}) {
  const dx = useDx();
  const initials = HOLDER.split(" ").map((p) => p[0]).join("");
  const fixed = over !== undefined;
  const past = usePastHero(over === true);
  const clear = over === true && !past;
  return (
    <header className={`dxa-top ${fixed ? "dxa-fixed" : ""} ${clear ? "is-clear" : ""}`}>
      <Link to={dx.href({ screen: "showcase" })} className="dxa-brand" aria-label="Synan, all events">
        <Wordmark small />
      </Link>
      <nav className="dxa-top-links" aria-label="Main">
        {LINKS.slice(0, 2).map((link) => (
          <Link key={link.label} to={dx.href({ screen: link.screen })} className="dxa-top-link" aria-current={current === link.screen ? "page" : undefined}>
            {link.label}
          </Link>
        ))}
      </nav>
      <div className="dxa-top-end">
        {action ? (
          action
        ) : signedIn ? (
          <span className="dxa-avatar" aria-label={`Signed in as ${HOLDER}`}>
            {initials}
          </span>
        ) : (
          <Link to={dx.href({ screen: "sign-in" })} className="dx-btn is-sm dxa-top-signin">
            Sign in
          </Link>
        )}
        <button type="button" className="dx-btn is-icon is-ghost dxa-menu-btn" aria-label="Open the menu" onClick={onMenu}>
          <MenuIcon />
        </button>
      </div>
    </header>
  );
}

/** Scroll progress of the .dx root, 0–1 (the stage's progress indicator). */
export function useScrollProgress(): number {
  const [p, setP] = useState(0);
  useEffect(() => {
    const root = document.querySelector(".dx");
    if (!root) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const max = root.scrollHeight - root.clientHeight;
        setP(max > 0 ? root.scrollTop / max : 0);
      });
    };
    root.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      root.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);
  return p;
}

/** The floating glass pill: wordmark, a few words, one filled action. */
export function PillNav({ action, progress, onMenu }: { action: ReactNode; progress?: boolean; onMenu?: () => void }) {
  const dx = useDx();
  const p = useScrollProgress();
  return (
    <header className="dxa-pill-wrap">
      <div className="dxa-pill dx-glass">
        <Link to={dx.href({ screen: "showcase" })} className="dxa-brand" aria-label="Synan, all events">
          <Wordmark small />
        </Link>
        <nav className="dxa-pill-links" aria-label="Main">
          <Link to={dx.href({ screen: "showcase" })} className="dxa-pill-link">
            Events
          </Link>
          <Link to={dx.href({ screen: "pass" })} className="dxa-pill-link">
            Agenda
          </Link>
          <Link to={dx.href({ screen: "sign-in" })} className="dxa-pill-link">
            Sign in
          </Link>
        </nav>
        {action}
        <button type="button" className="dx-btn is-icon is-on-glass dxa-menu-btn" aria-label="Open the menu" onClick={onMenu}>
          <MenuIcon />
        </button>
        {progress ? (
          <span className="dxa-progress" aria-hidden="true">
            <span style={{ transform: `scaleX(${Math.max(0.02, p)})` }} />
          </span>
        ) : null}
      </div>
    </header>
  );
}

/** The phone menu, open: large words, one pass card, the way out. */
export function MenuSheet({ onClose }: { onClose: () => void }) {
  const dx = useDx();
  const items = [
    { label: "Events", note: "5 this month", screen: "showcase" },
    { label: "My pass", note: "Nexus Summit 2026", screen: "pass" },
    { label: "Agenda", note: "4 sessions today", screen: "pass" },
    { label: "Updates", note: "3 new", screen: "pass" },
    { label: "Account", note: HOLDER, screen: "sign-in" },
  ];
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="dxa-sheet" role="dialog" aria-modal="true" aria-label="Menu">
      <div className="dxa-sheet-head">
        <Wordmark small />
        <button type="button" className="dx-btn is-icon" aria-label="Close the menu" onClick={onClose} autoFocus>
          <CloseIcon />
        </button>
      </div>
      <nav className="dxa-sheet-nav" aria-label="Main">
        {items.map((item, i) => (
          <Link key={item.label} to={dx.href({ screen: item.screen })} className="dxa-sheet-link" aria-current={i === 0 ? "page" : undefined}>
            {dx.d === 3 ? <span className="dxa-sheet-num dx-mono">{String(i + 1).padStart(2, "0")}</span> : null}
            <span className="dxa-sheet-word">{item.label}</span>
            <span className="dxa-sheet-note">{item.note}</span>
          </Link>
        ))}
      </nav>
      <div className="dxa-sheet-foot">
        {dx.d !== 1 ? (
          <Link to={dx.href({ screen: "event" })} className="dxm-card">
            <span className="dxm-card-img">
              <EventPicture event={FEATURED} photo={dx.photo} tag={false} />
            </span>
            <span>
              <span className="dx-small" style={{ display: "block", fontWeight: 500 }}>
                {FEATURED.title}
              </span>
              <span className="dx-meta dx-muted">Live now · {FEATURED.venue.name}</span>
            </span>
          </Link>
        ) : null}
        <Link to={dx.href({ screen: "pass" })} className="dx-btn is-action dxa-sheet-pass">
          Show my pass <Arrow />
        </Link>
        <p className="dx-meta dx-muted">Signed in as {HOLDER}</p>
      </div>
    </div>
  );
}
