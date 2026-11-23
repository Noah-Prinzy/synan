import { useState } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Wordmark } from "../brand/wordmark";
import {
  admissions,
  credentials,
  event,
  gates,
  peak,
  recentScans,
  zones,
} from "../data/command";
import type { Scan, ScanVerdict } from "../data/command";

const sections = [
  { label: "Overview", href: "#overview" },
  { label: "Scans", href: "#scans" },
  { label: "Zones", href: "#zones" },
  { label: "Gates", href: "#gates" },
  { label: "Credentials", href: "#credentials" },
];

const verdictTone: Record<ScanVerdict, string> = {
  ALLOWED: "text-success",
  DUPLICATE: "text-warning",
  DENIED: "text-destructive",
};

export default function Command() {
  const [query, setQuery] = useState("");
  const [railOpen, setRailOpen] = useState(true);
  const needle = query.trim().toLowerCase();
  const visibleScans = needle
    ? recentScans.filter((scan) =>
        `${scan.time} ${scan.gate} ${scan.credential} ${scan.verdict}`
          .toLowerCase()
          .includes(needle),
      )
    : recentScans;

  return (
    <div className="bg-background text-foreground min-h-dvh lg:flex">
      {railOpen ? <IndexRail onCollapse={() => setRailOpen(false)} /> : null}
      <div className="min-w-0 flex-1">
        <TopBar
          query={query}
          onQueryChange={setQuery}
          railOpen={railOpen}
          onOpenRail={() => setRailOpen(true)}
        />
        <main id="overview" className="px-6 py-8 md:px-10">
          <div className="mx-auto w-full max-w-[1600px]">
            <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
              <div className="space-y-6">
                <HeroPanel />
                <div className="grid gap-6 md:grid-cols-3">
                  <ZonesPanel />
                  <GatesPanel />
                  <CredentialsPanel />
                </div>
              </div>
              <aside className="space-y-6">
                <ScansPanel scans={visibleScans} total={recentScans.length} query={query} />
                <PeakPanel />
              </aside>
            </div>
            <footer className="border-border text-muted-foreground mt-8 flex flex-wrap items-center justify-between gap-2 border-t pt-4 font-mono text-[0.5625rem] tracking-[0.16em] uppercase">
              <span>Connexia Command · {event.name}</span>
              <span>Scans 4 Hz · Gates 1 Hz</span>
            </footer>
          </div>
        </main>
      </div>
    </div>
  );
}

function IndexRail({ onCollapse }: { onCollapse: () => void }) {
  return (
    <aside className="border-border sticky top-0 hidden h-dvh w-56 shrink-0 flex-col border-r lg:flex">
      <div className="flex items-center justify-between gap-3 px-5 py-4">
        <Link to="/" aria-label="Connexia Command home" className="flex items-baseline gap-2">
          <Wordmark className="h-5 w-auto" />
          <span className="text-muted-foreground font-mono text-[0.5rem] tracking-[0.2em] uppercase">
            Command
          </span>
        </Link>
        <button
          type="button"
          onClick={onCollapse}
          aria-label="Hide section index"
          className="border-border text-muted-foreground hover:border-brand hover:text-brand grid size-6 shrink-0 place-items-center border font-mono text-[0.625rem] transition-colors duration-[120ms] ease-[cubic-bezier(.2,0,0,1)] motion-reduce:transition-none"
        >
          ←
        </button>
      </div>
      <nav aria-label="Command sections" className="flex-1 px-3">
        <ul className="flex flex-col">
          {sections.map((section, index) => (
            <li key={section.href}>
              <a
                href={section.href}
                aria-current={index === 0 ? "page" : undefined}
                className={`flex items-baseline gap-3 px-2 py-2.5 font-mono text-[0.6875rem] tracking-[0.12em] uppercase transition-colors duration-[120ms] ease-[cubic-bezier(.2,0,0,1)] motion-reduce:transition-none ${
                  index === 0
                    ? "text-brand"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <span className="text-[0.5625rem] tabular-nums opacity-70">
                  {(index + 1).toString().padStart(2, "0")}
                </span>
                {section.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <p className="text-muted-foreground border-border border-t px-5 py-3 font-mono text-[0.5rem] tracking-[0.16em] uppercase">
        {event.name}
      </p>
    </aside>
  );
}

function TopBar({
  query,
  onQueryChange,
  railOpen,
  onOpenRail,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  railOpen: boolean;
  onOpenRail: () => void;
}) {
  return (
    <header className="border-border border-b">
      <div className="mx-auto w-full max-w-[1600px] px-6 md:px-10">
        <div className="flex items-center gap-6 py-3.5">
          <Link
            to="/"
            aria-label="Connexia Command home"
            className={`flex shrink-0 items-baseline gap-3 ${railOpen ? "lg:hidden" : ""}`}
          >
            <Wordmark className="h-6 w-auto" />
            <span className="text-muted-foreground hidden font-mono text-[0.5625rem] tracking-[0.2em] uppercase sm:inline">
              Command
            </span>
          </Link>
          {!railOpen ? (
            <button
              type="button"
              onClick={onOpenRail}
              className="border-border text-muted-foreground hover:border-brand hover:text-brand hidden border px-2.5 py-1.5 font-mono text-[0.625rem] tracking-[0.12em] uppercase transition-colors duration-[120ms] ease-[cubic-bezier(.2,0,0,1)] lg:block motion-reduce:transition-none"
            >
              Index
            </button>
          ) : null}
          <SectionNav className="hidden md:flex lg:hidden" />
          <div className="ml-auto flex items-center gap-3">
            <label htmlFor="scan-filter" className="sr-only">
              Filter recent scans
            </label>
            <input
              id="scan-filter"
              type="search"
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              placeholder="Filter scans, gates…"
              aria-controls="recent-scans"
              className="border-border placeholder:text-muted-foreground focus:border-brand hidden w-56 border bg-transparent px-3 py-1.5 font-mono text-[0.6875rem] xl:block"
            />
            <span
              role="img"
              aria-label="Signed in as Noah Prins"
              className="border-border grid size-8 shrink-0 place-items-center border font-mono text-[0.625rem] tracking-[0.08em]"
            >
              NP
            </span>
          </div>
        </div>
        <SectionNav className="border-border flex items-center gap-5 overflow-x-auto border-t py-2.5 [scrollbar-width:none] md:hidden [&::-webkit-scrollbar]:hidden" />
      </div>
    </header>
  );
}

function SectionNav({ className = "" }: { className?: string }) {
  return (
    <nav aria-label="Command sections" className={`items-center gap-5 ${className}`}>
      {sections.map((section, index) => (
        <a
          key={section.href}
          href={section.href}
          aria-current={index === 0 ? "page" : undefined}
          className={`shrink-0 border-b px-0.5 py-1.5 font-mono text-[0.6875rem] tracking-[0.12em] uppercase transition-colors motion-reduce:transition-none ${
            index === 0
              ? "border-brand text-brand"
              : "text-muted-foreground border-transparent hover:text-foreground"
          }`}
        >
          {section.label}
        </a>
      ))}
    </nav>
  );
}

function HeroPanel() {
  const max = Math.max(...admissions.map((hour) => hour.count));
  const admittedPct = Math.round((event.admitted / event.registered) * 100);

  return (
    <section aria-labelledby="admissions-title" className="border-border bg-card/30 border">
      <header className="border-border flex flex-wrap items-center justify-between gap-3 border-b px-5 py-3.5">
        <span className="flex items-center gap-2 font-mono text-[0.6875rem] tracking-[0.14em] uppercase">
          <span className="relative flex size-1.5" aria-hidden="true">
            <span className="bg-success absolute inline-flex h-full w-full animate-ping opacity-50 motion-reduce:animate-none" />
            <span className="bg-success relative inline-flex size-1.5" />
          </span>
          Live · {event.name}
        </span>
        <span className="text-muted-foreground font-mono text-[0.625rem] tracking-[0.12em] uppercase">
          Updated {event.updatedSeconds}s ago
        </span>
      </header>

      <div className="px-5 pt-6 pb-5 md:px-6">
        <h1
          id="admissions-title"
          className="font-serif text-4xl leading-none tracking-tight md:text-5xl"
        >
          Check-ins
        </h1>
        <p className="text-muted-foreground mt-3 text-sm">
          {event.venue} · {event.doors}
        </p>

        <dl className="border-border bg-border mt-8 grid grid-cols-2 gap-px border md:grid-cols-3 lg:grid-cols-5">
          <Stat
            label="Registered"
            value={event.registered.toLocaleString("en-US")}
            meta="credentials issued"
          />
          <Stat
            label="Checked in"
            value={event.admitted.toLocaleString("en-US")}
            meta={`${admittedPct}% of registered`}
          />
          <Stat
            label="On site now"
            value={event.onSite.toLocaleString("en-US")}
            meta="68 exited since 12:00"
          />
          <Stat
            label="Capacity risk"
            value={`${event.capacityRisk} room`}
            meta="Workshop A · 98%"
          />
          <Stat
            label="Open alerts"
            value={String(event.openAlerts)}
            meta="Gate 3 degraded"
            className="col-span-2 md:col-span-2 lg:col-span-1"
          />
        </dl>

        <figure className="mt-8">
          <figcaption className="flex items-baseline justify-between gap-3">
            <span className="text-muted-foreground font-mono text-[0.625rem] tracking-[0.14em] uppercase">
              Checked in by hour
            </span>
            <span className="text-muted-foreground font-mono text-[0.625rem] tracking-[0.12em] uppercase">
              Total {event.admitted.toLocaleString("en-US")}
            </span>
          </figcaption>
          <div aria-hidden="true" className="mt-3 flex h-40 items-stretch gap-2 sm:gap-3">
            {admissions.map((hour) => {
              const height = Math.max(2, (hour.count / max) * 100);
              return (
                <div
                  key={hour.hour}
                  title={`${hour.hour} · ${hour.count} checked in`}
                  className="flex min-w-0 flex-1 flex-col"
                >
                  <div className="border-border flex flex-1 items-end border-b">
                    <div
                      className={`w-full transition-colors motion-reduce:transition-none ${
                        hour.current
                          ? "bg-brand"
                          : "bg-foreground/15 hover:bg-foreground/30"
                      }`}
                      style={{ height: `${height}%` }}
                    />
                  </div>
                  <span
                    className={`pt-2 text-center font-mono text-[0.5625rem] tracking-[0.08em] ${
                      hour.current ? "text-foreground" : "text-muted-foreground"
                    }`}
                  >
                    {hour.hour.slice(0, 2)}
                  </span>
                </div>
              );
            })}
          </div>
          <p className="sr-only">
            Check-ins by hour:{" "}
            {admissions.map((hour) => `${hour.hour}, ${hour.count}`).join("; ")}.
          </p>
        </figure>
      </div>
    </section>
  );
}

function Stat({
  label,
  value,
  meta,
  className = "",
}: {
  label: string;
  value: string;
  meta: string;
  className?: string;
}) {
  return (
    <div className={`bg-background px-4 py-4 ${className}`}>
      <dt className="text-muted-foreground font-mono text-[0.5625rem] tracking-[0.16em] uppercase">
        {label}
      </dt>
      <dd className="mt-2 font-mono text-2xl leading-none tracking-tight tabular-nums md:text-[1.75rem]">
        {value}
      </dd>
      <dd className="text-muted-foreground mt-2 font-mono text-[0.625rem]">{meta}</dd>
    </div>
  );
}

function ScansPanel({
  scans,
  total,
  query,
}: {
  scans: Scan[];
  total: number;
  query: string;
}) {
  return (
    <section id="scans" aria-labelledby="scans-title" className="border-border bg-card/30 border">
      <header className="border-border flex items-center justify-between gap-3 border-b px-5 py-3.5">
        <h2
          id="scans-title"
          className="text-muted-foreground font-mono text-[0.6875rem] tracking-[0.14em] uppercase"
        >
          Recent scans
        </h2>
        <span className="text-muted-foreground flex items-center gap-1.5 font-mono text-[0.5625rem] tracking-[0.14em] uppercase">
          <span className="bg-success size-1" aria-hidden="true" />
          Live · 4 Hz
        </span>
      </header>

      {scans.length > 0 ? (
        <ul id="recent-scans" className="divide-border divide-y">
          {scans.map((scan) => (
            <li
              key={`${scan.time}-${scan.credential}`}
              className="hover:bg-card/60 grid grid-cols-[3.6rem_minmax(0,1fr)_auto] items-baseline gap-3 px-5 py-3 transition-colors motion-reduce:transition-none"
            >
              <span className="text-muted-foreground font-mono text-[0.625rem] tabular-nums">
                {scan.time}
              </span>
              <span className="truncate text-sm">
                {scan.gate}{" "}
                <span className="text-muted-foreground font-mono text-[0.625rem]">
                  · {scan.credential}
                </span>
              </span>
              <span
                className={`font-mono text-[0.5625rem] tracking-[0.12em] ${verdictTone[scan.verdict]}`}
              >
                {scan.verdict}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p
          id="recent-scans"
          className="text-muted-foreground px-5 py-8 text-center text-sm"
        >
          No scans match “{query.trim()}”.
        </p>
      )}

      <p
        role="status"
        className="border-border text-muted-foreground border-t px-5 py-3 font-mono text-[0.625rem]"
      >
        Showing {scans.length} of {total} scans
      </p>
    </section>
  );
}

function Panel({
  id,
  title,
  aside,
  children,
}: {
  id: string;
  title: string;
  aside?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="border-border bg-card/30 border">
      <header className="border-border flex items-center justify-between gap-3 border-b px-5 py-3.5">
        <h2
          id={`${id}-title`}
          className="text-muted-foreground font-mono text-[0.6875rem] tracking-[0.14em] uppercase"
        >
          {title}
        </h2>
        {aside ? (
          <span className="text-muted-foreground font-mono text-[0.5625rem] tracking-[0.12em] uppercase">
            {aside}
          </span>
        ) : null}
      </header>
      <div className="px-5 py-5">{children}</div>
    </section>
  );
}

function ZonesPanel() {
  return (
    <Panel id="zones" title="Zones" aside={`${zones.length} tracked`}>
      <ul className="space-y-5">
        {zones.map((zone) => {
          const hot = zone.pct >= 95;
          return (
            <li key={zone.name}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="truncate text-sm">{zone.name}</span>
                <span
                  className={`font-mono text-[0.6875rem] tabular-nums ${
                    hot ? "text-warning" : "text-muted-foreground"
                  }`}
                >
                  {zone.pct}%
                </span>
              </div>
              <div className="mt-2 h-1 w-full bg-foreground/10" aria-hidden="true">
                <div
                  className={`h-full ${hot ? "bg-warning" : "bg-foreground/60"}`}
                  style={{ width: `${zone.pct}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

function GatesPanel() {
  const online = gates.filter((gate) => gate.state === "online").length;
  return (
    <Panel id="gates" title="Gates" aside={`${online}/${gates.length} online`}>
      <ul className="space-y-4">
        {gates.map((gate) => {
          const degraded = gate.state === "degraded";
          return (
            <li key={gate.name} className="flex items-center justify-between gap-3">
              <span className="flex min-w-0 items-center gap-2.5">
                <span
                  className={`size-1.5 shrink-0 ${degraded ? "bg-warning" : "bg-success"}`}
                  aria-hidden="true"
                />
                <span className="truncate text-sm">{gate.name}</span>
              </span>
              <span
                className={`font-mono text-[0.625rem] tabular-nums ${
                  degraded ? "text-warning" : "text-muted-foreground"
                }`}
              >
                {degraded ? `${gate.heartbeat} lag` : gate.heartbeat}
              </span>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

function CredentialsPanel() {
  const issued = credentials.ready + credentials.unbound + credentials.revoked;
  return (
    <Panel
      id="credentials"
      title="Credentials"
      aside={`${issued.toLocaleString("en-US")} issued`}
    >
      <dl className="divide-border divide-y">
        <CredentialRow label="Ready" value={credentials.ready} />
        <CredentialRow label="Not yet bound" value={credentials.unbound} />
        <CredentialRow label="Revoked" value={credentials.revoked} />
      </dl>
      <p className="text-muted-foreground mt-4 text-xs leading-relaxed">
        Unclaimed credentials expire when doors close.
      </p>
    </Panel>
  );
}

function CredentialRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
      <dt className="text-sm">{label}</dt>
      <dd className="font-mono text-sm tabular-nums">{value.toLocaleString("en-US")}</dd>
    </div>
  );
}

function PeakPanel() {
  return (
    <section
      aria-labelledby="peak-title"
      className="border-border from-brand/10 bg-linear-to-b to-transparent border"
    >
      <header className="border-border border-b px-5 py-3.5">
        <h2
          id="peak-title"
          className="text-muted-foreground font-mono text-[0.6875rem] tracking-[0.14em] uppercase"
        >
          Peak window
        </h2>
      </header>
      <div className="px-5 py-5">
        <p className="font-mono text-4xl leading-none tracking-tight tabular-nums">
          {peak.time}
        </p>
        <p className="text-muted-foreground mt-3 max-w-[26ch] text-sm leading-relaxed">
          {peak.zone} holds {peak.pct}% for {peak.minutes} minutes. Two gates opened on
          the west side.
        </p>
        <div className="border-border text-muted-foreground mt-5 flex items-center justify-between border-t pt-3 font-mono text-[0.5625rem] tracking-[0.14em] uppercase">
          <span>Capacity {peak.pct}%</span>
          <span className="text-foreground">+2 gates</span>
        </div>
      </div>
    </section>
  );
}
