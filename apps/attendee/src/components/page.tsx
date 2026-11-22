import type { ReactNode } from "react";
import SiteHeader from "./site-header";

export function SkipLink() {
  return (
    <a
      href="#content"
      className="absolute left-0 top-0 -translate-y-full bg-background px-4 py-3 text-sm text-foreground focus:translate-y-0 focus:outline-none"
    >
      Skip to content
    </a>
  );
}

export function PageShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen">
      <SkipLink />
      <SiteHeader />
      <main
        id="content"
        className="mx-auto w-full max-w-[1600px] px-6 md:px-10 xl:px-16"
      >
        {children}
      </main>
    </div>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="text-xs uppercase tracking-widest text-muted-foreground">{children}</p>
  );
}

export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section className={`border border-border bg-card p-6 ${className}`}>
      {children}
    </section>
  );
}
