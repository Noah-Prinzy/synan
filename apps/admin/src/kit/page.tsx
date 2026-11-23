/**
 * Page structure every admin screen shares, so headers, section heads and spacing read the
 * same from one screen to the next (docs/05 §2: an instrument — hairline panels, no cards).
 *
 *   PageHeader   screen code, title, one meta line, actions on the right. 24px side gutter.
 *   SectionHead  a 32px ruled band naming a panel, with a quiet meta on the right.
 *   Panel        a hairline-bounded block with an optional SectionHead.
 *   KeyValues    a two-column definition list of facts.
 */
import type { ReactNode } from "react";
import { cn } from "@synan/ui/components";

export function PageHeader({
  code,
  title,
  meta,
  actions,
  back,
  className,
}: {
  /** Screen id from docs/06 (D4, D6.1 …), set small in mono above the title. */
  code?: string;
  title: ReactNode;
  /** One line under the title: what this is, a state, a date. */
  meta?: ReactNode;
  /** Buttons, right-aligned. One filled primary at most (docs/05 §9.2). */
  actions?: ReactNode;
  /** A small link back up the hierarchy, above the title. */
  back?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b border-border px-4 pt-5 pb-4 sm:px-6 sm:pt-6",
        className,
      )}
    >
      <div className="min-w-0">
        {back || code ? (
          <p className="flex items-center gap-2 text-11 text-muted-foreground">
            {back}
            {back && code ? <span aria-hidden="true">·</span> : null}
            {code ? <span className="font-mono">{code}</span> : null}
          </p>
        ) : null}
        <h1 className="mt-1 font-display text-28 leading-tight tracking-tight text-balance">{title}</h1>
        {meta ? <div className="mt-1.5 text-13 text-muted-foreground">{meta}</div> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function SectionHead({
  id,
  title,
  meta,
  actions,
  className,
}: {
  id?: string;
  title: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex min-h-8 items-center justify-between gap-3 border-b border-border px-4", className)}>
      <h2 id={id} className="py-1.5 text-12 font-medium">
        {title}
      </h2>
      <div className="flex items-center gap-3">
        {meta ? <span className="text-11 text-muted-foreground">{meta}</span> : null}
        {actions}
      </div>
    </header>
  );
}

export function Panel({
  title,
  meta,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn("min-w-0 border border-border", className)}>
      {title ? <SectionHead title={title} meta={meta} actions={actions} /> : null}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

export function KeyValues({ rows, className }: { rows: [ReactNode, ReactNode][]; className?: string }) {
  return (
    <dl className={cn("grid grid-cols-[minmax(7rem,auto)_minmax(0,1fr)] text-13", className)}>
      {rows.map(([key, value], index) => (
        <div key={index} className="contents">
          <dt className="border-t border-border px-4 py-2 text-12 text-muted-foreground first-of-type:border-t-0">{key}</dt>
          <dd className="min-w-0 border-t border-border px-4 py-2 [dt:first-of-type+&]:border-t-0">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The width-limited column most forms sit in, so line length stays readable on a wide screen. */
export function FormColumn({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("w-full max-w-160 px-4 py-6 sm:px-6", className)}>{children}</div>;
}

/** A link styled as text with a hairline underline that turns blue on hover (docs/05 §5). */
export const linkClass =
  "text-foreground underline decoration-border underline-offset-4 transition-colors duration-120 ease-standard hover:decoration-brand motion-reduce:transition-none";
