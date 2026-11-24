/**
 * The live side of Admin Command on the real API: `CommandApi` (live/transport.ts), call for call,
 * returning exactly the shapes the screens consume today. Where the server has no endpoint for a
 * call, the answer is composed from the endpoints there are, or the call fails NOT_IMPLEMENTED;
 * index.ts lists each case.
 */
import { ALERT_KIND_COPY } from "@synan/contracts/copy";
import type { ScanResult } from "@synan/contracts/enums";
import type { BreachAlert, Checkpoint, ScanRecord } from "@synan/contracts/rest";
import type {
  AlertContext,
  AlertCredential,
  CommandApi,
  CommandEvent,
  GateActivity,
  GateDetail,
  OperatorContext,
  OpsScan,
  ScanPage,
} from "@synan/mock/command";
import { heartbeatAt, toCommandEvent, toLiveSummary, toOperatorContext, toOpsScan, toVenueLayout } from "./adapters";
import { allPages, type ApiClient } from "./client";
import { ApiFailure } from "./failure";

const MINUTE = 60_000;
/** How far back the gate views read (gate activity: 15 min; gate detail: 1 h). */
const ACTIVITY_MINUTES = 15;
const DETAIL_MINUTES = 60;

/** What the live and configure halves share: the event → venue map and the gate labels per event. */
export interface SharedCache {
  venueOfEvent: Map<string, string>;
  checkpoints: Map<string, Promise<Checkpoint[]>>;
}

export function createSharedCache(): SharedCache {
  return { venueOfEvent: new Map(), checkpoints: new Map() };
}

export interface RealCommandApi extends CommandApi {
  /**
   * Sign in. With credentials: POST /auth/login. Without (the mock's `signIn()`): resumes a stored
   * session, or fails UNAUTHENTICATED — the console then shows its sign-in form.
   */
  signIn(credentials?: { email: string; password: string }): Promise<OperatorContext>;
}

export function createCommandApi(client: ApiClient, cache: SharedCache, hooks: { onSignOut?: () => void } = {}): RealCommandApi {
  const now = () => Date.now() + client.offsetMs();

  const venueIdOf = async (eventId: string): Promise<string> => {
    const known = cache.venueOfEvent.get(eventId);
    if (known) return known;
    // Operators: the event's own record. (Supervisors get the venue from the event list.)
    const event = await client.call("getEventAdmin", { params: { id: eventId } });
    if (!event.venue) throw new ApiFailure("NOT_FOUND", 404, { detail: "The event has no venue yet." });
    cache.venueOfEvent.set(eventId, event.venue.id);
    return event.venue.id;
  };

  /** One alert as it is now (GET /alerts/:id). */
  const findAlert = async (alertId: string): Promise<BreachAlert> => (await client.call("getAlert", { params: { id: alertId } })).alert;

  const api: RealCommandApi = {
    now,

    dashboard: () => client.call("dashboard"),

    async events() {
      const role = client.session.read()?.role;
      const rows: CommandEvent[] = [];
      if (role === "admin" || role === "organiser") {
        const { items } = await allPages((cursor) => client.call("listEventsAdmin", { query: { limit: 500, cursor } }));
        for (const row of items) {
          if (row.venue) cache.venueOfEvent.set(row.id, row.venue.id);
          const event = toCommandEvent(row);
          if (event) rows.push(event);
        }
      } else {
        // DIFFERENCE: supervisors and desk clerks may not call GET /admin/events (operators only);
        // the public list has published and live, listed events only.
        const { items } = await allPages((cursor) => client.call("listEvents", { query: { limit: 500, cursor } }));
        for (const row of items) {
          cache.venueOfEvent.set(row.id, row.venue.id);
          const event = toCommandEvent(row);
          if (event) rows.push(event);
        }
      }
      return rows;
    },

    async operator() {
      const profile = await client.call("myOperator");
      return toOperatorContext(profile);
    },

    async signOut() {
      hooks.onSignOut?.();
      await client.signOut();
    },

    async signIn(credentials) {
      if (credentials) await client.signIn(credentials.email, credentials.password);
      else if (!client.session.read()) throw new ApiFailure("UNAUTHENTICATED", 401);
      return api.operator();
    },

    async layout(eventId) {
      const venue = await client.call("getVenue", { params: { id: await venueIdOf(eventId) } });
      return toVenueLayout(venue);
    },

    async summary(eventId) {
      return toLiveSummary(await client.call("eventSummary", { params: { id: eventId }, query: { series_minutes: 60 } }));
    },

    async alerts(eventId) {
      const { items } = await client.call("listAlerts", { query: { event_id: eventId, limit: 500 } });
      return [...items].sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
    },

    async gates(eventId) {
      const { items } = await client.call("gateHealth", { query: { event_id: eventId } });
      return items;
    },

    async ack(alertId) {
      try {
        return await client.call("ackAlert", { params: { id: alertId } });
      } catch (error) {
        // DIFFERENCE: the mock answers an alert that is no longer open with the alert; the server
        // answers 409. Read it back so the caller gets the alert as it is.
        if (error instanceof ApiFailure && error.code === "CONFLICT") return findAlert(alertId);
        throw error;
      }
    },

    recount: (roomId, body) => client.call("recountRoom", { params: { id: roomId }, body }),

    postEventSummary: (eventId) => client.call("postEventSummary", { params: { id: eventId } }),

    // MFA: an export needs a fresh second factor (the client prompts and retries).
    exportReport: (eventId, body) => client.call("exportReport", { params: { id: eventId }, body: { format: body.format, kind: body.kind } }),

    async reports(eventId) {
      const { items } = await client.call("eventReports", { params: { eventId } });
      return items;
    },

    async resolveAlert(alertId, body) {
      try {
        return await client.call("resolveAlert", { params: { id: alertId }, body: { note: body.note.trim() } });
      } catch (error) {
        // DIFFERENCE: as `ack` — resolving a resolved alert answers 409 on the server.
        if (error instanceof ApiFailure && error.code === "CONFLICT") return findAlert(alertId);
        throw error;
      }
    },

    /**
     * GET /alerts/:id: the alert with its gate, room, scans, credential and ack/resolve history in one
     * read. The rule is the alert kind's copy plus the server's detail. `nearby` (the minute before at
     * the gate, when the alert names no scans) is one page of GET /scans at that gate. The credential's
     * name comes from GET /registrations/:id.
     */
    async alertContext(alertId) {
      const detail = await client.call("getAlert", { params: { id: alertId } });
      const { alert } = detail;
      const withLabel = (s: ScanRecord & { checkpoint_label: string }) => ({ ...toOpsScan(s), checkpoint_label: s.checkpoint_label });
      const scans: AlertContext["scans"] = detail.scans.map(withLabel);

      let nearby: AlertContext["nearby"] = [];
      if (scans.length === 0 && alert.checkpoint_id) {
        const at = Date.parse(alert.occurred_at);
        const label = detail.checkpoint?.label ?? "Unknown gate";
        const page = await client
          .call("listScans", { query: { event_id: alert.event_id, checkpoint_id: alert.checkpoint_id, limit: 50 } })
          .catch(() => ({ items: [] as ScanRecord[] }));
        nearby = page.items
          .filter((s) => Date.parse(s.corrected_at ?? s.occurred_at) <= at + 1000 && at - Date.parse(s.corrected_at ?? s.occurred_at) <= MINUTE)
          .map((s) => withLabel({ ...s, checkpoint_label: label }))
          .sort((a, b) => a.corrected_at.localeCompare(b.corrected_at));
      }

      let credential: AlertCredential | null = null;
      if (detail.credential?.registration_id) {
        const reg = await client.call("getRegistration", { params: { id: detail.credential.registration_id } }).catch(() => null);
        credential = {
          registration_id: detail.credential.registration_id,
          credential_id: detail.credential.id,
          state: detail.credential.state,
          tier: detail.credential.tier ?? reg?.tier ?? "ORDINARY",
          full_name: reg?.attendee.full_name ?? null,
          band_hint: detail.credential.band_hint ?? reg?.band_hint ?? null,
        };
      }

      const acked = [...detail.history].reverse().find((h) => h.action === "acked");
      const me = client.session.read();
      const ackedByName = acked ? (acked.actor_id && acked.actor_id === me?.sub ? "You" : (acked.actor_name ?? "Another operator")) : null;

      return {
        alert_id: alert.id,
        rule: `${ALERT_KIND_COPY[alert.kind].description} ${alert.detail}`.trim(),
        scans,
        nearby,
        credential,
        acked_by_name: ackedByName,
      };
    },

    /**
     * GET /scans, filtered by the server: several checkpoints (`checkpoint_ids`), a result, and `q`
     * (one pass, by credential or band; admins and organisers only, audited). `total` is the server's
     * count, exact up to 10,000 (`total_exact`, passed through for the access log's "at least");
     * `oldest_at` is the log's oldest scan. DIFFERENCES: `tier` and `latency_ms` are not served (null);
     * scans are newest-first by received time (the mock: by corrected time). The cursor accepts the
     * mock's `corrected_at|id` form (the access log builds it with `scanCursor`) and the server's id.
     */
    async scans(eventId, query = {}) {
      const limit = Math.max(1, Math.min(query.limit ?? 100, 200));
      const cursor = query.cursor ? (query.cursor.split("|").at(-1) ?? undefined) : undefined;
      const ids = query.checkpoint_ids ?? [];
      const q = query.q?.trim();
      const result = await client.call("listScans", {
        query: {
          event_id: eventId,
          checkpoint_ids: ids.length > 0 ? ids.join(",") : undefined,
          result: query.result,
          q: q && q.length >= 4 ? q : undefined,
          limit,
          cursor: cursor || undefined,
        },
      });
      const rows: OpsScan[] = result.items.map(toOpsScan);
      const last = rows.at(-1);
      const page: ScanPage & { total_exact: boolean } = {
        items: rows,
        next_cursor: result.next_cursor && last ? `${last.corrected_at}|${result.next_cursor}` : null,
        total: result.total ?? rows.length + (result.next_cursor ? 1 : 0),
        total_exact: result.total_exact ?? !result.next_cursor,
        oldest_at: result.oldest_at ?? null,
      };
      return page;
    },

    /**
     * GET /gates/health (heartbeat, last scan, 15-minute count) and, per gate, GET
     * /checkpoints/:id/activity for the last 15 minutes' per-minute series.
     */
    async gateActivity(eventId) {
      const t = now();
      const health = await client.call("gateHealth", { query: { event_id: eventId } });
      return Promise.all(
        health.items.map(async (gate): Promise<GateActivity> => {
          const activity = await client
            .call("checkpointActivity", { params: { id: gate.checkpoint_id }, query: { event_id: eventId, minutes: ACTIVITY_MINUTES } })
            .catch(() => null);
          const series = activity ? activity.minutes.map((m) => m.scans) : new Array<number>(ACTIVITY_MINUTES).fill(0);
          return {
            checkpoint_id: gate.checkpoint_id,
            heartbeat_at: heartbeatAt(gate, t),
            last_scan_at: gate.last_scan_at ?? null,
            per_minute: series,
            scans_last_15m: gate.scans_last_15m ?? series.reduce((sum, n) => sum + n, 0),
          };
        }),
      );
    },

    /**
     * GET /checkpoints/:id/activity for the last hour (per minute, summed here into 5-minute buckets;
     * the failure breakdown is the server's `by_result`) and the gate's last 50 scans from GET /scans.
     * DIFFERENCE: `link_history` is not served (empty).
     */
    async gateDetail(eventId, checkpointId) {
      const [activity, recent] = await Promise.all([
        client.call("checkpointActivity", { params: { id: checkpointId }, query: { event_id: eventId, minutes: DETAIL_MINUTES } }),
        client.call("listScans", { query: { event_id: eventId, checkpoint_id: checkpointId, limit: 50 } }),
      ]);
      const bucketMs = 5 * MINUTE;
      const from = Date.parse(activity.from);
      const counts = new Array<number>(Math.ceil(DETAIL_MINUTES / 5)).fill(0);
      for (const minute of activity.minutes) {
        const bucket = Math.floor((Date.parse(minute.at) - from) / bucketMs);
        if (bucket >= 0 && bucket < counts.length) counts[bucket] = (counts[bucket] ?? 0) + minute.scans;
      }
      const results = (Object.entries(activity.by_result) as [ScanResult, number][])
        .filter(([result, count]) => count > 0 && result !== "implied_exit")
        .map(([result, count]) => ({ result, count }))
        .sort((a, b) => b.count - a.count);
      const detail: GateDetail = {
        checkpoint_id: checkpointId,
        link_history: [],
        throughput: { from: activity.from, bucket_ms: bucketMs, counts },
        results,
        last_scans: recent.items.map(toOpsScan),
      };
      return detail;
    },

    /** NOT ON THE SERVER: no endpoint makes a synthetic read at a gate. */
    async testRead() {
      throw new ApiFailure("NOT_IMPLEMENTED", 501, { detail: "No endpoint for a test read at a gate (proposed: POST /checkpoints/:id/test-read)." });
    },
  };

  return api;
}
