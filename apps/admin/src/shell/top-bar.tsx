/**
 * The persistent top bar (docs/06 §2.2): lockup, event selector, live pill,
 * venue-local clock, shift label, operator menu. Ruled cells, no fills.
 */
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChevronDown } from "lucide-react";
import { Wordmark, surfaceName } from "@synan/ui/brand";
import { LivePill, formatClock, formatNumber, formatUtcOffset, type LiveState } from "@synan/ui/data";
import { TopBar, TopBarCell } from "@synan/ui/shell";
import type { DashboardData } from "@synan/mock";
import { api } from "../live/backend";
import { useCommand, useTimeZone } from "../live/context";
import { useNow } from "../live/hooks";
import { useSliceValue } from "../live/slice";
import type { CommandEvent } from "../live/transport";
import { Menu, MenuItem, MenuNote } from "./menu";

export function AdminTopBar() {
  return (
    <TopBar>
      <TopBarCell className="pr-5">
        <Link to="/" aria-label={`${surfaceName("admin")}, Command Center`} className="flex items-baseline gap-2.5">
          <Wordmark small className="text-17" />
          <span className="text-12 text-muted-foreground">Command</span>
        </Link>
      </TopBarCell>
      <EventSelector />
      <TopBarCell grow className="border-r-0">
        <span />
      </TopBarCell>
      <TopBarCell className="border-l border-border">
        <LiveIndicator />
      </TopBarCell>
      <TopBarCell>
        <VenueClock />
      </TopBarCell>
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
  const [org, setOrg] = useState<DashboardData | null>(null);
  return (
    <div className="flex items-stretch border-r border-border">
      <Menu
        onOpen={() => {
          api.dashboard().then(setOrg, () => setOrg(null));
        }}
        buttonLabel={event ? `Event: ${event.title}. Change event` : "Choose an event"}
        buttonClassName="flex h-full min-w-0 items-center gap-3 px-4 text-left transition-colors duration-120 ease-standard hover:bg-card/60 motion-reduce:transition-none"
        button={
          event ? (
            <>
              <span className="min-w-0">
                <span className="block truncate text-13 font-medium">{event.title}</span>
                <span className="block truncate text-11 text-muted-foreground">{event.venue_name}</span>
              </span>
              {event.state !== "live" ? (
                <span className={`font-mono text-11 tracking-[0.12em] ${stateView[event.state].tone}`}>
                  {stateView[event.state].text}
                </span>
              ) : null}
              <ChevronDown aria-hidden="true" size={14} strokeWidth={1.5} className="text-muted-foreground" />
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
              ) : (
                "Events"
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
  return <LivePill state={useLiveState()} />;
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

const roleLabel: Record<string, string> = {
  admin: "Admin",
  organiser: "Organiser",
  security_staff: "Security staff",
  speaker: "Speaker",
  crew: "Crew",
};

function OperatorMenu() {
  const { operator } = useCommand();
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
        buttonLabel={operator ? `${operator.name}, ${roleLabel[operator.role]}. Account menu` : "Account menu"}
        buttonClassName="flex h-full items-center gap-3 px-4 transition-colors duration-120 ease-standard hover:bg-card/60 motion-reduce:transition-none"
        button={
          <>
            <span className="hidden">
              <span className="block text-13">{operator?.name ?? "—"}</span>
              <span className="block text-11 text-muted-foreground">{operator ? roleLabel[operator.role] : ""}</span>
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
                {roleLabel[operator.role]} · {operator.shift.label}{" "}
                <span className="font-mono tabular-nums">
                  {formatClock(operator.shift.starts_at, zone, { seconds: false })}–
                  {formatClock(operator.shift.ends_at, zone, { seconds: false })}
                </span>
              </MenuNote>
            ) : null}
            <MenuItem
              onSelect={() => {
                close();
                navigate("/settings");
              }}
            >
              Settings
            </MenuItem>
            <MenuItem
              onSelect={() => {
                close();
                navigate("/sign-in");
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
