import type { ReactNode } from "react";

/** An honest placeholder: what the screen is for, and that it is not built yet. */
export function Placeholder({
  id,
  title,
  purpose,
  children,
}: {
  id: string;
  title: string;
  purpose: string;
  children?: ReactNode;
}) {
  return (
    <section aria-labelledby="screen-title" className="flex flex-1 flex-col gap-4 px-4 py-6">
      <p className="font-mono text-11 uppercase tracking-[0.14em] text-muted-foreground">
        {id} · Not built yet — Phase 3
      </p>
      <h1 id="screen-title" className="text-28 font-medium leading-tight">
        {title}
      </h1>
      <p className="max-w-[40ch] text-15 leading-relaxed text-muted-foreground">{purpose}</p>
      {children}
    </section>
  );
}
