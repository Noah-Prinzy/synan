/**
 * Payload types the mock serves. Every shape that `@synan/contracts` declares is
 * imported from it (type-only — no Zod at runtime). Shapes contracts does not declare
 * are marked `NOT IN CONTRACTS` and are proposals to the backend, kept thin.
 */
import type { EventDetail, Notification, ProfileField } from "@synan/contracts/rest";
import type { RoomOccupancy } from "@synan/contracts/ws";

export type {
  BreachAlert,
  Checkpoint,
  EventDetail,
  EventSession,
  EventSummary,
  GateHealth,
  MyCredential,
  PortalCode,
  PortalCodeBatch,
  Room,
  ScanRecord,
  Venue,
  Zone,
} from "@synan/contracts/rest";
export type {
  AlertsServerMessage,
  MeServerMessage,
  RoomOccupancy,
  ScansServerMessage,
  TelemetryServerMessage,
} from "@synan/contracts/ws";
export type {
  AttendeeTier,
  CarrierKind,
  CarrierState,
  CredentialState,
  EventState,
  ScanResult,
  WsChannel,
} from "@synan/contracts/enums";

export type { MyRegistration, Notification, ProfileField } from "@synan/contracts/rest";

/**
 * NOT IN CONTRACTS — presentation data the Attendee Portal shows that no endpoint
 * returns yet: the venue's city, a "near me" flag, and the public occupancy total.
 * Proposed to the backend as fields on EventSummary (city) and a public telemetry
 * scope total. `nearby` will come from the device, not the server.
 */
export interface EventExtras {
  city: string;
  nearby: boolean;
  /** Optional event photograph (URL). Events may have none; the portal designs for both. */
  image?: string;
}


/** NOT IN CONTRACTS — the viewer's relation to an event, for A2's "Your status" panel. */
export type Membership = "none" | "registered" | "checked_in";

export interface PortalEvent {
  detail: EventDetail;
  extras: EventExtras;
  /** Listed events appear in discovery; Private Invitation events do not. */
  listed: boolean;
}

export interface PortalWorld {
  events: PortalEvent[];
  occupancy: Record<string, RoomOccupancy[]>;
  profiles: Record<string, { fields: ProfileField[] }>;
}
