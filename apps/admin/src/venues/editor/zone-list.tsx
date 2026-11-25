/**
 * D3's left column: zones grouped by floor, each with its rooms beneath it. The list is the
 * keyboard and screen-reader way into the layout: every zone and room is a button that selects
 * it. In edit mode the selected zone shows its tools (rename inline, move up or down — across
 * floors at the ends — and delete), floors can be renamed, added and removed when empty.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from "lucide-react";
import { TextInput, buttonClass, cn } from "@synan/ui/components";
import { formatNumber } from "@synan/ui/data";
import { iconButtonClass } from "../floors-field";
import { orderZones, type Layout, type Selection } from "./model";

export interface ZoneListCommands {
  onSelect: (selection: Selection) => void;
  onAddZone: () => void;
  onRenameZone: (id: string, name: string) => void;
  onMoveZone: (id: string, by: -1 | 1) => void;
  onDeleteZone: (id: string) => void;
  onAddFloor: () => string;
  onRenameFloor: (id: string, name: string) => void;
  onRemoveFloor: (id: string) => void;
}

export function ZoneList({
  layout,
  selection,
  editing,
  invalid,
  marks,
  commands,
}: {
  layout: Layout;
  selection: Selection;
  editing: boolean;
  invalid: Set<string>;
  marks: Map<string, "new" | "changed">;
  commands: ZoneListCommands;
}) {
  const [renaming, setRenaming] = useState<{ kind: "zone" | "floor"; id: string } | null>(null);
  const zones = orderZones(layout.floors, layout.zones);
  const selectedZoneId =
    selection?.kind === "zone" ? selection.id : selection?.kind === "room" ? layout.rooms.find((r) => r.id === selection.id)?.zoneId : null;

  // Leaving edit mode closes any open rename.
  useEffect(() => {
    if (!editing) setRenaming(null);
  }, [editing]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex min-h-8 items-center justify-between gap-2 px-4">
        <h2 className="py-1.5 text-12 font-medium">
          Zones <span className="font-mono text-11 font-normal text-muted-foreground tabular-nums">{layout.zones.length}</span>
        </h2>
        {editing ? (
          <button type="button" onClick={commands.onAddZone} className={buttonClass("quiet", "compact", "-mr-3 h-7 px-2")}>
            <Plus size={14} strokeWidth={1.5} aria-hidden="true" />
            Add zone
          </button>
        ) : null}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {layout.floors.map((floor) => {
          const onFloor = zones.filter((z) => z.floorId === floor.id);
          const headId = `floor-head-${floor.id}`;
          return (
            <section key={floor.id} aria-labelledby={headId} className=" ">
              <div className="flex min-h-8 items-center justify-between gap-1 pr-2 pl-4">
                {renaming?.kind === "floor" && renaming.id === floor.id ? (
                  <InlineName
                    label="Floor name"
                    initial={floor.name}
                    onDone={(name) => {
                      if (name !== null) commands.onRenameFloor(floor.id, name);
                      setRenaming(null);
                    }}
                  />
                ) : (
                  <h3 id={headId} className="truncate py-1.5 text-11 text-muted-foreground">
                    {floor.name.trim() || "Unnamed floor"}
                  </h3>
                )}
                {editing && renaming?.id !== floor.id ? (
                  <span className="flex shrink-0 items-center">
                    <button
                      type="button"
                      className={iconButtonClass}
                      aria-label={`Rename floor ${floor.name}`}
                      onClick={() => setRenaming({ kind: "floor", id: floor.id })}
                    >
                      <Pencil size={13} strokeWidth={1.5} aria-hidden="true" />
                    </button>
                    {onFloor.length === 0 && layout.floors.length > 1 ? (
                      <button
                        type="button"
                        className={cn(iconButtonClass, "hover:text-destructive")}
                        aria-label={`Remove floor ${floor.name}`}
                        onClick={() => commands.onRemoveFloor(floor.id)}
                      >
                        <Trash2 size={13} strokeWidth={1.5} aria-hidden="true" />
                      </button>
                    ) : null}
                  </span>
                ) : null}
              </div>
              {invalid.has(floor.id) ? <p className="px-4 pb-1.5 text-12 text-destructive">Name this floor; each needs its own name.</p> : null}

              {onFloor.length === 0 ? (
                <p className="px-4 pb-2.5 text-12 text-muted-foreground">No zones on this floor{editing ? " yet." : "."}</p>
              ) : (
                <ul className="pb-1.5">
                  {onFloor.map((zone) => {
                    const index = zones.indexOf(zone);
                    const rooms = layout.rooms.filter((r) => r.zoneId === zone.id);
                    const zoneSelected = selection?.kind === "zone" && selection.id === zone.id;
                    const open = selectedZoneId === zone.id;
                    return (
                      <li key={zone.id}>
                        {renaming?.kind === "zone" && renaming.id === zone.id ? (
                          <div className="px-2 py-1">
                            <InlineName
                              label="Zone name"
                              initial={zone.name}
                              onDone={(name) => {
                                if (name !== null) commands.onRenameZone(zone.id, name);
                                setRenaming(null);
                              }}
                            />
                          </div>
                        ) : (
                          <Row
                            selected={zoneSelected}
                            invalid={invalid.has(zone.id)}
                            mark={marks.get(zone.id)}
                            onClick={() => commands.onSelect({ kind: "zone", id: zone.id })}
                            label={zone.name.trim() || "Unnamed zone"}
                            meta={`${rooms.length} ${rooms.length === 1 ? "room" : "rooms"}`}
                            strong
                          />
                        )}

                        {editing && zoneSelected && renaming?.id !== zone.id ? (
                          <div role="group" aria-label={`${zone.name} tools`} className="flex items-center gap-0.5 pr-2 pb-1 pl-6">
                            <button type="button" className={iconButtonClass} aria-label={`Rename ${zone.name}`} onClick={() => setRenaming({ kind: "zone", id: zone.id })}>
                              <Pencil size={13} strokeWidth={1.5} aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              className={iconButtonClass}
                              aria-label={`Move ${zone.name} up`}
                              disabled={index === 0 && layout.floors[0]?.id === zone.floorId}
                              onClick={() => commands.onMoveZone(zone.id, -1)}
                            >
                              <ArrowUp size={14} strokeWidth={1.5} aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              className={iconButtonClass}
                              aria-label={`Move ${zone.name} down`}
                              disabled={index === zones.length - 1 && layout.floors[layout.floors.length - 1]?.id === zone.floorId}
                              onClick={() => commands.onMoveZone(zone.id, 1)}
                            >
                              <ArrowDown size={14} strokeWidth={1.5} aria-hidden="true" />
                            </button>
                            <span className="flex-1" />
                            <button
                              type="button"
                              className={cn(iconButtonClass, "hover:text-destructive")}
                              aria-label={`Delete ${zone.name}`}
                              onClick={() => commands.onDeleteZone(zone.id)}
                            >
                              <Trash2 size={13} strokeWidth={1.5} aria-hidden="true" />
                            </button>
                          </div>
                        ) : null}

                        {open && rooms.length > 0 ? (
                          <ul aria-label={`Rooms in ${zone.name}`}>
                            {rooms.map((room) => (
                              <li key={room.id}>
                                <Row
                                  indent
                                  selected={selection?.kind === "room" && selection.id === room.id}
                                  invalid={invalid.has(room.id)}
                                  mark={marks.get(room.id)}
                                  onClick={() => commands.onSelect({ kind: "room", id: room.id })}
                                  label={room.name.trim() || "Unnamed room"}
                                  meta={/^\d+$/.test(room.capacity.trim()) ? formatNumber(Number(room.capacity)) : "—"}
                                  metaMono
                                />
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })}
        {editing ? (
          <div className="px-4 py-2">
            <AddFloor onAdd={commands.onAddFloor} onRename={(id) => setRenaming({ kind: "floor", id })} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function AddFloor({ onAdd, onRename }: { onAdd: () => string; onRename: (id: string) => void }) {
  return (
    <button type="button" onClick={() => onRename(onAdd())} className={buttonClass("quiet", "compact", "-ml-3 h-7 px-3")}>
      <Plus size={14} strokeWidth={1.5} aria-hidden="true" />
      Add floor
    </button>
  );
}

function Row({
  label,
  meta,
  metaMono,
  selected,
  invalid,
  mark,
  indent,
  strong,
  onClick,
}: {
  label: string;
  meta: ReactNode;
  metaMono?: boolean;
  selected: boolean;
  invalid: boolean;
  mark?: "new" | "changed";
  indent?: boolean;
  strong?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-current={selected ? "true" : undefined}
      onClick={onClick}
      className={cn(
        "relative grid h-8 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 pr-4 text-left text-13 transition-colors duration-120 ease-standard motion-reduce:transition-none pointer-coarse:h-11",
        indent ? "pl-8" : "pl-4",
        "before:absolute before:inset-y-1.5 before:left-0 before:w-0.5",
        selected ? "bg-surface-2 before:bg-brand" : "hover:bg-surface-2 before:bg-transparent",
      )}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <span className={cn("truncate", strong ? "text-foreground" : selected ? "text-foreground" : "text-foreground/80", invalid && "text-destructive")}>
          {label}
        </span>
        {invalid ? <span className="sr-only">, needs fixing</span> : null}
        {mark ? <span className="shrink-0 text-11 text-muted-foreground">{mark === "new" ? "New" : "Edited"}</span> : null}
      </span>
      <span className={cn("text-11 text-muted-foreground", metaMono && "font-mono tabular-nums")}>{meta}</span>
    </button>
  );
}

/** Rename in place: Enter or leaving the field keeps it, Escape puts it back. Empty is refused. */
function InlineName({ label, initial, onDone }: { label: string; initial: string; onDone: (name: string | null) => void }) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const done = useRef(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  const commit = () => {
    if (done.current) return;
    if (!value.trim()) {
      setError("A name is needed. Escape keeps the old one.");
      input.current?.focus();
      return;
    }
    done.current = true;
    onDone(value.trim());
  };

  return (
    <div className="min-w-0 flex-1">
      <TextInput
        ref={input}
        aria-label={label}
        value={value}
        maxLength={label === "Floor name" ? 50 : 200}
        invalid={Boolean(error)}
        aria-describedby={error ? "inline-name-error" : undefined}
        onChange={(event) => {
          setValue(event.target.value);
          setError(null);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          } else if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            done.current = true;
            onDone(null);
          }
        }}
        onBlur={() => {
          if (!done.current && value.trim()) commit();
          else if (!done.current) {
            done.current = true;
            onDone(null);
          }
        }}
        className="h-7"
      />
      {error ? (
        <p id="inline-name-error" className="mt-1 text-12 text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
