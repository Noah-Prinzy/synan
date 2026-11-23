import { BrowserRouter, Navigate, NavLink, Route, Routes } from "react-router-dom";
import type { ReactNode } from "react";
import { BRAND, Wordmark } from "@synan/ui/brand";
import Pair from "./screens/pair";
import Scan from "./screens/scan";
import Recent from "./screens/recent";
import Queue from "./screens/queue";
import Help from "./screens/help";

/**
 * Gate Scanner routes (docs/06 §3.1). Never deeper than one level: every screen
 * reaches the viewfinder in one tap.
 */
export default function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, "")}>
      <Shell>
        <Routes>
          <Route path="/" element={<Scan />} />
          <Route path="/pair" element={<Pair />} />
          <Route path="/recent" element={<Recent />} />
          <Route path="/queue" element={<Queue />} />
          <Route path="/help" element={<Help />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Shell>
    </BrowserRouter>
  );
}

const tabs = [
  { to: "/", label: "Scan", end: true },
  { to: "/recent", label: "Recent" },
  { to: "/queue", label: "Queue" },
  { to: "/help", label: "Help" },
];

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <header className="flex h-12 items-center justify-between border-b border-border px-4">
        <span className="text-17">
          <Wordmark small />
        </span>
        <span className="text-13 text-muted-foreground">{BRAND.surface.scanner}</span>
      </header>
      <main className="flex min-h-0 flex-1 flex-col">{children}</main>
      {/* Thumb reach: the only navigation sits at the bottom edge. */}
      <nav aria-label="Scanner" className="grid grid-cols-4 border-t border-border">
        {tabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) =>
              `relative flex min-h-14 items-center justify-center font-mono text-11 uppercase tracking-[0.12em] ${
                isActive ? "text-foreground" : "text-muted-foreground"
              }`
            }
          >
            {({ isActive }) => (
              <>
                {isActive ? (
                  <span aria-hidden="true" className="absolute inset-x-0 top-0 h-px bg-brand" />
                ) : null}
                {tab.label}
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
