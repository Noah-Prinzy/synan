/**
 * Select — one accessible, themed replacement for the native <select> (docs/05 §7 tier 1).
 *
 * Why not the native element: its option list is drawn by the browser and the operating
 * system, outside the theme. On a dark page that meant system fonts, a white or grey list on
 * some platforms, the OS highlight colour, a width unrelated to the field, and a placeholder
 * shown at full foreground as if it were an answer. None of it can be styled.
 *
 * Behaviour (WAI-ARIA APG "select-only combobox"):
 *   - Focus stays on the trigger; the active option is announced via aria-activedescendant.
 *   - Closed: ArrowDown/ArrowUp/Enter/Space/Alt+ArrowDown open; Home/End open on the first/last;
 *     typing selects the next matching option without opening (like the native control).
 *   - Open: ArrowUp/ArrowDown move, Home/End jump, PageUp/PageDown move by ten, typing jumps
 *     (type-ahead), Enter/Space choose, Tab chooses and moves on, Escape closes unchanged,
 *     a click outside closes unchanged.
 *
 * Placement: the list is rendered into the top layer (the Popover API) when the browser has
 * it, and into the nearest open <dialog> or <body> otherwise, with fixed coordinates — so no
 * overflow parent can clip it and no stacking context can hide it. It opens below the trigger,
 * or above when there is more room there, is never wider than the viewport, and its height is
 * capped to the space available, scrolling inside itself.
 */
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "../../lib/cn";
import { controlClass, useField, type Density } from "./field";

export interface SelectOption<V extends string = string> {
  value: V;
  label: string;
  /** A quieter second line in the list (not shown on the trigger). */
  description?: string;
  /** Right-aligned detail in the list, e.g. a count or a state word. */
  meta?: ReactNode;
  disabled?: boolean;
}

export interface SelectProps<V extends string = string> {
  options: readonly SelectOption<V>[];
  value: V | null;
  onChange: (value: V) => void;
  /** Shown, muted, while nothing is chosen. */
  placeholder?: string;
  density?: Density;
  disabled?: boolean;
  invalid?: boolean;
  /** Submitted with a surrounding form. */
  name?: string;
  id?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  className?: string;
  /** Minimum list width in px (defaults to the trigger's width). */
  listMinWidth?: number;
  /** Renders the trigger's content for the chosen option (defaults to its label). */
  renderValue?: (option: SelectOption<V>) => ReactNode;
}

const GAP = 4;
const EDGE = 8;
const MAX_LIST = 320;

interface Placement {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
  above: boolean;
}

/**
 * Type-ahead match: the label starts with what was typed, or any word in it does — so "nai"
 * finds "Africa/Nairobi" and "lounge" finds "VIP Lounge", as people expect.
 */
function startsAtWord(label: string, needle: string): boolean {
  if (label.startsWith(needle)) return true;
  for (let i = 1; i < label.length; i++) {
    if (/[\s/_\-(·,]/.test(label[i - 1] as string) && label.startsWith(needle, i)) return true;
  }
  return false;
}

const supportsPopover = typeof HTMLElement !== "undefined" && "showPopover" in HTMLElement.prototype;

export function Select<V extends string = string>({
  options,
  value,
  onChange,
  placeholder = "Choose…",
  density = "compact",
  disabled = false,
  invalid,
  name,
  id,
  className,
  listMinWidth,
  renderValue,
  ...aria
}: SelectProps<V>) {
  const field = useField();
  const auto = useId().replace(/:/g, "");
  const triggerId = id ?? field?.id ?? `sel${auto}`;
  const listId = `${triggerId}-list`;
  const optionId = (index: number) => `${triggerId}-opt-${index}`;

  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [place, setPlace] = useState<Placement | null>(null);
  const [host, setHost] = useState<Element | null>(null);
  const typed = useRef({ text: "", at: 0 });

  const selectedIndex = useMemo(() => options.findIndex((o) => o.value === value), [options, value]);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined;
  const bad = invalid ?? field?.invalid ?? false;

  const enabled = useCallback((index: number) => !!options[index] && !options[index]?.disabled, [options]);

  const step = useCallback(
    (from: number, delta: number): number => {
      if (options.length === 0) return -1;
      let i = from;
      for (let n = 0; n < options.length; n++) {
        i = Math.min(options.length - 1, Math.max(0, i + delta));
        if (enabled(i)) return i;
        if ((delta > 0 && i === options.length - 1) || (delta < 0 && i === 0)) break;
      }
      return enabled(from) ? from : -1;
    },
    [options.length, enabled],
  );
  const first = useCallback(() => step(-1, 1), [step]);
  const last = useCallback(() => step(options.length, -1), [step, options.length]);

  const openList = useCallback(
    (at?: number) => {
      if (disabled) return;
      const el = trigger.current;
      setHost(el?.closest("dialog[open]") ?? document.body);
      setActive(at ?? (selectedIndex >= 0 ? selectedIndex : first()));
      setOpen(true);
    },
    [disabled, selectedIndex, first],
  );

  const close = useCallback((refocus = true) => {
    setOpen(false);
    setPlace(null);
    if (refocus) trigger.current?.focus();
  }, []);

  const choose = useCallback(
    (index: number, refocus = true) => {
      const option = options[index];
      if (option && !option.disabled && option.value !== value) onChange(option.value);
      close(refocus);
    },
    [options, value, onChange, close],
  );

  /* type-ahead: repeated presses of one letter cycle; a word typed quickly matches its start */
  const match = (key: string, from: number): number => {
    const now = Date.now();
    const t = typed.current;
    t.text = now - t.at > 600 ? key : t.text + key;
    t.at = now;
    const query = t.text.toLowerCase();
    const cycling = query.length > 1 && [...query].every((c) => c === query[0]);
    const needle = cycling ? query[0] as string : query;
    const start = cycling || query.length === 1 ? from + 1 : Math.max(from, 0);
    for (let n = 0; n < options.length; n++) {
      const i = (start + n) % options.length;
      const option = options[i];
      if (option && !option.disabled && startsAtWord(option.label.toLowerCase(), needle)) return i;
    }
    return -1;
  };

  /* position: measure the trigger and the list, then fit the list into the viewport */
  const position = useCallback(() => {
    const el = trigger.current;
    const ul = list.current;
    if (!el || !ul) return;
    const r = el.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    const natural = Math.min(ul.scrollHeight, MAX_LIST);
    const below = vh - r.bottom - GAP - EDGE;
    const aboveSpace = r.top - GAP - EDGE;
    const above = below < Math.min(natural, 160) && aboveSpace > below;
    const maxHeight = Math.max(96, Math.min(MAX_LIST, above ? aboveSpace : below));
    const width = Math.min(vw - EDGE * 2, Math.max(r.width, listMinWidth ?? 0));
    const left = Math.min(Math.max(EDGE, r.left), vw - EDGE - width);
    const height = Math.min(natural, maxHeight);
    const top = above ? r.top - GAP - height : r.bottom + GAP;
    setPlace({ top, left, width, maxHeight, above });
  }, [listMinWidth]);

  useLayoutEffect(() => {
    if (!open) return;
    const ul = list.current;
    if (ul && supportsPopover && !ul.matches(":popover-open")) {
      try {
        ul.showPopover();
      } catch {
        /* already shown or detached */
      }
    }
    position();
  }, [open, host, position]);

  useEffect(() => {
    if (!open) return;
    const onScroll = (event: Event) => {
      if (list.current && event.target instanceof Node && list.current.contains(event.target)) return;
      position();
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (trigger.current?.contains(target) || list.current?.contains(target)) return;
      close(false);
    };
    window.addEventListener("resize", position);
    window.addEventListener("scroll", onScroll, true);
    document.addEventListener("pointerdown", onPointer, true);
    return () => {
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", onScroll, true);
      document.removeEventListener("pointerdown", onPointer, true);
    };
  }, [open, position, close]);

  /* keep the active option in view */
  useEffect(() => {
    if (!open || active < 0) return;
    list.current?.querySelector<HTMLElement>(`#${CSS.escape(optionId(active))}`)?.scrollIntoView({ block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, active, place]);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    const { key, altKey } = event;
    if (!open) {
      if (key === "ArrowDown" || key === "ArrowUp" || key === "Enter" || key === " ") {
        event.preventDefault();
        openList();
      } else if (key === "Home") {
        event.preventDefault();
        openList(first());
      } else if (key === "End") {
        event.preventDefault();
        openList(last());
      } else if (key.length === 1 && !event.ctrlKey && !event.metaKey && !altKey) {
        const hit = match(key, selectedIndex);
        if (hit >= 0 && options[hit]) onChange(options[hit].value);
      }
      return;
    }
    switch (key) {
      case "ArrowDown":
        event.preventDefault();
        if (altKey) break;
        setActive((i) => step(i, 1));
        break;
      case "ArrowUp":
        event.preventDefault();
        if (altKey) choose(active);
        else setActive((i) => step(i, -1));
        break;
      case "Home":
        event.preventDefault();
        setActive(first());
        break;
      case "End":
        event.preventDefault();
        setActive(last());
        break;
      case "PageDown":
        event.preventDefault();
        setActive((i) => step(Math.min(options.length - 1, i + 9), 1));
        break;
      case "PageUp":
        event.preventDefault();
        setActive((i) => step(Math.max(0, i - 9), -1));
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        choose(active);
        break;
      case "Escape":
        event.preventDefault();
        event.stopPropagation(); // never also close a dialog the select sits in
        close();
        break;
      case "Tab":
        if (active >= 0) choose(active, false);
        else close(false);
        break;
      default:
        if (key.length === 1 && !event.ctrlKey && !event.metaKey && !altKey) {
          const hit = match(key, active);
          if (hit >= 0) setActive(hit);
        }
    }
  };

  const listStyle: CSSProperties = place
    ? { top: place.top, left: place.left, right: "auto", bottom: "auto", width: place.width, maxHeight: place.maxHeight }
    : { top: -9999, left: -9999, right: "auto", bottom: "auto", visibility: "hidden" };

  const rows = density === "compact" ? "min-h-8 py-1.5 text-13 pointer-coarse:min-h-11" : "min-h-11 py-2.5 text-15";

  const listbox =
    open && host
      ? createPortal(
          <ul
            ref={list}
            id={listId}
            role="listbox"
            tabIndex={-1}
            aria-labelledby={aria["aria-labelledby"] ?? field?.labelId}
            aria-label={aria["aria-labelledby"] ?? field?.labelId ? undefined : aria["aria-label"]}
            {...(supportsPopover ? { popover: "manual" as const } : {})}
            style={listStyle}
            onMouseDown={(event) => event.preventDefault() /* keep focus on the trigger */}
            className={cn(
              "fixed z-50 m-0 overflow-y-auto overscroll-contain border border-foreground/20 bg-popover p-0 py-1 text-popover-foreground",
              "fade-in [scrollbar-width:thin]",
            )}
          >
            {options.length === 0 ? (
              <li role="presentation" className="px-3 py-2 text-12 text-muted-foreground">
                Nothing to choose from yet.
              </li>
            ) : null}
            {options.map((option, index) => {
              const isSelected = index === selectedIndex;
              const isActive = index === active;
              return (
                <li
                  key={option.value}
                  id={optionId(index)}
                  role="option"
                  aria-selected={isSelected}
                  aria-disabled={option.disabled || undefined}
                  data-active={isActive || undefined}
                  onPointerMove={() => !option.disabled && active !== index && setActive(index)}
                  onClick={() => !option.disabled && choose(index)}
                  className={cn(
                    "relative flex cursor-pointer items-center gap-3 px-3 select-none",
                    rows,
                    "before:absolute before:inset-y-1.5 before:left-0 before:w-0.5",
                    isSelected ? "before:bg-brand" : "before:bg-transparent",
                    isActive && "bg-muted/70",
                    option.disabled && "cursor-not-allowed opacity-40",
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className={cn("block truncate", isSelected && "text-foreground")}>{option.label}</span>
                    {option.description ? (
                      <span className="block truncate text-12 text-muted-foreground">{option.description}</span>
                    ) : null}
                  </span>
                  {option.meta ? <span className="shrink-0 text-12 text-muted-foreground">{option.meta}</span> : null}
                  <svg
                    viewBox="0 0 16 16"
                    aria-hidden="true"
                    className={cn("size-3.5 shrink-0 text-brand", isSelected ? "opacity-100" : "opacity-0")}
                  >
                    <path d="M3 8.5 6.5 12 13 4.5" fill="none" stroke="currentColor" strokeWidth="1.75" />
                  </svg>
                </li>
              );
            })}
          </ul>,
          host,
        )
      : null;

  return (
    <>
      <button
        ref={trigger}
        id={triggerId}
        type="button"
        role="combobox"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
        aria-labelledby={aria["aria-labelledby"] ?? (field ? `${field.labelId} ${triggerId}` : undefined)}
        aria-label={aria["aria-label"]}
        aria-describedby={aria["aria-describedby"] ?? field?.describedBy}
        aria-invalid={bad || undefined}
        aria-required={field?.required || undefined}
        onClick={() => (open ? close() : openList())}
        onKeyDown={onKeyDown}
        className={controlClass(density, bad, cn("flex items-center justify-between gap-2 text-left", className))}
      >
        <span className={cn("min-w-0 flex-1 truncate", !selected && "text-muted-foreground")}>
          {selected ? (renderValue ? renderValue(selected) : selected.label) : placeholder}
        </span>
        <svg
          viewBox="0 0 16 16"
          aria-hidden="true"
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition-transform duration-120 ease-standard motion-reduce:transition-none",
            open && "rotate-180",
          )}
        >
          <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </button>
      {name ? <input type="hidden" name={name} value={value ?? ""} /> : null}
      {listbox}
    </>
  );
}
