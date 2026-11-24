/** Scan ingest and alerts (02 §5 "Scans and alerts", 01 §7–§8). */
import { z } from "zod";
import { Id, IsoDateTime, pageOf, PageQuery } from "../common.js";
import { AlertKind, AlertState, AttendeeTier, CarrierKind, CredentialState, ScanDirection, ScanResult, Severity } from "../enums/index.js";
import { ErrorCode } from "../errors/index.js";
import { endpoint, IdParam, OPERATORS, type Access } from "./endpoint.js";
import { ScanRecord } from "./venue.js";

/** What the reader actually read. The server derives the carrier kind from it; the client never asserts it. */
export const Presented = z.discriminatedUnion("medium", [
  /** Camera read: the raw QR text (a compact JWS for our own codes). */
  z.object({ medium: z.literal("qr"), data: z.string().min(1).max(2048) }),
  /** NFC read: the chip UID, hex. */
  z.object({ medium: z.literal("nfc"), uid: z.string().regex(/^[0-9A-Fa-f]{8,32}$/) }),
]);
export type Presented = z.infer<typeof Presented>;

export const ScanSubmission = z.object({
  /** Client-generated idempotency key (UUID recommended). Replays return the original outcome. */
  idem_key: z.string().min(16).max(64).regex(/^[A-Za-z0-9_-]+$/),
  checkpoint_id: Id,
  presented: Presented,
  /** Required at a `both` checkpoint; otherwise the checkpoint's direction wins. */
  direction: ScanDirection.optional(),
  /** Device clock time of the read. */
  occurred_at: IsoDateTime,
  /** server_time − device_time, measured at the last sync (D-14). Bounded to ±24 h. */
  clock_offset_ms: z.number().int().min(-86_400_000).max(86_400_000),
  /** True if decided locally while offline and sent from the queue. */
  offline: z.boolean(),
  /** The result the device showed, when it decided offline. Informational; never trusted. */
  local_result: ScanResult.optional(),
  /**
   * Additive (offline items): the staff assignment (`GET /me/assignments` id) the scan was made under.
   * Lets a queued scan be counted after its maker signed out or handed over: it is accepted from the
   * maker, or from another staff member now on shift at the same checkpoint on the same scanner
   * (`device_id` seen under that assignment), when the assignment covered the scan's time and it
   * arrives within the late-sync window. Ignored for fixed readers.
   */
  assignment_id: Id.optional(),
});
export type ScanSubmission = z.infer<typeof ScanSubmission>;

export const ScanBatchRequest = z.object({
  event_id: Id,
  /** Stable identifier of the reader / scanner install. */
  device_id: z.string().min(1).max(128),
  scans: z.array(ScanSubmission).min(1).max(500),
});
export type ScanBatchRequest = z.infer<typeof ScanBatchRequest>;

export const ScanOutcome = z.object({
  idem_key: z.string(),
  scan_id: Id,
  result: ScanResult,
  /** Server-derived. Null for an unknown token. */
  carrier_kind: CarrierKind.nullable(),
  /** Tier is shown at the gate for fast-track lanes; null when unknown. */
  tier: AttendeeTier.nullable(),
  room_id: Id.nullable(),
  /** occurred_at + clock_offset_ms: the time the server ordered this scan by. */
  corrected_at: IsoDateTime,
  /** True when this idem_key had already been processed; this is the original outcome. */
  replayed: z.boolean(),
  /** Alerts raised by this scan (e.g. offline conflicts found at sync). */
  alert_ids: z.array(Id),
  /* ---- additive ---- */
  /**
   * `already_inside` only: when the holder last came in (the zone entry at a perimeter gate, the room
   * entry at an interior gate), for "last in 4m ago". Null when unknown.
   */
  last_in_at: IsoDateTime.nullable().optional(),
  /**
   * `admitted` at a perimeter gate only: the event's rooms this pass may enter now (ids only, never
   * identity), for the verdict's room chips.
   */
  permitted_room_ids: z.array(Id).optional(),
  /** True when the scan was accepted under its named assignment after that assignment had ended or been handed over. */
  late_synced: z.boolean().optional(),
});
export type ScanOutcome = z.infer<typeof ScanOutcome>;

/**
 * Undo a mistaken admission from the scanner (06 S3): the caller's own `admitted` entry scan, within
 * 60 seconds of it. Writes a correction record (the scan itself is never deleted), takes the holder
 * back out of the room and the perimeter as if the scan had not happened, and is idempotent.
 */
export const UndoScanRequest = z.object({
  event_id: Id,
  reason: z.string().trim().max(200).optional(),
});
export const UndoScanResult = z.object({
  scan_id: Id,
  event_id: Id,
  undone_at: IsoDateTime,
  /** True when this scan had already been undone; this is the original correction. */
  replayed: z.boolean(),
  /** The scan's room (null at a room-less perimeter gate) and its count after the correction. */
  room_id: Id.nullable(),
  occupancy: z.number().int().min(0).nullable(),
});
export type UndoScanResult = z.infer<typeof UndoScanResult>;

/**
 * A scan the server refused to apply, with why. The rest of the batch is applied regardless, so one
 * bad item never blocks an offline queue. The client should drop or park exactly these idem_keys.
 */
export const ScanRejection = z.object({
  idem_key: z.string(),
  /**
   * CHECKPOINT_NOT_ASSIGNED, OUTSIDE_SHIFT, NOT_FOUND (checkpoint), VALIDATION_FAILED, IDEMPOTENCY_CONFLICT,
   * or RATE_LIMITED (the checkpoint's per-minute scan limit, 03 §4): not applied and not stored — keep
   * the item queued and resend it later with the same idem_key.
   */
  code: ErrorCode,
  message: z.string(),
});
export type ScanRejection = z.infer<typeof ScanRejection>;

export const ScanBatchResponse = z.object({
  /** One outcome per applied (or replayed) scan, in request order. Rejected scans are not here. */
  results: z.array(ScanOutcome),
  /** Scans refused individually. Always sent by the server (possibly empty). */
  rejected: z.array(ScanRejection).optional(),
  server_time: IsoDateTime,
});
export type ScanBatchResponse = z.infer<typeof ScanBatchResponse>;

export const ScanQuery = PageQuery.extend({
  event_id: Id,
  checkpoint_id: Id.optional(),
  /**
   * Additive: several checkpoints (a gate, or every door of a room), comma-separated, at most 50;
   * combined with `checkpoint_id` when both are sent.
   */
  checkpoint_ids: z
    .string()
    .max(50 * 37)
    .transform((s) => s.split(",").map((x) => x.trim()).filter(Boolean))
    .pipe(z.array(Id).min(1).max(50))
    .optional(),
  result: ScanResult.optional(),
  /**
   * Additive (admins and organisers; FORBIDDEN for others): one pass's scans, found by its credential
   * id, credential reference (22 characters), the band's UID, or the band hint's last four characters
   * (the UID's last four in hex: `••••81BF` or `81BF`). Never by name. Records still carry no per-person id. Every search that finds
   * a pass is written to the audit log as an access-history lookup (03 §5, §7); one that finds none
   * answers an empty page.
   */
  q: z.string().trim().min(4).max(64).optional(),
});
/** GET /scans page. */
export const ScanPage = pageOf(ScanRecord).extend({
  /**
   * Additive: scans matching the filters in the whole log. Exact when `total_exact`; otherwise a lower
   * bound (counting stops at 10,000).
   */
  total: z.number().int().min(0).optional(),
  total_exact: z.boolean().optional(),
  /** Additive: the oldest scan the event's log holds (corrected time), whatever the filters; null when empty or purged. */
  oldest_at: IsoDateTime.nullable().optional(),
});

export const BreachAlert = z.object({
  id: Id,
  event_id: Id,
  severity: Severity,
  kind: AlertKind,
  checkpoint_id: Id.nullable(),
  credential_id: Id.nullable(),
  occurred_at: IsoDateTime,
  state: AlertState,
  acked_by: Id.nullable(),
  acked_at: IsoDateTime.nullable(),
  resolution_note: z.string().nullable(),
  /** Every scan involved, for offline conflicts (D-13). */
  scan_ids: z.array(Id),
  /** Short machine-built description; never personal data. */
  detail: z.string(),
});
export type BreachAlert = z.infer<typeof BreachAlert>;

export const AlertQuery = PageQuery.extend({
  event_id: Id.optional(),
  state: AlertState.optional(),
  severity: Severity.optional(),
});

export const ResolveAlert = z.object({ note: z.string().min(3).max(1000) });

/**
 * GET /alerts/:id: what the alert detail sheet needs (06 D10), without identity. The scans named by
 * the alert carry no per-person id (03 §5); the credential is ids, tier and state only, and the band
 * hint. Names, when needed, come from the registration (GET /registrations/:id) the operator may read.
 */
export const AlertDetail = z.object({
  alert: BreachAlert,
  /** The room the alert concerns (capacity alerts), or the gate's room. */
  room: z.object({ id: Id, name: z.string(), capacity: z.number().int().min(0) }).nullable(),
  checkpoint: z.object({ id: Id, label: z.string(), perimeter: z.boolean(), room_id: Id.nullable() }).nullable(),
  /** The scans named by the alert (`scan_ids`), in corrected-time order, each with its gate's label. */
  scans: z.array(ScanRecord.extend({ checkpoint_label: z.string() })),
  credential: z
    .object({
      id: Id,
      registration_id: Id.nullable(),
      state: CredentialState,
      tier: AttendeeTier.nullable(),
      /** The pass's live band, masked; null when none. */
      band_hint: z.string().nullable(),
    })
    .nullable(),
  /** Acknowledge and resolve, oldest first, from the audit log; `actor_name` is the display name, else the email. */
  history: z.array(
    z.object({
      action: z.enum(["acked", "resolved"]),
      at: IsoDateTime,
      actor_id: Id.nullable(),
      actor_name: z.string().nullable(),
      note: z.string().nullable(),
    }),
  ),
});
export type AlertDetail = z.infer<typeof AlertDetail>;

const OPS_AND_SECURITY: readonly Access[] = ["admin", "organiser", "supervisor", "security_staff"];
const SUPERVISE: readonly Access[] = ["admin", "organiser", "supervisor"];

export const scanEndpoints = {
  postScans: endpoint({ method: "POST", path: "/scans", access: ["security_staff", "device"], rateLimit: "scan", body: ScanBatchRequest, response: ScanBatchResponse }),
  /** Addition (06 S3 `Undo`): see UndoScanRequest. */
  undoScan: endpoint({ method: "POST", path: "/scans/:id/undo", access: ["security_staff"], audited: true, rateLimit: "scan", params: IdParam, body: UndoScanRequest, response: UndoScanResult }),
  listScans: endpoint({ method: "GET", path: "/scans", access: SUPERVISE, query: ScanQuery, response: ScanPage }),
  listAlerts: endpoint({ method: "GET", path: "/breach-alerts", access: OPS_AND_SECURITY, query: AlertQuery, response: pageOf(BreachAlert) }),
  /** Addition (06 D10 detail sheet): one alert with its gate, room, scans, credential and history. */
  getAlert: endpoint({ method: "GET", path: "/alerts/:id", access: SUPERVISE, params: IdParam, response: AlertDetail }),
  ackAlert: endpoint({ method: "POST", path: "/alerts/:id/ack", access: OPS_AND_SECURITY, audited: true, params: IdParam, response: BreachAlert }),
  resolveAlert: endpoint({ method: "POST", path: "/alerts/:id/resolve", access: SUPERVISE, audited: true, params: IdParam, body: ResolveAlert, response: BreachAlert }),
  /**
   * Not in 02 §5: the audited access-history lookup of one credential (03 §5, §7). The only way an
   * operator sees one person's movement over time; every call is written to the audit log.
   * `event_id` is required for staff credentials, which are not tied to one event.
   */
  credentialScans: endpoint({
    method: "GET",
    path: "/credentials/:id/scans",
    access: OPERATORS,
    audited: true,
    params: IdParam,
    query: PageQuery.extend({ event_id: Id.optional() }),
    response: pageOf(ScanRecord),
  }),
} as const;
