/**
 * DEVELOPMENT ONLY — the index and the side-by-side compare view of the direction mock-ups.
 * Router-agnostic (plain links), shared by the attendee and admin galleries.
 */
import { useEffect, useRef, useState } from "react";
import { DIRECTIONS, type DirectionId, type DxMode } from "./directions";

export interface GalleryScreen {
  id: string;
  label: string;
  light?: boolean;
  phone?: boolean;
  photo?: boolean;
}

/** An iframe of a mock-up at its real size, scaled to the cell. */
export function Thumb({ src, title, w = 1440, h = 900, live = false }: { src: string; title: string; w?: number; h?: number; live?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.25);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setScale(el.clientWidth / w));
    ro.observe(el);
    return () => ro.disconnect();
  }, [w]);
  return (
    <div ref={ref} className={`dxg-thumb ${live ? "is-live" : ""}`} style={{ aspectRatio: `${w} / ${h}` }}>
      <iframe title={title} src={src} width={w} height={h} loading="lazy" tabIndex={live ? 0 : -1} style={{ transform: `scale(${scale})` }} />
    </div>
  );
}

export function GalleryView({
  app,
  mode,
  screens,
  hrefFor,
  compareHref,
  compareScreens,
  modeHref,
  other,
  currents = [],
}: {
  app: "attendee" | "admin";
  mode: DxMode;
  screens: GalleryScreen[];
  hrefFor: (screen: string, d: DirectionId, m: DxMode, extra?: string) => string;
  compareHref: (screen: string, m: DxMode) => string;
  compareScreens: { id: string; label: string }[];
  modeHref: (m: DxMode) => string;
  other: { label: string; href: string };
  /** "Chosen vs current site" compare links. */
  currents?: { id: string; label: string; href: string }[];
}) {
  return (
    <div className="dx dxg" data-dir="1" data-chosen="" data-mode={mode} data-app={app}>
      <header className="dxg-head">
        <div>
          <p className="dx-eyebrow">Development only · design directions · {app === "attendee" ? "Attendee Portal" : "Admin Command"}</p>
          <h1 className="dx-title">The chosen design, and where it came from</h1>
          <p className="dx-body dx-muted dxg-lede">
            Chosen (D-37): {app === "attendee" ? "the Calm site, with the Field event page, all corners square" : "the Field console, all corners square, nothing moving"}. It opens first everywhere. The three
            directions it was picked from stay for comparison. Open any screen full size, then flip design or theme with the switcher in the corner.
          </p>
        </div>
        <nav className="dxg-head-links" aria-label="Gallery">
          <a className="dx-btn is-sm" href={other.href}>
            {other.label}
          </a>
          <span className="dxg-seg" role="group" aria-label="Theme of the previews">
            <a className="dx-btn is-sm" aria-current={mode === "dark" ? "true" : undefined} href={modeHref("dark")}>
              Dark
            </a>
            <a className="dx-btn is-sm" aria-current={mode === "light" ? "true" : undefined} href={modeHref("light")}>
              Light
            </a>
          </span>
        </nav>
      </header>

      <section className="dxg-dirs" aria-label="The chosen design and the three directions">
        {DIRECTIONS.map((d) => (
          <article key={d.id} className={`dx-surface dxg-dir ${d.id === 4 ? "is-chosen" : ""}`}>
            <p className="dx-eyebrow dx-mono">{d.id === 4 ? "Chosen · D-37" : `Direction ${d.id}`}</p>
            <h2 className="dx-h2">{d.name}</h2>
            <p className="dx-small dxg-tag">{d.tagline}</p>
            <p className="dx-small dx-muted">{d.feels}</p>
            <p className="dx-small dx-muted">
              <strong className="dxg-k">References.</strong> {d.references}
            </p>
            <p className="dx-small dx-muted">
              <strong className="dxg-k">What moves.</strong> {d.moves}
            </p>
            {app === "admin" ? (
              <p className="dx-small dx-muted">
                <strong className="dxg-k">In the console.</strong> {d.admin}
              </p>
            ) : null}
            <details className="dxg-card" open={d.id === 4 || undefined}>
              <summary>Show the rules card</summary>
              <dl>
                {Object.entries(d.card).map(([k, v]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
            </details>
          </article>
        ))}
      </section>

      <section className="dxg-compare" aria-label="Compare side by side">
        <h2 className="dx-h3">Side by side</h2>
        <div className="dxg-compare-links">
          {currents.map((c) => (
            <a key={`cur-${c.id}`} className="dx-btn is-sm is-action" href={c.href}>
              Chosen vs current: {c.label.toLowerCase()}
            </a>
          ))}
          {compareScreens.map((s) => (
            <a key={s.id} className="dx-btn is-sm" href={compareHref(s.id, mode)}>
              All four: {s.label.toLowerCase()}
            </a>
          ))}
        </div>
      </section>

      <section aria-label="Screens by direction" className="dxg-grid-wrap">
        <div className="dxg-grid" role="table" aria-label="Screens by direction">
          <div role="row" className="dxg-row dxg-row-head">
            <span role="columnheader" className="dx-meta dx-muted">
              Screen
            </span>
            {DIRECTIONS.map((d) => (
              <span key={d.id} role="columnheader" className="dx-meta">
                {d.id < 4 ? <span className="dx-mono dx-muted">{d.id} </span> : null}
                {d.name}
              </span>
            ))}
          </div>
          {screens.map((s) => (
            <div role="row" key={s.id} className="dxg-row">
              <div role="rowheader" className="dxg-rowhead">
                <span className="dx-small">{s.label}</span>
                <span className="dx-meta dx-muted">
                  {s.phone ? "Best at phone width" : "Desktop preview"}
                  {s.light ? " · light theme reviewed" : ""}
                </span>
              </div>
              {DIRECTIONS.map((d) => {
                const href = hrefFor(s.id, d.id, mode);
                return (
                  <a role="cell" key={d.id} className="dxg-cell" href={href} aria-label={`${s.label}, ${d.id === 4 ? "chosen design" : `direction ${d.id} ${d.name}`}, ${mode}`}>
                    {s.phone ? (
                      <div className="dxg-phone">
                        <Thumb src={hrefFor(s.id, d.id, mode, "&bare=1&still=1")} title={`${s.label} ${d.name}`} w={390} h={844} />
                      </div>
                    ) : (
                      <Thumb src={hrefFor(s.id, d.id, mode, "&bare=1&still=1")} title={`${s.label} ${d.name}`} />
                    )}
                    <span className="dx-meta dxg-open">Open full size</span>
                  </a>
                );
              })}
            </div>
          ))}
        </div>
      </section>
      <footer className="dxg-foot dx-meta dx-muted">
        Mock-ups only: static mock data from packages/mock, no real flows. Pictures are drawn placeholders, marked as such. Nothing here ships: the whole
        gallery is behind a development-only route.
      </footer>
    </div>
  );
}

export function CompareView({
  app,
  screen,
  label,
  mode,
  photo,
  width,
  hrefFor,
  selfHref,
  backHref,
}: {
  app: "attendee" | "admin";
  screen: string;
  label: string;
  mode: DxMode;
  photo?: boolean | undefined;
  width: "desktop" | "phone";
  hrefFor: (screen: string, d: DirectionId, m: DxMode, extra?: string) => string;
  selfHref: (next: { m?: DxMode; photo?: boolean; width?: "desktop" | "phone" }) => string;
  backHref: string;
}) {
  const extra = `&bare=1${photo === false ? "&photo=0" : ""}`;
  return (
    <div className="dx dxg dxg-cmp" data-dir="1" data-chosen="" data-mode={mode} data-app={app}>
      <header className="dxg-cmp-head">
        <a className="dx-btn is-sm" href={backHref}>
          Back to the index
        </a>
        <h1 className="dx-h3">{label}: the chosen design and the three directions</h1>
        <nav className="dxg-head-links" aria-label="Compare options">
          <span className="dxg-seg">
            <a className="dx-btn is-sm" aria-current={mode === "dark" ? "true" : undefined} href={selfHref({ m: "dark" })}>
              Dark
            </a>
            <a className="dx-btn is-sm" aria-current={mode === "light" ? "true" : undefined} href={selfHref({ m: "light" })}>
              Light
            </a>
          </span>
          <span className="dxg-seg">
            <a className="dx-btn is-sm" aria-current={width === "desktop" ? "true" : undefined} href={selfHref({ width: "desktop" })}>
              Desktop
            </a>
            <a className="dx-btn is-sm" aria-current={width === "phone" ? "true" : undefined} href={selfHref({ width: "phone" })}>
              Phone
            </a>
          </span>
          {photo !== undefined ? (
            <span className="dxg-seg">
              <a className="dx-btn is-sm" aria-current={photo ? "true" : undefined} href={selfHref({ photo: true })}>
                Photo
              </a>
              <a className="dx-btn is-sm" aria-current={!photo ? "true" : undefined} href={selfHref({ photo: false })}>
                No photo
              </a>
            </span>
          ) : null}
        </nav>
      </header>
      <div className={`dxg-cmp-cols ${width === "phone" ? "is-phone" : ""}`}>
        {DIRECTIONS.map((d) => (
          <section key={d.id} className="dxg-cmp-col" aria-label={`Direction ${d.id}, ${d.name}`}>
            <div className="dxg-cmp-cap">
              <span className="dx-small">
                <span className="dx-mono dx-muted">{d.id}</span> {d.name}
              </span>
              <a className="dx-link dx-meta" href={hrefFor(screen, d.id, mode, photo === false ? "&photo=0" : "")}>
                Open
              </a>
            </div>
            {width === "phone" ? (
              <div className="dxg-phone">
                <Thumb src={hrefFor(screen, d.id, mode, extra)} title={`${label}, ${d.name}`} w={390} h={844} />
              </div>
            ) : (
              <Thumb src={hrefFor(screen, d.id, mode, extra)} title={`${label}, ${d.name}`} />
            )}
          </section>
        ))}
      </div>
    </div>
  );
}

/**
 * Chosen vs the current site: the chosen design's mock-up beside the real screen running on the
 * same dev server. The real frame is live (it can be scrolled and signed into); it shows the real
 * site in the device's own theme setting, which this page does not change.
 */
export function CompareCurrentView({
  app,
  label,
  mode,
  width,
  chosenSrc,
  currentSrc,
  currentNote,
  selfHref,
  backHref,
  openChosen,
}: {
  app: "attendee" | "admin";
  label: string;
  mode: DxMode;
  width: "desktop" | "phone";
  chosenSrc: string;
  currentSrc: string;
  currentNote: string;
  selfHref: (next: { m?: DxMode; width?: "desktop" | "phone" }) => string;
  backHref: string;
  openChosen: string;
}) {
  const w = width === "phone" ? 390 : 1440;
  const h = width === "phone" ? 844 : 900;
  return (
    <div className="dx dxg dxg-cmp" data-dir="1" data-chosen="" data-mode={mode} data-app={app}>
      <header className="dxg-cmp-head">
        <a className="dx-btn is-sm" href={backHref}>
          Back to the index
        </a>
        <h1 className="dx-h3">{label}: chosen design vs the current site</h1>
        <nav className="dxg-head-links" aria-label="Compare options">
          <span className="dxg-seg">
            <a className="dx-btn is-sm" aria-current={mode === "dark" ? "true" : undefined} href={selfHref({ m: "dark" })}>
              Dark
            </a>
            <a className="dx-btn is-sm" aria-current={mode === "light" ? "true" : undefined} href={selfHref({ m: "light" })}>
              Light
            </a>
          </span>
          <span className="dxg-seg">
            <a className="dx-btn is-sm" aria-current={width === "desktop" ? "true" : undefined} href={selfHref({ width: "desktop" })}>
              Desktop
            </a>
            <a className="dx-btn is-sm" aria-current={width === "phone" ? "true" : undefined} href={selfHref({ width: "phone" })}>
              Phone
            </a>
          </span>
        </nav>
      </header>
      <div className={`dxg-cmp-cols is-two ${width === "phone" ? "is-phone" : ""}`}>
        <section className="dxg-cmp-col" aria-label="Chosen design">
          <div className="dxg-cmp-cap">
            <span className="dx-small">Chosen (D-37)</span>
            <a className="dx-link dx-meta" href={openChosen}>
              Open
            </a>
          </div>
          <div className={width === "phone" ? "dxg-phone" : undefined}>
            <Thumb src={chosenSrc} title={`${label}, chosen design`} w={w} h={h} />
          </div>
        </section>
        <section className="dxg-cmp-col" aria-label="Current site">
          <div className="dxg-cmp-cap">
            <span className="dx-small">Current site</span>
            <a className="dx-link dx-meta" href={currentSrc} target="_blank" rel="noreferrer">
              Open
            </a>
          </div>
          <div className={width === "phone" ? "dxg-phone" : undefined}>
            <Thumb src={currentSrc} title={`${label}, current site`} w={w} h={h} live />
          </div>
          <p className="dx-meta dx-muted dxg-cmp-note">{currentNote}</p>
        </section>
      </div>
    </div>
  );
}
