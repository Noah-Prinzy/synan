/**
 * DEVELOPMENT ONLY — the Command Center in two states: calm (nothing needs you) and alert (Lab 1
 * over capacity, Acknowledge with the reward tick). Also the base of the navigation screen.
 */
import { useState } from "react";
import { CircleCheck, OctagonExclamationPoint } from "lucide-react";
import { RewardTick } from "@synan/ui/mockups";
import { useDx } from "../frame";
import { Shell, type OpenState } from "../shell";
import { Figures, MapKey, Panel, RoomsList, VenueMap, commandFigures } from "../parts";
import { LAB, clock, levelOf, num, roomsFor, type DxData, type RoomView } from "../data";

const WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
const word = (n: number) => WORDS[n] ?? String(n);

const ALERT_AT = "2026-11-22T08:43:00.000Z";

interface State {
  alert: boolean;
  acked: boolean;
  ack: () => void;
}

function nearCount(rooms: RoomView[]) {
  return rooms.filter((r) => levelOf(r) !== "quiet" && levelOf(r) !== "busy").length;
}

function calmLine(data: DxData, rooms: RoomView[]) {
  const near = nearCount(rooms);
  return `${num(data.summary.on_site)} people on site and ${word(near)} rooms nearly full. Nothing needs you right now.`;
}

/* ---------------------------------------------------------------- 1 Calm */

function CalmStatement({ data, rooms, s }: { data: DxData; rooms: RoomView[]; s: State }) {
  if (!s.alert) {
    return (
      <section className="dxc-statement" aria-label="Status">
        <h1 className="dx-title">All calm at {data.venueName}.</h1>
        <p className="dxc-lede dx-muted">{calmLine(data, rooms)}</p>
      </section>
    );
  }
  return (
    <section className="dxc-statement is-alert" role="alert" aria-label="Critical alert">
      {s.acked ? (
        <p className="dxc-kicker">
          <RewardTick label="Acknowledged" />
            <span>
              Acknowledged by you · <span className="dx-mono">{clock(data.now)}</span>
            </span>
        </p>
      ) : (
        <p className="dxc-kicker dxc-sig-stop">
          <OctagonExclamationPoint size={16} strokeWidth={1.75} aria-hidden="true" />
          <span>
            Critical alert · <span className="dx-mono">{clock(ALERT_AT)}</span>
          </span>
        </p>
      )}
      <h1 className="dx-title">{LAB} is over capacity.</h1>
      <p className="dxc-lede dx-muted">41 people are in a room for 40, reported at the {LAB} door. Send someone to the door; new arrivals are being turned away.</p>
      <div className="dxc-statement-actions">
        {s.acked ? (
          <button type="button" className="dx-btn">
            Resolve with a note
          </button>
        ) : (
          <button type="button" className="dx-btn is-action" onClick={s.ack}>
            Acknowledge
          </button>
        )}
        <button type="button" className="dx-btn is-ghost">
          Open {LAB}
        </button>
      </div>
    </section>
  );
}

function CalmCommand({ data, s }: { data: DxData; s: State }) {
  const rooms = roomsFor(data.rooms, s.alert ? "alert" : "calm");
  const open = s.alert && !s.acked ? 1 : 0;
  return (
    <div className="dxc-page dxc-cc">
      <CalmStatement data={data} rooms={rooms} s={s} />
      <Figures items={commandFigures(data, rooms, open, s.alert && s.acked ? 1 : 0)} />
      <div className="dxc-cc-grid">
        <Panel className="dxc-mappanel" label="Venue map">
          <div className="dxc-panel-head">
            <div>
              <h2 className="dxc-h">{data.venueName}</h2>
              <p className="dxc-sub">Kampala · 5 zones · {rooms.length} rooms</p>
            </div>
            <MapKey />
          </div>
          <VenueMap data={data} rooms={rooms} />
        </Panel>
        <section className="dxc-side" aria-label="Rooms and alerts">
          {s.alert ? null : (
            <p className="dxc-clear">
              <CircleCheck size={18} strokeWidth={1.5} aria-hidden="true" className="dxc-sig-ok" />
              <span>
                <strong>All clear.</strong> <span className="dx-muted">No open alerts.</span>
              </span>
            </p>
          )}
          <div className="dxc-side-head">
            <h2 className="dxc-h">Rooms</h2>
            <span className="dxc-sub">Busiest first</span>
          </div>
          <RoomsList rooms={rooms} />
          <a className="dx-link dxc-more" href="#rooms">
            All {rooms.length} rooms
          </a>
        </section>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- 2 Stage, 3 Field */

function AlertCard({ data, s }: { data: DxData; s: State }) {
  return (
    <section className={`dxc-alert ${s.acked ? "is-acked" : ""}`} role="alert" aria-label="Critical alert">
      <span className="dxc-alert-icon dxc-sig-stop" aria-hidden="true">
        <OctagonExclamationPoint size={22} strokeWidth={1.5} />
      </span>
      <div className="dxc-alert-text">
        {s.acked ? (
          <p className="dxc-kicker">
            <RewardTick label="Acknowledged" />
            <span>
              Acknowledged by you · <span className="dx-mono">{clock(data.now)}</span>
            </span>
          </p>
        ) : (
          <p className="dxc-kicker dxc-sig-stop">
            <span>
              Critical · <span className="dx-mono">{clock(ALERT_AT)}</span>, 2 min ago
            </span>
          </p>
        )}
        <h2 className="dxc-alert-title">{LAB} is over capacity</h2>
        <p className="dxc-alert-detail">
          <span className="dx-mono">41</span> of <span className="dx-mono">40</span> inside · reported at the {LAB} door · Workshops, Level 1
        </p>
      </div>
      <div className="dxc-alert-actions">
        <button type="button" className="dx-btn is-ghost">
          Open {LAB}
        </button>
        {s.acked ? (
          <button type="button" className="dx-btn">
            Resolve with a note
          </button>
        ) : (
          <button type="button" className="dx-btn is-action" onClick={s.ack}>
            Acknowledge
          </button>
        )}
      </div>
    </section>
  );
}

function StageCommand({ data, s }: { data: DxData; s: State }) {
  const dx = useDx();
  const rooms = roomsFor(data.rooms, s.alert ? "alert" : "calm");
  const open = s.alert && !s.acked ? 1 : 0;
  return (
    <div className="dxc-page dxc-cc">
      <header className="dxc-head">
        <div className="dxc-head-main">
          <p className="dx-eyebrow">
            <span className="dx-live dxc-inline">
              <span className="dx-dot" aria-hidden="true" />
            </span>
            {dx.d === 3 ? `Live · ${data.venueName} · Sun 22 Nov · ${clock(data.now)}` : `Live now · Sunday 22 November, ${clock(data.now)}`}
          </p>
          <h1 className="dx-display">{s.alert ? `${LAB} needs you.` : `All calm at ${data.venueName}.`}</h1>
          <p className="dxc-lede dx-muted">
            {s.alert ? `One room is over capacity. Everything else at ${data.venueName} is running as it should.` : calmLine(data, rooms)}
          </p>
        </div>
        {s.alert ? null : (
          <p className="dxc-clear is-chip">
            <CircleCheck size={18} strokeWidth={1.5} aria-hidden="true" className="dxc-sig-ok" />
            <span>
              <strong>All clear</strong> <span className="dx-muted">· no open alerts</span>
            </span>
          </p>
        )}
      </header>
      {s.alert ? <AlertCard data={data} s={s} /> : null}
      <Figures items={commandFigures(data, rooms, open, s.alert && s.acked ? 1 : 0)} />
      <div className="dxc-cc-grid">
        <Panel className="dxc-mappanel" label="Venue map">
          <div className="dxc-panel-head">
            <div>
              {dx.d === 3 ? <p className="dx-eyebrow">Venue map</p> : null}
              <h2 className="dxc-h">{data.venueName}</h2>
              <p className="dxc-sub">Kampala · 5 zones · {rooms.length} rooms</p>
            </div>
            <MapKey />
          </div>
          <VenueMap data={data} rooms={rooms} />
        </Panel>
        <Panel className="dxc-roomspanel" label="Rooms">
          <div className="dxc-panel-head">
            <div>
              {dx.d === 3 ? <p className="dx-eyebrow">Rooms</p> : <h2 className="dxc-h">Rooms</h2>}
              <p className="dxc-sub">Busiest first</p>
            </div>
          </div>
          <RoomsList rooms={rooms} />
          <a className="dx-link dxc-more" href="#rooms">
            All {rooms.length} rooms
          </a>
        </Panel>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- the page */

export function CommandPage({ alert, open }: { alert: boolean; open?: OpenState }) {
  const dx = useDx();
  const [acked, setAcked] = useState(false);
  const s: State = { alert, acked, ack: () => setAcked(true) };
  return (
    <Shell page="command" open={open}>
      {(data) => (dx.d === 1 ? <CalmCommand data={data} s={s} /> : <StageCommand data={data} s={s} />)}
    </Shell>
  );
}

export default function Command() {
  return <CommandPage alert={false} />;
}

export function CommandAlert() {
  return <CommandPage alert />;
}

export function Navigation() {
  return <CommandPage alert={false} open={{ rail: true, event: true, account: true, section: "people", phone: true }} />;
}
