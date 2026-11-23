import type { ReactNode } from "react";
import { useLocation } from "react-router-dom";
import SiteHeader from "./site-header";
import SiteFooter from "./site-footer";
import PassBar, { usePassBarVisible } from "./pass-bar";
import { ErrorBoundary } from "./error-boundary";
import { useOnline } from "./use-online";

export function SkipLink() {
  return (
    <a
      href="#content"
      className="absolute top-0 left-[-9999px] z-50 border border-brand bg-background px-3 py-2 text-15 focus:left-4 focus:top-4"
    >
      Skip to content
    </a>
  );
}

function OfflineStrip() {
  const online = useOnline();
  if (online) return null;
  return (
    <p role="status" className="flex items-center gap-2 border-b border-border px-4 py-3 text-15 sm:px-6 md:px-8">
      <span aria-hidden="true" className="size-1.5 bg-warning" />
      You're offline. Your pass still works; other pages show what was last loaded.
    </p>
  );
}

/**
 * The Direction A frame: the page sits inside visible hairline edges (md and up),
 * the header is a row of ruled cells, sections are separated by full-width rules,
 * and the footer is ruled cells. `bleed` lets a screen draw its own full-width
 * sections; otherwise content gets the standard gutters.
 */
export function PageShell({ children, bleed = false }: { children: ReactNode; bleed?: boolean }) {
  const { pathname } = useLocation();
  const passBar = usePassBarVisible();
  return (
    <div className="min-h-dvh text-17 text-foreground">
      <SkipLink />
      <div className="mx-auto flex min-h-dvh w-full max-w-360 flex-col md:border-x md:border-border">
        <SiteHeader />
        <OfflineStrip />
        <main id="content" key={pathname} className="fade-in flex-1">
          <ErrorBoundary resetKey={pathname}>
            {bleed ? children : <div className="px-4 py-10 sm:px-6 md:px-10 md:py-14">{children}</div>}
          </ErrorBoundary>
        </main>
        <SiteFooter />
        {passBar ? <div aria-hidden="true" className="h-14 md:hidden" /> : null}
      </div>
      <PassBar />
    </div>
  );
}

/**
 * Direction A page opening: a full-width ruled band with the label, the display title
 * and an optional line, plus optional cells on the right (status, actions).
 */
export function PageHeader({
  label,
  title,
  children,
  aside,
}: {
  label: string;
  title: ReactNode;
  children?: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <section className="grid border-b border-border md:grid-cols-[minmax(0,1fr)_auto]">
      <div className="enter px-4 py-10 sm:px-6 md:px-10 md:py-14">
        <p className="text-13 font-medium text-muted-foreground">{label}</p>
        <h1 className="mt-2 font-display text-40 leading-[1.05] md:text-56">{title}</h1>
        {children ? <div className="mt-4 max-w-2xl text-17 text-muted-foreground">{children}</div> : null}
      </div>
      {aside ? <div className="flex items-end border-t border-border px-4 py-6 sm:px-6 md:border-t-0 md:border-l md:px-10">{aside}</div> : null}
    </section>
  );
}

/** A labelled row of the page: the label in a left rail cell, content to the right. */
export function RuledRow({ label, children, id }: { label: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section id={id} className="grid scroll-mt-24 border-b border-border md:grid-cols-[14rem_minmax(0,1fr)]">
      <h2 className="px-4 pt-8 font-display text-21 sm:px-6 md:border-r md:border-border md:px-10 md:py-8">{label}</h2>
      <div className="min-w-0 px-4 pt-4 pb-8 sm:px-6 md:px-10 md:py-8">{children}</div>
    </section>
  );
}

/** Section label: the UI sans, sentence case, muted. An optional numeral is data, so mono. */
export function Eyebrow({ children, index }: { children: ReactNode; index?: number }) {
  return (
    <p className="text-13 font-medium text-muted-foreground">
      {index !== undefined ? <span className="mr-2 font-mono">{String(index).padStart(2, "0")}</span> : null}
      {children}
    </p>
  );
}

export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`border border-border p-6 ${className}`}>{children}</section>;
}

export function Hairline() {
  return <div className="border-t border-border" />;
}
