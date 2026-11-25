/**
 * The scanner's mock world (docs/02 §8): the event, its gates and rooms, this staff
 * member's shift, and the passes and wristbands a gate can meet. Stands in for
 * GET /me/assignments, the signed offline allowlist and POST /scans when VITE_API_URL is unset
 * (the real API is data/api).
 *
 * Demo wristband numbers (type them with 123, or hold a band to an Android phone):
 *   04A29F31C7D0E2  Amara Okello, Ordinary        → admitted (then already inside)
 *   04B7731E22A9F0  Jonas Weber, VIP              → admitted everywhere
 *   04E7A1B2C3D4E5  Lena Park, Public             → not permitted at Door 4
 *   04C1D2E3F4A5B6  revoked band                  → revoked
 *   04D00DCAFE0001  held for review               → under review
 *   anything else                                 → not recognised
 * The attendee portal's QR (http://localhost:5173/pass) is Amara's arrival code.
 */
import { base64urlEncode } from "@synan/contracts/qr";
import type { AttendeeTier } from "@synan/contracts/enums";
import { MockClock, MockRealtime, createPortalStore, type MockGate } from "@synan/mock";

const clock = new MockClock();
const portal = createPortalStore({ clock });
const realtime = new MockRealtime({ clock, portal });

const passEvent = portal.passEvent().detail;

export const EVENT = { id: passEvent.id, title: passEvent.title };

export type Gate = MockGate & {
  /** The shift at this gate, in device time (API mode: from the GET /me/assignments item). */
  shift: { starts: string; ends: string; now: boolean };
  roomName: string | null;
  /** API mode only (data/api/runtime.ts): what the assignment, its checkpoint and its event say. */
  api?: {
    eventId: string;
    eventTitle: string;
    zoneId: string;
    direction: "in" | "out" | "both";
    assignmentId: string;
    /** Server time, ms. */
    shiftStart: number;
    shiftEnd: number;
  };
};

const roomName = (roomId: string | null) => passEvent.rooms.find((room) => room.room_id === roomId)?.name ?? null;

export const GATES: Gate[] = realtime.gates.map((gate, index) => ({
  ...gate,
  roomName: roomName(gate.roomId),
  // Gate 3 is someone else's shift until the afternoon: the refusal case (P-15).
  shift: index === 2 ? { starts: "14:00", ends: "20:00", now: false } : { starts: "08:00", ends: "14:00", now: true },
}));

export function gateById(id: string | null): Gate | null {
  return GATES.find((gate) => gate.id === id) ?? null;
}

/** Room capacity as the allowlist snapshot knew it. */
export function roomState(roomId: string): { capacity: number; occupancy: number } | null {
  const room = realtime.rooms.get(roomId);
  if (!room) return null;
  return { capacity: room.capacity, occupancy: room.occupancy ?? 0 };
}

export interface Holder {
  name: string;
  tier: AttendeeTier;
  /** null = every room of the event. */
  rooms: string[] | null;
  state: "active" | "revoked" | "suspended";
}

const workshop = GATES[3]?.roomId ?? "";
const allRoomsBut = (roomId: string) => passEvent.rooms.map((room) => room.room_id).filter((id) => id !== roomId);

/** The offline allowlist, keyed by band UID. The names are the mock's own: the real API names nobody at a gate (03 §5). */
export const BANDS: Record<string, Holder> = {
  "04A29F31C7D0E2": { name: "Amara Okello", tier: "ORDINARY", rooms: null, state: "active" },
  "04B7731E22A9F0": { name: "Jonas Weber", tier: "VIP", rooms: null, state: "active" },
  "04E7A1B2C3D4E5": { name: "Lena Park", tier: "PUBLIC", rooms: allRoomsBut(workshop), state: "active" },
  "04C1D2E3F4A5B6": { name: "Band reported lost", tier: "ORDINARY", rooms: null, state: "revoked" },
  "04D00DCAFE0001": { name: "Samir Haddad", tier: "ORDINARY", rooms: null, state: "suspended" },
};

/** The demo registration's 16-byte QR reference (packages/mock codes.ts, refFor). */
function refFor(registrationId: string): string {
  const hex = registrationId.replace(/-/g, "").padEnd(32, "0").slice(0, 32);
  return base64urlEncode(Uint8Array.from({ length: 16 }, (_, i) => parseInt(hex.slice(i * 2, i * 2 + 2), 16)));
}

/** Holders by QR reference: the demo attendee's arrival code resolves to the band holder above. */
export const QR_REFS: Record<string, { holder: Holder; bandUid: string }> = {
  [refFor(portal.credential().registration_id)]: { holder: BANDS["04A29F31C7D0E2"]!, bandUid: "04A29F31C7D0E2" },
};

export function roomNames(ids: string[] | null): string[] {
  const list = ids ?? passEvent.rooms.map((room) => room.room_id);
  return list.map((id) => roomName(id)).filter((name): name is string => Boolean(name));
}
