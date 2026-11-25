/**
 * DEVELOPMENT ONLY — (b) the event page: hero, key facts, schedule excerpt, how full, register.
 * ?e=<slug> picks the event (default: the live Nexus Summit).
 */
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { GatheringField, Reveal, SquareField } from "@synan/ui/mockups";
import { useDx } from "../frame";
import { CalmPage, CalmFooter } from "../shell";
import { Arrow, MenuSheet, PillNav, TopNav } from "../nav";
import { EventPicture } from "../scenes";
import { dateRange, dayShort, eventBySlug, fullness, n, time, useRegistrations, whenLabel, type MockEvent } from "../data";
import { Fullness, LiveChip, LivePanel, RoomsNow, SessionList } from "./parts";

const QUIET_TOP = { x: 0.18, y: 0.08, w: 0.64, h: 0.36, floor: 0.2 };
/** Chosen: below the picture the text runs wide, so the field stays low across the middle. */
const QUIET_WIDE = { x: 0.08, y: 0, w: 0.84, h: 1, floor: 0.4 };

export default function EventPage() {
  const dx = useDx();
  const [params] = useSearchParams();
  const event = eventBySlug(params.get("e") ?? undefined);
  return dx.d === 1 ? <CalmEvent event={event} /> : <StageEvent event={event} />;
}

function hours(event: MockEvent) {
  return `${time(event.starts_at)}–${time(event.ends_at)}`;
}

function Facts({ event, glass = false }: { event: MockEvent; glass?: boolean }) {
  const dx = useDx();
  const regs = useRegistrations();
  const full = fullness(event, regs);
  const days = dateRange(event);
  return (
    <>
      <dl className={`dxe-facts ${glass ? "is-glass" : ""}`}>
        <div>
          <dt>When</dt>
          <dd>
            {days}
            <span className="dx-muted"> · {dx.d === 3 ? <span className="dx-mono">{hours(event)}</span> : hours(event)}</span>
          </dd>
        </div>
        <div>
          <dt>Where</dt>
          <dd>
            {event.venue.name}
            <span className="dx-muted">, {event.venue.city}</span>
          </dd>
        </div>
        <div>
          <dt>Entry</dt>
          <dd>
            Free<span className="dx-muted"> · wristband at the desk</span>
          </dd>
        </div>
      </dl>
      <Fullness pct={full.pct} words={full.words} note={full.note} onGlass={glass} />
    </>
  );
}

function RegisterButton({ wide = false }: { wide?: boolean }) {
  const dx = useDx();
  return (
    <Link to={dx.href({ screen: "register" })} className={`dx-btn is-action ${wide ? "dxe-wide" : ""}`}>
      Register <Arrow />
    </Link>
  );
}

/* ------------------------------------------------------------------ Calm */

function CalmEvent({ event }: { event: MockEvent }) {
  const dx = useDx();
  const live = event.state === "live";
  return (
    <CalmPage quiet={QUIET_TOP} current="showcase">
      <section className="dxe1-head">
        <p className="dx-eyebrow">
          {live ? (
            <>
              <span className="dx-live">
                <span className="dx-dot" />
              </span>
              Live now · day 1 of 2
            </>
          ) : (
            whenLabel(event)
          )}
        </p>
        <h1 className="dx-display">{event.title}</h1>
        <p className="dx-h3 dx-tone2 dxe1-sub">
          {event.venue.name}, {event.venue.city} · {dateRange(event)}
        </p>
      </section>
      <Reveal image className="dxe1-img">
        <EventPicture event={event} photo={dx.photo} big />
      </Reveal>
      <div className="dxe1-cols">
        <div className="dxe1-main">
          <section className="dxe-sec">
            <h2 className="dx-h2">About</h2>
            <p className="dx-body dxe-prose">{event.description}</p>
          </section>
          <section className="dxe-sec">
            <div className="dxe-sec-head">
              <h2 className="dx-h2">{live ? "Today’s programme" : "Programme"}</h2>
              <a className="dx-link dx-small" href="#programme">
                Full programme
              </a>
            </div>
            <SessionList event={event} />
          </section>
          {live ? (
            <section className="dxe-sec">
              <div className="dxe-sec-head">
                <h2 className="dx-h2">Rooms right now</h2>
                <span className="dx-meta dx-muted">Updated {time("2026-11-22T08:45:00.000Z")}</span>
              </div>
              <RoomsNow event={event} />
            </section>
          ) : null}
        </div>
        <aside className="dx-surface dxe1-aside" aria-label="Key facts">
          <Facts event={event} />
          <RegisterButton wide />
          <p className="dx-meta dx-muted dxe-center">It takes a minute. Your pass arrives by email.</p>
        </aside>
      </div>
    </CalmPage>
  );
}

/* ------------------------------------------------------------------ Stage and Field */

function StageEvent({ event }: { event: MockEvent }) {
  const dx = useDx();
  const field = dx.d === 3;
  const live = event.state === "live";
  const regs = useRegistrations();
  const full = fullness(event, regs);
  const [menu, setMenu] = useState(false);
  const [first, ...more] = (event.description ?? "").split(". ");
  return (
    <>
      {dx.chosen ? (
        <GatheringField strength={1} still={dx.still} quiet={QUIET_WIDE} mode={dx.m} />
      ) : field ? (
        <SquareField still={dx.still} mode={dx.m} />
      ) : null}
      {dx.chosen ? (
        /* Chosen: the Calm site's own top bar, clear over the picture, solid once you scroll off it. */
        <TopNav
          over={dx.photo}
          current="showcase"
          onMenu={() => setMenu(true)}
          action={
            <Link to={dx.href({ screen: "register" })} className="dx-btn is-action is-sm">
              Register
            </Link>
          }
        />
      ) : (
        <PillNav
          progress
          onMenu={() => setMenu(true)}
          action={
            <Link to={dx.href({ screen: "register" })} className="dx-btn is-action is-sm">
              Register
            </Link>
          }
        />
      )}
      <main className="dx-above">
        <section className={`dxs2-stage dxe2-stage ${field ? "is-field" : ""} ${dx.chosen ? "is-chosen" : ""}`} aria-label={event.title}>
          <div className="dxe-vt" style={dx.chosen ? { viewTransitionName: `ev-${event.slug}` } : undefined}>
          <EventPicture event={event} photo={dx.photo} big className="dxs2-picture">
            <div className="dxs2-title-wrap dxe2-title-wrap" style={dx.chosen ? { viewTransitionName: "ev-title" } : undefined}>
              <p className="dx-eyebrow dxs2-kicker">
                {dateRange(event)} · {event.venue.name}
              </p>
              <h1 className="dx-display-xl dxs2-title">{event.title.replace(" 2026", "")}</h1>
            </div>
          </EventPicture>
          </div>
          {dx.chosen ? (
            <Link viewTransition to={dx.href({ screen: "showcase" })} className="dxe-back">
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                <path d="M13 8H4M7.5 4l-4 4 4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              All events
            </Link>
          ) : null}
          <div className="dxs2-shade" aria-hidden="true" />
          <article className="dx-glass dxs2-card dxe2-card" aria-label="Key facts">
            {live ? <LiveChip /> : <span className="dx-chip">{whenLabel(event)}</span>}
            <Facts event={event} glass />
            <RegisterButton wide />
          </article>
          {field && live ? (
            <aside className="dx-glass dxp-livepanel dxe2-rooms-panel" aria-label="Rooms now">
              <div className="dxp-lp-head">
                <span className="dx-eyebrow">Rooms now</span>
                <span className="dx-live dx-mono dxp-lp-count">
                  <span className="dx-dot" /> {n(event.on_site ?? 0)}
                </span>
              </div>
              <RoomsNow event={event} compact />
            </aside>
          ) : null}
        </section>

        <section className="dxe2-about">
          <Reveal className="dxe2-lead">
            <p className="dx-eyebrow">About</p>
            <p className="dx-title">{first}.</p>
          </Reveal>
          <Reveal className="dxe2-rest">
            <p className="dx-body dx-muted">{more.join(". ")}</p>
          </Reveal>
        </section>

        <section className="dxe2-sec" id="programme">
          <div className="dxe-sec-head">
            <h2 className="dx-title">{live ? "Today’s programme" : "Programme"}</h2>
            <a className="dx-link dx-small" href="#programme">
              Full programme
            </a>
          </div>
          <SessionList event={event} />
        </section>

        <section className="dxe2-sec dxe2-venue">
          <Reveal image className="dxe2-venue-img">
            <EventPicture event={event} photo={dx.photo} tag={false} />
          </Reveal>
          <div className="dxe2-venue-text">
            <p className="dx-eyebrow">Where</p>
            <h2 className="dx-caps-thin dxe2-venue-name">{event.venue.name}</h2>
            <p className="dx-body dx-muted">
              {event.venue.city}. {event.rooms.length} rooms: {event.rooms.map((r) => r.name).join(", ")}.
            </p>
            {live ? (
              <div className="dxe2-venue-rooms">
                <RoomsNow event={event} />
              </div>
            ) : null}
          </div>
        </section>

        <section className="dxe2-cta">
          <Reveal>
            <h2 className="dx-display">
              Join {n(full.taken)} people <span className="dx-tone2">at {event.title.replace(" 2026", "")}.</span>
            </h2>
          </Reveal>
          <p className="dx-body dx-muted">
            {full.live ? `Registration stays open while it runs. ${full.note}.` : `${full.words}: ${n(full.left)} places left.`}
          </p>
          <RegisterButton />
        </section>
        <CalmFooter />
      </main>
      {menu ? <MenuSheet onClose={() => setMenu(false)} /> : null}
    </>
  );
}
