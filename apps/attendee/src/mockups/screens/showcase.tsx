/**
 * DEVELOPMENT ONLY — (a) the event showcase / home, in the three directions.
 * Calm: one centred statement over the Gathering field, a soft search, rounded image previews.
 * Stage: the live event on stage (rounded frame, huge layered name, glass card, pill nav).
 * Field: Stage plus the pointer square field, the live panel, mono details.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { Reveal, SquareField } from "@synan/ui/mockups";
import { useDx } from "../frame";
import { CalmPage, CalmFooter } from "../shell";
import { MenuSheet, PillNav, Arrow } from "../nav";
import { EventPicture } from "../scenes";
import {
  EVENTS,
  LIVE,
  UPCOMING,
  dateRange,
  greeting,
  n,
  nowLabel,
  whenLabel,
  type MockEvent,
} from "../data";
import { LiveChip, LivePanel } from "./parts";

const WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six"];
const word = (count: number) => WORDS[count] ?? String(count);

export default function Showcase() {
  const dx = useDx();
  return dx.d === 1 ? <CalmShowcase /> : <StageShowcase />;
}

/* ------------------------------------------------------------------ Calm */

function SearchIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="9" cy="9" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="m13.2 13.2 3.3 3.3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function CalmShowcase() {
  const dx = useDx();
  const [filter, setFilter] = useState("Today");
  return (
    <CalmPage current="showcase">
      <section className="dxs1-hero">
        <p className="dx-eyebrow">
          <span className="dx-live">
            <span className="dx-dot" />
          </span>
          {greeting()} · {nowLabel()}
        </p>
        <h1 className="dx-display dxs1-statement">
          {word(LIVE.length)} events are on right now. <span className="dx-tone2">{word(UPCOMING.length)} more in the next two weeks.</span>
        </h1>
        <form className="dxs1-search" role="search" onSubmit={(e) => e.preventDefault()}>
          <span className="dxs1-search-icon dx-muted">
            <SearchIcon />
          </span>
          <label className="dx-sr" htmlFor="dxs1-q">
            Find an event
          </label>
          <input id="dxs1-q" className="dxs1-search-input" placeholder="Find an event, a venue or a speaker" autoComplete="off" />
          <button type="submit" className="dx-btn is-action is-icon" aria-label="Search">
            <Arrow />
          </button>
        </form>
        <div className="dxs1-chips" role="group" aria-label="When">
          {["Today", "This week", "Near me", "Free to attend"].map((f) => (
            <button key={f} type="button" className="dx-chip" aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {f}
            </button>
          ))}
        </div>
      </section>

      <section className="dxs1-section" aria-labelledby="dxs1-now">
        <h2 id="dxs1-now" className="dx-h3">
          On now
        </h2>
        <div className="dxs1-grid is-two">
          {LIVE.map((event) => (
            <CalmCard key={event.id} event={event} photo={dx.photo} big />
          ))}
        </div>
      </section>
      <section className="dxs1-section" aria-labelledby="dxs1-next">
        <h2 id="dxs1-next" className="dx-h3">
          Coming up
        </h2>
        <div className="dxs1-grid">
          {UPCOMING.map((event) => (
            <CalmCard key={event.id} event={event} photo={dx.photo} />
          ))}
        </div>
      </section>
    </CalmPage>
  );
}

function CalmCard({ event, photo, big = false }: { event: MockEvent; photo: boolean; big?: boolean }) {
  const dx = useDx();
  return (
    <Link
      to={`${dx.href({ screen: "event" })}&e=${event.slug}`}
      className={`dxs1-card ${big ? "is-big" : ""}`}
      viewTransition={dx.chosen || undefined}
    >
      <Reveal image className="dxs1-img">
        {/* Chosen: the card's picture becomes the event page's full-width picture (and back). */}
        <div className="dxe-vt" style={dx.chosen ? { viewTransitionName: `ev-${event.slug}` } : undefined}>
          <EventPicture event={event} photo={photo} />
        </div>
      </Reveal>
      <div className="dxs1-card-meta">
        {event.state === "live" ? <LiveChip /> : <span className="dx-chip">{whenLabel(event)}</span>}
        <h3 className="dx-h3 dxs1-card-title">{event.title}</h3>
        <p className="dx-small dx-muted">
          {event.venue.name} · {dateRange(event)}
        </p>
      </div>
    </Link>
  );
}

/* ------------------------------------------------------------------ Stage and Field */

function StageShowcase() {
  const dx = useDx();
  const field = dx.d === 3;
  const [index, setIndex] = useState(0);
  const [menu, setMenu] = useState(false);
  const featured = LIVE[index] ?? LIVE[0] ?? EVENTS[0]!;
  const rest = EVENTS.filter((e) => e.id !== featured.id);
  const shortTitle = featured.title.replace(" 2026", "");

  return (
    <>
      {field ? <SquareField still={dx.still} mode={dx.m} /> : null}
      <PillNav
        onMenu={() => setMenu(true)}
        action={
          <Link to={dx.href({ screen: "pass" })} className="dx-btn is-action is-sm">
            My pass
          </Link>
        }
      />
      <main className="dx-above">
        <section className={`dxs2-stage ${field ? "is-field" : ""}`} aria-label="On stage now">
          <EventPicture event={featured} photo={dx.photo} big className="dxs2-picture">
            <div className="dxs2-title-wrap">
              {field ? <p className="dx-eyebrow dxs2-kicker">Live · {featured.venue.name}</p> : null}
              <h1 className="dx-display-xl dxs2-title">{shortTitle}</h1>
            </div>
          </EventPicture>
          <div className="dxs2-shade" aria-hidden="true" />

          <article className="dx-glass dxs2-card">
            <LiveChip>{featured.state === "live" ? "Live now" : whenLabel(featured)}</LiveChip>
            <h2 className="dx-h3 dxs2-card-title">{featured.title}</h2>
            <p className="dx-small dx-muted">
              {featured.venue.name}, {featured.venue.city}
            </p>
            <div className="dxs2-card-chips">
              <span className="dx-chip">{dateRange(featured)}</span>
              {featured.on_site ? <span className="dx-chip">{n(featured.on_site)} here now</span> : null}
            </div>
            <div className="dxs2-card-foot">
              <span className="dx-small">Free · registration open</span>
              <Link to={`${dx.href({ screen: "event" })}&e=${featured.slug}`} className="dx-btn is-sm is-on-glass">
                View event <Arrow />
              </Link>
            </div>
          </article>

          <div className={`dxs2-caption ${field ? "is-hidden" : ""}`}>
            <p className="dxs2-caption-text">{(featured.description ?? "").split(". ")[0]}.</p>
            <a href="#more" className="dxs2-caption-link">
              All events <Arrow />
            </a>
          </div>

          {LIVE.length > 1 ? (
            <div className="dxs2-pager" role="group" aria-label="Events on now">
              <span className="dx-mono dxs2-pager-num">
                {String(index + 1).padStart(2, "0")} / {String(LIVE.length).padStart(2, "0")}
              </span>
              {LIVE.map((event, i) => (
                <button key={event.id} type="button" className="dxs2-pager-btn" aria-pressed={i === index} aria-label={event.title} onClick={() => setIndex(i)}>
                  <span />
                </button>
              ))}
            </div>
          ) : null}

          {field ? <LivePanel events={LIVE} /> : null}
        </section>

        <section id="more" className="dxs2-more" aria-labelledby="dxs2-more-h">
          <div className="dxs2-more-head">
            <h2 id="dxs2-more-h" className="dx-title">
              More to come
            </h2>
            <p className="dx-body dx-muted">
              {word(rest.length)} more events in Kampala in the next two weeks.
            </p>
          </div>
          <div className="dxs2-tiles">
            {rest.map((event, i) => (
              <StageTile key={event.id} event={event} photo={dx.photo} wide={i === 0} />
            ))}
          </div>
        </section>
        <CalmFooter />
      </main>
      {menu ? <MenuSheet onClose={() => setMenu(false)} /> : null}
    </>
  );
}

function StageTile({ event, photo, wide }: { event: MockEvent; photo: boolean; wide: boolean }) {
  const dx = useDx();
  return (
    <Link to={`${dx.href({ screen: "event" })}&e=${event.slug}`} className={`dxs2-tile ${wide ? "is-wide" : ""}`} aria-label={`${event.title}, ${dateRange(event)}`}>
      <Reveal image className="dxs2-tile-img">
        <EventPicture event={event} photo={photo} tag={wide} />
      </Reveal>
      <span className="dxs2-tile-shade" aria-hidden="true" />
      <span className="dxs2-tile-top">{event.state === "live" ? <LiveChip /> : null}</span>
      <span className="dxs2-tile-cap">
        <span className="dx-caps-thin dxs2-tile-title">{event.title}</span>
        <span className="dxs2-tile-sub">
          {dx.d === 3 ? <span className="dx-mono">{dateRange(event).toUpperCase()}</span> : dateRange(event)} · {event.venue.name}
        </span>
      </span>
    </Link>
  );
}
