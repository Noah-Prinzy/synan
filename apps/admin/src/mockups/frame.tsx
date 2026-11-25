/**
 * DEVELOPMENT ONLY — the admin mock-up root: reads ?d=1|2|3&m=dark|light&bare=1&still=1, sets the
 * scoped .dx root (data-app="admin": nothing animates), and shows the switcher.
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { DirectionSwitcher, parseDirection, parseMode, type DirectionId, type DxMode } from "@synan/ui/mockups";

export interface Dx {
  /** The direction the screen is drawn in (Chosen resolves to 3, Field). */
  d: DirectionId;
  /** The owner's chosen design (D-37, ?d=4): Field, square corners, no animation. */
  chosen: boolean;
  m: DxMode;
  bare: boolean;
  still: boolean;
  screen: string;
  /** Same screen (or another), other direction / mode. */
  href: (next: { d?: DirectionId; m?: DxMode; screen?: string }) => string;
}

const DxContext = createContext<Dx | null>(null);

export function useDx(): Dx {
  const value = useContext(DxContext);
  if (!value) throw new Error("useDx outside a mock-up frame");
  return value;
}

export const BASE = "/dev/directions";

/** The router's basename (/admin): plain links and iframes need it, router links do not. */
export const ROOT = import.meta.env.BASE_URL.replace(/\/$/, "");

export function screenHref(screen: string, d: DirectionId, m: DxMode, extra = "") {
  return `${BASE}/${screen}?d=${d}&m=${m}${extra}`;
}

/** True at phone width (the layout switches structure there, not only size). */
export function useNarrow(): boolean {
  const query = "(max-width: 720px)";
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setNarrow(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return narrow;
}

export function DxFrame({ screen, label, children }: { screen: string; label: string; children: ReactNode }) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const d = parseDirection(params.get("d"));
  const chosen = d === 4;
  const eff: DirectionId = chosen ? 3 : d;
  const m = parseMode(params.get("m"));
  const bare = params.get("bare") === "1";
  const still = params.get("still") === "1";

  const value = useMemo<Dx>(
    () => ({
      d: eff,
      chosen,
      m,
      bare,
      still,
      screen,
      href: (next) => screenHref(next.screen ?? screen, next.d ?? d, next.m ?? m, `${bare ? "&bare=1" : ""}${still ? "&still=1" : ""}`),
    }),
    [d, eff, chosen, m, bare, still, screen],
  );

  return (
    <DxContext.Provider value={value}>
      <div className="dx" data-dir={eff} data-chosen={chosen ? "" : undefined} data-mode={m} data-app="admin" data-still={still || undefined} data-bare={bare || undefined}>
        {children}
        {bare ? null : (
          <DirectionSwitcher
            direction={d}
            mode={m}
            screenLabel={label}
            onChange={(next) => navigate(value.href(next), { replace: true })}
            onIndex={() => navigate(`${BASE}?m=${m}`)}
            onCompare={() => navigate(`${BASE}/compare/${screen}?m=${m}`)}
            phoneSrc={`${ROOT}${screenHref(screen, d, m, "&bare=1")}`}
          />
        )}
      </div>
    </DxContext.Provider>
  );
}
