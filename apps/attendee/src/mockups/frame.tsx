/**
 * DEVELOPMENT ONLY — the mock-up root: reads ?d=1|2|3&m=dark|light&photo=0|1&bare=1&still=1,
 * sets the scoped .dx root, and shows the switcher.
 */
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { DirectionSwitcher, parseDirection, parseMode, type DirectionId, type DxMode } from "@synan/ui/mockups";

export interface Dx {
  /** The direction the screen is drawn in (Chosen resolves to 1, or 3 on the event page). */
  d: DirectionId;
  /** The owner's chosen design (D-37, ?d=4): square corners, Calm site, Field event page. */
  chosen: boolean;
  m: DxMode;
  photo: boolean;
  bare: boolean;
  still: boolean;
  /** Same screen, other direction / mode / photo. */
  href: (next: { d?: DirectionId; m?: DxMode; photo?: boolean; screen?: string }) => string;
}

const DxContext = createContext<Dx | null>(null);

export function useDx(): Dx {
  const value = useContext(DxContext);
  if (!value) throw new Error("useDx outside a mock-up frame");
  return value;
}

export const BASE = "/dev/directions";

export function screenHref(screen: string, d: DirectionId, m: DxMode, photo = true, extra = "") {
  return `${BASE}/${screen}?d=${d}&m=${m}${photo ? "" : "&photo=0"}${extra}`;
}

export function DxFrame({
  screen,
  label,
  hasPhoto,
  children,
}: {
  screen: string;
  label: string;
  /** Whether the screen shows event pictures (adds the photo switch). */
  hasPhoto?: boolean;
  children: ReactNode;
}) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const d = parseDirection(params.get("d"));
  const chosen = d === 4;
  /** Chosen = Calm everywhere except the event page, which is Field's (D-37). */
  const eff: DirectionId = chosen ? (screen === "event" ? 3 : 1) : d;
  const m = parseMode(params.get("m"));
  const photo = params.get("photo") !== "0";
  const bare = params.get("bare") === "1";
  const still = params.get("still") === "1";

  const value = useMemo<Dx>(
    () => ({
      d: eff,
      chosen,
      m,
      photo,
      bare,
      still,
      href: (next) =>
        screenHref(next.screen ?? screen, next.d ?? d, next.m ?? m, next.photo ?? photo, `${bare ? "&bare=1" : ""}${still ? "&still=1" : ""}`),
    }),
    [d, eff, chosen, m, photo, bare, still, screen],
  );

  return (
    <DxContext.Provider value={value}>
      <div className="dx" data-dir={eff} data-chosen={chosen ? "" : undefined} data-mode={m} data-app="attendee" data-still={still || undefined} data-bare={bare || undefined}>
        {children}
        {bare ? null : (
          <DirectionSwitcher
            direction={d}
            mode={m}
            photo={hasPhoto ? photo : undefined}
            screenLabel={label}
            onChange={(next) => navigate(value.href(next), { replace: true })}
            onIndex={() => navigate(BASE)}
            onCompare={screen === "showcase" || screen === "event" ? () => navigate(`${BASE}/compare/${screen}?m=${m}${photo ? "" : "&photo=0"}`) : undefined}
            phoneSrc={`${screenHref(screen, d, m, photo)}&bare=1`}
          />
        )}
      </div>
    </DxContext.Provider>
  );
}
