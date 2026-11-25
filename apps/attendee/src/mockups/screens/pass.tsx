/**
 * DEVELOPMENT ONLY — (d) the pass. The code is the hero: black on white, on a white card in both
 * modes, large enough to scan. Calm: one centred statement and the card under it. Stage: the card
 * becomes a ticket with the event's small rounded picture, set beside an editorial column.
 * Field: Stage plus mono ids, times and the code's countdown.
 *
 * ?band=1 shows the secondary state: the wristband already bound.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { CODE_TTL_S, codeFor } from "@synan/mock";
import { RewardTick } from "@synan/ui/mockups";
import { useDx } from "../frame";
import { CalmPage } from "../shell";
import { FEATURED, HOLDER, NOW, time } from "../data";
import { EventCard } from "./register";
import "./forms.css";

const REG_ID = "7d3f2a10-4c1b-4e8a-9b2d-0e2d0a17c4e1";
/** The real mock rotates the code once a minute (CODE_TTL_S), as the real pass says. */
const ROTATE_S = CODE_TTL_S;
const DESK = "Desk 2 · North entrance";
const PASS_ID = "NX26-7D3F-2A10";

const PHONE = "(max-width: 720px)";

function usePhone(): boolean {
  const [phone, setPhone] = useState(() => typeof matchMedia === "function" && matchMedia(PHONE).matches);
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const mq = matchMedia(PHONE);
    const on = () => setPhone(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return phone;
}

/** The rotating code: a fresh signed token every minute; `left` counts the seconds down. */
function useRotatingCode(still: boolean) {
  const first = Math.floor(NOW / 1000 / ROTATE_S);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (still) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [still]);
  const index = first + Math.floor(tick / ROTATE_S);
  const left = ROTATE_S - (tick % ROTATE_S);
  const code = useMemo(() => codeFor(REG_ID, index).code, [index]);
  return { code, index, left };
}

export default function Pass() {
  const dx = useDx();
  const phone = usePhone();
  const [params] = useSearchParams();
  const bound = params.get("band") === "1";
  const stage = dx.d !== 1;
  const mono = dx.d === 3;
  const [bright, setBright] = useState(false);
  const { code, index, left } = useRotatingCode(dx.still);
  const first = HOLDER.split(" ")[0] ?? HOLDER;

  const head = (
    <div className="dxf-pass-head">
      <p className="dx-eyebrow">
        <span className="dx-live">
          <span className="dx-dot" />
        </span>
        {mono
          ? `Live · day 1 of 2 · ${time(FEATURED.starts_at)}–${time(FEATURED.ends_at)}`
          : stage
            ? `Live now · day 1 of 2`
            : `Live now · ${FEATURED.title} · today ${time(FEATURED.starts_at)}–${time(FEATURED.ends_at)}`}
      </p>
      <h1 className="dx-display dxf-pass-statement">
        Your pass, {first}. <span className="dx-tone2 dxf-break">Show it at any entrance.</span>
      </h1>
    </div>
  );

  return (
    <CalmPage signedIn current="pass" field={!phone} quiet={stage ? { x: 0.06, y: 0.06, w: 0.88, h: 0.86, floor: 0.2 } : { x: 0.25, y: 0.08, w: 0.5, h: 0.9, floor: 0.15 }}>
      <div className={`dxf-pass ${stage ? "is-stage" : "is-calm"}`}>
        {head}
        <PassCard code={code} index={index} left={left} />
        <div className="dxf-pass-info">
          <Wristband bound={bound} />
          <PassActions onBright={() => setBright(true)} />
          {stage ? (
            <p className="dx-small dx-muted dxf-pass-help">
              Lost your phone? Show photo ID at {DESK}. We can send the pass to your email too.
            </p>
          ) : null}
        </div>
      </div>
      {bright ? <BrightSheet code={code} onClose={() => setBright(false)} /> : null}
    </CalmPage>
  );
}

/* ------------------------------------------------------------------ the white card */

function PassCard({ code, index, left }: { code: string; index: number; left: number }) {
  const dx = useDx();
  const stage = dx.d !== 1;
  const mono = dx.d === 3;
  return (
    <section className="dxf-card" aria-label={`Pass for ${HOLDER}`}>
      {stage ? <EventCard event={FEATURED} onWhite /> : null}
      <div className="dxf-qr">
        <QRCodeSVG
          value={code}
          size={320}
          marginSize={0}
          level="M"
          bgColor="#ffffff"
          fgColor="#0a0a0a"
          title={`Entry code for ${HOLDER}`}
          role="img"
          style={{ width: "100%", height: "auto", display: "block" }}
        />
      </div>
      <div className="dxf-holder">
        <div className="dxf-holder-text">
          <p className="dxf-holder-name">{HOLDER}</p>
          {mono ? <p className="dxf-mono-caps dxf-card-muted">{PASS_ID}</p> : null}
        </div>
        <span className={`dxf-tier ${mono ? "dxf-mono-caps" : ""}`}>Ordinary</span>
      </div>
      <div className="dxf-refresh">
        <span className="dxf-drain" aria-hidden="true">
          <span key={index} style={{ animationDelay: `${left - ROTATE_S}s`, animationDuration: `${ROTATE_S}s` }} />
        </span>
        <p className="dxf-card-muted dxf-card-small dxf-refresh-text">
          {/* Non-breaking spaces keep the break after the dash when the card is narrow. */}
          <span>{"Code refreshes every minute — screenshots won’t work."}</span>
          {mono ? (
            <span className="dx-mono dxf-countdown" aria-hidden="true">
              {String(Math.floor(left / 60)).padStart(2, "0")}:{String(left % 60).padStart(2, "0")}
            </span>
          ) : null}
        </p>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ wristband and actions */

function Wristband({ bound }: { bound: boolean }) {
  const dx = useDx();
  const mono = dx.d === 3;
  const m = (s: string) => (mono ? <span className="dx-mono">{s}</span> : s);
  if (dx.d === 1) {
    // Calm: one line in open space, no panel.
    return (
      <p className="dxf-band-line" data-bound={bound || undefined}>
        <span className="dxf-band-line-icon" aria-hidden="true">
          {bound ? <BandIcon /> : <DeskIcon />}
        </span>
        {bound ? (
          <span>
            <strong>Wristband ••••E2D0</strong> <span className="dx-muted">{"— bound at 08:12. Tap it at any door."}</span>
          </span>
        ) : (
          <span>
            <strong>No wristband yet</strong> <span className="dx-muted">— collect it at {DESK}</span>
          </span>
        )}
      </p>
    );
  }
  return (
    <div className="dx-surface dxf-band" data-bound={bound || undefined}>
      <span className="dxf-band-icon" aria-hidden="true">
        {bound ? <BandIcon /> : <DeskIcon />}
      </span>
      <div className="dxf-band-text">
        {bound ? (
          <>
            <p className="dxf-band-title">
              Wristband {m("••••E2D0")} <span className="dx-ok dxf-band-ok">· bound {m("08:12")}</span>
            </p>
            <p className="dx-small dx-muted">Tap it at any door. Your phone can stay in your pocket.</p>
          </>
        ) : (
          <>
            <p className="dxf-band-title">No wristband yet</p>
            <p className="dx-small dx-muted">Collect it at {DESK}.</p>
          </>
        )}
      </div>
    </div>
  );
}

function PassActions({ onBright }: { onBright: () => void }) {
  const [added, setAdded] = useState(0);
  useEffect(() => {
    if (!added) return;
    const t = window.setTimeout(() => setAdded(0), 2600);
    return () => window.clearTimeout(t);
  }, [added]);
  return (
    <div className="dxf-pass-actions">
      <button type="button" className="dx-btn dxf-quiet" onClick={() => setAdded((k) => k + 1)}>
        {added ? <RewardTick key={added} label="Added" /> : <WalletIcon />}
        {added ? "Added to wallet" : "Add to wallet"}
      </button>
      <span className="dx-sr" role="status">
        {added ? "Added to your wallet" : ""}
      </span>
      <button type="button" className="dx-btn dxf-quiet" onClick={onBright}>
        <SunIcon /> Make the code brighter
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ brighter: the code alone, full white */

function BrightSheet({ code, onClose }: { code: string; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="dxf-bright" role="dialog" aria-modal="true" aria-label="Your code, full brightness">
      <div className="dxf-bright-qr">
        <QRCodeSVG value={code} size={480} marginSize={0} level="M" bgColor="#ffffff" fgColor="#0a0a0a" title={`Entry code for ${HOLDER}`} role="img" style={{ width: "100%", height: "auto", display: "block" }} />
      </div>
      <p className="dxf-bright-name">{HOLDER}</p>
      <p className="dxf-card-muted dxf-card-small">Turn your screen brightness up and hold the phone flat to the reader.</p>
      <button ref={closeRef} type="button" className="dxf-bright-close" onClick={onClose}>
        Done
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ icons */

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}
function WalletIcon() {
  return (
    <Icon>
      <rect x="2.5" y="4.5" width="15" height="11.5" rx="2.5" />
      <path d="M13 10.25h1.5M2.5 8h15" />
    </Icon>
  );
}
function SunIcon() {
  return (
    <Icon>
      <circle cx="10" cy="10" r="3.2" />
      <path d="M10 2.5v1.6M10 15.9v1.6M2.5 10h1.6M15.9 10h1.6M4.7 4.7l1.1 1.1M14.2 14.2l1.1 1.1M4.7 15.3l1.1-1.1M14.2 5.8l1.1-1.1" />
    </Icon>
  );
}
function DeskIcon() {
  return (
    <Icon>
      <path d="M10 17.5s-5.5-4.6-5.5-9a5.5 5.5 0 0 1 11 0c0 4.4-5.5 9-5.5 9Z" />
      <circle cx="10" cy="8.5" r="2" />
    </Icon>
  );
}
function BandIcon() {
  return (
    <Icon>
      <rect x="6" y="2.5" width="8" height="15" rx="4" />
      <path d="M8.5 10h3" />
    </Icon>
  );
}
