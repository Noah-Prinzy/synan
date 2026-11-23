/**
 * Authentication (03 §3).
 *
 * - Access tokens: EdDSA JWTs, 10 min, carrying kind + role + mfa_at + session id.
 * - Refresh tokens: opaque 256-bit, stored hashed, single-use with rotation; presenting a
 *   used refresh token revokes the whole family (theft detection).
 * - Operators/staff: email + password (scrypt). Attendees: email link only, no passwords.
 * - MFA: TOTP step-up; privileged routes require mfa_at within `mfaFreshS`.
 * - WebSocket tickets: single-use, 30 s, bound to principal + channel + scope.
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
import type { Mailer } from "../lib/mailer.js";
import type { AttendeeRow, AuthSessionRow, Repos, UserRow } from "../repo/types.js";
import { generateEd25519, importPrivate, importPublic, type Key } from "./keys.js";
import { kindForRole, type AuthContext } from "./principal.js";

const ISSUER = API_BRAND.tokenIssuer;
const AUDIENCE = API_BRAND.tokenAudience;

export interface WsTicketGrant {
  ctx: AuthContext;
  channel: WsChannel;
  eventId: string | null;
  checkpointId: string | null;
  expiresAt: number;
}

export class AuthService {
  private signKey!: Key;
  private verifyKey!: Key;
  private kid = "";
  private dummyHash = "";
  private tickets = new Map<string, WsTicketGrant>();
  /** Last accepted TOTP step per user, to refuse replay of a code within its window. */
  private lastTotp = new Map<string, { code: string; at: number }>();

  constructor(
    private readonly repos: Repos,
    private readonly config: Config,
    private readonly mailer: Mailer,
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
    const token = await new SignJWT({ knd: ctx.kind, rol: ctx.role, mfa: ctx.mfaAt ? Math.floor(ctx.mfaAt / 1000) : null, sid: ctx.sid })
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

  /** Start a new session (refresh family) or rotate within one. */
  private async issue(ctx: AuthContext, row: UserRow | AttendeeRow, familyId: string): Promise<TokenPair> {
    const refresh = randomToken(32);
    const ttl = ctx.kind === "attendee" ? this.config.attendeeRefreshTtlS : this.config.operatorRefreshTtlS;
    const session: AuthSessionRow = {
      id: randomUUID(),
      principal_kind: ctx.kind === "attendee" ? "attendee" : "user",
      principal_id: ctx.sub,
      refresh_hash: sha256b64url(refresh),
      family_id: familyId,
      expires_at: new Date(this.now() + ttl * 1000),
      used_at: null,
      revoked_at: null,
      mfa_at: ctx.mfaAt ? new Date(ctx.mfaAt) : null,
    };
    await this.repos.auth.insertSession(session);
    const at = await this.accessToken({ ...ctx, sid: familyId });
    return {
      token_type: "Bearer",
      access_token: at.token,
      access_expires_at: new Date(at.exp).toISOString(),
      refresh_token: refresh,
      refresh_expires_at: session.expires_at.toISOString(),
      principal: this.principalOf({ ...ctx, sid: familyId }, row),
    };
  }

  /* ------------------------------------------------------------------ flows */

  async login(email: string, password: string): Promise<TokenPair> {
    const user = await this.repos.users.byEmail(email);
    // Always run the hash, so an unknown email costs the same time as a wrong password.
    const ok = await verifyPassword(password, user?.password_hash ?? this.dummyHash);
    if (!user || !ok) throw new ContractError("INVALID_CREDENTIALS");
    const family = randomUUID();
    return this.issue({ sub: user.id, kind: kindForRole(user.role), role: user.role, mfaAt: null, sid: family }, user, family);
  }

  async refresh(refreshToken: string): Promise<TokenPair> {
    const now = this.now();
    const s = await this.repos.auth.sessionByRefreshHash(sha256b64url(refreshToken));
    if (!s || s.revoked_at || s.expires_at.getTime() <= now) throw new ContractError("UNAUTHENTICATED");
    if (!(await this.repos.auth.markSessionUsed(s.id, new Date(now)))) {
      // Reuse of a rotated refresh token: assume theft, kill the family.
      await this.repos.auth.revokeFamily(s.family_id, new Date(now));
      throw new ContractError("UNAUTHENTICATED", "Refresh token reuse detected; session revoked.");
    }
    const mfaAt = s.mfa_at?.getTime() ?? null;
    if (s.principal_kind === "user") {
      const user = await this.repos.users.byId(s.principal_id);
      if (!user) throw new ContractError("UNAUTHENTICATED");
      return this.issue({ sub: user.id, kind: kindForRole(user.role), role: user.role, mfaAt, sid: s.family_id }, user, s.family_id);
    }
    const att = await this.repos.attendees.byId(s.principal_id);
    if (!att) throw new ContractError("UNAUTHENTICATED");
    return this.issue({ sub: att.id, kind: "attendee", role: null, mfaAt: null, sid: s.family_id }, att, s.family_id);
  }

  /** Always resolves; never reveals whether the address is known. */
  async requestEmailLink(email: string, returnTo?: string): Promise<void> {
    const att = await this.repos.attendees.byEmail(email);
    if (!att || !att.email) return;
    const token = randomToken(32);
    await this.repos.auth.insertLink({
      token_hash: sha256b64url(token),
      attendee_id: att.id,
      expires_at: new Date(this.now() + this.config.emailLinkTtlS * 1000),
      used_at: null,
    });
    // Token in the fragment: never sent to a server in a request line, never in Referer.
    const qs = returnTo ? `&return_to=${encodeURIComponent(returnTo)}` : "";
    const link = `${this.config.attendeeAppOrigin}/auth/verify#token=${token}${qs}`;
    await this.mailer.send({
      to: att.email,
      tag: "auth.link",
      subject: API_BRAND.mail.signInSubject,
      text: `${API_BRAND.mail.signInIntro}\n\n${link}\n\nThis link works once and expires in ${Math.round(this.config.emailLinkTtlS / 60)} minutes. If you did not ask for it, ignore this email.`,
    });
  }

  async verifyEmailLink(token: string): Promise<TokenPair> {
    const link = await this.repos.auth.consumeLink(sha256b64url(token), new Date(this.now()));
    if (!link) throw new ContractError("LINK_EXPIRED");
    const att = await this.repos.attendees.byId(link.attendee_id);
    if (!att) throw new ContractError("LINK_INVALID");
    const family = randomUUID();
    return this.issue({ sub: att.id, kind: "attendee", role: null, mfaAt: null, sid: family }, att, family);
  }

  async mfaVerify(ctx: AuthContext, code: string): Promise<TokenPair> {
    if (ctx.kind === "attendee") throw new ContractError("FORBIDDEN");
    const user = await this.repos.users.byId(ctx.sub);
    if (!user) throw new ContractError("UNAUTHENTICATED");
    if (!user.mfa_secret || !user.mfa_enrolled_at) throw new ContractError("MFA_NOT_ENROLLED");
    const now = this.now();
    if (!verifyTotp(user.mfa_secret, code, now)) throw new ContractError("INVALID_MFA_CODE");
    // A code is valid for up to 90 s (±1 step); refuse the same code twice inside that window.
    const last = this.lastTotp.get(user.id);
    if (last && last.code === code && now - last.at < 90_000) {
      throw new ContractError("INVALID_MFA_CODE", "That code was already used.");
    }
    this.lastTotp.set(user.id, { code, at: now });
    // Revoke the current family and start a stepped-up one, so the old refresh token cannot mint mfa tokens.
    await this.repos.auth.revokeFamily(ctx.sid, new Date(now));
    const family = randomUUID();
    return this.issue({ sub: user.id, kind: ctx.kind, role: user.role, mfaAt: now, sid: family }, user, family);
  }

  isMfaFresh(ctx: AuthContext): boolean {
    return ctx.mfaAt !== null && this.now() - ctx.mfaAt < this.config.mfaFreshS * 1000;
  }

  /* -------------------------------------------------------------- ws tickets */

  mintWsTicket(grant: Omit<WsTicketGrant, "expiresAt">): { ticket: string; expiresAt: number } {
    this.sweepTickets();
    const ticket = randomToken(32);
    const expiresAt = this.now() + this.config.wsTicketTtlS * 1000;
    this.tickets.set(sha256b64url(ticket), { ...grant, expiresAt });
    return { ticket, expiresAt };
  }

  /** Single use: the ticket is deleted on first presentation, valid or not. */
  consumeWsTicket(ticket: string): WsTicketGrant | null {
    const key = sha256b64url(ticket);
    const g = this.tickets.get(key);
    this.tickets.delete(key);
    if (!g || g.expiresAt <= this.now()) return null;
    return g;
  }

  private sweepTickets() {
    const now = this.now();
    for (const [k, g] of this.tickets) if (g.expiresAt <= now) this.tickets.delete(k);
  }
}
