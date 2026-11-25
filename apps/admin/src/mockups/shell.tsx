/**
 * DEVELOPMENT ONLY — the console's navigation in the three directions.
 *   Calm (1):   a slim icon rail (labels on hover / focus, or pinned open), a very quiet top line
 *               with the event switcher and the account. Phone: a bottom bar and a "More" sheet.
 *   Stage (2):  a floating glass pill bar (wordmark, event, Live · Events · People · Setup,
 *               account) over one large rounded stage. Phone: one pill with a menu sheet.
 *   Field (3):  Stage's bar plus a small live status (gates online, last scan, scans a minute).
 * Menus are opaque, borderless and open instantly (the admin has no motion).
 */
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Bell,
  Building,
  CalendarDays,
  Check,
  ChevronDown,
  DoorOpen,
  FileText,
  IdCard,
  LogOut,
  Menu as MenuIcon,
  PanelLeftClose,
  PanelLeftOpen,
  Radio,
  Settings,
  UserRound,
  Users,
  X,
  Ellipsis,
} from "lucide-react";
import { Mark, Wordmark } from "@synan/ui/brand";
import { useDx, useNarrow } from "./frame";
import { STATE_WORD, clock, dateRange, day, initials, num, useData, type DxData } from "./data";

export type Section = "live" | "events" | "people" | "setup";
type Page = "command" | "events" | "attendees" | "desk" | "dialog" | "alerts" | "gates" | "venues" | "reports" | "settings" | "log" | "staff";

export interface OpenState {
  rail?: boolean;
  event?: boolean;
  account?: boolean;
  section?: Section | null;
  phone?: boolean;
}

const ICON = { size: 20, strokeWidth: 1.5 } as const;
const SMALL = { size: 16, strokeWidth: 1.5 } as const;

/** Where a page lives in the mock-up gallery (pages without a mock-up open the Command Center). */
const SCREEN_OF: Record<Page, string> = {
  command: "command",
  events: "events",
  attendees: "attendees",
  desk: "desk",
  dialog: "dialog",
  alerts: "command-alert",
  gates: "command",
  venues: "events",
  reports: "events",
  settings: "events",
  log: "command",
  staff: "attendees",
};

const RAIL: { page: Page; label: string; icon: typeof Radio; section: Section }[] = [
  { page: "command", label: "Live", icon: Radio, section: "live" },
  { page: "events", label: "Events", icon: CalendarDays, section: "events" },
  { page: "attendees", label: "People", icon: Users, section: "people" },
  { page: "desk", label: "Desk", icon: IdCard, section: "people" },
  { page: "gates", label: "Gates", icon: DoorOpen, section: "live" },
  { page: "venues", label: "Venues", icon: Building, section: "setup" },
  { page: "reports", label: "Reports", icon: FileText, section: "setup" },
];

const SECTIONS: { id: Section; label: string; items: { page: Page; label: string; note: string }[] }[] = [
  {
    id: "live",
    label: "Live",
    items: [
      { page: "command", label: "Command Center", note: "The venue, right now" },
      { page: "alerts", label: "Alerts", note: "What needs you, newest first" },
      { page: "gates", label: "Gates", note: "Readers, links and queues" },
      { page: "log", label: "Access log", note: "Every scan, searchable" },
    ],
  },
  {
    id: "events",
    label: "Events",
    items: [
      { page: "events", label: "All events", note: "Live, coming up and past" },
      { page: "dialog", label: "New event", note: "Start a draft" },
    ],
  },
  {
    id: "people",
    label: "People",
    items: [
      { page: "attendees", label: "Attendees", note: "Find anyone, any event" },
      { page: "desk", label: "Registration desk", note: "Bind bands, resend passes" },
      { page: "staff", label: "Staff", note: "Roles and shifts" },
    ],
  },
  {
    id: "setup",
    label: "Setup",
    items: [
      { page: "venues", label: "Venues", note: "Floors, zones and rooms" },
      { page: "reports", label: "Reports", note: "Exports and summaries" },
      { page: "settings", label: "Settings", note: "Organisation and security" },
    ],
  },
];

/* ---------------------------------------------------------------- menus */

function useDismiss(open: boolean, close: () => void, ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close, ref]);
}

function LiveWord({ className = "" }: { className?: string }) {
  return (
    <span className={`dxc-state dx-live ${className}`}>
      <span className="dx-dot" aria-hidden="true" />
      Live
    </span>
  );
}

export function StateWord({ state }: { state: string }) {
  const s = STATE_WORD[state] ?? { word: state, tone: "quiet" as const };
  if (s.tone === "live") return <LiveWord />;
  return (
    <span className="dxc-state dxc-quietword">
      <span className="dx-dot dxc-dot-quiet" aria-hidden="true" />
      {s.word}
    </span>
  );
}

/** The event switcher: the current event, and its menu of the others. */
function EventSwitcher({ data, initial = false, compact = false, onGlass = false }: { data: DxData; initial?: boolean; compact?: boolean; onGlass?: boolean }) {
  const [open, setOpen] = useState(initial);
  const ref = useRef<HTMLDivElement>(null);
  const dx = useDx();
  useDismiss(open, () => setOpen(false), ref);
  const rank = (state: string) => ["live", "published", "draft", "closed"].indexOf(state);
  const others = data.events
    .filter((e) => e.state !== "archived")
    .sort((a, b) => (a.id === data.live.id ? -1 : b.id === data.live.id ? 1 : rank(a.state) - rank(b.state)));
  return (
    <div className="dxc-pop-anchor" ref={ref}>
      <button
        type="button"
        className={`dxc-switch ${onGlass ? "is-glass" : ""}`}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="dx-dot dx-live" aria-hidden="true" />
        <span className="dxc-switch-name">{compact ? "Nexus Summit" : data.live.title}</span>
        {compact ? null : <span className="dxc-switch-state">Live</span>}
        <ChevronDown {...SMALL} aria-hidden="true" />
      </button>
      {open ? (
        <div className="dxc-menu dxc-menu-event" role="menu" aria-label="Switch event">
          <p className="dxc-menu-head dx-eyebrow">Switch event</p>
          {others.map((e) => (
            <Link key={e.id} to={dx.href({ screen: "command" })} role="menuitem" className="dxc-menu-item dxc-menu-event-item" onClick={() => setOpen(false)}>
              <span className="dxc-menu-event-main">
                <span className="dxc-menu-label">{e.title}</span>
                <span className="dxc-menu-note">
                  {dateRange(e.starts_at, e.ends_at)} · {e.venue?.name ?? "No venue yet"}
                </span>
              </span>
              <span className="dxc-menu-event-end">
                <StateWord state={e.state} />
                {e.id === data.live.id ? <Check {...SMALL} className="dxc-current" aria-label="Current" /> : null}
              </span>
            </Link>
          ))}
          <Link to={dx.href({ screen: "events" })} role="menuitem" className="dxc-menu-item dxc-menu-foot">
            All events
          </Link>
        </div>
      ) : null}
    </div>
  );
}

/** The account: who is signed in, the theme, and the way out. */
function Account({ data, initial = false, onGlass = false }: { data: DxData; initial?: boolean; onGlass?: boolean }) {
  const [open, setOpen] = useState(initial);
  const ref = useRef<HTMLDivElement>(null);
  const dx = useDx();
  const navigate = useNavigate();
  useDismiss(open, () => setOpen(false), ref);
  const op = data.operator;
  return (
    <div className="dxc-pop-anchor" ref={ref}>
      <button
        type="button"
        className={`dxc-avatar ${onGlass ? "is-glass" : ""}`}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Account, ${op.name}`}
        onClick={() => setOpen((v) => !v)}
      >
        {initials(op.name)}
      </button>
      {open ? (
        <div className="dxc-menu dxc-menu-account" role="menu" aria-label="Account">
          <div className="dxc-menu-who">
            <span className="dxc-avatar is-big" aria-hidden="true">
              {initials(op.name)}
            </span>
            <span>
              <span className="dxc-menu-label">{op.name}</span>
              <span className="dxc-menu-note">Admin · {op.shift.label.toLowerCase()} until {clock(op.shift.ends_at)}</span>
            </span>
          </div>
          <div className="dxc-menu-theme" role="group" aria-label="Theme">
            <span className="dxc-menu-note">Theme</span>
            <span className="dxc-seg">
              {(["dark", "light"] as const).map((m) => (
                <button key={m} type="button" aria-pressed={dx.m === m} onClick={() => navigate(dx.href({ m }), { replace: true })}>
                  {m === "dark" ? "Dark" : "Light"}
                </button>
              ))}
            </span>
          </div>
          <button type="button" role="menuitem" className="dxc-menu-item">
            <UserRound {...SMALL} aria-hidden="true" /> Your account
          </button>
          <button type="button" role="menuitem" className="dxc-menu-item">
            <Settings {...SMALL} aria-hidden="true" /> Settings
          </button>
          <button type="button" role="menuitem" className="dxc-menu-item">
            <LogOut {...SMALL} aria-hidden="true" /> Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------------- 1 Calm */

function Rail({ page, pinned, onPin }: { page: Page; pinned: boolean; onPin: () => void }) {
  const dx = useDx();
  return (
    <nav className={`dxc-rail ${pinned ? "is-pinned" : ""}`} aria-label="Main">
      <Link to={dx.href({ screen: "command" })} className="dxc-rail-mark" aria-label="Synan, Command Center">
        {pinned ? <Wordmark small /> : <Mark size={24} />}
      </Link>
      <ul className="dxc-rail-list">
        {RAIL.map((item) => {
          const Icon = item.icon;
          const current = item.page === page;
          return (
            <li key={item.page}>
              <Link to={dx.href({ screen: SCREEN_OF[item.page] })} className="dxc-rail-btn" aria-current={current ? "page" : undefined} aria-label={pinned ? undefined : item.label}>
                <Icon {...ICON} aria-hidden="true" />
                {pinned ? <span className="dxc-rail-word">{item.label}</span> : <span className="dxc-tip" aria-hidden="true">{item.label}</span>}
              </Link>
            </li>
          );
        })}
      </ul>
      <div className="dxc-rail-end">
        <Link to={dx.href({ screen: "events" })} className="dxc-rail-btn" aria-label={pinned ? undefined : "Settings"}>
          <Settings {...ICON} aria-hidden="true" />
          {pinned ? <span className="dxc-rail-word">Settings</span> : <span className="dxc-tip" aria-hidden="true">Settings</span>}
        </Link>
        <button type="button" className="dxc-rail-btn" onClick={onPin} aria-label={pinned ? "Hide labels" : "Show labels"} aria-pressed={pinned}>
          {pinned ? <PanelLeftClose {...ICON} aria-hidden="true" /> : <PanelLeftOpen {...ICON} aria-hidden="true" />}
          {pinned ? <span className="dxc-rail-word">Hide labels</span> : <span className="dxc-tip" aria-hidden="true">Show labels</span>}
        </button>
      </div>
    </nav>
  );
}

function TopLine({ data, open }: { data: DxData; open: OpenState }) {
  return (
    <header className="dxc-topline">
      <EventSwitcher data={data} initial={open.event} />
      <div className="dxc-topline-end">
        <span className="dxc-time dx-mono">
          {day(data.now)} · {clock(data.now)}
        </span>
        <Account data={data} initial={open.account} />
      </div>
    </header>
  );
}

const BOTTOM: { page: Page; label: string; icon: typeof Radio }[] = [
  { page: "command", label: "Live", icon: Radio },
  { page: "events", label: "Events", icon: CalendarDays },
  { page: "attendees", label: "People", icon: Users },
  { page: "desk", label: "Desk", icon: IdCard },
];

function BottomBar({ page, onMore, moreOpen }: { page: Page; onMore: () => void; moreOpen: boolean }) {
  const dx = useDx();
  return (
    <nav className="dxc-bottom" aria-label="Main">
      {BOTTOM.map((item) => {
        const Icon = item.icon;
        return (
          <Link key={item.page} to={dx.href({ screen: SCREEN_OF[item.page] })} className="dxc-bottom-btn" aria-current={item.page === page && !moreOpen ? "page" : undefined}>
            <Icon {...ICON} aria-hidden="true" />
            <span>{item.label}</span>
          </Link>
        );
      })}
      <button type="button" className="dxc-bottom-btn" aria-expanded={moreOpen} aria-current={moreOpen ? "page" : undefined} onClick={onMore}>
        <Ellipsis {...ICON} aria-hidden="true" />
        <span>More</span>
      </button>
    </nav>
  );
}

function MoreSheet({ data, onClose }: { data: DxData; onClose: () => void }) {
  const dx = useDx();
  const navigate = useNavigate();
  useEscape(onClose);
  const items: { page: Page; label: string; note: string; icon: typeof Radio }[] = [
    { page: "alerts", label: "Alerts", note: "1 open", icon: Bell },
    { page: "gates", label: "Gates", note: `${data.gatesOnline} of 4 online`, icon: DoorOpen },
    { page: "venues", label: "Venues", note: data.venueName, icon: Building },
    { page: "reports", label: "Reports", note: "Exports and summaries", icon: FileText },
    { page: "settings", label: "Settings", note: "Organisation", icon: Settings },
  ];
  return (
    <>
      <div className="dxc-scrim" onClick={onClose} aria-hidden="true" />
      <div className="dxc-sheet is-bottom" role="dialog" aria-modal="true" aria-label="More">
        <div className="dxc-sheet-grip" aria-hidden="true" />
        <ul className="dxc-sheet-list">
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <li key={item.page}>
                <Link to={dx.href({ screen: SCREEN_OF[item.page] })} className="dxc-sheet-link">
                  <Icon {...ICON} aria-hidden="true" />
                  <span className="dxc-sheet-word">{item.label}</span>
                  <span className="dxc-sheet-note">{item.note}</span>
                </Link>
              </li>
            );
          })}
        </ul>
        <div className="dxc-sheet-foot">
          <span className="dxc-avatar" aria-hidden="true">
            {initials(data.operator.name)}
          </span>
          <span className="dxc-sheet-who">
            <span className="dxc-menu-label">{data.operator.name}</span>
            <span className="dxc-menu-note">Admin · until {clock(data.operator.shift.ends_at)}</span>
          </span>
          <span className="dxc-seg" role="group" aria-label="Theme">
            {(["dark", "light"] as const).map((m) => (
              <button key={m} type="button" aria-pressed={dx.m === m} onClick={() => navigate(dx.href({ m }), { replace: true })}>
                {m === "dark" ? "Dark" : "Light"}
              </button>
            ))}
          </span>
        </div>
        <button type="button" className="dx-btn is-ghost dxc-sheet-close" onClick={onClose} autoFocus>
          Close
        </button>
      </div>
    </>
  );
}

function useEscape(onClose: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
}

function CalmShell({ data, page, open, children }: { data: DxData; page: Page; open: OpenState; children: ReactNode }) {
  const narrow = useNarrow();
  const [pinned, setPinned] = useState(!!open.rail);
  const [more, setMore] = useState(!!open.phone);
  if (narrow) {
    return (
      <div className="dxc dxc-calm is-narrow">
        <header className="dxc-topline">
          <span className="dxc-topline-mark">
            <Mark size={24} />
          </span>
          <EventSwitcher data={data} compact initial={open.event && !open.phone} />
          <Account data={data} initial={open.account && !open.phone} />
        </header>
        <main className="dxc-main">{children}</main>
        <BottomBar page={page} moreOpen={more} onMore={() => setMore((v) => !v)} />
        {more ? <MoreSheet data={data} onClose={() => setMore(false)} /> : null}
      </div>
    );
  }
  return (
    <div className={`dxc dxc-calm ${pinned ? "is-pinned" : ""}`}>
      <Rail page={page} pinned={pinned} onPin={() => setPinned((v) => !v)} />
      <div className="dxc-calm-body">
        <TopLine data={data} open={open} />
        <main className="dxc-main">{children}</main>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- 2 Stage, 3 Field */

function SectionButton({ section, active, initial }: { section: (typeof SECTIONS)[number]; active: boolean; initial: boolean }) {
  const [open, setOpen] = useState(initial);
  const ref = useRef<HTMLDivElement>(null);
  const dx = useDx();
  useDismiss(open, () => setOpen(false), ref);
  return (
    <div className="dxc-pop-anchor is-center" ref={ref}>
      <button type="button" className="dxc-pill-link" aria-current={active ? "page" : undefined} aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen((v) => !v)}>
        {section.label}
      </button>
      {open ? (
        <div className="dxc-menu dxc-menu-section" role="menu" aria-label={section.label}>
          {section.items.map((item, i) => (
            <Link key={item.page} to={dx.href({ screen: SCREEN_OF[item.page] })} role="menuitem" className="dxc-menu-item is-tall" onClick={() => setOpen(false)}>
              {dx.d === 3 ? <span className="dxc-menu-num dx-mono">{String(i + 1).padStart(2, "0")}</span> : null}
              <span>
                <span className="dxc-menu-label">{item.label}</span>
                <span className="dxc-menu-note">{item.note}</span>
              </span>
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Field's live status: small, mono, in the bar. */
export function LiveStatus({ data, className = "" }: { data: DxData; className?: string }) {
  return (
    <div className={`dxc-livestat ${className}`} aria-label="Live status">
      <span className="dxc-livestat-item dx-live">
        <span className="dx-dot" aria-hidden="true" />
        <span className="dxc-livestat-v">
          {data.gatesOnline}/4
        </span>
        <span className="dxc-livestat-k">gates online</span>
      </span>
      <span className="dxc-livestat-item">
        <span className="dxc-livestat-k">last scan</span>
        <span className="dxc-livestat-v">12 s</span>
      </span>
      <span className="dxc-livestat-item">
        <span className="dxc-livestat-v">{num(data.scansPerMinute)}</span>
        <span className="dxc-livestat-k">/ min</span>
      </span>
    </div>
  );
}

function PhoneMenu({ data, page, onClose }: { data: DxData; page: Page; onClose: () => void }) {
  const dx = useDx();
  const navigate = useNavigate();
  useEscape(onClose);
  const current = sectionOf(page);
  return (
    <div className="dxc-sheet is-full" role="dialog" aria-modal="true" aria-label="Menu">
      <div className="dxc-sheet-head">
        <Wordmark small />
        <button type="button" className="dx-btn is-icon" aria-label="Close the menu" onClick={onClose} autoFocus>
          <X {...ICON} aria-hidden="true" />
        </button>
      </div>
      {dx.d === 3 ? <LiveStatus data={data} className="is-sheet" /> : null}
      <nav className="dxc-sheet-nav" aria-label="Main">
        {SECTIONS.map((s, i) => (
          <div key={s.id} className="dxc-sheet-group">
            <p className="dxc-sheet-big" aria-current={s.id === current ? "page" : undefined}>
              {dx.d === 3 ? <span className="dxc-sheet-num dx-mono">{String(i + 1).padStart(2, "0")}</span> : null}
              {s.label}
            </p>
            <div className="dxc-sheet-subs">
              {s.items.map((item) => (
                <Link key={item.page} to={dx.href({ screen: SCREEN_OF[item.page] })} className="dxc-sheet-sub" aria-current={item.page === page ? "page" : undefined}>
                  {item.label}
                </Link>
              ))}
            </div>
          </div>
        ))}
      </nav>
      <div className="dxc-sheet-foot">
        <span className="dxc-avatar" aria-hidden="true">
          {initials(data.operator.name)}
        </span>
        <span className="dxc-sheet-who">
          <span className="dxc-menu-label">{data.operator.name}</span>
          <span className="dxc-menu-note">Admin · until {clock(data.operator.shift.ends_at)}</span>
        </span>
        <span className="dxc-seg" role="group" aria-label="Theme">
          {(["dark", "light"] as const).map((m) => (
            <button key={m} type="button" aria-pressed={dx.m === m} onClick={() => navigate(dx.href({ m }), { replace: true })}>
              {m === "dark" ? "Dark" : "Light"}
            </button>
          ))}
        </span>
      </div>
    </div>
  );
}

function sectionOf(page: Page): Section {
  return SECTIONS.find((s) => s.items.some((i) => i.page === page))?.id ?? "live";
}

function StageShell({ data, page, open, children }: { data: DxData; page: Page; open: OpenState; children: ReactNode }) {
  const dx = useDx();
  const narrow = useNarrow();
  const [menu, setMenu] = useState(!!open.phone);
  const active = sectionOf(page);
  if (narrow) {
    return (
      <div className="dxc dxc-stage is-narrow">
        <header className="dxc-pill-wrap">
          <div className="dxc-pill dx-glass">
            <Link to={dx.href({ screen: "command" })} className="dxc-pill-brand" aria-label="Synan, Command Center">
              <Wordmark small />
            </Link>
            <EventSwitcher data={data} compact onGlass initial={open.event && !open.phone} />
            <button type="button" className="dx-btn is-icon is-on-glass dxc-pill-menu" aria-label="Open the menu" aria-expanded={menu} onClick={() => setMenu(true)}>
              <MenuIcon {...ICON} aria-hidden="true" />
            </button>
          </div>
        </header>
        {dx.d === 3 ? <LiveStatus data={data} className="is-strip" /> : null}
        <main className="dxc-stage-frame">{children}</main>
        {menu ? <PhoneMenu data={data} page={page} onClose={() => setMenu(false)} /> : null}
      </div>
    );
  }
  return (
    <div className="dxc dxc-stage">
      <header className="dxc-pill-wrap">
        <div className="dxc-pill dx-glass">
          <div className="dxc-pill-start">
            <Link to={dx.href({ screen: "command" })} className="dxc-pill-brand" aria-label="Synan, Command Center">
              <Wordmark small />
            </Link>
            <EventSwitcher data={data} onGlass initial={open.event} />
          </div>
          <nav className="dxc-pill-links" aria-label="Main">
            {SECTIONS.map((s) => (
              <SectionButton key={s.id} section={s} active={s.id === active} initial={open.section === s.id} />
            ))}
          </nav>
          <div className="dxc-pill-end">
            {dx.d === 3 ? <LiveStatus data={data} /> : <span className="dxc-time dx-mono">{clock(data.now)}</span>}
            <Account data={data} onGlass initial={open.account} />
          </div>
        </div>
      </header>
      <main className="dxc-stage-frame">{children}</main>
    </div>
  );
}

/* ---------------------------------------------------------------- the shell */

export function Shell({ page, open = {}, children }: { page: Page; open?: OpenState; children: (data: DxData) => ReactNode }) {
  const dx = useDx();
  const data = useData();
  if (!data) return <div className="dxc dxc-loading" aria-busy="true" />;
  const body = children(data);
  return dx.d === 1 ? (
    <CalmShell data={data} page={page} open={open}>
      {body}
    </CalmShell>
  ) : (
    <StageShell data={data} page={page} open={open}>
      {body}
    </StageShell>
  );
}
