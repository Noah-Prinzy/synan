/**
 * The switch (roadmap Phase 3). `VITE_API_URL` unset: the scanner runs on the mock exactly as
 * before. Set (the API's origin, e.g. `http://127.0.0.1:5180`): it signs in, scans, queues and
 * syncs against the real API.
 */
const raw = (import.meta.env.VITE_API_URL as string | undefined)?.trim() ?? "";

/** True when the scanner talks to the real API. */
export const API_MODE = raw !== "";

/** The API origin, without a trailing slash or the `/api/v1` base path. */
export const API_ORIGIN = raw.replace(/\/+$/, "").replace(/\/api\/v1$/, "");

/** REST base (02 §5). */
export const REST_BASE = `${API_ORIGIN}/api/v1`;

/** WebSocket base (02 §6): channels hang off the origin, not the REST base. */
export const WS_BASE = API_ORIGIN.replace(/^http/, "ws");

/* ------------------------------------------------------------ tuning */

/** An online scan waits this long for the server's verdict before deciding locally. */
export const ONLINE_VERDICT_TIMEOUT_MS = 2500;
/** Ordinary requests. */
export const REQUEST_TIMEOUT_MS = 10_000;
/** Allowlist refresh while the link is up (it is stale after 15 minutes, O-05). */
export const ALLOWLIST_REFRESH_MS = 5 * 60_000;
/** Clock offset re-measured this often while online (D-14). */
export const CLOCK_REFRESH_MS = 5 * 60_000;
/** REST heartbeat when the stream is not open (a gate is offline after 60 s of silence). */
export const REST_HEARTBEAT_MS = 25_000;
/** Heartbeat frame on `/stream/scans`. */
export const STREAM_HEARTBEAT_MS = 15_000;
/** Items per POST /scans (the contract allows 500). */
export const SYNC_BATCH = 100;
/**
 * QR validity tolerance. The server's is QR_LEEWAY_S (default 5 s, at most 30) and is not
 * published; the scanner uses the default. NOT IN CONTRACTS (see the report).
 */
export const QR_LEEWAY_S = 5;
/** Retired signing keys keep verifying this long on the server (apps/api domain/keys.ts). */
export const RETIRED_KEY_GRACE_MS = 24 * 3600_000;
