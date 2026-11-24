/** Credentials and their QR carriers (01 §5, 03 §2, D-05, D-12). */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { ContractError } from "@synan/contracts/errors";
import type { CredentialState } from "@synan/contracts/enums";
import type { Credential, MyCredential, PortalCodeBatch } from "@synan/contracts/rest";
import { API_BRAND } from "../brand.js";
import type { Config } from "../config.js";
import type { Clock } from "../lib/clock.js";
import { randomToken, sha256b64url } from "../lib/crypto.js";
import type { MailService } from "./mail.js";
import { NOTE, type NotificationService } from "./notifications.js";
import type { CarrierRow, CredentialRow, RegistrationRow, Repos } from "../repo/types.js";
import type { AuditService } from "./audit.js";
import { evaluateAccess } from "./decision.js";
import { currentOf, eventRef } from "./event-ref.js";
import type { AuthContext } from "./principal.js";
import type { QrService } from "./qr.js";

export function credentialRef(): string {
  return createHash("sha256").update(randomBytes(32)).digest().subarray(0, 16).toString("base64url");
}

export function hint(c: CarrierRow): string {
  if (c.kind === "nfc") return `band ••${(c.identifier ?? "").slice(-4)}`;
  if (c.kind === "qr_email") return "emailed code";
  return "app pass";
}

export function carrierDto(c: CarrierRow): Credential["carriers"][number] {
  return {
    id: c.id,
    credential_id: c.credential_id,
    kind: c.kind,
    identifier_hint: hint(c),
    chip_profile: c.chip_profile,
    state: c.state,
    bound_at: c.bound_at?.toISOString() ?? null,
    redeemed_at: c.redeemed_at?.toISOString() ?? null,
  };
}

export class CredentialService {
  /** Emits `state` { event_id, registration_id, attendee_id, state } for `/stream/me`. */
  readonly events = new EventEmitter();

  constructor(
    private readonly repos: Repos,
    private readonly qr: QrService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly config: Config,
    private readonly clock: Clock,
    private readonly notes: NotificationService,
  ) {}

  /** Issue a credential for a registration. The secret is generated, hashed, and discarded. */
  async issueForRegistration(registrationId: string): Promise<CredentialRow> {
    const row: CredentialRow = {
      id: randomUUID(),
      registration_id: registrationId,
      staff_user_id: null,
      // 128-bit credential reference: first 16 bytes of SHA-256 of a 256-bit secret, base64url (22 chars).
      // It is what QR codes and the offline allowlist carry; the secret itself is discarded.
      token_hash: credentialRef(),
      state: "issued",
      zone_state: "OUTSIDE",
      issued_at: new Date(this.clock.now()),
      revoked_at: null,
    };
    await this.repos.credentials.insert(row);
    await this.repos.carriers.insert({
      id: randomUUID(),
      credential_id: row.id,
      kind: "qr_portal",
      identifier: null, // portal codes are signed per request; nothing to look up
      chip_profile: null,
      state: "active",
      bound_at: row.issued_at,
      redeemed_at: null,
    });
    await this.notes.forRegistration(registrationId, NOTE.passIssued);
    return row;
  }

  /**
   * Resolve the attendee's registration for an event; without one, their only pass, else the
   * current one (the live event's, else the next to start, else the most recent).
   */
  private async registrationFor(attendeeId: string, eventId?: string): Promise<RegistrationRow> {
    const regs = (await this.repos.registrations.forAttendee(attendeeId)).filter((r) => r.state === "confirmed");
    let reg = eventId ? regs.find((r) => r.event_id === eventId) : regs.length === 1 ? regs[0] : undefined;
    if (!eventId && regs.length > 1) {
      const items = [];
      for (const r of regs) {
        const event = await this.repos.events.byId(r.event_id);
        if (event) items.push({ item: r, event });
      }
      reg = currentOf(items, this.clock.now()) ?? undefined;
    }
    if (!reg) throw new ContractError("NO_CREDENTIAL");
    return reg;
  }

  async myCredential(attendeeId: string, eventId?: string): Promise<MyCredential> {
    const reg = await this.registrationFor(attendeeId, eventId);
    const event = await this.repos.events.byId(reg.event_id);
    const cred = await this.repos.credentials.forRegistration(reg.id);
    if (!cred) throw new ContractError("NO_CREDENTIAL");
    const carriers = await this.repos.carriers.forCredential(cred.id);
    const rules = await this.repos.events.accessRules(reg.event_id);
    const rooms = await this.repos.events.rooms(reg.event_id);
    const now = this.clock.now();
    const permitted = rooms
      .map((r) => r.room_id)
      .filter((roomId) =>
        evaluateAccess(
          rules.map((x) => ({ ...x, window_start: x.window_start?.getTime() ?? null, window_end: x.window_end?.getTime() ?? null })),
          { kind: "tier", value: reg.tier },
          roomId,
          now,
        ),
      );
    return {
      event_id: reg.event_id,
      registration_id: reg.id,
      tier: reg.tier,
      state: cred.state,
      carriers: carriers.filter((c) => c.state !== "retired").map((c) => ({ kind: c.kind, state: c.state, identifier_hint: hint(c) })),
      permitted_room_ids: permitted,
      ...(event ? { event: await eventRef(this.repos, event) } : {}),
    };
  }

  /** A batch of consecutive short-lived signed portal codes (D-12, O-07). */
  async portalCodes(attendeeId: string, eventId?: string): Promise<PortalCodeBatch> {
    const reg = await this.registrationFor(attendeeId, eventId);
    const cred = await this.repos.credentials.forRegistration(reg.id);
    if (!cred) throw new ContractError("NO_CREDENTIAL");
    if (cred.state === "revoked" || cred.state === "replaced") throw new ContractError("NO_CREDENTIAL", "This pass has been revoked.");
    const now = this.clock.now();
    const { kid, codes } = await this.qr.portalBatch(cred.token_hash, now, this.config.qrBatchSize);
    return { kid, codes, rotate_every_s: this.config.qrCodeTtlS, server_time: new Date(now).toISOString() };
  }

  /**
   * Issue a fresh single-use emailed QR (D-05). Any earlier emailed code for this credential
   * is retired, so only the newest email works.
   */
  async sendEmailedQr(credentialId: string): Promise<{ code: string; carrierId: string }> {
    const cred = await this.repos.credentials.byId(credentialId);
    if (!cred || !cred.registration_id) throw new ContractError("NOT_FOUND");
    if (cred.state === "revoked" || cred.state === "replaced") throw new ContractError("CONFLICT", "Credential is revoked.");
    const reg = await this.repos.registrations.byId(cred.registration_id);
    const event = reg ? await this.repos.events.byId(reg.event_id) : null;
    const attendee = reg ? await this.repos.attendees.byId(reg.attendee_id) : null;
    if (!reg || !event) throw new ContractError("NOT_FOUND");
    const cid = randomToken(16);
    const now = this.clock.now();
    const carrierId = randomUUID();
    // Registrations exist only for published events, which always have dates (a draft has none to register for).
    if (!event.ends_at) throw new ContractError("CONFLICT", "The event has no dates yet.");
    const code = await this.qr.emailCode(cred.token_hash, cid, now, event.ends_at.getTime() + 24 * 3600 * 1000);
    // The new code, the retirement of the old ones and the email are one unit of work: the email
    // exists only if the carrier does, and the carrier only with its email queued.
    await this.repos.transaction(async (s) => {
      for (const c of await s.repos.carriers.forCredential(cred.id)) {
        if (c.kind === "qr_email" && c.state !== "retired") await s.repos.carriers.update(c.id, { state: "retired" });
      }
      await s.repos.carriers.insert({
        id: carrierId,
        credential_id: cred.id,
        kind: "qr_email",
        identifier: sha256b64url(cid), // the code id is only ever in the signed email; we keep its hash (43 chars)
        chip_profile: null,
        state: "active",
        bound_at: new Date(now),
        redeemed_at: null,
      });
      if (attendee?.email) {
        await this.mail.send(
          {
            to: attendee.email,
            tag: "pass.email_qr",
            subject: API_BRAND.mail.passSubject(event.title),
            text: `Show this code at the entrance to collect your wristband. It works once.\n\nQR: ${code}\n\nYour pass in the app keeps working after this code is used.`,
          },
          s,
        );
      }
    });
    return { code, carrierId };
  }

  async toDto(cred: CredentialRow): Promise<Credential> {
    const reg = cred.registration_id ? await this.repos.registrations.byId(cred.registration_id) : null;
    const carriers = await this.repos.carriers.forCredential(cred.id);
    return {
      id: cred.id,
      registration_id: cred.registration_id,
      staff_user_id: cred.staff_user_id,
      tier: reg?.tier ?? null,
      state: cred.state,
      zone_state: cred.zone_state,
      issued_at: cred.issued_at.toISOString(),
      revoked_at: cred.revoked_at?.toISOString() ?? null,
      carriers: carriers.map(carrierDto),
    };
  }

  /**
   * Registration issues the credential and sends the pass (01 §1.1 stage 4). A mail failure does not
   * undo the registration: it is logged and the pass can be resent.
   */
  async issueAndSend(registrationId: string): Promise<{ credential: CredentialRow; code: string | null }> {
    const credential = await this.issueForRegistration(registrationId);
    try {
      const { code } = await this.sendEmailedQr(credential.id);
      return { credential, code };
    } catch (e) {
      console.error("[mail] pass delivery failed:", e instanceof Error ? e.message : String(e));
      return { credential, code: null };
    }
  }

  /** Tell `/stream/me` subscribers that a credential changed state. */
  notifyState(cred: CredentialRow, state: CredentialState) {
    void (async () => {
      const reg = cred.registration_id ? await this.repos.registrations.byId(cred.registration_id) : null;
      if (reg) this.events.emit("state", { event_id: reg.event_id, registration_id: reg.id, attendee_id: reg.attendee_id, state });
    })().catch(() => undefined);
  }

  private async setState(actor: AuthContext, cred: CredentialRow, state: CredentialState, action: string, meta: Record<string, unknown>) {
    const updated = await this.repos.credentials.update(cred.id, {
      state,
      ...(state === "revoked" ? { revoked_at: new Date(this.clock.now()) } : {}),
    });
    await this.audit.append({ actorId: actor.sub, action, target: `credential:${cred.id}`, meta: { from: cred.state, to: state, ...meta } });
    const reg = cred.registration_id ? await this.repos.registrations.byId(cred.registration_id) : null;
    if (reg) this.events.emit("state", { event_id: reg.event_id, registration_id: reg.id, attendee_id: reg.attendee_id, state });
    if (state === "revoked") await this.notes.forRegistration(cred.registration_id, NOTE.passRevoked);
    else if (state === "suspended_review") await this.notes.forRegistration(cred.registration_id, NOTE.passReview);
    else if (state === "active" && cred.state === "suspended_review") await this.notes.forRegistration(cred.registration_id, NOTE.passCleared);
    return updated;
  }

  /** Revoking invalidates every carrier immediately: the scan decision checks credential state at step 3. */
  async revoke(actor: AuthContext, id: string, reason: string) {
    const cred = await this.repos.credentials.byId(id);
    if (!cred) throw new ContractError("NOT_FOUND");
    if (cred.state === "revoked") return this.toDto(cred);
    return this.toDto(await this.setState(actor, cred, "revoked", "credential.revoke", { reason }));
  }

  async clearReview(actor: AuthContext, id: string, outcome: "clear" | "revoke", note: string) {
    const cred = await this.repos.credentials.byId(id);
    if (!cred) throw new ContractError("NOT_FOUND");
    if (cred.state !== "suspended_review") throw new ContractError("CONFLICT", "Credential is not under review.");
    const next = outcome === "clear" ? "active" : "revoked";
    return this.toDto(await this.setState(actor, cred, next, "credential.clear_review", { outcome, note }));
  }
}
