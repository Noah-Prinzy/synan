/** Auth endpoints (02 §5 "Auth", 03 §3). */
import { z } from "zod";
import { WS_SUBPROTOCOL, WS_TICKET_PREFIX } from "../brand.js";
import { Email, Id, IsoDateTime, Ok } from "../common.js";
import { PrincipalKind, Role, SigningKeyPurpose, WsChannel } from "../enums/index.js";
import { endpoint, PUBLIC, type Access } from "./endpoint.js";

const ANY_SIGNED_IN: readonly Access[] = ["attendee", "admin", "organiser", "security_staff", "speaker", "crew"];
const ANY_USER: readonly Access[] = ["admin", "organiser", "security_staff", "speaker", "crew"];

/** The authenticated identity as the client sees it. Never contains a DB id for attendees. */
export const Principal = z.object({
  /** Opaque subject identifier. */
  sub: z.string(),
  kind: PrincipalKind,
  /** Present for operator and staff principals. */
  role: Role.nullable(),
  email: z.email().nullable(),
  /** True once the token has been stepped up with a second factor. */
  mfa: z.boolean(),
  mfa_enrolled: z.boolean(),
});
export type Principal = z.infer<typeof Principal>;

export const TokenPair = z.object({
  token_type: z.literal("Bearer"),
  access_token: z.string(),
  access_expires_at: IsoDateTime,
  refresh_token: z.string(),
  refresh_expires_at: IsoDateTime,
  principal: Principal,
});
export type TokenPair = z.infer<typeof TokenPair>;

export const LoginRequest = z.object({
  email: Email,
  password: z.string().min(1).max(256),
});
export type LoginRequest = z.infer<typeof LoginRequest>;

export const RefreshRequest = z.object({ refresh_token: z.string().min(16).max(512) });
export type RefreshRequest = z.infer<typeof RefreshRequest>;

/** Request an attendee sign-in link by email. Always answers 202, whether or not the address is known. */
export const EmailLinkRequest = z.object({
  email: Email,
  /** Where the attendee app should land after verify. Path only, never an absolute URL. */
  return_to: z.string().regex(/^\/[A-Za-z0-9\-._~/?=&%]*$/).max(512).optional(),
});
export type EmailLinkRequest = z.infer<typeof EmailLinkRequest>;

export const EmailLinkAccepted = z.object({ accepted: z.literal(true) });

export const VerifyRequest = z.object({ token: z.string().min(16).max(512) });
export type VerifyRequest = z.infer<typeof VerifyRequest>;

export const MfaVerifyRequest = z.object({ code: z.string().regex(/^\d{6}$/) });
export type MfaVerifyRequest = z.infer<typeof MfaVerifyRequest>;

export const WsTicketRequest = z.object({
  channel: WsChannel,
  /** Event to scope the subscription to (required for scans/telemetry/alerts). */
  event_id: Id.optional(),
  /** `/stream/scans` only: the checkpoint the scanner is paired with. */
  checkpoint_id: Id.optional(),
});
export type WsTicketRequest = z.infer<typeof WsTicketRequest>;

/** The ticket is sent as a second subprotocol: `Sec-WebSocket-Protocol: <WS_SUBPROTOCOL>, <WS_TICKET_PREFIX><ticket>`. */
export { WS_SUBPROTOCOL, WS_TICKET_PREFIX };

export const WsTicket = z.object({
  ticket: z.string(),
  expires_at: IsoDateTime,
  /** Pass these, in order, as the WebSocket `protocols` argument. */
  protocols: z.tuple([z.literal(WS_SUBPROTOCOL), z.string()]),
  channel: WsChannel,
});
export type WsTicket = z.infer<typeof WsTicket>;

/** One public verification key, as an Ed25519 JWK plus metadata. */
export const SigningKey = z.object({
  kid: z.string(),
  purpose: SigningKeyPurpose,
  alg: z.literal("EdDSA"),
  kty: z.literal("OKP"),
  crv: z.literal("Ed25519"),
  x: z.string(),
  /** 4-byte key id carried inside compact QR codes (first 4 bytes of SHA-256 of the raw public key), hex. */
  qr_kid: z.string().regex(/^[0-9a-f]{8}$/),
  active_from: IsoDateTime,
  retired_at: IsoDateTime.nullable(),
});
export type SigningKey = z.infer<typeof SigningKey>;

export const SigningKeys = z.object({ keys: z.array(SigningKey) });
export type SigningKeys = z.infer<typeof SigningKeys>;

export const ServerTime = z.object({
  server_time: IsoDateTime,
  epoch_ms: z.number().int(),
});
export type ServerTime = z.infer<typeof ServerTime>;

export const authEndpoints = {
  login: endpoint({ method: "POST", path: "/auth/login", access: PUBLIC, rateLimit: "auth", body: LoginRequest, response: TokenPair }),
  refresh: endpoint({ method: "POST", path: "/auth/refresh", access: PUBLIC, rateLimit: "auth", body: RefreshRequest, response: TokenPair }),
  /** Not in 02 §5: the request half of the attendee email link. Proposed addition. */
  emailLink: endpoint({ method: "POST", path: "/auth/email-link", access: PUBLIC, rateLimit: "auth", body: EmailLinkRequest, response: EmailLinkAccepted, status: 202 }),
  verify: endpoint({ method: "POST", path: "/auth/verify", access: PUBLIC, rateLimit: "auth", body: VerifyRequest, response: TokenPair }),
  mfaVerify: endpoint({ method: "POST", path: "/auth/mfa/verify", access: ANY_USER, rateLimit: "auth", body: MfaVerifyRequest, response: TokenPair }),
  /**
   * Not in 02 §5: ends the caller's session family. Its refresh tokens and any WebSocket tickets
   * minted under it stop working; the current access token still lives until it expires (≤ 10 min).
   */
  logout: endpoint({ method: "POST", path: "/auth/logout", access: ANY_SIGNED_IN, response: Ok }),
  wsTicket: endpoint({ method: "POST", path: "/auth/ws-ticket", access: ANY_SIGNED_IN, rateLimit: "auth", body: WsTicketRequest, response: WsTicket }),
  signingKeys: endpoint({ method: "GET", path: "/auth/signing-keys", access: PUBLIC, response: SigningKeys }),
  time: endpoint({ method: "GET", path: "/time", access: PUBLIC, response: ServerTime }),
} as const;
