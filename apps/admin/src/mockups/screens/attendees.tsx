/**
 * DEVELOPMENT ONLY — one event workspace tab with a table: Nexus Summit 2026 › Attendees. Tabs
 * without rules (the active one by weight and a small blue mark), a search field, filter chips,
 * the table separated by space only, quiet row actions on hover and focus.
 */
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronRight, Ellipsis, Search } from "lucide-react";
import { useDx, useNarrow } from "../frame";
import { Shell, StateWord } from "../shell";
import { Tone } from "../parts";
import { PASS_WORD, TIER_WORD, clock, dateRange, num, type DxData } from "../data";
import type { AttendeeListRow } from "@synan/mock/command";

const TABS = ["Overview", "Schedule", "Rooms & rules", "Attendees", "Credentials", "Staff", "Reports", "Settings"];

type Chip = "all" | "vip" | "out" | "noband" | "review";

function Pass({ row }: { row: AttendeeListRow }) {
  const p = row.credential_state ? PASS_WORD[row.credential_state] : undefined;
  if (!p) return <span className="dxc-quietword">No pass yet</span>;
  return <Tone tone={p.tone}>{p.word}</Tone>;
}

function WorkspaceHead({ data }: { data: DxData }) {
  const dx = useDx();
  const tabs = useRef<HTMLDivElement>(null);
  /* at phone width the tab row scrolls: keep the open tab in view */
  useLayoutEffect(() => {
    const el = tabs.current;
    const sel = el?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (el && sel && el.scrollWidth > el.clientWidth) el.scrollLeft = sel.offsetLeft - (el.clientWidth - sel.offsetWidth) / 2;
  }, []);
  return (
    <header className="dxc-wshead">
      <nav className="dxc-crumbs" aria-label="Breadcrumb">
        <Link to={dx.href({ screen: "events" })} className="dxc-crumb">
          Events
        </Link>
        <ChevronRight size={14} strokeWidth={1.5} aria-hidden="true" />
        <span aria-current="page">{data.live.title}</span>
      </nav>
      <div className="dxc-wshead-row">
        <h1 className={dx.d === 1 ? "dx-h2" : "dx-title"}>{data.live.title}</h1>
        <StateWord state={data.live.state} />
      </div>
      <p className="dxc-sub">
        {dateRange(data.live.starts_at, data.live.ends_at)} · {data.venueName}, Kampala
      </p>
      <div ref={tabs} className="dxc-tabs" role="tablist" aria-label="Event workspace">
        {TABS.map((t) => (
          <button key={t} type="button" role="tab" className="dxc-tab" aria-selected={t === "Attendees"} tabIndex={t === "Attendees" ? 0 : -1}>
            {t}
          </button>
        ))}
      </div>
    </header>
  );
}

function AttendeesBody({ data }: { data: DxData }) {
  const narrow = useNarrow();
  const [q, setQ] = useState("");
  const [chip, setChip] = useState<Chip>("all");
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return data.attendees
      .filter((r) => r.full_name)
      .filter((r) => !needle || (r.full_name ?? "").toLowerCase().includes(needle) || (r.email ?? "").toLowerCase().includes(needle))
      .filter((r) =>
        chip === "vip"
          ? r.tier === "VIP"
          : chip === "out"
            ? !r.checked_in
            : chip === "noband"
              ? r.band_hint === null
              : chip === "review"
                ? r.credential_state === "suspended_review"
                : true,
      )
      .slice(0, 10);
  }, [data.attendees, q, chip]);
  const chips: { id: Chip; label: string }[] = [
    { id: "all", label: "Everyone" },
    { id: "vip", label: "VIP" },
    { id: "out", label: "Not checked in" },
    { id: "noband", label: "No band" },
    { id: "review", label: "Under review" },
  ];
  return (
    <div className="dxc-page dxc-attendees">
      <WorkspaceHead data={data} />
      <div className="dxc-tools">
        <label className="dxc-search">
          <Search size={18} strokeWidth={1.5} aria-hidden="true" />
          <span className="dx-sr">Search attendees</span>
          <input className="dxc-search-input" placeholder="Search by name, email or band" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <p className="dxc-sub dxc-count">
          <span className="dx-mono">{num(data.summary.registered)}</span> registered · <span className="dx-mono">{num(data.summary.checked_in)}</span> checked in
        </p>
      </div>
      <div className="dxc-chips" role="group" aria-label="Show">
        {chips.map((c) => (
          <button key={c.id} type="button" className="dx-chip" aria-pressed={chip === c.id} onClick={() => setChip(c.id)}>
            {c.label}
          </button>
        ))}
      </div>
      {narrow ? (
        <ul className="dxc-plist">
          {rows.map((r) => (
            <li key={r.registration_id}>
              <button type="button" className="dxc-prow">
                <span className="dxc-prow-main">
                  <span className="dxc-prow-name">{r.full_name}</span>
                  <span className="dxc-prow-sub">
                    {TIER_WORD[r.tier] ?? r.tier} · <Pass row={r} />
                  </span>
                </span>
                <span className="dxc-prow-end dx-mono">{r.last_scan_at ? clock(r.last_scan_at) : "—"}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <table className="dxc-table">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Tier</th>
              <th scope="col">Pass</th>
              <th scope="col">Band</th>
              <th scope="col">Last scan</th>
              <th scope="col">
                <span className="dx-sr">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.registration_id}>
                <td>
                  <span className="dxc-cell-name">{r.full_name}</span>
                  <span className="dxc-cell-sub">{r.email}</span>
                </td>
                <td>{TIER_WORD[r.tier] ?? r.tier}</td>
                <td>
                  <Pass row={r} />
                </td>
                <td>{r.band_hint ? <span className="dx-mono">{r.band_hint}</span> : <span className="dxc-quietword">No band</span>}</td>
                <td>{r.last_scan_at ? <span className="dx-mono">{clock(r.last_scan_at)}</span> : <span className="dxc-quietword">Not yet</span>}</td>
                <td className="dxc-cell-actions">
                  <span className="dxc-rowactions">
                    <button type="button" className="dx-btn is-sm is-ghost">
                      Open
                    </button>
                    <button type="button" className="dx-btn is-sm is-ghost is-icon" aria-label={`More for ${r.full_name ?? "this attendee"}`}>
                      <Ellipsis size={18} strokeWidth={1.5} aria-hidden="true" />
                    </button>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="dxc-tablefoot dxc-sub">
        Showing the first {rows.length}. More load as you scroll.
      </p>
    </div>
  );
}

export default function Attendees() {
  return <Shell page="attendees">{(data) => <AttendeesBody data={data} />}</Shell>;
}
