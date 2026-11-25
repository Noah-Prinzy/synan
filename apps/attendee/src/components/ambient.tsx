import { lazy, Suspense, useSyncExternalStore } from "react";
import { useLocation } from "react-router-dom";
import { GatheringBackground, type BackgroundKind, type QuietZone } from "@synan/ui/components";

/** The centre column where a calm screen's statement sits: the field drops to a quarter there. */
const QUIET_CENTRE: QuietZone = { x: 0.22, y: 0.12, w: 0.56, h: 0.5, floor: 0.22 };
/** The event page: below its picture the text runs wide, so the field stays low across the middle. */
const QUIET_WIDE: QuietZone = { x: 0.08, y: 0, w: 0.84, h: 1, floor: 0.4 };

/**
 * The background the owner is choosing between (2026-11-25): Lines, Gradient, or the Points of
 * the Gathering field. Once chosen: set SHIPPED to it, delete components/background-chooser.tsx
 * and everything below marked "chooser", and delete the unchosen kinds in packages/ui/src/theme.
 */
const SHIPPED: BackgroundKind = "lines";
/* chooser: development builds only */
const Chooser = import.meta.env.DEV ? lazy(() => import("./background-chooser")) : null;
export const BG_KEY = "synan.dev.bg"; // chooser
export const BG_EVENT = "synan:bg"; // chooser
const KINDS: readonly BackgroundKind[] = ["lines", "gradient", "points"]; // chooser

/* chooser: ?bg=lines|gradient|points, remembered on the device, in development only */
function readKind(): BackgroundKind {
  if (!import.meta.env.DEV) return SHIPPED;
  const fromUrl = new URLSearchParams(window.location.search).get("bg");
  if (fromUrl && (KINDS as readonly string[]).includes(fromUrl)) {
    try {
      localStorage.setItem(BG_KEY, fromUrl);
    } catch {
      /* storage blocked: the choice holds for this page */
    }
    return fromUrl as BackgroundKind;
  }
  try {
    const stored = localStorage.getItem(BG_KEY);
    if (stored && (KINDS as readonly string[]).includes(stored)) return stored as BackgroundKind;
  } catch {
    /* storage blocked */
  }
  return SHIPPED;
}

/* chooser */
function subscribe(onChange: () => void): () => void {
  window.addEventListener(BG_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(BG_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/**
 * The living background behind every attendee page (D-37, packages/ui theme). It loads after the
 * page has painted and the browser is idle, so no screen waits for it.
 * Development: ?ambient=off renders the page without it, for comparison.
 */
export function Ambient() {
  const { pathname, search } = useLocation();
  const kind = useSyncExternalStore(subscribe, readKind, () => SHIPPED);
  if (import.meta.env.DEV && new URLSearchParams(search).get("ambient") === "off") return null;
  return (
    <>
      <GatheringBackground kind={kind} quiet={/^\/events\/[^/]+\/?$/.test(pathname) ? QUIET_WIDE : QUIET_CENTRE} />
      {Chooser ? (
        <Suspense fallback={null}>
          <Chooser kind={kind} kinds={KINDS} />
        </Suspense>
      ) : null}
    </>
  );
}
