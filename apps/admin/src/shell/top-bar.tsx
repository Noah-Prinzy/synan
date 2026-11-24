/**
 * The persistent top bar (docs/06 §2.2): lockup, event selector, live pill,
 * venue-local clock, shift label, operator menu. Ruled cells, no fills.
 */
import { useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChevronDown } from "lucide-react";
import { Wordmark, surfaceName } from "@synan/ui/brand";
import { LivePill, formatClock, formatNumber, formatUtcOffset, type LiveState } from "@synan/ui/data";
import { TopBar, TopBarCell } from "@synan/ui/shell";
import type { DashboardData } from "@synan/mock";
import { api, auth } from "../live/backend";
import { requestEnrolment } from "../access/mfa-bus";
import { useSession } from "../access/session";
import { useCommand, useTimeZone } from "../live/context";
import { useNow } from "../live/hooks";
import { useSliceValue } from "../live/slice";
import type { CommandEvent } from "../live/transport";
import { Menu, MenuItem, MenuNote } from "./menu";

export function AdminTopBar({ menu }: { menu?: ReactNode }) {
  const { can, landing, landingLabel } = useSession();
  // A role that does not watch the floor has no live pill or venue clock to read.
  const watches = can("live.view");
  return (
    <TopBar>
      {menu}
      <TopBarCell className="px-3 sm:px-4 sm:pr-5">
        <Link to={landing} aria-label={`${surfaceName("admin")}, ${landingLabel.replace(/^the /, "")}`} className="flex items-baseline gap-2.5">
          <Wordmark small className="text-17" />
          <span className="hidden text-12 text-muted-foreground md:inline">Command</span>
        </Link>
      </TopBarCell>
      <EventSelector />
      <TopBarCell grow className="hidden border-r-0 sm:flex">
        <span />
      </TopBarCell>
      {watches ? (
        <>
          <TopBarCell className="px-2.5 sm:border-l sm:border-border sm:px-4">
            <LiveIndicator />
          </TopBarCell>
          <TopBarCell className="hidden sm:flex">
            <VenueClock />
          </TopBarCell>
        </>
      ) : null}
      <OperatorMenu />
    </TopBar>
  );
}

/* ----------------------------------------------------------- event selector */

const stateView: Record<CommandEvent["state"], { text: string; tone: string }> = {
  live: { text: "LIVE", tone: "text-success" },
  published: { text: "PUBLISHED", tone: "text-muted-foreground" },
  draft: { text: "DRAFT", tone: "text-muted-foreground" },
  closed: { text: "CLOSED", tone: "text-muted-foreground" },
  archived: { text: "ARCHIVED", tone: "text-muted-foreground" },
};

function EventSelector() {
  const { events, event, selectEvent } = useCommand();
  const { can } = useSession();
  const [org, setOrg] = useState<DashboardData | null>(null);
  return (
    <div className="flex min-w-0 flex-1 items-stretch border-r border-border sm:flex-none">
      <Menu
        onOpen={() => {
          // The organisation's live totals are for roles that watch the floor.
          if (can("live.view")) api.dashboard().then(setOrg, () => setOrg(null));
        }}
        buttonLabel={event ? `Event: ${event.title}. Change event` : "Choose an event"}
        buttonClassName="flex h-full w-full min-w-0 items-center gap-3 px-3 text-left sm:px-4 transition-colors duration-120 ease-standard hover:bg-card/60 motion-reduce:transition-none"
        button={
          event ? (
            <>
              <span className="min-w-0">
                <span className="block truncate text-13 font-medium">{event.title}</span>
                <span className="block truncate text-11 text-muted-foreground">{event.venue_name}</span>
              </span>
              {event.state !== "live" ? (
                <span className={`hidden font-mono text-11 tracking-[0.12em] sm:inline ${stateView[event.state].tone}`}>
                  {stateView[event.state].text}
                </span>
              ) : null}
              <ChevronDown aria-hidden="true" size={14} strokeWidth={1.5} className="ml-auto shrink-0 text-muted-foreground" />
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
                <span className={`pt-0.5 font-mono text-11 tracking-[0.12em] ${stateView[item.state].tone}`}>
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

function LiveIndicator() {
  const state = useLiveState();
  return (
    <>
      <span className="hidden sm:contents">
        <LivePill state={state} />
      </span>
      {/* A phone keeps the shape and the word; the rate is a detail for the wall display. */}
      <span className="contents sm:hidden">
        <LivePill state={state} rate="" className="px-1.5 tracking-normal" />
      </span>
    </>
  );
}

/* -------------------------------------------------------------------- clock */

function VenueClock() {
  const zone = useTimeZone();
  const now = useNow(1000);
  return (
    <span className="flex items-baseline gap-2" aria-label={`Venue time ${formatClock(now, zone)}`}>
      <span className="font-mono text-15 tabular-nums">{formatClock(now, zone)}</span>
      <span className="sr-only">{formatUtcOffset(now, zone)}</span>
    </span>
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
    <div className="flex items-stretch">
      <Menu
        align="end"
        buttonLabel={operator ? `${operator.name}, ${roleLabel}. Account menu` : "Account menu"}
        buttonClassName="flex h-full items-center gap-3 px-3 sm:px-4 transition-colors duration-120 ease-standard hover:bg-card/60 motion-reduce:transition-none"
        button={
          <>
            {/* At 1440 and up there is room to say who is signed in without opening the menu. */}
            <span className="hidden text-right 2xl:block">
              <span className="block text-12 leading-tight">{operator?.name ?? "—"}</span>
              <span className="block text-11 leading-tight text-muted-foreground">{roleLabel}</span>
            </span>
            <span aria-hidden="true" className="grid size-7 place-items-center border border-border font-mono text-11">
              {initials ?? "··"}
            </span>
          </>
        }
      >
        {(close) => (
          <>
            {operator ? (
              <MenuNote>
                <span className="block text-13 text-foreground">{operator.name}</span>
                {/* The real API has no display name yet: the email stands in, so it is not repeated. */}
                {operator.email !== operator.name ? <span className="block truncate">{operator.email}</span> : null}
                <span className="mt-1.5 block">
                  <span className="text-foreground">{roleLabel}</span>
                  {/* The real API sends no shift when there is none; nothing is invented. */}
                  {operator.shift.label ? (
                    <>
                      {" "}
                      · {operator.shift.label}{" "}
                      <span className="font-mono tabular-nums">
                        {formatClock(operator.shift.starts_at, zone, { seconds: false })}–
                        {formatClock(operator.shift.ends_at, zone, { seconds: false })}
                      </span>
                    </>
                  ) : null}
                </span>
              </MenuNote>
            ) : null}
            {auth ? <SecondFactorItems close={close} zone={zone} /> : null}
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
