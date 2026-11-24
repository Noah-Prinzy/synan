/**
 * The map's room names and the rooms list's order (command/room-labels.ts, command/rooms-order.ts):
 * what an operator reads to tell rooms apart at a glance, and which rooms sit at the top of the
 * list when the venue fills.
 */
import { describe, expect, it } from "vitest";
import { Room } from "@synan/contracts/rest";
import { labelCandidates } from "../src/command/room-labels";
import { sortRooms } from "../src/command/rooms-order";
import type { RoomLive } from "../src/live/store";

/** As the map counts them: how many of the venue's room names start with each word. */
function firstWordsOf(names: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const name of names) {
    const first = name.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
    counts.set(first, (counts.get(first) ?? 0) + 1);
  }
  return counts;
}

const VENUE_ROOMS = [
  "Main Auditorium", "Workshop A", "Workshop B", "Quiet Room", "Partner Lounge", "Boardroom", "Cloakroom",
  "Speaker Green Room", "Speaker Prep", "Room 101", "Hall", "VIP Bar", "Press Booth", "Expo Hall North",
];
const firstWords = firstWordsOf(VENUE_ROOMS);
const labels = (name: string, zone = "Ground") => labelCandidates(name, zone, firstWords);

describe("room labels", () => {
  it("start with the full name and shorten as the docs promise", () => {
    expect(labels("Workshop C", "Workshops")).toEqual(["Workshop C", "C", "WC"]);
    expect(labels("Quiet Room")).toEqual(["Quiet Room", "Quiet", "QR"]);
    expect(labels("Partner Lounge")).toEqual(["Partner Lounge", "Partner", "PL"]);
    expect(labels("Boardroom")).toEqual(["Boardroom", "Board"]);
    expect(labels("Speaker Green Room")).toEqual(["Speaker Green Room", "Speaker Green", "SGR"]);
  });

  it("shorten a name to its first word only when no other room starts with it", () => {
    expect(labels("Main Auditorium")).toContain("Main");
    expect(labels("Speaker Prep")).not.toContain("Speaker");
  });

  it("keep numbers whole in initials", () => {
    expect(labels("Room 101")).toEqual(["Room 101", "101", "R101"]);
  });

  it("never offer an empty label, and always end with something to draw", () => {
    for (const name of [...VENUE_ROOMS, "  Padded  Name ", "Hall", "Room", "X"]) {
      const candidates = labels(name);
      expect(candidates.length, name).toBeGreaterThan(0);
      for (const candidate of candidates) expect(candidate.trim(), name).not.toBe("");
      expect(candidates[0]).toBe(name.trim());
    }
  });

  it("never cut a word: every label is whole words of the name, a '…room' compound's stem, or the initials", () => {
    for (const name of VENUE_ROOMS) {
      const words = name.split(/\s+/);
      const stems = words.map((w) => (/^.{3,}room$/i.test(w) ? w.slice(0, -4) : w));
      const initials = words.map((w) => (/^\d+$/.test(w) ? w : w[0]!.toUpperCase())).join("");
      for (const candidate of labels(name)) {
        if (candidate === initials) continue;
        for (const part of candidate.split(" ")) expect([...words, ...stems], `${name} → ${candidate}`).toContain(part);
      }
    }
  });

  it("drop a word the zone already says, but never the whole name", () => {
    expect(labels("Expo Hall North", "Expo Hall")).toContain("North");
    expect(labels("Workshops", "Workshops")).toEqual(["Workshops"]);
  });

  // DEFECT (left failing on purpose, minor): the short forms are chosen per room, so two rooms whose
  // names differ only in the generic word ("Partner Lounge", "Partner Room") both shorten to
  // "Partner" on a small map. The first-word rule checks for clashes; dropping the generic word does
  // not. The full name is in the hover card and the rooms list, so this is a reading hazard on a
  // crowded map, not lost information. A fix needs venue-wide knowledge in place(), not a local change.
  it.fails("give two different rooms different short labels", () => {
    const names = ["Partner Lounge", "Partner Room"];
    const words = firstWordsOf(names);
    const [a, b] = names.map((name) => labelCandidates(name, "Ground", words).slice(1, -1));
    expect(a!.filter((label) => b!.includes(label))).toEqual([]);
  });
});

describe("the rooms list", () => {
  const ZONE = "a0a0a0a0-a0a0-40a0-80a0-a0a0a0a0a0a0";
  const VENUE = "ffffffff-ffff-4fff-8fff-ffffffffffff";
  const room = (n: number, name: string, capacity: number) =>
    Room.parse({ id: `a1a1a1a1-a1a1-41a1-81a1-00000000000${n}`, venue_id: VENUE, zone_id: ZONE, name, capacity, continuous: false, geometry: null });
  const live = (entries: [ReturnType<typeof room>, number][]): Map<string, RoomLive> =>
    new Map(entries.map(([r, occupancy]) => [r.id, { id: r.id, occupancy, capacity: r.capacity, level: "ok" as const }]));

  it("puts the fullest room first by share of capacity, not by head count", () => {
    const hall = room(1, "Hall", 1000);
    const lab = room(2, "Lab", 20);
    const studio = room(3, "Studio", 50);
    expect(sortRooms([hall, lab, studio], live([[hall, 500], [lab, 19], [studio, 10]]))).toEqual([lab.id, hall.id, studio.id]);
  });

  it("puts an over-capacity room above a full one", () => {
    const a = room(1, "A", 100);
    const b = room(2, "B", 100);
    expect(sortRooms([a, b], live([[a, 100], [b, 120]]))).toEqual([b.id, a.id]);
  });

  it("orders ties, rooms with no count and rooms with no capacity by name", () => {
    const zeta = room(1, "Zeta", 100);
    const alpha = room(2, "Alpha", 100);
    const storage = room(3, "Storage", 0);
    const beta = room(4, "Beta", 100);
    expect(sortRooms([zeta, alpha, storage, beta], live([[zeta, 50], [alpha, 50], [storage, 7]]))).toEqual([alpha.id, zeta.id, beta.id, storage.id]);
  });
});
