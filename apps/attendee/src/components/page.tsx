import type { ReactNode } from "react";
import { useLocation } from "react-router-dom";
import SiteHeader from "./site-header";
import SiteFooter from "./site-footer";
import PassBar, { usePassBarVisible } from "./pass-bar";
import { ErrorBoundary } from "./error-boundary";
import { useOnline } from "./use-online";

/** The calm column (D-37): one centred column, 1200 wide at most, 20px gutters on a phone, 32 from md. */
export const COLUMN = "mx-auto w-full max-w-300 px-5 md:px-8";
/** A panel: a tonal step from the ground (soft depth on light). */
export const PANEL = "bg-surface shadow-depth";

export function SkipLink() {
  return (
    <a
      href="#content"
      className="absolute top-0 left-[-9999px] z-50 bg-solid px-3 py-2 text-15 shadow-pop focus:top-4 focus:left-4"
    >
      Skip to content
    </a>
  );
}

function OfflineStrip() {
  const online = useOnline();
  if (online) return null;
  return (
    <p role="status" className={`${COLUMN} flex items-center gap-2 py-3 text-15`}>
      <span aria-hidden="true" className="size-1.5 rounded-full bg-warning" />
      You're offline. Your pass still works; other pages show what was last loaded.
    </p>
  );
}

/**
 * The calm page (D-37): a minimal top bar, the page on the ground (the Gathering field shows
 * through; nothing here paints an opaque ground), a quiet footer. `bleed` lets a screen draw its
 * own full-width parts; otherwise content sits in the calm column. `over` (the event page): the
 * top bar lies clear over the screen's picture; `action` is the bar's action once it turns solid.
 */
export function PageShell({
  children,
  bleed = false,
  over = false,
  onPhoto = false,
  action,
}: {
  children: ReactNode;
  bleed?: boolean;
  over?: boolean;
  onPhoto?: boolean;
  action?: ReactNode;
}) {
  const { pathname } = useLocation();
  const passBar = usePassBarVisible();
  return (
    <div className="flex min-h-dvh flex-col text-17 text-foreground">
      <SkipLink />
      <SiteHeader over={over} onPhoto={onPhoto} action={action} />
      <OfflineStrip />
      <main id="content" key={pathname} className="fade-in flex-1">
        <ErrorBoundary resetKey={pathname}>{bleed ? children : <div className={COLUMN}>{children}</div>}</ErrorBoundary>
      </main>
      <SiteFooter />
      {passBar ? <div aria-hidden="true" className="h-16 md:hidden" /> : null}
      <PassBar />
    </div>
  );
}

/**
 * The one statement of a calm screen (D-37): an optional eyebrow, the statement in display
 * type with its second sentence (`more`) muted, then an optional line and actions, centred.
 */
export function PageHeader({
  label,
  title,
  more,
  children,
  aside,
  hero = false,
}: {
  label?: ReactNode;
  title: ReactNode;
  more?: ReactNode;
  children?: ReactNode;
  aside?: ReactNode;
  /** The showcase: the statement is the page's opening, so it sits lower. */
  hero?: boolean;
}) {
  return (
    <div className={`mx-auto flex max-w-220 flex-col items-center text-center ${hero ? "pt-12 md:pt-36" : "pt-8 md:pt-12"}`}>
      {label ? <p className="eyebrow mb-5 text-balance">{label}</p> : null}
      <h1 className="type-statement max-w-[11em] wrap-anywhere">
        {title}
        {more ? <span className="text-muted-foreground"> {more}</span> : null}
      </h1>
      {children ? <div className="mt-5 max-w-[52ch] text-17 text-muted-foreground">{children}</div> : null}
      {aside ? <div className="mt-8 flex flex-wrap items-center justify-center gap-3">{aside}</div> : null}
    </div>
  );
}

/**
 * A section of a calm screen: its title, then its content on a tonal panel, held apart from the
 * next by space (no rules).
 */
export function Section({ label, children, id }: { label: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section id={id} aria-labelledby={id ? `${id}-title` : undefined} className="mt-12 scroll-mt-24 md:mt-16">
      <h2 id={id ? `${id}-title` : undefined} className="mb-4 font-display text-21 font-medium">
        {label}
      </h2>
      <div className={`${PANEL} p-6 md:p-8`}>{children}</div>
    </section>
  );
}

/** A panel: a tonal step, padded. */
export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`${PANEL} p-6 md:p-8 ${className}`}>{children}</section>;
}
