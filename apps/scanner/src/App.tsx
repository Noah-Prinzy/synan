import { BrowserRouter, Link, Navigate, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { useEffect, type ReactNode } from "react";
import { BRAND, Wordmark } from "@synan/ui/brand";
import Pair from "./screens/pair";
import Scan from "./screens/scan";
import Recent from "./screens/recent";
import Queue from "./screens/queue";
import Help from "./screens/help";
import { gateById } from "./data/mock";
import { setForceOffline, useOnline, useScanner } from "./data/store";
import { unlockAudio } from "./data/feedback";

/**
 * Gate Scanner routes (docs/06 §3.1). Never deeper than one level: every screen
 * reaches the viewfinder in one tap.
 */
export default function App() {
  useEffect(() => {
    // Development: ?offline=1 behaves as if the network were down; ?offline=0 restores.
    const flag = new URLSearchParams(window.location.search).get("offline");
    if (flag !== null) setForceOffline(flag === "1");
    // Tones need one touch or key first (browser rule).
    const unlock = () => unlockAudio();
    window.addEventListener("pointerdown", unlock, { once: true, capture: true });
    window.addEventListener("keydown", unlock, { once: true, capture: true });
  }, []);

  return (
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, "")}>
      <Shell>
        <Routes>
          <Route path="/" element={<RequireGate><Scan /></RequireGate>} />
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

/** No gate yet: choosing one is the first thing a device does. */
function RequireGate({ children }: { children: ReactNode }) {
  const { gateId } = useScanner();
  if (!gateById(gateId)) return <Navigate to="/pair" replace />;
  return <>{children}</>;
}

const tabs = [
  { to: "/", label: "Scan", end: true },
  { to: "/recent", label: "Recent" },
  { to: "/queue", label: "Queue" },
  { to: "/help", label: "Help" },
];

function LinkState() {
  const online = useOnline();
  const { scans } = useScanner();
  const waiting = scans.filter((scan) => !scan.synced).length;
  if (online && waiting === 0) {
    return (
      <span className="flex items-center gap-1.5">
        <span aria-hidden="true" className="size-1.5 bg-success" />
        Online
      </span>
    );
  }
  return (
    <span className={`flex items-center gap-1.5 ${online ? "" : "text-warning"}`}>
      <span aria-hidden="true" className={`size-1.5 ${online ? "bg-foreground" : "bg-warning"}`} />
      {online ? "Sending" : "Offline"}
      {waiting > 0 ? (
        <>
          {" · "}
          <span className="font-mono">{waiting}</span> queued
        </>
      ) : null}
    </span>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const { gateId, scans } = useScanner();
  const gate = gateById(gateId);
  const { pathname } = useLocation();
  const waiting = scans.filter((scan) => !scan.synced).length;

  return (
    // One screen, never a scrolling page: no pull-to-refresh, no rubber band, no
    // accidental text selection under a thumb. Inner lists scroll on their own.
    <div className="scanner-root fixed inset-0 flex flex-col bg-background text-foreground">
      <header className="flex shrink-0 items-stretch border-b border-border pt-[env(safe-area-inset-top)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">
        <span className="flex items-center px-4 text-17" aria-label={`${BRAND.name} ${BRAND.surface.scanner}`}>
          <Wordmark small />
        </span>
        {gate ? (
          <Link
            to="/pair"
            aria-label={`Gate: ${gate.label}. Change gate`}
            className="flex min-h-14 min-w-0 flex-1 flex-col justify-center border-l border-border px-4 py-1.5"
          >
            <span className="truncate text-15 font-medium leading-tight">{gate.label}</span>
            <span className="mt-0.5 text-13 leading-tight text-muted-foreground" aria-live="polite">
              <LinkState />
            </span>
          </Link>
        ) : (
          <span className="flex min-h-14 flex-1 items-center border-l border-border px-4 text-15 text-muted-foreground">
            {pathname === "/pair" ? "No gate chosen" : BRAND.surface.scanner}
          </span>
        )}
      </header>

      <main className="flex min-h-0 flex-1 flex-col pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">{children}</main>

      {/* Thumb reach: the only navigation sits at the bottom edge. */}
      <nav aria-label="Scanner" className="grid shrink-0 grid-cols-4 border-t border-border pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">
        {tabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) =>
              `pressable relative flex min-h-14 items-center justify-center gap-1.5 border-l border-border text-15 first:border-l-0 landscape:min-h-12 ${
                isActive ? "text-foreground" : "text-muted-foreground"
              }`
            }
          >
            {({ isActive }) => (
              <>
                {isActive ? <span aria-hidden="true" className="absolute inset-x-0 top-0 h-0.5 bg-brand" /> : null}
                {tab.label}
                {tab.to === "/queue" && waiting > 0 ? (
                  <span className="font-mono text-13 text-warning" aria-label={`${waiting} waiting`}>
                    {waiting}
                  </span>
                ) : null}
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
