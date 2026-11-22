import type { ReactNode } from "react";
import SiteHeader from "./site-header";

export function SkipLink() {
  return (
    <a
      href="#content"
      className="absolute top-0 -left-[9999px] focus:left-4 focus:top-4 focus:z-50 focus:block focus:border focus:border-brand focus:bg-background focus:px-3 focus:py-2 focus:font-mono focus:text-[0.6875rem] focus:tracking-[0.12em] focus:text-brand focus:uppercase focus:underline focus:underline-offset-2 motion-reduce:transition-none"
    >
      Skip to content
    </a>
  );
}

export function PageShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <SkipLink />
      <SiteHeader />
      <main
        id="content"
        className="mx-auto w-full max-w-[1600px] px-6 md:px-10 xl:px-16 pt-10 md:pt-14 xl:pt-16"
      >
        {children}
      </main>
    </div>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="font-mono text-[0.6875rem] tracking-[0.18em] uppercase text-muted-foreground">
      {children}
    </p>
  );
}

export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <section className={`border border-border p-6 ${className}`}>
      {children}
    </section>
  );
}

// Hairline rule component matching discover.tsx patterns
export function Hairline() {
  return <div className="border-border border-t" />;
}
