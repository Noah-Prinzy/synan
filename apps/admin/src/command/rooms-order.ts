/**
 * The rooms list's order (moved here unchanged from rail.tsx so it can be tested without the
 * rail): fullest first, by share of capacity; ties, and rooms with no count, by name.
 */
import type { Room } from "@synan/contracts/rest";
import type { RoomLive } from "../live/store";

function utilisation(room: Room, live: RoomLive | undefined): number {
  return live && room.capacity > 0 ? live.occupancy / room.capacity : 0;
}

export function sortRooms(rooms: readonly Room[], live: ReadonlyMap<string, RoomLive>): string[] {
  return [...rooms]
    .sort((a, b) => utilisation(b, live.get(b.id)) - utilisation(a, live.get(a.id)) || a.name.localeCompare(b.name))
    .map((room) => room.id);
}
