/**
 * DEVELOPMENT ONLY — the small fixed switcher on every direction mock-up: direction 1/2/3,
 * dark/light, photo/no photo (where a screen has pictures), a 390 px phone preview, compare,
 * and back to the index. Router-agnostic: the app passes callbacks.
 */
import { useEffect, useState } from "react";
import { DIRECTIONS, type DirectionId, type DxMode } from "./directions";

export interface SwitcherProps {
  direction: DirectionId;
  mode: DxMode;
  /** Undefined hides the photo toggle. */
  photo?: boolean | undefined;
  screenLabel: string;
  onChange: (next: { d?: DirectionId; m?: DxMode; photo?: boolean }) => void;
  onIndex: () => void;
  onCompare?: (() => void) | undefined;
  /** Same screen, chrome-free, for the phone preview iframe. */
  phoneSrc: string;
}

const KEY = "synan.dx.switcher";

export function DirectionSwitcher({ direction, mode, photo, screenLabel, onChange, onIndex, onCompare, phoneSrc }: SwitcherProps) {
  const [open, setOpen] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved) return saved === "open";
    } catch {
      /* storage unavailable */
    }
    return typeof window === "undefined" || window.innerWidth > 720;
  });
  const [phone, setPhone] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, open ? "open" : "closed");
    } catch {
      /* storage unavailable */
    }
  }, [open]);

  useEffect(() => {
    if (!phone) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPhone(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phone]);

  return (
    <>
      <div className="dxs" data-open={open || undefined} role="region" aria-label="Direction switcher">
        {open ? (
          <>
            <span className="dxs-label">{screenLabel}</span>
            <div className="dxs-group" role="group" aria-label="Direction">
              {DIRECTIONS.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  className="dxs-btn"
                  aria-pressed={direction === d.id}
                  onClick={() => onChange({ d: d.id })}
                  title={d.tagline}
                >
                  {d.id < 4 ? <span className="dxs-num">{d.id} </span> : null}{d.name}
                </button>
              ))}
            </div>
            <div className="dxs-group" role="group" aria-label="Theme">
              {(["dark", "light"] as const).map((m) => (
                <button key={m} type="button" className="dxs-btn" aria-pressed={mode === m} onClick={() => onChange({ m })}>
                  {m === "dark" ? "Dark" : "Light"}
                </button>
              ))}
            </div>
            {photo !== undefined ? (
              <div className="dxs-group" role="group" aria-label="Event picture">
                <button type="button" className="dxs-btn" aria-pressed={photo} onClick={() => onChange({ photo: true })}>
                  Photo
                </button>
                <button type="button" className="dxs-btn" aria-pressed={!photo} onClick={() => onChange({ photo: false })}>
                  No photo
                </button>
              </div>
            ) : null}
            <div className="dxs-group">
              <button type="button" className="dxs-btn" onClick={() => setPhone(true)}>
                Phone 390
              </button>
              {onCompare ? (
                <button type="button" className="dxs-btn" onClick={onCompare}>
                  Compare
                </button>
              ) : null}
              <button type="button" className="dxs-btn" onClick={onIndex}>
                Index
              </button>
            </div>
            <button type="button" className="dxs-btn dxs-close" aria-label="Hide the switcher" onClick={() => setOpen(false)}>
              ×
            </button>
          </>
        ) : (
          <button type="button" className="dxs-btn dxs-fab" aria-label="Show the direction switcher" onClick={() => setOpen(true)}>
            {direction === 4 ? "Chosen" : `D${direction}`} · {mode === "dark" ? "Dark" : "Light"}
          </button>
        )}
      </div>
      {phone ? (
        <div className="dxs-phone" role="dialog" aria-modal="true" aria-label="Phone preview, 390 by 844" onClick={() => setPhone(false)}>
          <div className="dxs-phone-frame" onClick={(event) => event.stopPropagation()}>
            <iframe title="Phone preview" src={phoneSrc} width={390} height={844} />
          </div>
          <button type="button" className="dxs-btn dxs-phone-close" onClick={() => setPhone(false)}>
            Close phone preview
          </button>
        </div>
      ) : null}
    </>
  );
}
