/**
 * D3's right sheet: what is selected, in words and numbers. A room shows its name, zone,
 * capacity, the warn and stop thresholds (with the head count each one means), whether it is
 * continuous, and what gates do at the stop threshold. A zone shows its name, floor, size and
 * rooms. With nothing selected, the venue's own facts.
 *
 * Read-only until Edit layout is on; then the same facts become fields, checked as you type.
 */
import type { ReactNode } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { CapacityPolicy } from "@synan/contracts/enums";
import { Button, Checkbox, Field, Select, TextInput } from "@synan/ui/components";
import { formatNumber } from "@synan/ui/data";
import type { VenueDetail } from "@synan/mock/command";
import { KeyValues } from "../../kit";
import { describeRect } from "./canvas";
import { POLICY_LABEL, orderZones, roundRect, type DraftRoom, type DraftZone, type Layout, type Selection } from "./model";

const POLICY_OPTIONS: { value: CapacityPolicy; label: string; description: string }[] = [
  { value: "block", label: POLICY_LABEL.block, description: "Gates refuse entry once the room reaches its stop point." },
  { value: "admit_with_alert", label: POLICY_LABEL.admit_with_alert, description: "Gates still admit, and the Command Center raises an alert." },
];

export interface InspectorCommands {
  onRoom: (id: string, patch: Partial<DraftRoom>) => void;
  onRoomZone: (id: string, zoneId: string) => void;
  onZone: (id: string, patch: Partial<DraftZone>) => void;
  onAddRoom: (zoneId: string) => void;
  onDelete: (selection: NonNullable<Selection>) => void;
  onSelect: (selection: Selection) => void;
}

const digits = (value: string) => value.replace(/[^\d]/g, "").slice(0, 6);
const whole = (value: string): number | null => (/^\d+$/.test(value.trim()) ? Number(value) : null);

function headcount(capacity: string, pct: string): string | null {
  const c = whole(capacity);
  const p = whole(pct);
  if (c === null || p === null || c < 1) return null;
  const n = Math.floor((c * p) / 100);
  return `${formatNumber(n)} ${n === 1 ? "person" : "people"}`;
}

export function Inspector({
  layout,
  detail,
  selection,
  editing,
  errors,
  commands,
}: {
  layout: Layout;
  detail: VenueDetail;
  selection: Selection;
  editing: boolean;
  /** Messages for the selected item, by field. */
  errors: Record<string, string>;
  commands: InspectorCommands;
}) {
  const room = selection?.kind === "room" ? layout.rooms.find((r) => r.id === selection.id) : undefined;
  const zone = selection?.kind === "zone" ? layout.zones.find((z) => z.id === selection.id) : undefined;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex min-h-8 items-center justify-between gap-2 px-4">
        <h2 className="truncate py-1.5 text-12 font-medium">{room ? "Room" : zone ? "Zone" : "Venue"}</h2>
        {room || zone ? (
          <button type="button" onClick={() => commands.onSelect(null)} className="text-11 text-muted-foreground hover:text-foreground">
            Clear selection
          </button>
        ) : null}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {room ? (
          <RoomSheet key={room.id} room={room} layout={layout} editing={editing} errors={errors} commands={commands} />
        ) : zone ? (
          <ZoneSheet key={zone.id} zone={zone} layout={layout} editing={editing} errors={errors} commands={commands} />
        ) : (
          <VenueFacts layout={layout} detail={detail} editing={editing} />
        )}
      </div>
    </div>
  );
}

function Title({ children, meta }: { children: ReactNode; meta?: ReactNode }) {
  return (
    <div className="px-4 pt-3 pb-2">
      <p className="truncate font-display text-17 leading-snug">{children}</p>
      {meta ? <p className="mt-0.5 text-12 text-muted-foreground">{meta}</p> : null}
    </div>
  );
}

function RoomSheet({
  room,
  layout,
  editing,
  errors,
  commands,
}: {
  room: DraftRoom;
  layout: Layout;
  editing: boolean;
  errors: Record<string, string>;
  commands: InspectorCommands;
}) {
  const zone = layout.zones.find((z) => z.id === room.zoneId);
  const floor = layout.floors.find((f) => f.id === zone?.floorId);
  const where = `${floor?.name ?? ""} · ${zone?.name ?? ""}`;
  const r = roundRect(room.rect);
  const set = (patch: Partial<DraftRoom>) => commands.onRoom(room.id, patch);
  const warnPeople = headcount(room.capacity, room.warn);
  const stopPeople = headcount(room.capacity, room.stop);

  if (!editing) {
    return (
      <>
        <Title meta={where}>{room.name.trim() || "Unnamed room"}</Title>
        <KeyValues
          className=""
          rows={[
            ["Capacity", <span className="font-mono tabular-nums">{whole(room.capacity) !== null ? formatNumber(Number(room.capacity)) : "—"}</span>],
            ["Warns at", <Pct pct={room.warn} people={warnPeople} />],
            ["Stops at", <Pct pct={room.stop} people={stopPeople} />],
            ["At the stop point", POLICY_LABEL[room.policy]],
            ["Continuous", room.continuous ? "Yes, not reset when a session ends" : "No"],
            ["On the grid", <span className="font-mono text-12 tabular-nums">{`${r.x}, ${r.y} · ${r.w} × ${r.h}`}</span>],
          ]}
        />
        {Object.keys(errors).length > 0 ? (
          <ul className="px-4 py-2.5 text-12 text-destructive">
            {Object.entries(errors).map(([field, message]) => (
              <li key={field}>{message}</li>
            ))}
          </ul>
        ) : null}
      </>
    );
  }

  const zoneOptions = orderZones(layout.floors, layout.zones).map((z) => ({
    value: z.id,
    label: z.name.trim() || "Unnamed zone",
    meta: layout.floors.find((f) => f.id === z.floorId)?.name,
  }));

  return (
    <div className="flex flex-col gap-4 px-4 pt-3 pb-5">
      <Field label="Name" id="room-name" error={errors.name}>
        <TextInput value={room.name} maxLength={200} onChange={(event) => set({ name: event.target.value })} />
      </Field>
      <Field label="Zone" id="room-zone" hint="Moving it to another zone places it in free space there.">
        <Select options={zoneOptions} value={room.zoneId} onChange={(zoneId) => zoneId !== room.zoneId && commands.onRoomZone(room.id, zoneId)} />
      </Field>
      <Field label="Capacity" id="room-capacity" error={errors.capacity} hint="The most people allowed inside at once.">
        <TextInput
          value={room.capacity}
          inputMode="numeric"
          suffix="people"
          className="font-mono tabular-nums"
          onChange={(event) => set({ capacity: digits(event.target.value) })}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Warn at" id="room-warn" error={errors.warn} hint={warnPeople ?? undefined}>
          <TextInput value={room.warn} inputMode="numeric" suffix="%" className="font-mono tabular-nums" onChange={(event) => set({ warn: digits(event.target.value) })} />
        </Field>
        <Field label="Stop at" id="room-stop" error={errors.stop} hint={stopPeople ?? undefined}>
          <TextInput value={room.stop} inputMode="numeric" suffix="%" className="font-mono tabular-nums" onChange={(event) => set({ stop: digits(event.target.value) })} />
        </Field>
      </div>
      <Field label="At the stop point" id="room-policy">
        <Select options={POLICY_OPTIONS} value={room.policy} onChange={(policy) => set({ policy })} />
      </Field>
      <Checkbox
        label="Continuous"
        description="Not reset when a session ends: a café, a lounge, a foyer people stay in."
        checked={room.continuous}
        onChange={(event) => set({ continuous: event.target.checked })}
      />
      <p className="pt-3 text-12 text-muted-foreground">
        On the grid <span className="font-mono text-foreground/80 tabular-nums">{describeRect(room.rect)}</span>. Arrow keys on the canvas move it,
        Shift+arrows resize it.
      </p>
      <div>
        <Button size="compact" variant="danger" onClick={() => commands.onDelete({ kind: "room", id: room.id })}>
          <Trash2 size={14} strokeWidth={1.5} aria-hidden="true" />
          Delete room
        </Button>
      </div>
    </div>
  );
}

function Pct({ pct, people }: { pct: string; people: string | null }) {
  return (
    <span>
      <span className="font-mono tabular-nums">{pct || "—"}%</span>
      {people ? <span className="text-muted-foreground"> · {people}</span> : null}
    </span>
  );
}

function ZoneSheet({
  zone,
  layout,
  editing,
  errors,
  commands,
}: {
  zone: DraftZone;
  layout: Layout;
  editing: boolean;
  errors: Record<string, string>;
  commands: InspectorCommands;
}) {
  const rooms = layout.rooms.filter((r) => r.zoneId === zone.id);
  const capacity = rooms.reduce((sum, r) => sum + (whole(r.capacity) ?? 0), 0);
  const floor = layout.floors.find((f) => f.id === zone.floorId);
  const r = roundRect(zone.rect);
  const facts: [ReactNode, ReactNode][] = [
    ["Rooms", <span className="font-mono tabular-nums">{rooms.length}</span>],
    ["Capacity", <span className="font-mono tabular-nums">{capacity > 0 ? formatNumber(capacity) : "—"}</span>],
    ["On the grid", <span className="font-mono text-12 tabular-nums">{`${r.x}, ${r.y} · ${r.w} × ${r.h}`}</span>],
  ];

  if (!editing) {
    return (
      <>
        <Title meta={floor?.name}>{zone.name.trim() || "Unnamed zone"}</Title>
        <KeyValues className="" rows={facts} />
        <RoomLinks rooms={rooms} onSelect={commands.onSelect} />
      </>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-4 px-4 pt-3 pb-4">
        <Field label="Name" id="zone-name" error={errors.name}>
          <TextInput value={zone.name} maxLength={200} onChange={(event) => commands.onZone(zone.id, { name: event.target.value })} />
        </Field>
        <Field label="Floor" id="zone-floor">
          <Select
            options={layout.floors.map((f) => ({ value: f.id, label: f.name.trim() || "Unnamed floor" }))}
            value={zone.floorId}
            onChange={(floorId) => commands.onZone(zone.id, { floorId })}
          />
        </Field>
      </div>
      <KeyValues className="" rows={facts} />
      <RoomLinks rooms={rooms} onSelect={commands.onSelect} />
      <div className="flex flex-wrap gap-2 px-4 py-3">
        <Button size="compact" variant="secondary" onClick={() => commands.onAddRoom(zone.id)}>
          <Plus size={14} strokeWidth={1.5} aria-hidden="true" />
          Add room
        </Button>
        <Button size="compact" variant="danger" onClick={() => commands.onDelete({ kind: "zone", id: zone.id })}>
          <Trash2 size={14} strokeWidth={1.5} aria-hidden="true" />
          Delete zone
        </Button>
      </div>
      <p className="px-4 pb-4 text-12 text-muted-foreground">
        Drag inside the zone to draw a room, or use Add room. Drag the zone by its label to move it with its rooms.
      </p>
    </>
  );
}

function RoomLinks({ rooms, onSelect }: { rooms: DraftRoom[]; onSelect: (selection: Selection) => void }) {
  if (rooms.length === 0) return <p className="px-4 py-2.5 text-12 text-muted-foreground">No rooms drawn in this zone yet.</p>;
  return (
    <ul className="py-1">
      {rooms.map((room) => (
        <li key={room.id}>
          <button
            type="button"
            onClick={() => onSelect({ kind: "room", id: room.id })}
            className="grid h-7 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-4 text-left text-13 hover:bg-surface-2 pointer-coarse:h-11"
          >
            <span className="truncate">{room.name.trim() || "Unnamed room"}</span>
            <span className="font-mono text-11 text-muted-foreground tabular-nums">{whole(room.capacity) !== null ? formatNumber(Number(room.capacity)) : "—"}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function VenueFacts({ layout, detail, editing }: { layout: Layout; detail: VenueDetail; editing: boolean }) {
  const capacity = layout.rooms.reduce((sum, r) => sum + (whole(r.capacity) ?? 0), 0);
  return (
    <>
      <Title meta={[detail.venue.city, detail.venue.timezone.replace(/_/g, " ")].filter(Boolean).join(" · ")}>{detail.venue.name}</Title>
      <KeyValues
        className=""
        rows={[
          ["Floors", layout.floors.map((f) => f.name).join(", ") || "—"],
          ["Zones", <span className="font-mono tabular-nums">{layout.zones.length}</span>],
          ["Rooms", <span className="font-mono tabular-nums">{layout.rooms.length}</span>],
          ["Capacity", <span className="font-mono tabular-nums">{capacity > 0 ? formatNumber(capacity) : "—"}</span>],
          [
            "New rooms start at",
            detail.capacity_default ? <span className="font-mono tabular-nums">{formatNumber(detail.capacity_default)}</span> : <span className="text-muted-foreground">No default</span>,
          ],
          ["Grid", <span className="font-mono text-12 tabular-nums">{`${detail.grid.w} × ${detail.grid.h} units`}</span>],
        ]}
      />
      <p className="px-4 py-3 text-12 text-muted-foreground">
        {editing
          ? "Select a zone or room to change it, or draw a new one on the grid."
          : "Select a zone or room, on the grid or in the list, to see its details."}
      </p>
    </>
  );
}
