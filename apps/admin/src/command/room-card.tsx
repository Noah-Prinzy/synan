/**
 * RoomCard — what hovering (or focusing) a room on the map reveals: its numbers
 * against its own thresholds, the last minute's change, its door, and the two
 * actions: Recount (D-10, audited) and Open room (drill in).
 */
import { CapacityMeter, StatusDot, formatNumber } from "@synan/ui/data";
import { useCommand } from "../live/context";
import { useSlice } from "../live/slice";
import { levelState, levelWords } from "./ui-state";
import type { PlacedRoom } from "./zone-map";

export function minuteChange(samples: readonly number[] | undefined, current: number): number | null {
  // Samples are 5 s apart; 12 back is a minute.
  if (!samples || samples.length < 2) return null;
  const back = samples[Math.max(0, samples.length - 13)] as number;
  return current - back;
}

export function RoomCard({
  placed,
  onOpen,
  onRecount,
}: {
  placed: PlacedRoom;
  onOpen: () => void;
  onRecount: () => void;
}) {
  const { store } = useCommand();
  const rooms = useSlice(store.rooms);
  const history = useSlice(store.history);
  const gates = useSlice(store.gates);
  const layout = useSlice(store.layout);
  const { room, zone } = placed;
  const live = rooms.get(room.id);
  if (!live) return null;
  const change = minuteChange(history.get(room.id), live.occupancy);
  const doors = layout?.checkpoints.filter((c) => c.room_id === room.id) ?? [];
  const door = doors[0] ? gates.get(doors[0].id) : undefined;

  return (
    <div role="group" aria-label={`${room.name} details`} className="border border-foreground/25 bg-popover">
      <div className="flex items-start justify-between gap-3 border-b border-border px-3 pt-2.5 pb-2">
        <div className="min-w-0">
          <p className="truncate text-13 font-medium">{room.name}</p>
          <p className="truncate text-11 text-muted-foreground">
            {zone ? `${zone.floor} · ${zone.name}` : ""}
            {room.continuous ? " · continuous" : ""}
          </p>
        </div>
        <StatusDot
          state={levelState(live.level)}
          label={levelWords(live.level, room.warn_at_pct, room.block_at_pct)}
          className="pt-1"
        />
      </div>
      <div className="px-3 pt-2.5 pb-1">
        <CapacityMeter
          occupancy={live.occupancy}
          capacity={room.capacity}
          warnAtPct={room.warn_at_pct}
          blockAtPct={room.block_at_pct}
          level={live.level}
        />
      </div>
      <dl className="grid grid-cols-2 border-t border-border text-12">
        <div className="border-r border-border px-3 py-2">
          <dt className="text-11 text-muted-foreground">Last minute</dt>
          <dd className="font-mono tabular-nums">{change === null ? "—" : formatNumber(change, { signed: true })}</dd>
        </div>
        <div className="px-3 py-2">
          <dt className="text-11 text-muted-foreground">Door</dt>
          <dd className="truncate font-mono tabular-nums">
            {door ? (
              door.link_state === "online" ? (
                `online · ${door.scans_last_minute}/min`
              ) : (
                <span className={door.link_state === "offline" ? "text-destructive" : "text-warning"}>{door.link_state}</span>
              )
            ) : (
              "—"
            )}
          </dd>
        </div>
      </dl>
      <div className="grid grid-cols-2 border-t border-border">
        <button
          type="button"
          onClick={onRecount}
          className="border-r border-border px-3 py-2 text-left text-12 font-medium transition-colors duration-120 ease-standard hover:bg-foreground/5 motion-reduce:transition-none"
        >
          Recount
        </button>
        <button
          type="button"
          onClick={onOpen}
          className="px-3 py-2 text-left text-12 text-muted-foreground transition-colors duration-120 ease-standard hover:bg-foreground/5 hover:text-foreground motion-reduce:transition-none"
        >
          Open room →
        </button>
      </div>
    </div>
  );
}
