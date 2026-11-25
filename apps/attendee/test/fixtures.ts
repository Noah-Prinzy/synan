/**
 * Shared test fixtures, each built through the contracts' own schemas (`.parse`), so a contract
 * change that the screens would feel breaks these tests too.
 */
import { MeServerMessage } from "@synan/contracts/ws";
import {
  Me,
  MyCredential,
  MyRegistrationItem,
  PortalCodeBatch,
  TokenPair,
  WsTicket,
} from "@synan/contracts/rest";
import { QR_PREFIX_PORTAL, QR_TEXT_LENGTH } from "@synan/contracts/qr";
import { WS_SUBPROTOCOL } from "@synan/contracts/brand";

export const EVENT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const EVENT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const EVENT_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
export const PERSON = "11111111-1111-4111-8111-111111111111";
export const OTHER_PERSON = "22222222-2222-4222-8222-222222222222";

export const iso = (ms: number) => new Date(ms).toISOString();

let tokenSeq = 0;
/** A token pair from /auth/verify or /auth/refresh, access token valid `accessMs` from `now`. */
export function tokenPair(now: number, p: { accessMs?: number; refreshMs?: number; sub?: string; email?: string; access?: string; refresh?: string } = {}): TokenPair {
  tokenSeq++;
  return TokenPair.parse({
    token_type: "Bearer",
    access_token: p.access ?? `access-${tokenSeq}`,
    access_expires_at: iso(now + (p.accessMs ?? 10 * 60_000)),
    refresh_token: p.refresh ?? `refresh-token-${String(tokenSeq).padStart(8, "0")}`,
    refresh_expires_at: iso(now + (p.refreshMs ?? 30 * 24 * 3600_000)),
    principal: { sub: p.sub ?? PERSON, kind: "attendee", role: null, email: p.email ?? "ada@example.com", mfa: false, mfa_enrolled: false },
  });
}

/** A portal code text of the contract's exact length, distinguishable by `n`. */
export function codeText(n: number): string {
  const body = `c${n}-`.padEnd(QR_TEXT_LENGTH.portal - QR_PREFIX_PORTAL.length, "x");
  return QR_PREFIX_PORTAL + body;
}

/** `count` back-to-back codes of `rotateS` seconds, the first valid from `fromMs`. */
export function codeBatch(fromMs: number, count: number, rotateS = 60, serverTimeMs = fromMs): PortalCodeBatch {
  return PortalCodeBatch.parse({
    kid: "0a1b2c3d",
    codes: Array.from({ length: count }, (_, i) => ({
      code: codeText(i),
      not_before: iso(fromMs + i * rotateS * 1000),
      expires_at: iso(fromMs + (i + 1) * rotateS * 1000),
    })),
    rotate_every_s: rotateS,
    server_time: iso(serverTimeMs),
  });
}

export function eventRef(id: string, p: { title?: string; startsAt?: string | null; slug?: string } = {}) {
  return {
    id,
    slug: p.slug ?? `event-${id.slice(0, 4)}`,
    title: p.title ?? `Event ${id.slice(0, 4)}`,
    starts_at: p.startsAt === undefined ? "2026-12-01T09:00:00.000Z" : p.startsAt,
    ends_at: "2026-12-01T18:00:00.000Z",
    timezone: "Europe/London",
    state: "published" as const,
    venue_name: "Hall One",
  };
}

export function credential(eventId: string, p: Partial<Pick<MyCredential, "state" | "carriers" | "tier">> = {}): MyCredential {
  return MyCredential.parse({
    event_id: eventId,
    registration_id: "33333333-3333-4333-8333-333333333333",
    tier: p.tier ?? "ORDINARY",
    state: p.state ?? "issued",
    carriers: p.carriers ?? [],
    permitted_room_ids: [],
    event: eventRef(eventId),
  });
}

export function registrationItem(
  eventId: string,
  p: { startsAt?: string | null; state?: MyRegistrationItem["state"]; credentialState?: MyRegistrationItem["credential_state"]; title?: string } = {},
): MyRegistrationItem {
  return MyRegistrationItem.parse({
    registration_id: "44444444-4444-4444-8444-444444444444",
    event: eventRef(eventId, { startsAt: p.startsAt, title: p.title }),
    tier: "ORDINARY",
    state: p.state ?? "confirmed",
    created_at: "2026-11-01T09:00:00.000Z",
    checked_in_at: null,
    zone_presence_consent: false,
    credential_state: p.credentialState === undefined ? "issued" : p.credentialState,
    band_bound: false,
  });
}

export function me(name: string | null = "Ada Lovelace"): Me {
  return Me.parse({ id: PERSON, full_name: name, email_masked: "a•••@example.com", phone_masked: null });
}

export function wsTicket(): WsTicket {
  return WsTicket.parse({
    ticket: "ticket",
    expires_at: "2030-01-01T00:00:00.000Z",
    protocols: [WS_SUBPROTOCOL, "ticket.abc"],
    channel: "/stream/me",
  });
}

export function meFrame(frame: unknown): string {
  return JSON.stringify(MeServerMessage.parse(frame));
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

export function apiError(code: string, status: number, issues?: { path: string; message: string }[]): Response {
  return json({ error: { code, message: code, ...(issues ? { issues } : {}) } }, status);
}

export type Route = (request: { method: string; path: string; query: URLSearchParams; body: unknown; token: string | null }) => Response | Promise<Response>;

/** A fetch that answers from `route` and records every request. A thrown error stands for "no answer". */
export function fakeFetch(route: Route) {
  const requests: { method: string; path: string; query: URLSearchParams; body: unknown; token: string | null }[] = [];
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const request = {
      method: init?.method ?? "GET",
      path: url.pathname.replace(/^\/api\/v1/, ""),
      query: url.searchParams,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      token: headers.Authorization?.replace(/^Bearer /, "") ?? null,
    };
    requests.push(request);
    return route(request);
  };
  return { fetch: fetchImpl as typeof fetch, requests };
}
