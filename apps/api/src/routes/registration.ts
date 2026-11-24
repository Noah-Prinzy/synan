/**
 * Slice 3 — registration and the four tier flows (01 §4, 03 §2, §5).
 *
 * Tier is decided by the path, never by the client:
 *   Ordinary         POST /users/register (public) sends a sign-in link: redeeming it is the email
 *                    verification. Signed in, POST /registrations creates the confirmed Ordinary
 *                    registration. No registration exists for an address nobody has proved.
 *   VIP              PATCH /registrations/:id/tier (operator, MFA, audited).
 *   Private Invite   POST /invitations (operator, audited) mails single-use links bound to the
 *                    recipient's email hash; POST /invitations/:token/rsvp redeems one exactly once.
 *                    Unlisted events are never reachable by self-registration.
 *   Public           POST /kiosk/registrations (staffed kiosk): an anonymous attendee, no personal data.
 * Every confirmed registration is issued its credential and sent its pass (emailed single-use QR).
 */
import { randomUUID } from "node:crypto";
import type { Express } from "express";
import { ContractError } from "@synan/contracts/errors";
import { endpoints, type BatchItemRejection, type Registration } from "@synan/contracts/rest";
import type { AppContext } from "../app.js";
import { API_BRAND } from "../brand.js";
import { carrierDto, hint } from "../domain/credential-service.js";
import type { AuthContext } from "../domain/principal.js";
import { mayRunDesk, mayWorkDeskFor } from "../domain/scope.js";
import { nfcIdentifier } from "../domain/scan-service.js";
import { mount } from "../http/route.js";
import { randomToken, sha256b64url } from "../lib/crypto.js";
import type { AttendeeRow, CarrierRow, CredentialRow, EventRow, RegistrationRow } from "../repo/types.js";
import { canSeeEvent } from "./events.js";

type Json = Record<string, unknown>;
const DAY = 86_400_000;
const INVITE_TTL_MS = 14 * DAY;

export const registrationDto = (r: RegistrationRow): Registration => ({
  id: r.id,
  event_id: r.event_id,
  tier: r.tier,
  state: r.state,
  zone_presence_consent_at: r.zone_presence_consent_at?.toISOString() ?? null,
  created_at: r.created_at.toISOString(),
});

const open = (e: EventRow) => e.state === "published" || e.state === "live";
const invalid = (path: string, message: string) => new ContractError("VALIDATION_FAILED", message, [{ path, message }]);

/** Pages through a sorted id source, filtering, until `limit + 1` matches or the scan budget is spent. */
async function filteredPage<T extends { id: string }>(
  fetch: (after: string | undefined, n: number) => Promise<T[]>,
  keep: (row: T) => boolean,
  after: string | undefined,
  limit: number,
): Promise<{ items: T[]; next_cursor: string | null }> {
  const out: T[] = [];
  let cursor = after;
  for (let scanned = 0; scanned < 5000; ) {
    const batch = await fetch(cursor, 200);
    if (batch.length === 0) return { items: out, next_cursor: null };
    for (const row of batch) {
      cursor = row.id;
      if (!keep(row)) continue;
      out.push(row);
      if (out.length === limit) return { items: out, next_cursor: row.id };
    }
    scanned += batch.length;
    if (batch.length < 200) return { items: out, next_cursor: null };
  }
  // Budget spent: hand back where we stopped so the caller can continue.
  return { items: out, next_cursor: cursor ?? null };
}

export function registrationRoutes(x: Express, app: AppContext) {
  const audit = (actor: string | null, action: string, target: string, meta: Json = {}) => app.audit.append({ actorId: actor, action, target, meta });
  const now = () => new Date(app.clock.now());
  const newRegistration = (eventId: string, attendeeId: string, tier: RegistrationRow["tier"], consent: boolean): RegistrationRow => ({
    id: randomUUID(), event_id: eventId, attendee_id: attendeeId, tier, state: "confirmed",
    zone_presence_consent_at: consent ? now() : null, checked_in_at: null, created_at: now(),
  });
  /** Self-service is for listed, open events only: an unlisted event answers exactly like a missing one. */
  const selfServiceEvent = async (e: EventRow | null, ctx: AuthContext | null): Promise<EventRow> => {
    if (!e || !e.listed_bool || !open(e) || !(await canSeeEvent(app, e, ctx))) throw new ContractError("NOT_FOUND");
    return e;
  };

  /* ---- Ordinary: start with email verification ---- */
  mount(x, app, endpoints.registerUser, async ({ body, ip }) => {
    const e = await selfServiceEvent(await app.repos.events.bySlug(body.event_slug), null);
    // Every request counts against the address and the IP (this endpoint never fails on a known address).
    app.rateLimiter.hit(`ip:${ip}:${endpoints.registerUser.path}`, app.config.rateLimits.authPerMin, 60_000);
    const retry = app.rateLimiter.hit(`link:${body.email.toLowerCase()}`, 3, 15 * 60_000);
    if (retry === null) {
      // Never overwrite an existing person's identity from an unauthenticated request.
      if (!(await app.repos.attendees.byEmail(body.email))) {
        await app.repos.attendees.insert({ id: randomUUID(), user_id: null, email: body.email, full_name: body.full_name, profile_jsonb: body.profile });
      }
      await app.auth.requestEmailLink(body.email, `/events/${e.slug}/register`);
    }
    // Same answer whether the address was new, known, or limited.
    return { accepted: true as const, verification_sent: true };
  });

  /* ---- Ordinary: the verified (signed-in) attendee registers ---- */
  mount(x, app, endpoints.createRegistration, async ({ body, ctx }) => {
    const e = await selfServiceEvent(await app.repos.events.byId(body.event_id), ctx);
    const att = await app.repos.attendees.byId(ctx!.sub);
    if (!att || !att.email) throw new ContractError("FORBIDDEN");
    const reg = newRegistration(e.id, att.id, "ORDINARY", body.zone_presence_consent);
    if ((await app.repos.registrations.insert(reg)) === "duplicate") throw new ContractError("CONFLICT", "You are already registered for this event.");
    if (Object.keys(body.profile).length) await app.repos.attendees.update(att.id, { profile_jsonb: { ...att.profile_jsonb, ...body.profile } });
    await app.credentials.issueAndSend(reg.id);
    return registrationDto(reg);
  });

  /* ---- operators: an event's registrations ---- */
  mount(x, app, endpoints.eventRegistrations, async ({ params, query, ctx }) => {
    const e = await app.repos.events.byId(params.id);
    // Desk clerks see only the events at their desk; another event answers like a missing one (D-23).
    if (!e || !(await mayWorkDeskFor(app, ctx!, e))) throw new ContractError("NOT_FOUND");
    const clerk = ctx!.role === "desk_clerk";
    const all = await app.repos.registrations.forEvent(e.id);
    // Each registration's current credential (newest not replaced) and its live wristband.
    const creds = await app.repos.credentials.forRegistrations(all.map((r) => r.id));
    const credOf = new Map<string, CredentialRow>();
    for (const c of creds) {
      if (c.state === "replaced" || !c.registration_id) continue;
      const cur = credOf.get(c.registration_id);
      if (!cur || c.issued_at > cur.issued_at) credOf.set(c.registration_id, c);
    }
    const bandOf = new Map<string, CarrierRow>();
    for (const c of await app.repos.carriers.forCredentials([...credOf.values()].map((x) => x.id))) {
      if (c.kind === "nfc" && c.credential_id && (c.state === "assigned" || c.state === "bound" || c.state === "active")) bandOf.set(c.credential_id, c);
    }
    let matching: Set<string> | null = null;
    if (query.q) {
      // Operators search identity: a bounded decrypt-and-filter over this event's attendees (SQL backend).
      const found = await app.repos.attendees.search(query.q, { attendeeIds: [...new Set(all.map((r) => r.attendee_id))], limit: 5000 });
      matching = new Set(found.map((a) => a.id));
    }
    const regs = all
      .filter((r) => !query.tier || r.tier === query.tier)
      .filter((r) => !query.state || r.state === query.state)
      .filter((r) => !query.credential || credOf.get(r.id)?.state === query.credential)
      .filter((r) => query.unbound === undefined || (query.unbound ? !bandOf.has(credOf.get(r.id)?.id ?? "") : bandOf.has(credOf.get(r.id)?.id ?? "")))
      .filter((r) => !matching || matching.has(r.attendee_id))
      .sort((a, b) => a.id.localeCompare(b.id))
      .filter((r) => !query.cursor || r.id > query.cursor);
    const page = regs.slice(0, query.limit);
    const people = new Map((await app.repos.attendees.byIds(page.map((r) => r.attendee_id))).map((a) => [a.id, a]));
    return {
      items: page.map((r) => {
        const a = people.get(r.attendee_id);
        const cred = credOf.get(r.id) ?? null;
        const band = cred ? bandOf.get(cred.id) : undefined;
        return {
          ...registrationDto(r), attendee: { id: r.attendee_id, full_name: a?.full_name ?? null, email: a?.email ?? null },
          credential_id: cred?.id ?? null, credential_state: cred?.state ?? null, band_hint: band ? hint(band) : null,
          // A desk clerk sees identity, tier and states only: no check-in time (D-23).
          ...(clerk ? {} : { checked_in_at: r.checked_in_at?.toISOString() ?? null }),
        };
      }),
      next_cursor: regs.length > query.limit ? page.at(-1)!.id : null,
      total: all.length,
    };
  });

  /* ---- VIP and every manual tier change: MFA + audited ---- */
  mount(x, app, endpoints.changeTier, async ({ params, body, ctx }) => {
    const reg = await app.repos.registrations.byId(params.id);
    if (!reg) throw new ContractError("NOT_FOUND");
    const e = await app.repos.events.byId(reg.event_id);
    if (!e || e.state === "closed" || e.state === "archived") throw new ContractError("CONFLICT", "The event is closed; tiers are frozen.");
    if (reg.state === "cancelled") throw new ContractError("CONFLICT", "The registration is cancelled.");
    if (reg.tier === body.tier) return registrationDto(reg);
    const updated = await app.repos.registrations.update(reg.id, { tier: body.tier });
    await audit(ctx!.sub, "registration.tier_change", `registration:${reg.id}`, { event_id: reg.event_id, from: reg.tier, to: body.tier, reason: body.reason });
    app.credentials.events.emit("entitlements", { event_id: reg.event_id, registration_id: reg.id, attendee_id: reg.attendee_id });
    return registrationDto(updated);
  });

  /* ---- Private Invitation ---- */
  mount(x, app, endpoints.createInvitations, async ({ body, ctx }) => {
    const e = await app.repos.events.byId(body.event_id);
    if (!e) throw new ContractError("NOT_FOUND");
    if (e.state === "closed" || e.state === "archived") throw new ContractError("CONFLICT", "The event is closed.");
    if (!e.ends_at) throw new ContractError("CONFLICT", "Set the event's dates before inviting anyone.");
    const endsAt = e.ends_at.getTime();
    const t = app.clock.now();
    let expires = Math.min(t + INVITE_TTL_MS, endsAt);
    if (body.expires_at) {
      expires = Date.parse(body.expires_at);
      if (expires <= t) throw invalid("body.expires_at", "must be in the future");
      if (expires > endsAt) throw invalid("body.expires_at", "must not be after the event ends");
    }
    if (expires <= t) throw new ContractError("CONFLICT", "The event has ended.");
    const items = [];
    const rejected: BatchItemRejection[] = [];
    const seen = new Set<string>();
    for (const [index, email] of body.emails.entries()) {
      const emailHash = app.repos.invitations.hashEmail(email);
      if (seen.has(emailHash)) {
        rejected.push({ index, code: "CONFLICT", message: "This address appears earlier in the list." });
        continue;
      }
      seen.add(emailHash);
      const token = randomToken(32);
      const row = { id: randomUUID(), event_id: e.id, email_hash: emailHash, token_hash: sha256b64url(token), state: "sent" as const, expires_at: new Date(expires), redeemed_at: null, created_at: new Date(t) };
      // Token in the fragment: never in a request line or a Referer.
      const link = `${app.config.attendeeAppOrigin}/invite#token=${token}`;
      // The invitation and its email are one unit of work (per item: one refusal never undoes the others).
      const inserted = await app.repos.transaction(async (s) => {
        if ((await s.repos.invitations.insert(row)) === "duplicate") return false;
        await app.mail.send({ to: email, tag: "invitation", subject: API_BRAND.mail.passSubject(e.title), text: `You are invited to ${e.title}.\n\nReply here (the link works once):\n${link}` }, s);
        return true;
      });
      if (!inserted) {
        rejected.push({ index, code: "CONFLICT", message: "This address already has an open invitation to this event." });
        continue;
      }
      items.push({ id: row.id, event_id: row.event_id, state: row.state, expires_at: row.expires_at.toISOString(), redeemed_at: null });
    }
    // No addresses in the audit log: counts only.
    await audit(ctx!.sub, "invitation.create", `event:${e.id}`, { sent: items.length, rejected: rejected.length, invitation_ids: items.map((i) => i.id) });
    return { items, rejected };
  });

  mount(x, app, endpoints.rsvp, async ({ params, body }) => {
    const inv = await app.repos.invitations.byTokenHash(sha256b64url(params.token));
    // Unknown, used, declined and wrong-address all look alike: nothing about the invitation leaks.
    if (!inv || inv.state === "redeemed" || inv.state === "revoked") throw new ContractError("LINK_INVALID");
    if (!app.repos.invitations.hashCandidates(body.email).includes(inv.email_hash)) throw new ContractError("LINK_INVALID");
    const e = await app.repos.events.byId(inv.event_id);
    if (inv.state === "expired" || inv.expires_at.getTime() <= app.clock.now() || !e || !open(e)) throw new ContractError("LINK_EXPIRED");
    if (!body.accept) {
      if (!(await app.repos.invitations.consume(inv.id, "revoked", now()))) throw new ContractError("LINK_INVALID");
      return { registration: null };
    }
    let att: AttendeeRow | null = await app.repos.attendees.byEmail(body.email);
    if (!att) {
      att = { id: randomUUID(), user_id: null, email: body.email, full_name: body.full_name, profile_jsonb: body.profile };
      await app.repos.attendees.insert(att);
    }
    if ((await app.repos.registrations.forAttendee(att.id)).some((r) => r.event_id === e.id)) {
      throw new ContractError("CONFLICT", "You are already registered for this event.");
    }
    // Single use, even under concurrency: only one RSVP flips the invitation.
    if (!(await app.repos.invitations.consume(inv.id, "redeemed", now()))) throw new ContractError("LINK_INVALID");
    const reg = newRegistration(e.id, att.id, "PRIVATE_INVITE", body.zone_presence_consent);
    if ((await app.repos.registrations.insert({ ...reg, invitation_id: inv.id })) === "duplicate") {
      throw new ContractError("CONFLICT", "You are already registered for this event.");
    }
    await app.credentials.issueAndSend(reg.id);
    return { registration: registrationDto(reg) };
  });

  /* ---- Public tier at a kiosk ---- */
  mount(x, app, endpoints.kioskRegister, async ({ body, ctx }) => {
    const e = await app.repos.events.byId(body.event_id);
    if (!e || !open(e) || !e.venue_id) throw new ContractError("NOT_FOUND");
    // Staff run a kiosk only at a perimeter desk of this venue, inside their shift (server time).
    if (!(await mayRunDesk(app, ctx!, e.venue_id))) {
      throw new ContractError("CHECKPOINT_NOT_ASSIGNED", "A kiosk runs only at a perimeter desk you are staffing now.");
    }
    const bandHash = body.band_uid ? nfcIdentifier(body.band_uid) : null;
    if (bandHash) {
      const band = await app.repos.carriers.byIdentifier("nfc", bandHash);
      if (!band || band.state !== "stock") throw invalid("body.band_uid", "this band is not in stock");
    }
    const attendee: AttendeeRow = { id: randomUUID(), user_id: null, email: null, full_name: null, profile_jsonb: {} };
    await app.repos.attendees.insert(attendee);
    const reg = newRegistration(e.id, attendee.id, "PUBLIC", body.zone_presence_consent);
    await app.repos.registrations.insert(reg);
    const { credential, code } = await app.credentials.issueAndSend(reg.id);
    let carrier = null;
    if (bandHash) {
      const r = await app.repos.carriers.bind({ identifier: bandHash, credentialId: credential.id, actorId: ctx!.sub, now: now() });
      if (r.status === "bound" && r.carrier_id) carrier = carrierDto((await app.repos.carriers.forCredential(credential.id)).find((c) => c.id === r.carrier_id)!);
    }
    await audit(ctx!.sub, "registration.kiosk", `registration:${reg.id}`, { event_id: e.id, band: carrier !== null });
    return { registration: registrationDto(reg), pass_code: code ?? "", carrier };
  });

  /* ---- operators: attendees ---- */
  mount(x, app, endpoints.listAttendees, async ({ query, ctx }) => {
    const needle = query.q?.trim().toLowerCase() || undefined;
    let ids: string[] | undefined;
    if (query.event_id) {
      const e = await app.repos.events.byId(query.event_id);
      if (!e) throw new ContractError("NOT_FOUND");
      ids = [...new Set((await app.repos.registrations.forEvent(e.id)).map((r) => r.attendee_id))].sort();
    }
    let page: { items: AttendeeRow[]; next_cursor: string | null };
    if (needle) {
      // Bounded decrypt-and-filter (no searchable index of names exists, by decision); one page, no cursor.
      page = { items: await app.repos.attendees.search(needle, { attendeeIds: ids, limit: query.limit }), next_cursor: null };
    } else if (ids) {
      const scope = ids;
      page = await filteredPage(
        async (after, n) => app.repos.attendees.byIds(scope.filter((id) => !after || id > after).slice(0, n)).then((rows) => rows.sort((a, b) => a.id.localeCompare(b.id))),
        () => true, query.cursor, query.limit,
      );
    } else {
      page = await filteredPage((after, n) => app.repos.attendees.list({ after, limit: n }), () => true, query.cursor, query.limit);
    }
    const counts = await app.repos.registrations.countByAttendee(page.items.map((a) => a.id));
    // Searching identities is itself recorded (03 §5): never the search text, which may be an address.
    if (needle) await audit(ctx!.sub, "attendee.search", query.event_id ? `event:${query.event_id}` : "attendees", { query_length: needle.length, results: page.items.length });
    return {
      items: page.items.map((a) => ({ id: a.id, full_name: a.full_name, email: a.email, registrations: counts.get(a.id) ?? 0 })),
      next_cursor: page.next_cursor,
    };
  });

  mount(x, app, endpoints.updateProfile, async ({ params, body, ctx }) => {
    // An attendee edits only their own identity; another id answers as if it did not exist.
    if (ctx!.kind === "attendee" && params.id !== ctx!.sub) throw new ContractError("NOT_FOUND");
    const att = await app.repos.attendees.byId(params.id);
    if (!att || (att.email === null && att.full_name === null && ctx!.kind === "attendee")) throw new ContractError("NOT_FOUND");
    const ok = await app.repos.attendees.update(att.id, {
      ...(body.full_name !== undefined ? { full_name: body.full_name } : {}),
      ...(body.profile !== undefined ? { profile_jsonb: body.profile } : {}),
    });
    if (!ok) throw new ContractError("NOT_FOUND");
    if (ctx!.kind === "operator") await audit(ctx!.sub, "attendee.profile_update", `attendee:${att.id}`, { fields: Object.keys(body) });
    return { ok: true as const };
  });
}
