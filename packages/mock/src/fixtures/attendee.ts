/**
 * The demo attendee: one Ordinary registration for Nexus Summit, its credential,
 * the bands a desk clerk could hand out, and the attendee's notifications.
 * All people here are fictional.
 */
import { idFor } from "../random";
import type { MyCredential, Notification } from "../types";

export const DEMO_EVENT_SLUG = "nexus-summit-2026";
export const DEMO_HOLDER = "Amara Okello";
export const DEMO_DESK = "Desk 2 · North entrance";

export function demoCredential(eventId: string, permittedRoomIds: string[]): MyCredential {
  return {
    event_id: eventId,
    registration_id: idFor("registration:demo"),
    tier: "ORDINARY",
    state: "active",
    carriers: [
      { kind: "qr_portal", state: "active", identifier_hint: "portal" },
      { kind: "qr_email", state: "bound", identifier_hint: "email · single use" },
    ],
    permitted_room_ids: permittedRoomIds,
  };
}

export interface DeskBand {
  /** Six characters from the clerk, alphabet A–H J–N P–Z 2–9 (contracts SelfBindRequest). */
  code: string;
  /** NFC chip UID, hex. */
  uid: string;
  /** null = in stock and free to bind. */
  boundTo: "self" | "other" | null;
}

export const deskBands: DeskBand[] = [
  { code: "K4M2PZ", uid: "04A29F31C7D0E2", boundTo: null },
  { code: "BUSY27", uid: "04B7731E22A9F0", boundTo: "other" },
];

/** Codes to try in the mock: one free band, one already bound to someone else. */
export const DEMO_DESK_CODES = { free: "K4M2PZ", taken: "BUSY27" } as const;

export const demoNotifications: Notification[] = [
  {
    id: idFor("notification:1"),
    kind: "pass",
    at: "2026-11-20T07:30:00.000Z",
    title: "You're registered",
    body: "Your registration for Nexus Summit 2026 is confirmed. Collect your wristband at the North entrance desk.",
    read: false,
  },
  {
    id: idFor("notification:2"),
    kind: "session",
    at: "2026-11-20T11:00:00.000Z",
    title: "Fireside chat added",
    body: "A fireside chat on infrastructure in Africa has been added to Day 2, 15:00 on the West Terrace.",
    read: false,
  },
  {
    id: idFor("notification:3"),
    kind: "event",
    at: "2026-11-21T05:00:00.000Z",
    title: "Desk locations updated",
    body: "Registration desk 2 has moved to the North entrance. The South entrance desk is closed today.",
    read: true,
  },
  {
    id: idFor("notification:4"),
    kind: "event",
    at: "2026-11-21T06:00:00.000Z",
    title: "Doors and screening",
    body: "Doors open at 08:00. Allow fifteen minutes for security screening.",
    read: true,
  },
  {
    id: idFor("notification:5"),
    kind: "capacity",
    at: "2026-11-22T08:40:00.000Z",
    title: "Workshop A is nearly full",
    body: "Building Scalable Infrastructure is close to capacity. Space is still open in Breakout 1.",
    read: false,
  },
];

/** Emails that already hold a registration, so A3 routes them to sign-in. */
export const registeredEmails = ["taken@example.com"];
