/**
 * DEVELOPMENT ONLY — the registration desk: find a person, the selected attendee, bind a band
 * (with the "already bound" error shown), the one filled action, the reward tick after binding,
 * and the band stock at a glance.
 */
import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { RewardTick } from "@synan/ui/mockups";
import { useDx } from "../frame";
import { Shell } from "../shell";
import { Tone } from "../parts";
import { PASS_WORD, TIER_WORD, clock, initials, num, type DxData } from "../data";
import type { AttendeeListRow } from "@synan/mock/command";

const TAKEN = "04:A2:19:C3:77:81:BF";
const NEXT = "04:5E:22:B1:7D:20:80";

function hint(code: string) {
  const hex = code.replace(/[^0-9a-f]/gi, "").toUpperCase();
  return `••••${hex.slice(-4)}`;
}

function Stock({ data }: { data: DxData }) {
  const s = data.stock;
  /* The mock's stock is 1,500 minus the bands bound, which is 0 for Nexus Summit; a desk with an
     empty stock would tell the wrong story next to "Use the next band from stock", so the mock-up
     shows a believable shelf instead. */
  const inStock = s.stock > 0 ? s.stock : 412;
  return (
    <dl className="dxc-stock" aria-label="Bands at a glance">
      <div>
        <dt>In stock</dt>
        <dd className="dx-mono">{num(inStock)}</dd>
      </div>
      <div>
        <dt>Bound to this event</dt>
        <dd className="dx-mono">{num(s.bound)}</dd>
      </div>
      <div>
        <dt>Lost</dt>
        <dd className="dx-mono">{num(s.lost)}</dd>
      </div>
    </dl>
  );
}

function Results({ rows, selected, onPick }: { rows: AttendeeListRow[]; selected: string; onPick: (id: string) => void }) {
  return (
    <ul className="dxc-results" aria-label="Results">
      {rows.map((r) => {
        const pass = r.credential_state ? PASS_WORD[r.credential_state] : undefined;
        return (
          <li key={r.registration_id}>
            <button type="button" className="dxc-result" aria-pressed={r.registration_id === selected} onClick={() => onPick(r.registration_id)}>
              <span className="dxc-avatar is-soft" aria-hidden="true">
                {initials(r.full_name ?? "?")}
              </span>
              <span className="dxc-result-main">
                <span className="dxc-result-name">{r.full_name}</span>
                <span className="dxc-result-sub">
                  {TIER_WORD[r.tier] ?? r.tier} · {r.band_hint ? `Band ${r.band_hint}` : "No band yet"}
                  {pass && pass.tone !== "ok" ? ` · ${pass.word}` : ""}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function Person({ person, bound, onBound }: { person: AttendeeListRow; bound: string | null; onBound: (code: string) => void }) {
  const [code, setCode] = useState(TAKEN);
  const [tried, setTried] = useState(true);
  const taken = code.replace(/\s/g, "").toUpperCase() === TAKEN;
  const empty = code.trim() === "";
  const pass = person.credential_state ? PASS_WORD[person.credential_state] : undefined;
  const bind = () => {
    setTried(true);
    if (!taken && !empty) onBound(code);
  };
  const invalid = tried && (taken || empty);
  return (
    <section className="dxc-person dxc-panel" aria-label="Selected attendee">
      <div className="dxc-person-head">
        <span className="dxc-avatar is-big" aria-hidden="true">
          {initials(person.full_name ?? "?")}
        </span>
        <div>
          <h2 className="dx-h3">{person.full_name}</h2>
          <p className="dxc-sub">{person.email}</p>
        </div>
      </div>
      <dl className="dxc-facts">
        <div>
          <dt>Tier</dt>
          <dd>{TIER_WORD[person.tier] ?? person.tier}</dd>
        </div>
        <div>
          <dt>Pass</dt>
          <dd>{pass ? <Tone tone={pass.tone}>{pass.word}</Tone> : "No pass yet"}</dd>
        </div>
        <div>
          <dt>Band</dt>
          <dd>{bound ? <span className="dx-mono">{hint(bound)}</span> : person.band_hint ? <span className="dx-mono">{person.band_hint}</span> : "None yet"}</dd>
        </div>
        <div>
          <dt>Checked in</dt>
          <dd>{person.last_scan_at ? <span className="dx-mono">{clock(person.last_scan_at)}</span> : "Not yet"}</dd>
        </div>
      </dl>
      {bound ? (
        <div className="dxc-bound">
          <p className="dxc-done-line">
            <RewardTick label="Band bound" />
            <span>
              Band <span className="dx-mono">{hint(bound)}</span> is bound to {person.full_name?.split(" ")[0]}.
            </span>
          </p>
          <p className="dxc-sub">The pass works on the band from now on. Hand it over and help the next person.</p>
        </div>
      ) : person.band_hint ? (
        <div className="dxc-bound">
          <p className="dxc-sub">This person already wears a band. If it is lost or damaged, replace it; the old one stops working at once.</p>
          <div className="dxc-bind-actions">
            <button type="button" className="dx-btn">
              Replace the band
            </button>
            <button type="button" className="dx-btn is-ghost">
              Resend the pass
            </button>
          </div>
        </div>
      ) : (
        <form
          className="dxc-bind"
          onSubmit={(e) => {
            e.preventDefault();
            bind();
          }}
        >
          <label className="dx-label" htmlFor="dxc-band">
            Band code
          </label>
          <input
            id="dxc-band"
            className="dx-input dx-mono"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            aria-invalid={invalid ? true : undefined}
            aria-describedby={invalid ? "dxc-band-error" : "dxc-band-hint"}
            spellCheck={false}
            autoComplete="off"
          />
          {invalid ? (
            <p id="dxc-band-error" className="dx-error">
              {empty ? "Tap a band on the reader, or type its code." : "That band is already bound to another attendee. Hand out a different band."}
            </p>
          ) : (
            <p id="dxc-band-hint" className="dx-hint">
              Tap the band on the reader, or type the code printed inside it.
            </p>
          )}
          <div className="dxc-bind-actions">
            <button type="submit" className="dx-btn is-action">
              Bind band
            </button>
            <button
              type="button"
              className="dx-btn is-ghost"
              onClick={() => {
                setCode(NEXT);
                setTried(false);
              }}
            >
              Use the next band from stock
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

function DeskBody({ data }: { data: DxData }) {
  const dx = useDx();
  const first = data.unbound.find((r) => r.full_name) ?? data.attendees[0];
  const surname = (first?.full_name ?? "").split(" ").slice(-1)[0] ?? "";
  const [q, setQ] = useState(surname);
  const [selected, setSelected] = useState(first?.registration_id ?? "");
  const [bound, setBound] = useState<Record<string, string>>({});
  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const named = data.attendees.filter((r) => r.full_name);
    const hits = needle ? named.filter((r) => (r.full_name ?? "").toLowerCase().includes(needle)) : named;
    const withFirst = first && !hits.some((h) => h.registration_id === first.registration_id) && (!needle || (first.full_name ?? "").toLowerCase().includes(needle)) ? [first, ...hits] : hits;
    return withFirst.slice(0, 5);
  }, [q, data.attendees, first]);
  const person = [...data.unbound, ...data.attendees].find((r) => r.registration_id === selected);

  const search = (
    <label className="dxc-search is-big">
      <Search size={20} strokeWidth={1.5} aria-hidden="true" />
      <span className="dx-sr">Find a person</span>
      <input className="dxc-search-input" placeholder="Name, email or pass code" value={q} onChange={(e) => setQ(e.target.value)} />
    </label>
  );

  return (
    <div className="dxc-page dxc-desk">
      {dx.d === 1 ? (
        <section className="dxc-statement is-desk" aria-label="Find a person">
          <h1 className="dx-title">Who are you helping?</h1>
          {search}
          <Stock data={data} />
        </section>
      ) : (
        <header className="dxc-head">
          <div className="dxc-head-main">
            <p className="dx-eyebrow">Registration desk · {data.live.title}</p>
            <h1 className="dx-title">Who are you helping?</h1>
          </div>
          <Stock data={data} />
        </header>
      )}
      <div className="dxc-desk-grid">
        <section className="dxc-desk-find" aria-label="Results">
          {dx.d === 1 ? null : search}
          <p className="dxc-grouphead">
            {results.length} {results.length === 1 ? "person" : "people"} found
          </p>
          <Results rows={results} selected={selected} onPick={setSelected} />
        </section>
        {person ? (
          <Person
            key={person.registration_id}
            person={person}
            bound={bound[person.registration_id] ?? null}
            onBound={(code) => setBound((b) => ({ ...b, [person.registration_id]: code }))}
          />
        ) : (
          <p className="dxc-sub">Pick a person to see their pass and band.</p>
        )}
      </div>
    </div>
  );
}

export default function Desk() {
  return <Shell page="desk">{(data) => <DeskBody data={data} />}</Shell>;
}
