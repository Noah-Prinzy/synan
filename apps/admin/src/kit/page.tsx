/**
 * Page structure every admin screen shares, so headers, section heads and spacing read the
 * same from one screen to the next (docs/05 §2, D-37: an instrument — tonal panels, no rules).
 *
 * Layout rules (docs/05 layout and density). Use these names, not new numbers:
 *
 *   spacing     4px base, 8px rhythm: 4 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 48.
 *   gutter      the page's side gutter: 16px on a phone, 24px from 640, 32px from 1536 (GUTTER_X).
 *   header      one PageHeader per screen: optional back link (mono capitals), a display title, one meta line,
 *               actions on the right. No screen codes on screen; the title says where you are.
 *   panels      a SectionHead is a mono capital eyebrow with a 12px meta, set apart by space. Panel bodies pad
 *               16px in a rail or narrow column (PAD_TIGHT), 20px in a main column (PAD).
 *   type floor  body and table cells 13px; labels, table heads and meta 12px; 11px only for unit
 *               suffixes and the status bar. Figures in mono with tabular numerals.
 *   measure     prose stops at 68 characters (PROSE); forms at 40rem (FormColumn).
 *   tables      head 36px, rows 40px (44 under a coarse pointer); numbers right-aligned in mono
 *               and sized to their content (Th/Td `numeric`, `fit`).
 *   controls    32px on a mouse, 44px under a coarse pointer (the shared `compact` controls).
 *   columns     a main column and an aside: `SPLIT` — the aside is 20–26rem and drops under the
 *               main column below 1024, so a narrow column never carries a wide one's density.
 *
 *   PageHeader   back link, title, one meta line, actions on the right.
 *   SectionHead  a mono capital label naming a panel, with a quiet meta on the right.
 *   Panel        a tonal surface (a soft depth on light) with an optional SectionHead.
 *   KeyValues    a two-column definition list of facts.
 */
import type { ReactNode } from "react";
import { cn } from "@synan/ui/components";

/** The page's side gutter. Every full-width band (header, filters, tables' first/last cells) uses it. */
export const GUTTER_X = "px-4 sm:px-6 2xl:px-8";
/** Panel body padding: in a main column, and in a rail or narrow column. */
export const PAD = "px-5 py-4";
export const PAD_TIGHT = "px-4 py-3";
/** Readable line length for prose: help text, explanations, empty states. */
export const PROSE = "max-w-[68ch]";
/** A main column with an aside on the right from 1024 up; stacked below. */
export const SPLIT = "grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,24rem)] 2xl:grid-cols-[minmax(0,1fr)_26rem]";

/**
 * Type roles. One size and weight per role, everywhere:
 *   title     the page title (PageHeader)            28 display
 *   heading   a panel or section heading             13 medium
 *   body      text, table cells, controls            13 regular
 *   label     field labels, table heads, meta, hints 12 regular, muted
 *   figure    a headline number                      40 mono (28 in a narrow cell)
 *   value     a number in a row or a table           13 mono tabular, right-aligned in columns
 */
export const TYPE = {
  heading: "text-13 font-medium",
  body: "text-13",
  label: "text-12 text-muted-foreground",
  value: "font-mono text-13 tabular-nums",
} as const;

/**
 * A row action repeated down a table or list (Duplicate, Handover, Open): quiet at rest — muted text,
 * no frame — with a tonal step on hover and focus. 32px tall on a mouse, 44px under a coarse pointer.
 * Never a filled or bordered button in every row.
 */
export const ROW_ACTION =
  "pressable inline-flex h-8 shrink-0 items-center gap-1.5 px-2.5 text-13 whitespace-nowrap text-muted-foreground hover:bg-surface-2 hover:text-foreground focus-visible:bg-surface-2 focus-visible:text-foreground disabled:pointer-events-none disabled:opacity-50 pointer-coarse:h-11 [&_svg]:size-4 [&_svg]:shrink-0";

/** A square icon-only control: 32px on a mouse, 44px under a coarse pointer, icon 16px at 1.5px stroke. */
export const ICON_BUTTON =
  "pressable inline-grid size-8 shrink-0 place-items-center text-muted-foreground hover:bg-surface-2 hover:text-foreground focus-visible:bg-surface-2 disabled:pointer-events-none disabled:opacity-40 pointer-coarse:size-11 [&_svg]:size-4";

export function PageHeader({
  code: _code,
  title,
  meta,
  actions,
  back,
  className,
}: {
  /**
   * Screen id from docs/06 (D4, D6.1 …). Kept for the code's sake; not shown — an operator
   * reads the title, not the spec's numbering.
   */
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
        "flex flex-wrap items-end justify-between gap-x-6 gap-y-4 pt-8 pb-6 sm:pt-10",
        GUTTER_X,
        className,
      )}
    >
      <div className="min-w-0">
        {back ? <p className="mb-3 flex items-center gap-2 font-mono text-12 tracking-[0.08em] text-muted-foreground uppercase">{back}</p> : null}
        <h1 className="type-title">{title}</h1>
        {meta ? <div className="mt-2 max-w-[80ch] text-13 text-muted-foreground">{meta}</div> : null}
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
    <header className={cn("flex min-h-10 flex-wrap items-center justify-between gap-x-3 px-4 pt-3 sm:px-5", className)}>
      <h2 id={id} className="eyebrow-mono py-2">
        {title}
      </h2>
      <div className="flex min-w-0 items-center gap-3">
        {meta ? <span className="min-w-0 truncate text-12 text-muted-foreground">{meta}</span> : null}
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
    <section className={cn("min-w-0 bg-surface shadow-depth", className)}>
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
          <dt className="px-4 py-2 text-12 text-muted-foreground sm:px-5">{key}</dt>
          <dd className="min-w-0 px-4 py-2 sm:px-5">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The width-limited column most forms sit in, so line length stays readable on a wide screen. */
export function FormColumn({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("w-full max-w-160 py-6", GUTTER_X, className)}>{children}</div>;
}

/** A link styled as text with a faint underline that turns blue on hover (docs/05 §5). */
export const linkClass = "text-foreground underline decoration-foreground/30 underline-offset-4 hover:decoration-brand";
