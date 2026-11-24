/**
 * Admin Command on the real API: one factory, `createRealBackend(baseUrl)`, giving the same pieces
 * live/backend.ts gives from the mock today — `api` (CommandApi), `configure` (ConfigureApi),
 * `connect(eventId)` (LiveTransport) and `clock` — plus what only a real backend has: `auth` (sign
 * in with email and password, the MFA step-up prompt, sign-out from the server).
 *
 * live/backend.ts loads this folder with a dynamic import behind VITE_API_URL (done), so neither the
 * mock (`@synan/mock`) nor this client (Zod, the contract schemas) is in the other's bundle. This
 * folder imports only types from the mock; the build erases them.
 *
 * ------------------------------------------------------------------------------------------------
 * Switching over (live/backend.ts; done as below, with `mode`, `auth` and `mockBackend` added):
 *
 *   const url = import.meta.env.VITE_API_URL;
 *   const real = url ? (await import("../api")).createRealBackend(url) : null;
 *   const mock = real ? null : (await import("./mock-backend")).createMockBackend(); // today's file body
 *   export const api = real?.api ?? mock!.api;          // … configure, connect, clock the same way
 *
 * and in kit/errors.ts read `fields` from any error that has them (an ApiFailure has the mock's shape):
 *   const fields = (e: unknown) => (e && typeof e === "object" && "fields" in e ? (e as { fields: Record<string, string> }).fields : {});
 * ------------------------------------------------------------------------------------------------
 *
 * Every difference between the mock's shapes and the server's, and how it is bridged (★ = a gap
 * the API should close; the rest are adapters only):
 *
 * Session and errors
 *   - signIn(): the mock takes no arguments; here `signIn({ email, password })`, or a stored session.
 *   - MFA_REQUIRED: the mock never asks. Here the client calls the `auth.onStepUp` handler and retries.
 *   - Errors: ApiFailure (code = message, `fields` like MockApiError's), not MockApiError.
 *   - ★ OperatorContext.name: GET /me/operator has no display name; the email stands in.
 *   - OperatorContext.shift: null on the server without a current assignment; "Signed in" + session times stand in.
 *   - OperatorContext.event_ids ← desk_event_ids (desk clerks), else null.
 * Live
 *   - events(): admins/organisers read GET /admin/events; ★ supervisors and desk clerks may not, so
 *     they get GET /events (published and live, listed only). Drafts are left out, as in the mock.
 *   - layout(): GET /venues/:id (flat) → { venue, zones, rooms, checkpoints, grid, checkpoint_positions };
 *     positions from checkpoints[].position; grid is a canvas ≥ 96 × 60 (the server's is the shapes' bounding box).
 *   - summary(): the server's `series` is per-minute throughput; the KPI series is `kpi_series` → `series`.
 *   - ack()/resolveAlert(): the server answers 409 for an alert no longer open / already resolved;
 *     the alert is read back and returned, as the mock does.
 *   - scans(): ★ one checkpoint and no text search on GET /scans — several checkpoints and `q` are
 *     filtered here (up to 2,500 scans); ★ `total` and `oldest_at` are not served; ★ `tier` and
 *     `latency_ms` are not on ScanRecord (null); `corrected_at` = occurred_at + clock_offset_ms;
 *     newest first by received time (mock: corrected time); the mock's `corrected_at|id` cursor is accepted.
 *   - ★ gateActivity(): composed (GET /gates/health + 15 minutes of GET /scans).
 *   - ★ gateDetail(): composed from an hour of GET /scans; `link_history` is empty.
 *   - ★ testRead(): no endpoint; fails NOT_IMPLEMENTED.
 *   - ★ alertContext(): composed (alert from GET /breach-alerts, scans, credentials, registrations, staff).
 *   - Streams: ★ `gate.health` is not published on /stream/alerts — polled from GET /gates/health and
 *     emitted as frames; alerts are re-read when /stream/alerts reconnects without replay.
 * Configure
 *   - setupStatus(): the server adds `venues` (a count). Same otherwise.
 *   - venues(): counts nest under `counts`; flattened.
 *   - venue()/publishLayout(): flat VenueDetail → { venue, floors, capacity_default, grid, …, layout_version };
 *     floors fall back to the zones' when a venue has none; grid as layout().
 *   - publishLayout() issues: `body.rooms.3.x` → `room:<id>`; ★ an in-use zone/room is 409 CONFLICT with
 *     `zone:<id>` on the server — re-coded VALIDATION_FAILED (serverCode CONFLICT) so the editor marks it;
 *     a stale version stays CONFLICT. MFA while an event there is live.
 *   - createVenue(): a missing address becomes the city (as the mock).
 *   - event(): EventAdmin → EventRecord: venue → venue_id, rooms → {room_id, capacity_override},
 *     pass_template (free-form on the server) → PassTemplate with defaults, updated_by OperatorRef → name.
 *   - eventRows(): updated_by OperatorRef → name.
 *   - createDraft(): ★ the server needs a title and slug (the mock accepts neither): "Untitled event",
 *     slug from the title with -2, -3 … while taken, time zone from the organisation; rules → PUT access-rules.
 *   - updateEvent(): `rules` go to PUT access-rules (expected = current version); ★ venue_id null cannot
 *     be sent (not nullable on the server) and is left out.
 *   - readiness(): `{ items }` unwrapped; three more keys (doors, gate, sessions).
 *   - publishEvent(): unmet checklist is 409 on the server → re-coded VALIDATION_FAILED.
 *   - attendees(): ★ `last_scan_at` not served (null); `q` matches name/email only; up to 2,000 rows.
 *   - credentialOverview(): ★ `recent` not served (empty); every state filled in.
 *   - ★ deskAttendee(): no GET /registrations/:id — found in the event's registrations; carrier from
 *     GET /credentials; ★ pass_sent_at not served (null), band_changed_at = the band's bound_at.
 *   - replaceBand()/resendPass(): MFA (step-up); reviewCredential(): MFA for a supervisor.
 *   - ★ deskStock(): `today` not served (zeros).
 *   - staff(): display_name → name (email when none).
 *   - assignments(): labels optional on the server ("Unknown" when absent).
 *   - createAssignment(): shift_start/shift_end issues and a bare overlap 409 are also put under `shift`.
 */
import type { CommandApi, ConfigureApi } from "@synan/mock/command";
import type { LiveTransport } from "../live/transport";
import { createApiClient, type ApiClient, type StepUpHandler, type StepUpOutcome } from "./client";
import { createCommandApi, createSharedCache, type RealCommandApi } from "./command";
import { createConfigureApi } from "./configure";
import { createSessionStore, type KeyValueStorage, type OperatorSession } from "./session";
import { openLiveStream, type LiveStream } from "./stream";

export { ApiFailure, failureCopy, isApiFailure, type FailureCopy, type Issue } from "./failure";
export { STEP_UP_ATTEMPTS, type StepUpAnswer, type StepUpHandler, type StepUpOutcome, type StepUpRequest } from "./client";
export type { OperatorSession } from "./session";

export interface RealBackendOptions {
  /** Default: localStorage (in-memory when blocked). `null`: memory only. */
  storage?: KeyValueStorage | null;
  fetch?: typeof fetch;
  WebSocketImpl?: typeof WebSocket;
  /** Contract mismatches, dropped frames, stream state changes. */
  debug?: (message: string, detail?: unknown) => void;
}

export interface AdminAuth {
  /** POST /auth/login. INVALID_CREDENTIALS, RATE_LIMITED (5 failures in 15 minutes) on failure. */
  signIn(email: string, password: string): Promise<OperatorSession>;
  /** Forget the session here, close the live links, end the family on the server. */
  signOut(): Promise<void>;
  /** The stored session, or null. `mfa_until` estimates how long a step-up still lasts. */
  session(): OperatorSession | null;
  /** Sign-in, refresh, step-up and sign-out, in this tab or another. */
  onSession(listener: (session: OperatorSession | null) => void): () => void;
  /** The server refused the session (expired, revoked elsewhere). The console shows sign-in. */
  onSignedOut(listener: () => void): () => void;
  /** The MFA prompt: called when a call answers MFA_REQUIRED; the call is retried once a code is accepted. */
  onStepUp(handler: StepUpHandler): () => void;
  /** How each prompt ended (accepted, or failed with no retry to follow). */
  onStepUpSettled(listener: (outcome: StepUpOutcome) => void): () => void;
  /** Enrolment (no authenticator yet): POST /auth/mfa/enrol, then /auth/mfa/enrol/confirm with a code from it. */
  startEnrolment(): Promise<{ secret: string; otpauth_url: string; expires_at: string }>;
  confirmEnrolment(code: string): Promise<void>;
  /** Step up now, without waiting for a refusal (e.g. before a series of privileged actions). */
  stepUp(code: string): Promise<OperatorSession>;
}

export interface RealBackend {
  mode: "api";
  api: RealCommandApi & CommandApi;
  configure: ConfigureApi;
  /** The live link for one event (the store only asks for live events). */
  connect(eventId: string): LiveTransport | null;
  /** Server time (GET /time offset). The mock's `clock` is used only for `now()` by the screens. */
  clock: { now(): number };
  auth: AdminAuth;
  /** The typed client, for calls the two interfaces do not cover. */
  client: ApiClient;
  /** Close every live link and stop timers. */
  close(): void;
}

const TIME_SYNC_MS = 5 * 60_000;

export function createRealBackend(baseUrl: string, options: RealBackendOptions = {}): RealBackend {
  const session = createSessionStore({ storage: options.storage });
  const client = createApiClient({ baseUrl, session, fetch: options.fetch, debug: options.debug });
  const cache = createSharedCache();
  const streams = new Set<LiveStream>();

  const closeStreams = () => {
    for (const stream of streams) stream.close();
    streams.clear();
  };

  const api = createCommandApi(client, cache, { onSignOut: closeStreams });
  const configure = createConfigureApi(client, cache);

  client.onSignedOut(closeStreams);

  // Server time, now and every few minutes (the screens' "now" and the KPI buckets).
  void client.syncTime().catch(() => undefined);
  const timeTimer = setInterval(() => void client.syncTime().catch(() => undefined), TIME_SYNC_MS);
  (timeTimer as { unref?: () => void }).unref?.();

  return {
    mode: "api",
    api,
    configure,
    connect(eventId) {
      const stream = openLiveStream({
        eventId,
        client,
        WebSocketImpl: options.WebSocketImpl,
        debug: options.debug,
        onClose: () => streams.delete(stream),
      });
      streams.add(stream);
      return stream;
    },
    clock: { now: () => Date.now() + client.offsetMs() },
    auth: {
      signIn: (email, password) => client.signIn(email, password),
      async signOut() {
        closeStreams();
        await client.signOut();
      },
      session: () => session.read(),
      onSession: (listener) => session.subscribe(listener),
      onSignedOut: (listener) => client.onSignedOut(listener),
      onStepUp: (handler) => client.onStepUp(handler),
      onStepUpSettled: (listener) => client.onStepUpSettled(listener),
      startEnrolment: () => client.call("mfaEnrol", {}, { noStepUp: true }),
      async confirmEnrolment(code) {
        await client.call("mfaEnrolConfirm", { body: { code: code.trim() } }, { noStepUp: true });
      },
      stepUp: (code) => client.stepUp(code),
    },
    client,
    close() {
      clearInterval(timeTimer);
      closeStreams();
    },
  };
}
