/**
 * The floors of a new venue (D2b): an ordered, editable list. Add, rename, remove and reorder
 * with buttons, so it works from the keyboard and on touch; focus follows the floor that moved
 * and lands somewhere sensible after a removal. At least one floor always remains.
 */
import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { TextInput, buttonClass, cn } from "@synan/ui/components";

export interface FloorItem {
  id: string;
  name: string;
}

export function newFloor(name = ""): FloorItem {
  return { id: crypto.randomUUID(), name };
}

/** Square icon button used in lists: 28px on a mouse, 44px under a coarse pointer. */
export const iconButtonClass =
  "pressable inline-grid size-7 shrink-0 place-items-center text-muted-foreground hover:bg-surface-2 hover:text-foreground disabled:pointer-events-none disabled:opacity-30 motion-reduce:transition-none pointer-coarse:size-11";

type FocusTarget = { id: string; part: "input" | "up" | "down" | "remove" } | { id: null; part: "add" };

export function FloorsField({
  floors,
  onChange,
  errors,
  listError,
}: {
  floors: FloorItem[];
  onChange: (floors: FloorItem[]) => void;
  /** Per-floor messages keyed by floor id. */
  errors: Record<string, string>;
  /** A message about the list as a whole (none, duplicates). */
  listError?: string;
}) {
  const refs = useRef(new Map<string, HTMLElement | null>());
  const [focus, setFocus] = useState<FocusTarget | null>(null);
  const [said, setSaid] = useState("");

  useEffect(() => {
    if (!focus) return;
    const key = focus.id === null ? "add" : `${focus.id}:${focus.part}`;
    const el = refs.current.get(key);
    el?.focus();
    setFocus(null);
  }, [focus]);

  const ref = (key: string) => (el: HTMLElement | null) => {
    refs.current.set(key, el);
  };

  const move = (index: number, by: -1 | 1) => {
    const target = index + by;
    if (target < 0 || target >= floors.length) return;
    const next = [...floors];
    const [item] = next.splice(index, 1);
    if (!item) return;
    next.splice(target, 0, item);
    onChange(next);
    // Keep focus on the same control unless it just became disabled at an end of the list.
    const atEdge = (by === -1 && target === 0) || (by === 1 && target === next.length - 1);
    setFocus({ id: item.id, part: atEdge ? (by === -1 ? "down" : "up") : by === -1 ? "up" : "down" });
    setSaid(`${item.name || "Floor"} moved to position ${target + 1} of ${next.length}.`);
  };

  const remove = (index: number) => {
    const item = floors[index];
    if (!item || floors.length <= 1) return;
    const next = floors.filter((_, i) => i !== index);
    onChange(next);
    const neighbour = next[Math.max(0, index - 1)];
    setFocus(neighbour ? { id: neighbour.id, part: "input" } : { id: null, part: "add" });
    setSaid(`${item.name || "Floor"} removed.`);
  };

  const add = () => {
    const item = newFloor();
    onChange([...floors, item]);
    setFocus({ id: item.id, part: "input" });
  };

  return (
    <fieldset className="min-w-0" aria-describedby={listError ? "floors-error" : "floors-hint"}>
      <legend className="mb-1.5 text-12 font-medium text-muted-foreground">Floors</legend>
      <ol className="">
        {floors.map((floor, index) => {
          const error = errors[floor.id];
          const label = `Floor ${index + 1} name`;
          return (
            <li key={floor.id} className="py-1.5">
              <div className="flex items-center gap-2">
                <span aria-hidden="true" className="w-5 shrink-0 text-right font-mono text-12 text-muted-foreground tabular-nums">
                  {index + 1}
                </span>
                <TextInput
                  ref={ref(`${floor.id}:input`)}
                  aria-label={label}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? `floor-${floor.id}-error` : undefined}
                  invalid={Boolean(error)}
                  value={floor.name}
                  maxLength={50}
                  placeholder={index === 0 ? "Ground" : `Level ${index}`}
                  onChange={(event) => onChange(floors.map((f) => (f.id === floor.id ? { ...f, name: event.target.value } : f)))}
                />
                <div className="flex shrink-0 items-center">
                  <button
                    type="button"
                    ref={ref(`${floor.id}:up`)}
                    className={cn(iconButtonClass, "size-8")}
                    aria-label={`Move ${floor.name || `floor ${index + 1}`} up`}
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                  >
                    <ArrowUp size={14} strokeWidth={1.5} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    ref={ref(`${floor.id}:down`)}
                    className={cn(iconButtonClass, "size-8")}
                    aria-label={`Move ${floor.name || `floor ${index + 1}`} down`}
                    disabled={index === floors.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    <ArrowDown size={14} strokeWidth={1.5} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    ref={ref(`${floor.id}:remove`)}
                    className={cn(iconButtonClass, "size-8 hover:text-destructive")}
                    aria-label={`Remove ${floor.name || `floor ${index + 1}`}`}
                    disabled={floors.length <= 1}
                    title={floors.length <= 1 ? "A venue needs at least one floor" : undefined}
                    onClick={() => remove(index)}
                  >
                    <X size={14} strokeWidth={1.5} aria-hidden="true" />
                  </button>
                </div>
              </div>
              {error ? (
                <p id={`floor-${floor.id}-error`} className="mt-1 ml-7 text-12 text-destructive">
                  {error}
                </p>
              ) : null}
            </li>
          );
        })}
      </ol>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <button type="button" ref={ref("add")} onClick={add} className={buttonClass("quiet", "compact", "-ml-3")}>
          <Plus size={14} strokeWidth={1.5} aria-hidden="true" />
          Add floor
        </button>
      </div>
      {listError ? (
        <p id="floors-error" className="mt-1 text-12 text-destructive">
          {listError}
        </p>
      ) : (
        <p id="floors-hint" className="mt-1 text-12 text-muted-foreground">
          In order from the bottom up, as people would say them. Zones are drawn per floor.
        </p>
      )}
      <span role="status" aria-live="polite" className="sr-only">
        {said}
      </span>
    </fieldset>
  );
}
