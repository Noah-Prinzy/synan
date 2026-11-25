/**
 * Theme choice: System (the default, follows `prefers-color-scheme` live), Light or Dark,
 * remembered per device. The tokens live in styles/theme.css under :root (dark) and
 * :root[data-theme="light"].
 *
 * First paint is not done here: a tiny inline script in each app's index.html reads the same
 * key and sets the same attributes before any CSS or module loads, so there is no flash of the
 * wrong theme. It also follows the system setting and other tabs from then on. This module is
 * what React reads and writes; keep the two in step (key, attribute, colours).
 *
 *   localStorage["synan.theme"]  "light" | "dark"; absent means System
 *   <html data-theme>            the resolved theme, always "light" or "dark"
 *   <html class="dark">          present on dark only (the `dark:` variant)
 *   <meta name="theme-color">    browser chrome: the ground of the resolved theme
 *   <meta name="color-scheme">   the resolved theme
 */
import { createElement, useEffect, useState, useSyncExternalStore, type ComponentType } from "react";
import type { QuietZone } from "./gathering";

export type { QuietZone };

export type ThemeChoice = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "synan.theme";

/** Browser chrome per theme: the ground colour of each (theme.css --background). */
export const THEME_CHROME: Record<ResolvedTheme, string> = { dark: "#0a0a0a", light: "#f7f5f0" };

const CHANGE = "synan:theme";
const LIGHT_QUERY = "(prefers-color-scheme: light)";

export function readThemeChoice(): ThemeChoice {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    return "system";
  }
}

function systemTheme(): ResolvedTheme {
  return typeof window !== "undefined" && window.matchMedia?.(LIGHT_QUERY).matches ? "light" : "dark";
}

export function resolveTheme(choice: ThemeChoice): ResolvedTheme {
  return choice === "system" ? systemTheme() : choice;
}

/** Puts a resolved theme on the document (the same four things the inline script sets). */
export function applyTheme(theme: ResolvedTheme): void {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.classList.toggle("dark", theme === "dark");
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_CHROME[theme]);
  document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", theme);
}

export function setThemeChoice(choice: ThemeChoice): void {
  try {
    if (choice === "system") window.localStorage.removeItem(THEME_STORAGE_KEY);
    else window.localStorage.setItem(THEME_STORAGE_KEY, choice);
  } catch {
    /* storage blocked: the choice holds for this page only */
  }
  applyTheme(resolveTheme(choice));
  window.dispatchEvent(new Event(CHANGE));
}

function subscribe(onChange: () => void): () => void {
  const query = window.matchMedia?.(LIGHT_QUERY);
  window.addEventListener(CHANGE, onChange);
  window.addEventListener("storage", onChange);
  query?.addEventListener("change", onChange);
  return () => {
    window.removeEventListener(CHANGE, onChange);
    window.removeEventListener("storage", onChange);
    query?.removeEventListener("change", onChange);
  };
}

/** The current choice and the theme it resolves to; re-renders when either changes. */
export function useTheme(): { choice: ThemeChoice; resolved: ResolvedTheme; setChoice: (choice: ThemeChoice) => void } {
  const choice = useSyncExternalStore(subscribe, readThemeChoice, () => "system" as const);
  const resolved = useSyncExternalStore(subscribe, () => resolveTheme(readThemeChoice()), () => "dark" as const);
  return { choice, resolved, setChoice: setThemeChoice };
}

export const THEME_CHOICES: { value: ThemeChoice; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

/**
 * The Gathering field behind every attendee page (D-37; ./gathering). It is never on the critical
 * path: nothing of it loads until the page has painted and the browser is idle, then its own
 * chunk arrives and draws. Admin Command and the Gate Scanner do not use it.
 */
export function GatheringBackground(props: { quiet?: QuietZone; strength?: number }) {
  const [Field, setField] = useState<ComponentType<{ quiet?: QuietZone; strength?: number }> | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      void import("./gathering").then(
        (m) => {
          if (!cancelled) setField(() => m.default);
        },
        () => {
          /* offline before the chunk was cached: the page simply has no field */
        },
      );
    };
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
    const later = () => (w.requestIdleCallback ? w.requestIdleCallback(load, { timeout: 2000 }) : window.setTimeout(load, 200));
    if (document.readyState === "complete") later();
    else window.addEventListener("load", later, { once: true });
    return () => {
      cancelled = true;
      window.removeEventListener("load", later);
    };
  }, []);
  return Field ? createElement(Field, props) : null;
}
