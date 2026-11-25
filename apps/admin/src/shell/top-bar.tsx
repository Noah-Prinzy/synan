/**
 * The top bar (D-37, docs/05 §5 "Admin Command layout"): one full-width solid band — the
 * wordmark, the event switcher, the sections (Live · Events · People · Setup), the alert notice,
 * the live gate status in mono, and the account. There is no side rail. The venue clock and the
 * shift sit in the account menu. On a phone the sections move into a menu sheet (PhoneNav) and
 * the gate status into a strip under the bar.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChevronDown } from "lucide-react";
import { Mark, Wordmark, surfaceName } from "@synan/ui/brand";
import { SignalShape, formatAge, formatClock, formatNumber, formatUtcOffset, type LiveState, type SignalState } from "@synan/ui/data";
import { Avatar, TopBar } from "@synan/ui/shell";
import { THEME_CHOICES, cn, useTheme } from "@synan/ui/components";
import type { DashboardData } from "@synan/mock";
import { api, auth } from "../live/backend";
import { requestEnrolment } from "../access/mfa-bus";
import { useSession } from "../access/session";
import { useCommand, useTimeZone } from "../live/context";
import { useNow } from "../live/hooks";
import { useSlice, useSliceValue } from "../live/slice";
import type { CommandEvent } from "../live/transport";
import { Menu, MenuItem, MenuNote } from "./menu";

export function AdminTopBar({
  menu = null,
  sections = null,
  alerts = null,
}: {
  /** The phone's Menu button (below 640), for a role with more than one screen. */
  menu?: ReactNode;
  /** The sections, from 640 up, for a role with more than one screen. */
  sections?: ReactNode;
  /** The alert notice, for roles that see alerts. */
  alerts?: ReactNode;
}) {
  const { can, landing, landingLabel } = useSession();
  // A role that does not watch the floor has no live state to read.
  const watches = can("live.view");
  return (
    <TopBar className="relative z-30 gap-2 pr-2 shadow-depth sm:pr-3 2xl:pr-5">
      <div className="flex min-w-0 flex-1 basis-0 items-center gap-1 pl-4 sm:pl-6 2xl:pl-8">
        <Link
          to={landing}
          aria-label={`${surfaceName("admin")}, ${landingLabel.replace(/^the /, "")}`}
          className="mr-2 flex h-10 shrink-0 items-center sm:mr-3"
        >
          {/* On a phone the mark alone, so the event keeps the room. */}
          <span className="hidden sm:contents">
            <Wordmark small className="text-17" />
          </span>
          <span className="contents sm:hidden">
            <Mark size={22} title="" />
          </span>
        </Link>
        <EventSelector />
      </div>
      {sections ? <div className="hidden shrink-0 items-center sm:flex">{sections}</div> : null}
      <div className="flex flex-1 basis-0 items-center justify-end gap-1.5">
        {alerts}
        {watches ? <LiveStatus className="hidden lg:flex" /> : null}
        <OperatorMenu />
        {menu}
      </div>
    </TopBar>
  );
}

/* ----------------------------------------------------------- event selector */

/** An event's state in words, in the UI sans; only Live carries a signal colour. */
const stateView: Record<CommandEvent["state"], { text: string; tone: string }> = {
  live: { text: "Live", tone: "text-success" },
  published: { text: "Published", tone: "text-muted-foreground" },
  draft: { text: "Draft", tone: "text-muted-foreground" },
  closed: { text: "Closed", tone: "text-muted-foreground" },
  archived: { text: "Archived", tone: "text-muted-foreground" },
};

/** A trigger in the top bar: a tonal step under the pointer and while open. */
const BAR_TRIGGER = "flex h-10 items-center hover:bg-surface-2 aria-expanded:bg-surface-2 pointer-coarse:h-11";

function EventSelector() {
  const { events, event, selectEvent } = useCommand();
  const { can } = useSession();
  const navigate = useNavigate();
  const [org, setOrg] = useState<DashboardData | null>(null);
  return (
    <div className="flex min-w-0 items-center">
      <Menu
        onOpen={() => {
          // The organisation's live totals are for roles that watch the floor.
          if (can("live.view")) api.dashboard().then(setOrg, () => setOrg(null));
        }}
        // Named from what it shows (WCAG 2.5.3): "Event:" and "Change event" are added for screen
        // readers only, around the visible title and state.
        buttonClassName={cn(BAR_TRIGGER, "min-w-0 gap-2 px-2.5 text-left")}
        button={
          event ? (
            <>
              <span className="sr-only">Event: </span>
              {event.state === "live" ? <SignalShape state="ok" className="text-success" /> : null}
              <span className="min-w-0 truncate text-13 font-medium">{event.title}</span>{" "}
              <span className="hidden shrink-0 text-13 text-muted-foreground md:inline">{stateView[event.state].text}</span>
              <span className="sr-only">. Change event</span>
              <ChevronDown aria-hidden="true" size={16} strokeWidth={1.5} className="shrink-0 text-muted-foreground" />
            </>
          ) : (
            <span className="text-muted-foreground">Loading events…</span>
          )
        }
      >
        {(close) => (
          <>
            <MenuNote>
              {org ? (
                <>
                  Across the organisation:{" "}
                  <span className="font-mono text-foreground tabular-nums">{org.live_events}</span> live ·{" "}
                  <span className="font-mono text-foreground tabular-nums">{formatNumber(org.on_site)}</span> on site ·{" "}
                  <span className="font-mono text-foreground tabular-nums">{org.open_alerts}</span> open alerts
                </>
              ) : can("live.view") ? (
                "Events"
              ) : (
                "Your events"
              )}
            </MenuNote>
            {(events ?? []).map((item) => (
              <MenuItem
                key={item.id}
                current={item.id === event?.id}
                onSelect={() => {
                  selectEvent(item.id);
                  close();
                }}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{item.title}</span>
                  <span className="block truncate text-12 text-muted-foreground">
                    {item.venue_name} ·{" "}
                    <span className="font-mono tabular-nums">
                      {new Date(item.starts_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: item.timezone })}
                    </span>
                  </span>
                </span>
                <span className={cn("flex shrink-0 items-center gap-1.5 self-start pt-0.5 text-12", stateView[item.state].tone)}>
                  {item.state === "live" ? <SignalShape state="ok" /> : null}
                  {stateView[item.state].text}
                </span>
              </MenuItem>
            ))}
            {can("events.list") ? (
              <MenuItem
                onSelect={() => {
                  close();
                  navigate("/events");
                }}
              >
                <span className="text-muted-foreground">All events</span>
              </MenuItem>
            ) : null}
          </>
        )}
      </Menu>
    </div>
  );
}

/* -------------------------------------------------------------- live status */

export function useLiveState(): LiveState {
  const { store } = useCommand();
  const status = useSliceValue(store.link, (l) => l.status);
  if (status === "idle") return "idle";
  if (status === "live") return "live";
  if (status === "offline") return "offline";
  return "reconnecting";
}

const liveView: Record<LiveState, { shape: SignalState; text: string; tone: string }> = {
  live: { shape: "ok", text: "Live", tone: "text-success" },
  reconnecting: { shape: "warn", text: "Reconnecting…", tone: "text-warning" },
  offline: { shape: "stop", text: "Offline", tone: "text-destructive" },
  idle: { shape: "idle", text: "Not live", tone: "text-muted-foreground" },
};

/**
 * The live gate status in mono: "4/4 gates online · last scan 12 s · 74 / min", from the gates'
 * health and the scans as they arrive. The scan rate starts from the gates' own last-minute counts
 * and becomes the count of scans received in the last minute once a minute has been watched. A
 * figure the data does not give is left out, never guessed. While the link is down it says so
 * in words, with its shape.
 */
export function LiveStatus({ className, strip = false }: { className?: string; strip?: boolean }) {
  const { store } = useCommand();
  const state = useLiveState();
  const gates = useSlice(store.gates);
  const load = useSliceValue(store.load, (l) => l.status);
  const now = useNow(1000);
  const seen = useRef<number[]>([]);
  const [since] = useState(() => store.now());
  const [lastScan, setLastScan] = useState<number | null>(null);

  useEffect(
    () =>
      store.subscribeScans((scan) => {
        const at = store.now();
        seen.current.push(at);
        const corrected = Date.parse(scan.corrected_at);
        setLastScan((prev) => Math.max(prev ?? 0, Number.isFinite(corrected) ? Math.min(corrected, at) : at));
      }),
    [store],
  );

  const view = liveView[state];
  const ready = load === "ready" && gates.size > 0;
  let online = 0;
  let snapshotRate = 0;
  let snapshotLast: number | null = null;
  for (const gate of gates.values()) {
    if (gate.link_state === "online") online++;
    snapshotRate += gate.scans_last_minute;
    const at = gate.last_scan_at ? Date.parse(gate.last_scan_at) : NaN;
    if (Number.isFinite(at)) snapshotLast = Math.max(snapshotLast ?? 0, at);
  }
  seen.current = seen.current.filter((at) => now - at < 60_000);
  const rate = now - since >= 60_000 ? seen.current.length : snapshotRate;
  const last = lastScan ?? snapshotLast;
  const allOnline = online === gates.size;

  return (
    <div className={cn("h-10 items-center gap-3 px-3 font-mono", strip ? "justify-center bg-surface" : "bg-surface-2", " text-12 whitespace-nowrap text-muted-foreground tabular-nums", className)}>
      <span className={cn("flex items-center gap-2", state !== "live" && view.tone)}>
        <SignalShape state={state === "live" && ready && !allOnline ? "warn" : view.shape} className={state === "live" && ready && !allOnline ? "text-warning" : view.tone} />
        <span className="sr-only">Connection: </span>
        {state === "live" && ready ? (
          <span>
            <span className="text-foreground">
              {online}/{gates.size}
            </span>{" "}
            {gates.size === 1 ? "gate" : "gates"} online
          </span>
        ) : (
          <span className="font-sans text-13">{view.text}</span>
        )}
      </span>
      {state === "live" && ready && last !== null ? (
        <span>
          last scan <span className="text-foreground">{formatAge(now - last)}</span>
        </span>
      ) : null}
      {state === "live" && ready ? (
        <span>
          <span className="text-foreground">{formatNumber(rate)}</span> / min
        </span>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------- clock */

/** Venue-local time, in the account menu (mounted only while it is open). */
function VenueClock() {
  const zone = useTimeZone();
  const now = useNow(1000);
  return (
    <>
      <span className="font-mono text-foreground tabular-nums">{formatClock(now, zone, { seconds: false })}</span>{" "}
      <span className="font-mono tabular-nums">{formatUtcOffset(now, zone)}</span>
    </>
  );
}

/* ------------------------------------------------------------ account menu */

/** Real API only: whether the second factor is set up, and until when a step-up lasts. */
function SecondFactorItems({ close, zone }: { close: () => void; zone: string }) {
  const session = auth?.session();
  if (!session) return null;
  if (!session.mfa_enrolled) {
    return (
      <MenuItem
        onSelect={() => {
          close();
          requestEnrolment();
        }}
      >
        <span>
          <span className="block">Set up authenticator</span>
          <span className="block text-12 text-muted-foreground">Some actions ask for its code</span>
        </span>
      </MenuItem>
    );
  }
  const until = session.mfa_until;
  if (!until || until <= Date.now()) return null;
  return (
    <MenuNote>
      Code confirmed until{" "}
      <span className="font-mono text-foreground tabular-nums">{formatClock(new Date(until).toISOString(), zone, { seconds: false })}</span>
    </MenuNote>
  );
}

/** Appearance for this device: System (follows the OS, live), Light or Dark, as three tonal cells;
    the chosen one is ink. The menu stays open so the choice is seen taking effect. */
function ThemeItems() {
  const { choice, resolved, setChoice } = useTheme();
  return (
    <div role="group" aria-label="Appearance" className="px-4 pt-2 pb-3">
      <p className="pb-2 text-12 text-muted-foreground">
        Appearance{choice === "system" ? ` · following this device, ${resolved} now` : ""}
      </p>
      <div className="grid grid-cols-3 gap-1">
        {THEME_CHOICES.map((option) => (
          <button
            key={option.value}
            type="button"
            role="menuitem"
            tabIndex={-1}
            aria-current={choice === option.value || undefined}
            onClick={() => setChoice(option.value)}
            className="h-8 bg-surface-2 text-13 hover:bg-surface-3 focus-visible:-outline-offset-2 aria-current:bg-foreground aria-current:text-background pointer-coarse:h-11"
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function initialsOf(name: string | undefined): string | undefined {
  return name
    ?.split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function OperatorMenu() {
  const { user: operator, roleLabel, can, signOut } = useSession();
  const navigate = useNavigate();
  const zone = useTimeZone();
  const initials = initialsOf(operator?.name);
  return (
    <div className="flex items-center">
      <Menu
        align="end"
        // The name holds what the button shows (WCAG 2.5.3): the initials, after who and what role.
        buttonLabel={operator ? `${[operator.name, roleLabel, initials].filter(Boolean).join(", ")}. Account menu` : "Account menu"}
        buttonClassName="grid size-11 place-items-center rounded-full hover:[&>span]:bg-surface-3 aria-expanded:[&>span]:bg-surface-3"
        button={<Avatar initials={initials ?? "··"} />}
      >
        {(close) => (
          <>
            {operator ? (
              <MenuNote>
                <span className="flex items-center gap-3 pb-3">
                  <Avatar initials={initials ?? "··"} />
                  <span className="min-w-0">
                    <span className="block truncate text-13 font-medium text-foreground">{operator.name}</span>
                    {/* The real API has no display name yet: the email stands in, so it is not repeated. */}
                    {operator.email !== operator.name ? <span className="block truncate">{operator.email}</span> : null}
                  </span>
                </span>
                <span className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1">
                  <span>Role</span>
                  <span className="text-foreground">{roleLabel}</span>
                  {/* The real API sends no shift when there is none; nothing is invented. */}
                  {operator.shift.label ? (
                    <>
                      <span>Shift</span>
                      <span>
                        <span className="text-foreground">{operator.shift.label}</span>{" "}
                        <span className="font-mono tabular-nums">
                          {formatClock(operator.shift.starts_at, zone, { seconds: false })}–
                          {formatClock(operator.shift.ends_at, zone, { seconds: false })}
                        </span>
                      </span>
                    </>
                  ) : null}
                  {can("live.view") ? (
                    <>
                      <span>Venue time</span>
                      <span>
                        <VenueClock />
                      </span>
                    </>
                  ) : null}
                </span>
              </MenuNote>
            ) : null}
            {auth ? <SecondFactorItems close={close} zone={zone} /> : null}
            <ThemeItems />
            {can("settings.manage") ? (
              <MenuItem
                onSelect={() => {
                  close();
                  navigate("/settings");
                }}
              >
                Settings
              </MenuItem>
            ) : null}
            <MenuItem
              onSelect={() => {
                close();
                void signOut();
              }}
            >
              Sign out
            </MenuItem>
          </>
        )}
      </Menu>
    </div>
  );
}
