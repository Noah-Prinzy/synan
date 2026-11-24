/**
 * The workspace's one loaded event, shared with every tab so a tab never fetches it again.
 * The layout (D6) loads the event and its venue; tabs read them through `useWorkspaceEvent()`.
 */
import { createContext, useContext, type ReactNode } from "react";
import type { Room } from "@synan/contracts/rest";
import type { EventRecord, VenueDetail } from "@synan/mock/command";
import type { Resource } from "../../kit";
import { Notice } from "../../kit";

export interface WorkspaceValue {
  event: EventRecord;
  /** Fetch the event again; `quiet` keeps what is shown while it loads. */
  reload: (quiet?: boolean) => void;
  /** Put a record the server just returned in place, without a round trip. */
  replace: (record: EventRecord) => void;
  /** The event's venue (null when the event has none yet). */
  venue: Resource<VenueDetail | null> & { reload: (quiet?: boolean) => void };
  /** Closed and archived events are kept as a record: nothing in them changes. */
  readOnly: boolean;
  /**
   * Whether a tab may show a filled primary action. A draft's header already carries one
   * (Continue setup), and a screen has one filled primary at most (docs/05 §9.2).
   */
  tabPrimary: boolean;
}

const WorkspaceContext = createContext<WorkspaceValue | null>(null);

export function WorkspaceProvider({ value, children }: { value: WorkspaceValue; children: ReactNode }) {
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspaceEvent(): WorkspaceValue {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("useWorkspaceEvent outside the event workspace");
  return value;
}

/** The venue's rooms this event uses, with the event's capacity override applied. */
export interface EventRoom extends Room {
  /** The venue's own capacity, before any override. */
  venue_capacity: number;
  capacity_override: number | null;
}

export function eventRooms(event: EventRecord, venue: VenueDetail | null): EventRoom[] {
  if (!venue) return [];
  const picked = new Map(event.rooms.map((r) => [r.room_id, r.capacity_override]));
  return venue.rooms
    .filter((room) => picked.has(room.id))
    .map((room) => {
      const override = picked.get(room.id) ?? null;
      return { ...room, venue_capacity: room.capacity, capacity_override: override, capacity: override ?? room.capacity };
    });
}

/** One line saying why nothing here can change, for closed and archived events. */
export function ReadOnlyNote({ event, what }: { event: EventRecord; what: string }) {
  const word = event.state === "archived" ? "archived" : "closed";
  return (
    <Notice className="mx-4 mt-4 sm:mx-6 2xl:mx-8">
      This event is {word}, so {what} can no longer be changed. It is kept as the record of what happened.
    </Notice>
  );
}
