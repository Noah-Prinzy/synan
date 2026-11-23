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
      className="absolute top-0 -left-[9999px] z-50 border border-brand bg-background px-3 py-2 text-15 focus:left-4 focus:top-4"
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
    <div className="min-h-dvh bg-background text-17 text-foreground">
      <SkipLink />
      <div className="mx-auto flex min-h-dvh w-full max-w-[1440px] flex-col md:border-x md:border-border">
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
