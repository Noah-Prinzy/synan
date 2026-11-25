/**
 * TEMPORARY, development builds only: lets the owner switch the attendee background between
 * Lines, Gradient and Points (2026-11-25). Delete this file and the lines marked "chooser" in
 * ambient.tsx once one is chosen. Deliberately plain and neutral: a review tool, not the design.
 * Inline styles, so it adds nothing to the app's stylesheet.
 */
import type { CSSProperties } from "react";
import type { BackgroundKind } from "@synan/ui/components";
import { BG_EVENT, BG_KEY } from "./ambient";

const LABEL: Record<BackgroundKind, string> = { lines: "Lines", gradient: "Gradient", points: "Points" };

const bar: CSSProperties = {
  position: "fixed",
  left: "50%",
  // Above the phone's My pass bar.
  bottom: typeof window !== "undefined" && window.innerWidth < 768 ? 88 : 16,
  transform: "translateX(-50%)",
  zIndex: 90,
  display: "flex",
  alignItems: "center",
  gap: 4,
  padding: 4,
  background: "#1c1c1e",
  color: "#f2f2f0",
  font: "500 13px/1 var(--type-ui)",
  boxShadow: "0 8px 30px -8px rgb(0 0 0 / 0.6)",
};
const button = (on: boolean): CSSProperties => ({
  minHeight: 40,
  padding: "0 12px",
  border: 0,
  cursor: "pointer",
  font: "inherit",
  background: on ? "#f2f2f0" : "transparent",
  color: on ? "#111" : "#f2f2f0",
});

export default function BackgroundChooser({ kind, kinds }: { kind: BackgroundKind; kinds: readonly BackgroundKind[] }) {
  const choose = (next: BackgroundKind) => {
    try {
      localStorage.setItem(BG_KEY, next);
    } catch {
      /* storage blocked */
    }
    const url = new URL(window.location.href);
    if (url.searchParams.has("bg")) {
      url.searchParams.set("bg", next);
      window.history.replaceState(window.history.state, "", url);
    }
    window.dispatchEvent(new Event(BG_EVENT));
  };
  return (
    <div role="group" aria-label="Background (review only)" style={bar}>
      <span style={{ padding: "0 8px", color: "#b9b9b4" }}>Background</span>
      {kinds.map((k) => (
        <button key={k} type="button" aria-pressed={k === kind} onClick={() => choose(k)} style={button(k === kind)}>
          {LABEL[k]}
        </button>
      ))}
    </div>
  );
}
