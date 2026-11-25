/**
 * The persistent top bar (docs/06 §2.2): lockup, event selector, live state, operator menu —
 * four ruled cells on one 48px line, no fills. The venue clock and the shift sit in the
 * operator menu; the channel's data rate is for the dev panel, not the chrome.
 */
import { useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChevronDown } from "lucide-react";
import { Mark, Wordmark, surfaceName } from "@synan/ui/brand";
import { SignalShape, formatClock, formatNumber, formatUtcOffset, type LiveState, type SignalState } from "@synan/ui/data";
import { TopBar } from "@synan/ui/shell";
import { THEME_CHOICES, cn, useTheme } from "@synan/ui/components";
import type { DashboardData } from "@synan/mock";
import { api, auth } from "../live/backend";
import { requestEnrolment } from "../access/mfa-bus";
import { GUTTER_X } from "../kit/page";
import { useSession } from "../access/session";
import { useCommand, useTimeZone } from "../live/context";
import { useNow } from "../live/hooks";
import { useSliceValue } from "../live/slice";
import type { CommandEvent } from "../live/transport";
import { Menu, MenuItem, MenuNote } from "./menu";

/**
 * `rail` is the navigation rail beside the page, if the role has one: the lockup cell takes the
 * rail's width so the two rules line up, and over the collapsed rail it shows the mark alone.
 * On a phone a role with a rail has the Menu cell instead, and the lockup moves into its sheet,
 * so the event keeps the room.
 */
export function AdminTopBar({
  menu,
  rail = null,
  alerts = null,
}: {
  menu?: ReactNode;
  rail?: "expanded" | "collapsed" | null;
  /** The alert notice, for roles that see alerts: right-aligned, just before the live state. */
  alerts?: ReactNode;
}) {
  const { can, landing, landingLabel } = useSession();
  // A role that does not watch the floor has no live state to read.
  const watches = can("live.view");
  return (
    <TopBar>
      {menu}
      <div
        className={cn(
          "flex shrink-0 items-center border-r border-border",
          // Without a rail the lockup stands on the page gutter, over the page title.
          rail === null ? GUTTER_X : "max-sm:hidden",
          rail === "expanded" && "w-52 px-5",
          rail === "collapsed" && "w-14 justify-center px-0",
        )}
      >
        <Link
          to={landing}
          aria-label={`${surfaceName("admin")}, ${landingLabel.replace(/^the /, "")}`}
          className="flex h-8 items-center"
        >
          {rail === "collapsed" ? <Mark size={20} title="" /> : <AdminLockup />}
        </Link>
      </div>
      <EventSelector />
      <div aria-hidden="true" className="hidden flex-1 sm:block" />
      {alerts}
      {watches ? (
        <div className="flex shrink-0 items-center border-r border-border px-3 sm:border-r-0 sm:border-l sm:px-4">
          <LiveIndicator />
        </div>
      ) : null}
      <OperatorMenu />
    </TopBar>
  );
}

/** The wordmark and the surface's name, on one baseline. */
export function AdminLockup() {
  return (
    <span className="flex items-baseline gap-2.5 *:shrink-0">
      <Wordmark small className="text-17" />
      <span className="hidden text-12 text-muted-foreground md:inline">Command</span>
    </span>
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

/** A trigger in the top bar: the full cell height, a faint surface on hover and while open. */
const BAR_TRIGGER =
  "flex h-full items-center transition-colors duration-120 ease-standard hover:bg-foreground/4 aria-expanded:bg-foreground/4 focus-visible:-outline-offset-2 motion-reduce:transition-none";

function EventSelector() {
  const { events, event, selectEvent } = useCommand();
  const { can } = useSession();
  const [org, setOrg] = useState<DashboardData | null>(null);
  return (
    <div className="flex min-w-0 flex-1 items-stretch border-r border-border sm:w-72 sm:flex-none lg:w-80">
      <Menu
        onOpen={() => {
          // The organisation's live totals are for roles that watch the floor.
          if (can("live.view")) api.dashboard().then(setOrg, () => setOrg(null));
        }}
        // Named from what it shows (WCAG 2.5.3): "Event:" and "Change event" are added for screen
        // readers only, around the visible title, venue and state, so a speech user can say what they see.
        buttonClassName={cn(BAR_TRIGGER, "w-full min-w-0 gap-3 px-3 text-left sm:px-4")}
        button={
          event ? (
            <>
              <span className="min-w-0 flex-1">
                <span className="sr-only">Event: </span>
                <span className="block truncate text-13 leading-5 font-medium">{event.title}</span>
                <span className="block truncate text-12 leading-4 text-muted-foreground">
                  {event.venue_name}
                  {event.state !== "live" ? <span className="hidden sm:inline"> · {stateView[event.state].text}</span> : null}
                </span>
                <span className="sr-only">. Change event</span>
              </span>
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
          </>
        )}
      </Menu>
    </div>
  );
}

/* ---------------------------------------------------------------- live pill */

export function useLiveState(): LiveState {
  const { store } = useCommand();
  const status = useSliceValue(store.link, (l) => l.status);
  if (status === "idle") return "idle";
  if (status === "live") return "live";
  if (status === "offline") return "offline";
  return "reconnecting";
}

/** The live state as plain words with its shape: Live, Reconnecting…, Offline. No figures. */
const liveView: Record<LiveState, { shape: SignalState; text: string; tone: string; word: string }> = {
  live: { shape: "ok", text: "Live", tone: "text-success", word: "text-foreground" },
  reconnecting: { shape: "warn", text: "Reconnecting…", tone: "text-warning", word: "text-warning" },
  offline: { shape: "stop", text: "Offline", tone: "text-destructive", word: "text-destructive" },
  idle: { shape: "idle", text: "Not live", tone: "text-muted-foreground", word: "text-muted-foreground" },
};

function LiveIndicator() {
  const view = liveView[useLiveState()];
  return (
    <span className="flex items-center gap-2 text-13 whitespace-nowrap">
      <SignalShape state={view.shape} className={view.tone} />
      <span className="sr-only">Connection: </span>
      <span className={view.word}>{view.text}</span>
    </span>
  );
}

/* -------------------------------------------------------------------- clock */

/** Venue-local time, in the operator menu (mounted only while it is open). */
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

function ShiftLabel() {
  const { operator } = useCommand();
  const zone = useTimeZone();
  if (!operator) return null;
  const { shift } = operator;
  return (
    <span className="flex items-baseline gap-2 whitespace-nowrap">
      <span className="text-12 text-muted-foreground">{shift.label}</span>
      <span className="font-mono text-12 tabular-nums">
        {formatClock(shift.starts_at, zone, { seconds: false })}–{formatClock(shift.ends_at, zone, { seconds: false })}
      </span>
    </span>
  );
}

/* ------------------------------------------------------------ operator menu */

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

/** Appearance for this device: System (follows the OS, live), Light or Dark. The menu stays open
    so the choice is seen taking effect; the chosen line carries the accent rule. */
function ThemeItems() {
  const { choice, resolved, setChoice } = useTheme();
  return (
    <div role="group" aria-label="Appearance" className="border-b border-border pb-1">
      <p className="px-3 pt-1.5 pb-0.5 text-12 text-muted-foreground">
        Appearance{choice === "system" ? ` · following this device, ${resolved} now` : ""}
      </p>
      {THEME_CHOICES.map((option) => (
        <MenuItem key={option.value} current={choice === option.value} onSelect={() => setChoice(option.value)}>
          {option.label}
        </MenuItem>
      ))}
    </div>
  );
}

function OperatorMenu() {
  const { user: operator, roleLabel, can, signOut } = useSession();
  const navigate = useNavigate();
  const zone = useTimeZone();
  const initials = operator?.name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <div className="flex items-stretch sm:border-l sm:border-border">
      <Menu
        align="end"
        // The name holds what the button shows, in its order (WCAG 2.5.3): the name and role (from
        // 1536px) and the initials, so "click" plus the initials works for a speech user at any width.
        buttonLabel={operator ? `${[operator.name, roleLabel, initials].filter(Boolean).join(", ")}. Account menu` : "Account menu"}
        buttonClassName={cn(BAR_TRIGGER, "gap-3 px-3 sm:px-4")}
        button={
          <>
            {/* From 1536 there is room to say who is signed in without opening the menu. */}
            <span className="hidden text-right 2xl:block">
              <span className="block text-12 leading-4">{operator?.name ?? "—"}</span>
              <span className="block text-12 leading-4 text-muted-foreground">{roleLabel}</span>
            </span>
            <span aria-hidden="true" className="grid size-8 place-items-center border border-border text-11 font-medium tracking-wide">
              {initials ?? "··"}
            </span>
          </>
        }
      >
        {(close) => (
          <>
            {operator ? (
              <MenuNote>
                <span className="block text-13 font-medium text-foreground">{operator.name}</span>
                {/* The real API has no display name yet: the email stands in, so it is not repeated. */}
                {operator.email !== operator.name ? <span className="block truncate">{operator.email}</span> : null}
                <span className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1">
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
