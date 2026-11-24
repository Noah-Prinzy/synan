/**
 * Development-only: the scenario switcher (docs/02 §8 named scenarios, "show me a
 * breach" in one click), link control for the degraded states, venue size for the
 * performance test, and the frame sampler. Loaded lazily under import.meta.env.DEV,
 * so none of it ships in a production build.
 *
 * On the real API (VITE_API_URL) the mock-only tools are gone: no personas (the role is the
 * signed-in account's, from GET /me/operator), no scenarios, link control or page states.
 * What is left: which server, who is signed in, and the frame sampler.
 */
import { useEffect, useState } from "react";
import type { ScenarioName } from "@synan/mock";
import { API_URL, devParams, mockBackend } from "../live/backend";
import { useCommand } from "../live/context";
import { useSlice, useSliceValue } from "../live/slice";
import { useSession } from "../access/session";
import { sampler, type PerfReport } from "./fps";
import { RolePicker } from "./role-switcher";

const SCENARIOS: { name: ScenarioName; what: string }[] = [
  { name: "doors_open", what: "40 scans/s for 10 s" },
  { name: "capacity_overflow", what: "Workshop passes warn, then stop" },
  { name: "breach_restricted_room", what: "Tier denied, alert raised" },
  { name: "gate_offline", what: "Gate 3 drops, queues, drains" },
  { name: "impossible_travel", what: "Critical: credential suspended" },
  { name: "offline_conflict", what: "Two offline gates, pass reused" },
  { name: "occupancy_drift", what: "Implied exits, session reset" },
  { name: "clock_skew", what: "Scanner clock 3 min fast" },
];

const LOOP_MS = 11_000;

function reloadWith(changes: Record<string, string | null>): void {
  const url = new URL(window.location.href);
  for (const [key, value] of Object.entries(changes)) {
    if (value === null) url.searchParams.delete(key);
    else url.searchParams.set(key, value);
  }
  window.location.assign(url.toString());
}

export default function DevTools() {
  const { event, store } = useCommand();
  const { user, role, roleLabel } = useSession();
  const load = useSlice(store.load);
  const linkStatus = useSliceValue(store.link, (l) => l.status);
  const [open, setOpen] = useState(false);
  const [fps, setFps] = useState(devParams.fps);
  const [looping, setLooping] = useState<ScenarioName | null>(null);
  const [played, setPlayed] = useState<string | null>(null);
  const server = event && load.status === "ready" ? (mockBackend?.serverFor(event.id) ?? null) : null;
  const [ambient, setAmbient] = useState(devParams.ambient);

  // ?scenario=…&loop=1 plays once the event is live on screen.
  useEffect(() => {
    if (!server || !devParams.scenario) return;
    const name = SCENARIOS.find((s) => s.name === devParams.scenario)?.name;
    if (!name) return;
    server.rt.play(name);
    setPlayed(name);
    if (devParams.loop) setLooping(name);
  }, [server]);

  useEffect(() => {
    if (!server || !looping) return;
    const id = window.setInterval(() => server.rt.play(looping), LOOP_MS);
    return () => window.clearInterval(id);
  }, [server, looping]);

  const play = (name: ScenarioName) => {
    server?.rt.play(name);
    setPlayed(name);
  };

  const button =
    "border border-border px-2 py-1 text-left text-11 transition-colors duration-120 hover:border-foreground/50 disabled:opacity-40";

  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        title="Development tools — not part of the product"
        className="fixed right-2 bottom-8 z-50 border border-dashed border-foreground/30 bg-background px-2 py-0.5 font-mono text-11 tracking-[0.12em] text-muted-foreground hover:text-foreground"
      >
        DEV{role && role !== "admin" ? ` · ${roleLabel.toLowerCase()}` : ""}
        {played ? ` · ${played}` : ""}
      </button>
      {fps ? <FpsOverlay /> : null}
      {open ? (
        <div
          role="dialog"
          aria-label="Development tools"
          className="fixed right-2 bottom-15 z-50 max-h-[calc(100dvh-5rem)] w-96 max-w-[calc(100vw-1rem)] overflow-y-auto border border-dashed border-foreground/30 bg-popover text-12 text-foreground"
        >
          <header className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="font-medium">Development tools</span>
            <span className="text-11 text-muted-foreground">not in production builds</span>
          </header>
          {!mockBackend ? (
            <div className="border-b border-border px-3 py-2 text-11 text-muted-foreground">
              <p>
                Real API · <span className="font-mono text-foreground">{API_URL}</span>
              </p>
              <p className="mt-1">
                Signed in as <span className="text-foreground">{user?.email ?? "—"}</span> · {roleLabel || "no role"} (from the server). Personas,
                scenarios and link control are mock-only.
              </p>
            </div>
          ) : null}
          {mockBackend ? (
          <>
          <div className="border-b border-border px-3 py-2">
            <p className="mb-1.5 text-11 text-muted-foreground">View the console as · signed in as {user?.name ?? "—"}</p>
            <RolePicker onPicked={() => setOpen(false)} />
          </div>
          <div className="border-b border-border px-3 py-2">
            <p className="mb-1.5 text-11 text-muted-foreground">Scenarios · {event?.title ?? "no event"}</p>
            <div className="grid grid-cols-2 gap-1">
              {SCENARIOS.map((s) => (
                <button key={s.name} type="button" disabled={!server} onClick={() => play(s.name)} className={button}>
                  <span className="block font-mono">{s.name}</span>
                  <span className="block text-muted-foreground">{s.what}</span>
                </button>
              ))}
            </div>
            <label className="mt-2 flex items-center gap-2">
              <input
                type="checkbox"
                checked={looping !== null}
                disabled={!played}
                onChange={(e) => setLooping(e.target.checked && played ? (played as ScenarioName) : null)}
              />
              Repeat the last scenario every {LOOP_MS / 1000} s
            </label>
            <label className="mt-1 flex items-center gap-2">
              <input
                type="checkbox"
                checked={ambient}
                disabled={!server}
                onChange={(e) => {
                  setAmbient(e.target.checked);
                  if (e.target.checked) server?.startAmbient();
                  else server?.stopAmbient();
                }}
              />
              Background traffic (~2 scans/s)
            </label>
          </div>
          <div className="border-b border-border px-3 py-2">
            <p className="mb-1.5 text-11 text-muted-foreground">
              Admin link · now <span className="font-mono">{linkStatus}</span>
            </p>
            <div className="grid grid-cols-3 gap-1">
              {(["live", "reconnecting", "offline"] as const).map((status) => (
                <button key={status} type="button" disabled={!server} onClick={() => server?.rt.setLink(status)} className={button}>
                  {status}
                </button>
              ))}
            </div>
          </div>
          </>
          ) : null}
          <div className="border-b border-border px-3 py-2">
            <p className="mb-1.5 text-11 text-muted-foreground">{mockBackend ? "Page states (reload)" : "Measure"}</p>
            <div className="grid grid-cols-2 gap-1">
              {mockBackend ? (
              <>
              <button type="button" className={button} onClick={() => reloadWith({ venue: devParams.venue === "large" ? null : "large" })}>
                {devParams.venue === "large" ? "Standard venue (24)" : "60-room venue"}
              </button>
              <button type="button" className={button} onClick={() => reloadWith({ live: devParams.noLive ? null : "none" })}>
                {devParams.noLive ? "Live event" : "No live event"}
              </button>
              <button type="button" className={button} onClick={() => reloadWith({ slow: "1", fail: null })}>
                Loading (slow)
              </button>
              <button type="button" className={button} onClick={() => reloadWith({ fail: "1", slow: null })}>
                Load error
              </button>
              <button
                type="button"
                className={button}
                onClick={() => reloadWith({ venue: null, live: null, slow: null, fail: null, scenario: null, loop: null, fps: null, ambient: null })}
              >
                Reset all
              </button>
              </>
              ) : null}
              <button
                type="button"
                className={button}
                onClick={() => {
                  setFps((f) => !f);
                }}
              >
                {fps ? "Hide" : "Show"} frame sampler
              </button>
            </div>
          </div>
          <p className="px-3 py-2 text-11 text-muted-foreground">
            {mockBackend ? "URL: ?as=role · ?venue=large · ?live=none · ?slow=1 · ?fail=1 · ?ambient=0 · ?scenario=name&loop=1 · ?fps=1" : "URL: ?fps=1"}
          </p>
        </div>
      ) : null}
    </>
  );
}

function FpsOverlay() {
  const [report, setReport] = useState<PerfReport | null>(null);
  useEffect(() => {
    sampler.start();
    const id = window.setInterval(() => setReport(sampler.report(2000)), 500);
    return () => {
      window.clearInterval(id);
      sampler.stop();
    };
  }, []);
  if (!report) return null;
  return (
    <div
      aria-hidden="true"
      className="fixed right-2 bottom-15 z-40 border border-dashed border-foreground/30 bg-popover px-2.5 py-1.5 font-mono text-11 leading-relaxed tabular-nums"
    >
      <div className={report.fps >= 55 ? "text-success" : "text-warning"}>{report.fps.toFixed(1)} fps · 2 s</div>
      <div className="text-muted-foreground">
        frame p95 {report.p95Ms} ms · worst {report.worstMs}
      </div>
      <div className="text-muted-foreground">
        map work p95 {report.workP95Ms} ms · {report.writesPerFrame} writes/frame
      </div>
      <div className="text-muted-foreground">tab {report.visibility}</div>
    </div>
  );
}
