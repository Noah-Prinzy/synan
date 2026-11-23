/**
 * Phone-side behaviour shared by the Attendee Portal and the Gate Scanner (mobile agent).
 * No visuals here: hooks and small browser helpers only. Build-time PWA plumbing is in
 * ./pwa-plugin.ts and is never imported by app code.
 */
import { useCallback, useEffect, useRef, useState } from "react";

/* ------------------------------------------------------------ service worker */

/**
 * Register the app's service worker after the page has loaded, in production builds only
 * (the dev server never gets one, so hot reload is untouched). Fails silently: the app
 * works without it, just not offline.
 */
export function registerServiceWorker(url: string, scope: string, enabled: boolean): void {
  if (!enabled || typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  const register = () => {
    navigator.serviceWorker.register(url, { scope }).catch(() => {
      /* offline support unavailable; the app still works online */
    });
  };
  if (document.readyState === "complete") register();
  else window.addEventListener("load", register, { once: true });
}

/** True when running as an installed app (home-screen icon), not in a browser tab. */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/**
 * On an installed app on a phone-sized screen, hold portrait (Android honours this only for
 * installed or full-screen apps; elsewhere it is a no-op). Tablets are left free to rotate.
 */
export function lockPortraitOnPhones(): void {
  try {
    if (!isStandalone()) return;
    if (Math.min(window.screen.width, window.screen.height) >= 600) return;
    const orientation = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
    orientation.lock?.("portrait").catch(() => {});
  } catch {
    /* not supported */
  }
}

/* --------------------------------------------------------------- wake lock */

type Sentinel = { released: boolean; release(): Promise<void>; addEventListener(type: "release", fn: () => void): void };
type WakeLockApi = { request(type: "screen"): Promise<Sentinel> };

function wakeLockApi(): WakeLockApi | undefined {
  if (typeof navigator === "undefined") return undefined;
  return (navigator as Navigator & { wakeLock?: WakeLockApi }).wakeLock;
}

export type WakeLockState = "unsupported" | "off" | "on" | "failed";

/**
 * Keep the screen from dimming or locking while `wanted` is true (docs/06 A4 "Keep screen
 * on"; the scanner holds it while scanning). The browser drops the lock whenever the page
 * is hidden — switching apps, locking the phone — so it is requested again each time the
 * page becomes visible. `state` is what is true now, for the button to say so.
 */
export function useWakeLock(wanted: boolean): WakeLockState {
  const [state, setState] = useState<WakeLockState>(() => (wakeLockApi() ? "off" : "unsupported"));
  const sentinel = useRef<Sentinel | null>(null);

  const acquire = useCallback(async () => {
    const api = wakeLockApi();
    if (!api) return setState("unsupported");
    if (document.visibilityState !== "visible") return;
    if (sentinel.current && !sentinel.current.released) return setState("on");
    try {
      const lock = await api.request("screen");
      sentinel.current = lock;
      setState("on");
      lock.addEventListener("release", () => {
        // Released by the browser (page hidden) or by us; visibility brings it back.
        if (sentinel.current === lock) setState(document.visibilityState === "visible" ? "off" : "on");
      });
    } catch {
      setState("failed");
    }
  }, []);

  useEffect(() => {
    if (!wanted) {
      const lock = sentinel.current;
      sentinel.current = null;
      lock?.release().catch(() => {});
      if (wakeLockApi()) setState("off");
      return;
    }
    void acquire();
    const onVisible = () => {
      if (document.visibilityState === "visible") void acquire();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [wanted, acquire]);

  useEffect(
    () => () => {
      sentinel.current?.release().catch(() => {});
      sentinel.current = null;
    },
    [],
  );

  return state;
}

/* ---------------------------------------------------------------- keyboard */

/**
 * How far the on-screen keyboard covers the bottom of the layout viewport, in CSS px.
 * Where the browser shrinks the layout for the keyboard (Android with
 * interactive-widget=resizes-content) this stays 0; where it only shrinks the visual
 * viewport (iOS Safari, Android by default) it is the covered height. Lift a fixed
 * bottom sheet by this much so its field and button stay above the keys.
 */
export function useKeyboardInset(active = true): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const viewport = typeof window !== "undefined" ? window.visualViewport : null;
    if (!active || !viewport) return;
    const update = () => setInset(Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop)));
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
      setInset(0);
    };
  }, [active]);
  return inset;
}

/** True while a text field has focus — i.e. the on-screen keyboard is probably up. */
export function useTyping(): boolean {
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    const isField = (node: EventTarget | null) => {
      const el = node as HTMLElement | null;
      if (!el || !el.tagName) return false;
      if (el.isContentEditable || el.tagName === "TEXTAREA" || el.tagName === "SELECT") return true;
      if (el.tagName !== "INPUT") return false;
      const type = (el as HTMLInputElement).type;
      return !["checkbox", "radio", "button", "submit", "reset", "range", "color", "file"].includes(type);
    };
    const onIn = (event: FocusEvent) => setTyping(isField(event.target));
    const onOut = (event: FocusEvent) => {
      if (!isField(event.relatedTarget)) setTyping(false);
    };
    document.addEventListener("focusin", onIn);
    document.addEventListener("focusout", onOut);
    return () => {
      document.removeEventListener("focusin", onIn);
      document.removeEventListener("focusout", onOut);
    };
  }, []);
  return typing;
}

/* ------------------------------------------------------------------ dialogs */

/**
 * For a modal sheet or menu: focus the first control, keep Tab inside `container` (plus
 * any `also` elements, such as the button that opened it), close on Escape, and stop the
 * page behind from scrolling. Returns focus to `returnTo` when it closes.
 */
export function useModal(
  container: { current: HTMLElement | null },
  open: boolean,
  onClose: () => void,
  options: { also?: { current: HTMLElement | null }[]; returnTo?: { current: HTMLElement | null }; initial?: { current: HTMLElement | null } } = {},
): void {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    if (!open) return;
    const node = container.current;
    if (!node) return;
    const { also = [], returnTo, initial } = optionsRef.current;
    const selector = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusables = () =>
      [...also.map((ref) => ref.current).filter((el): el is HTMLElement => Boolean(el)), ...node.querySelectorAll<HTMLElement>(selector)].filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
    (initial?.current ?? node.querySelector<HTMLElement>(selector))?.focus({ preventScroll: true });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusables();
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      const active = document.activeElement as HTMLElement | null;
      const outside = !active || !items.includes(active);
      if (event.shiftKey && (active === first || outside)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || outside)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    const html = document.documentElement;
    const previous = html.style.overflow;
    html.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      html.style.overflow = previous;
      returnTo?.current?.focus({ preventScroll: true });
    };
  }, [open, container]);
}

/* -------------------------------------------------------------- preferences */

/** A boolean remembered on this device (localStorage), safe where storage is blocked. */
export function useDevicePreference(key: string, fallback: boolean): [boolean, (value: boolean) => void] {
  const [value, setValue] = useState<boolean>(() => {
    try {
      const stored = window.localStorage.getItem(key);
      return stored === null ? fallback : stored === "1";
    } catch {
      return fallback;
    }
  });
  const set = useCallback(
    (next: boolean) => {
      setValue(next);
      try {
        window.localStorage.setItem(key, next ? "1" : "0");
      } catch {
        /* storage blocked: the choice lasts for this page only */
      }
    },
    [key],
  );
  return [value, set];
}
