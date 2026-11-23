/**
 * Authentication (03 §3).
 *
 * - Access tokens: EdDSA JWTs, 10 min, carrying kind + role + mfa_at + session id.
 * - Refresh tokens: opaque 256-bit, stored hashed, single-use with rotation; presenting a
 *   used refresh token revokes the whole family (theft detection).
 * - Operators/staff: email + password (scrypt). Attendees: email link only, no passwords.
 * - MFA: TOTP step-up; privileged routes require mfa_at within `mfaFreshS`.
 * - WebSocket tickets: single-use, 30 s, bound to holder + session family + channel + scope.
 * - Sessions, links and tickets live in the repository (the database on the SQL backend), stored only
 *   as base64url SHA-256 hashes, so they survive a restart and work across instances.
 */
import { randomUUID } from "node:crypto";
import { jwtVerify, SignJWT, type JWK } from "jose";
import { ContractError } from "@synan/contracts/errors";
import type { Role, WsChannel } from "@synan/contracts/enums";
import type { Principal, TokenPair } from "@synan/contracts/rest";
import { API_BRAND } from "../brand.js";
import type { Config } from "../config.js";
import type { Clock } from "../lib/clock.js";
import { hashPassword, randomToken, sha256b64url, verifyPassword, verifyTotp } from "../lib/crypto.js";
import type { MailService } from "./mail.js";
import type { AttendeeRow, Repos, UserRow } from "../repo/types.js";
import { generateEd25519, importPrivate, importPublic, type Key } from "./keys.js";
import { kindForRole, type AuthContext } from "./principal.js";

const ISSUER = API_BRAND.tokenIssuer;
const AUDIENCE = API_BRAND.tokenAudience;

export interface WsTicketGrant {
  ctx: AuthContext;
  channel: WsChannel;
  eventId: string | null;
  checkpointId: string | null;
}

export class AuthService {
  private signKey!: Key;
  private verifyKey!: Key;
  private kid = "";
  private dummyHash = "";
  /** Highest TOTP time-step accepted per user: any code for that step or an earlier one is refused. */
  private lastTotpStep = new Map<string, number>();

  constructor(
    private readonly repos: Repos,
    private readonly config: Config,
    private readonly mail: MailService,
    private readonly clock: Clock,
  ) {}

  async init() {
    let jwk: JWK;
    if (this.config.accessTokenPrivateJwk) {
      jwk = JSON.parse(this.config.accessTokenPrivateJwk) as JWK;
    } else {
      jwk = (await generateEd25519()).privateJwk; // dev: ephemeral; tokens die on restart
    }
    this.kid = sha256b64url(String(jwk.x)).slice(0, 16);
    this.signKey = await importPrivate(jwk);
    this.verifyKey = await importPublic(jwk);
    this.dummyHash = await hashPassword(randomToken());
  }

  private now() {
    return this.clock.now();
  }

  /* ----------------------------------------------------------------- tokens */

  private async accessToken(ctx: AuthContext): Promise<{ token: string; exp: number }> {
    const iat = Math.floor(this.now() / 1000);
    const exp = iat + this.config.accessTokenTtlS;
    const token = await new SignJWT({ knd: ctx.kind, rol: ctx.role, mfa: ctx.mfaAt ? Math.floor(ctx.mfaAt / 1000) : null, sid: ctx.sid, ...(ctx.kind === "device" ? { cp: ctx.checkpointId ?? null, tv: ctx.tokenVersion ?? null } : {}) })
      .setProtectedHeader({ alg: "EdDSA", typ: "at+jwt", kid: this.kid })
      .setSubject(ctx.sub)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt(iat)
      .setExpirationTime(exp)
      .setJti(randomToken(12))
      .sign(this.signKey);
    return { token, exp: exp * 1000 };
  }

  async verifyAccess(token: string): Promise<AuthContext> {
    try {
      const { payload } = await jwtVerify(token, this.verifyKey, {
        issuer: ISSUER,
        audience: AUDIENCE,
        algorithms: ["EdDSA"],
        typ: "at+jwt",
        currentDate: new Date(this.now()),
      });
      if (typeof payload.sub !== "string" || typeof payload.sid !== "string") throw new Error("claims");
      return {
        sub: payload.sub,
        kind: payload.knd as AuthContext["kind"],
        role: (payload.rol as Role | null) ?? null,
        mfaAt: typeof payload.mfa === "number" ? payload.mfa * 1000 : null,
        sid: payload.sid,
        ...(payload.knd === "device" ? { checkpointId: typeof payload.cp === "string" ? payload.cp : null, tokenVersion: typeof payload.tv === "number" ? payload.tv : null } : {}),
      };
    } catch (e) {
      const code = (e as { code?: string }).code;
      throw new ContractError(code === "ERR_JWT_EXPIRED" ? "TOKEN_EXPIRED" : "UNAUTHENTICATED");
    }
  }

  private principalOf(ctx: AuthContext, row: UserRow | AttendeeRow): Principal {
    const isUser = "role" in row;
    return {
      sub: ctx.sub,
      kind: ctx.kind,
      role: ctx.role,
      email: row.email ?? null,
      mfa: ctx.mfaAt !== null && this.now() - ctx.mfaAt < this.config.mfaFreshS * 1000,
      mfa_enrolled: isUser ? (row as UserRow).mfa_enrolled_at !== null : false,
    };
  }

  private refreshTtlMs(kind: AuthContext["kind"]) {
    return (kind === "attendee" ? this.config.attendeeRefreshTtlS : this.config.operatorRefreshTtlS) * 1000;
  }

  private async tokens(ctx: AuthContext, row: UserRow | AttendeeRow, refresh: string, refreshExpiresAt: Date): Promise<TokenPair> {
    const at = await this.accessToken(ctx);
    return {
      token_type: "Bearer",
      access_token: at.token,
      access_expires_at: new Date(at.exp).toISOString(),
      refresh_token: refresh,
      refresh_expires_at: refreshExpiresAt.toISOString(),
      principal: this.principalOf(ctx, row),
    };
  }

  /** Start a new refresh-token family (login, email-link sign-in, MFA step-up). Stored only as a hash. */
  private async startFamily(ctx: Omit<AuthContext, "sid">, row: UserRow | AttendeeRow): Promise<TokenPair> {
    const familyId = randomUUID();
    const refresh = randomToken(32);
    const now = new Date(this.now());
    const expiresAt = new Date(now.getTime() + this.refreshTtlMs(ctx.kind));
    await this.repos.auth.startSession({
      holder: ctx.kind === "attendee" ? { attendeeId: ctx.sub } : { userId: ctx.sub },
      familyId,
      tokenHash: sha256b64url(refresh),
      expiresAt,
      mfaAt: ctx.mfaAt ? new Date(ctx.mfaAt) : null,
      now,
    });
    return this.tokens({ ...ctx, sid: familyId }, row, refresh, expiresAt);
  }

  /* ------------------------------------------------------------------ flows */

  async login(email: string, password: string): Promise<TokenPair> {
    const user = await this.repos.users.byEmail(email);
    // Always run the hash, so an unknown email costs the same time as a wrong password.
    const ok = await verifyPassword(password, user?.password_hash ?? this.dummyHash);
    if (!user || !ok) throw new ContractError("INVALID_CREDENTIALS");
    return this.startFamily({ sub: user.id, kind: kindForRole(user.role), role: user.role, mfaAt: null }, user);
  }

  /**
   * Exchange a refresh token, strictly single-use (one atomic call on the SQL backend).
   *
   * Known behaviour, kept as built: two near-simultaneous refreshes of one token from the same client
   * (two tabs, a retried request) are indistinguishable from theft — the second is reuse and ends the
   * whole session. A grace window, if wanted, belongs in the rotate operation itself (the SQL function
   * auth_rotate_session in @synan/db, and its in-memory mirror): when the presented row was rotated
   * less than N seconds ago and its child has not itself been used, return the child instead of
   * revoking. It must not be emulated here, outside the row lock.
   */
  async refresh(refreshToken: string): Promise<TokenPair> {
    const now = new Date(this.now());
    const next = randomToken(32);
    // Operators and attendees have different refresh lifetimes; the store picks one by the token's
    // holder inside the same locked exchange, so there is no separate lookup first.
    const r = await this.repos.auth.rotateSession({
      tokenHash: sha256b64url(refreshToken),
      newTokenHash: sha256b64url(next),
      ttl: { userSeconds: this.config.operatorRefreshTtlS, attendeeSeconds: this.config.attendeeRefreshTtlS },
      now,
    });
    if (r.status === "reuse_detected") throw new ContractError("UNAUTHENTICATED", "Refresh token reuse detected; session revoked.");
    if (r.status !== "rotated" || !r.family_id || !r.expires_at) throw new ContractError("UNAUTHENTICATED");
    const expiresAt = r.expires_at;
    const mfaAt = r.mfa_at?.getTime() ?? null;
    if (r.user_id) {
      const user = await this.repos.users.byId(r.user_id);
      if (!user) throw new ContractError("UNAUTHENTICATED");
      const ctx: AuthContext = { sub: user.id, kind: kindForRole(user.role), role: user.role, mfaAt, sid: r.family_id };
      return this.tokens(ctx, user, next, expiresAt);
    }
    const att = r.attendee_id ? await this.repos.attendees.byId(r.attendee_id) : null;
    if (!att) throw new ContractError("UNAUTHENTICATED");
    return this.tokens({ sub: att.id, kind: "attendee", role: null, mfaAt: null, sid: r.family_id }, att, next, expiresAt);
  }

  /** Ends the caller's session family: its refresh tokens and any tickets minted under it stop working. */
  async logout(ctx: AuthContext): Promise<void> {
    await this.repos.auth.revokeFamily(ctx.sid, "logout", new Date(this.now()));
  }

  /**
   * Always resolves at once; never reveals whether the address is known. The lookup, the link and
   * its outbox email are written off the request path in one unit of work, so neither a slow
   * database lookup nor the mail provider makes a known address answer differently (slower, or 500)
   * from an unknown one. Failures are logged without the address.
   */
  async requestEmailLink(email: string, returnTo?: string): Promise<void> {
    this.mail.background("auth.link", () => this.issueEmailLink(email, returnTo));
  }

  private async issueEmailLink(email: string, returnTo?: string): Promise<void> {
    const att = await this.repos.attendees.byEmail(email);
    if (!att || !att.email) return;
    const to = att.email;
    const token = randomToken(32);
    const now = new Date(this.now());
    // Token in the fragment: never sent to a server in a request line, never in Referer.
    const qs = returnTo ? `&return_to=${encodeURIComponent(returnTo)}` : "";
    const link = `${this.config.attendeeAppOrigin}/auth/verify#token=${token}${qs}`;
    await this.repos.transaction(async (s) => {
      await s.repos.auth.createLink({ tokenHash: sha256b64url(token), attendeeId: att.id, expiresAt: new Date(now.getTime() + this.config.emailLinkTtlS * 1000), now });
      await this.mail.send(
        {
          to,
          tag: "auth.link",
          subject: API_BRAND.mail.signInSubject,
          text: `${API_BRAND.mail.signInIntro}\n\n${link}\n\nThis link works once and expires in ${Math.round(this.config.emailLinkTtlS / 60)} minutes. If you did not ask for it, ignore this email.`,
        },
        s,
      );
    });
  }

  async verifyEmailLink(token: string): Promise<TokenPair> {
    const r = await this.repos.auth.redeemLink(sha256b64url(token), new Date(this.now()));
    if (r.status === "invalid") throw new ContractError("LINK_INVALID");
    if (r.status !== "redeemed" || !r.attendee_id) throw new ContractError("LINK_EXPIRED");
    const att = await this.repos.attendees.byId(r.attendee_id);
    if (!att) throw new ContractError("LINK_INVALID");
    return this.startFamily({ sub: att.id, kind: "attendee", role: null, mfaAt: null }, att);
  }

  async mfaVerify(ctx: AuthContext, code: string): Promise<TokenPair> {
    if (ctx.kind === "attendee") throw new ContractError("FORBIDDEN");
    const user = await this.repos.users.byId(ctx.sub);
    if (!user) throw new ContractError("UNAUTHENTICATED");
    if (!user.mfa_secret || !user.mfa_enrolled_at) throw new ContractError("MFA_NOT_ENROLLED");
    const now = this.now();
    const step = verifyTotp(user.mfa_secret, code, now);
    if (step === null) throw new ContractError("INVALID_MFA_CODE");
    // Replay guard by time-step (in process for now): once a step is used, it and every earlier step
    // are spent, so an observed code cannot be reused even after a newer code has been accepted.
    if (step <= (this.lastTotpStep.get(user.id) ?? -Infinity)) {
      throw new ContractError("INVALID_MFA_CODE", "That code was already used.");
    }
    this.lastTotpStep.set(user.id, step);
    // Revoke the current family and start a stepped-up one, so the old refresh token cannot mint mfa tokens.
    await this.repos.auth.revokeFamily(ctx.sid, "mfa_step_up", new Date(now));
    return this.startFamily({ sub: user.id, kind: ctx.kind, role: user.role, mfaAt: now }, user);
  }

  /**
   * Fixed readers (O-17): a device token, stored only as a hash, buys a short-lived access token for
   * the `device` principal, bound to the device's one checkpoint. No refresh token: the reader
   * re-presents its device token when the access token expires.
   */
  async deviceToken(token: string) {
    const d = await this.repos.devices.authenticate(token);
    if (!d || (d.kind === "fixed_reader" && !d.checkpoint_id)) throw new ContractError("INVALID_CREDENTIALS");
    const at = await this.accessToken({ sub: d.id, kind: "device", role: null, mfaAt: null, sid: d.id, checkpointId: d.checkpoint_id, tokenVersion: d.token_version });
    return { token_type: "Bearer" as const, access_token: at.token, access_expires_at: new Date(at.exp).toISOString(), device_id: d.id, checkpoint_id: d.checkpoint_id };
  }

  isMfaFresh(ctx: AuthContext): boolean {
    return ctx.mfaAt !== null && this.now() - ctx.mfaAt < this.config.mfaFreshS * 1000;
  }

  /* -------------------------------------------------------------- ws tickets */

  /** Single-use, 30 s; stored only as a hash, bound to the holder, the session family, channel and scope. */
  async mintWsTicket(grant: { ctx: AuthContext; channel: WsChannel; eventId: string | null; checkpointId: string | null }): Promise<{ ticket: string; expiresAt: number }> {
    const ticket = randomToken(32);
    const now = new Date(this.now());
    const expiresAt = now.getTime() + this.config.wsTicketTtlS * 1000;
    await this.repos.auth.mintTicket({
      ticketHash: sha256b64url(ticket),
      holder: grant.ctx.kind === "attendee" ? { attendeeId: grant.ctx.sub } : { userId: grant.ctx.sub },
      sessionFamilyId: grant.ctx.sid,
      channel: grant.channel,
      eventId: grant.eventId,
      checkpointId: grant.checkpointId,
      expiresAt: new Date(expiresAt),
      now,
    });
    return { ticket, expiresAt };
  }

  /**
   * Single use: consumed on first presentation, valid or not. Only `valid` admits (expired, already
   * used, unknown, or minted under a since-revoked session all refuse). The ticket stores the holder,
   * not the role, so the role is re-read now — a role changed since minting is the one that counts.
   */
  async consumeWsTicket(ticket: string): Promise<WsTicketGrant | null> {
    const r = await this.repos.auth.consumeTicket(sha256b64url(ticket), new Date(this.now()));
    if (r.status !== "valid" || !r.channel) return null;
    let ctx: AuthContext;
    if (r.user_id) {
      const user = await this.repos.users.byId(r.user_id);
      if (!user) return null;
      ctx = { sub: user.id, kind: kindForRole(user.role), role: user.role, mfaAt: null, sid: r.session_family_id ?? "" };
    } else if (r.attendee_id) {
      ctx = { sub: r.attendee_id, kind: "attendee", role: null, mfaAt: null, sid: r.session_family_id ?? "" };
    } else return null;
    return { ctx, channel: r.channel, eventId: r.event_id, checkpointId: r.checkpoint_id };
  }

  /** Scheduled: delete expired sign-in state. */
  async cleanup() {
    return this.repos.auth.cleanup(new Date(this.now()));
  }
}
