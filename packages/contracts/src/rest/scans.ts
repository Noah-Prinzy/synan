/** Scan ingest and alerts (02 §5 "Scans and alerts", 01 §7–§8). */
import { z } from "zod";
import { Id, IsoDateTime, pageOf, PageQuery } from "../common.js";
import { AlertKind, AlertState, AttendeeTier, CarrierKind, ScanDirection, ScanResult, Severity } from "../enums/index.js";
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
});
export type ScanOutcome = z.infer<typeof ScanOutcome>;

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
  result: ScanResult.optional(),
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

const OPS_AND_SECURITY: readonly Access[] = ["admin", "organiser", "supervisor", "security_staff"];
const SUPERVISE: readonly Access[] = ["admin", "organiser", "supervisor"];

export const scanEndpoints = {
  postScans: endpoint({ method: "POST", path: "/scans", access: ["security_staff", "device"], rateLimit: "scan", body: ScanBatchRequest, response: ScanBatchResponse }),
  listScans: endpoint({ method: "GET", path: "/scans", access: SUPERVISE, query: ScanQuery, response: pageOf(ScanRecord) }),
  listAlerts: endpoint({ method: "GET", path: "/breach-alerts", access: OPS_AND_SECURITY, query: AlertQuery, response: pageOf(BreachAlert) }),
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
