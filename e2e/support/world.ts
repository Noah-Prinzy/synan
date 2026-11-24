/**
 * Fixtures made through the API's own endpoints, the way an organiser and an admin would make them:
 * a venue with a drawn layout, a live event on it, gates, staff with shifts, and attendees. Every
 * journey builds its own world, so counts start at zero and nothing is shared with another test.
 */
import { randomUUID } from "node:crypto";
import type { TokenPair } from "@synan/contracts/rest";
import { adminApi, api, caller, ctl, linkIn, mailMark, uniq, waitForMail, type Caller } from "./api.ts";

const H = 3600_000;

export interface Gate {
  id: string;
  label: string;
  perimeter: boolean;
  roomId: string | null;
  /** The security-staff member on shift here. */
  staff: { id: string; email: string; password: string };
}

export interface World {
  admin: Caller;
  venueId: string;
  venueName: string;
  eventId: string;
  slug: string;
  title: string;
  zoneId: string;
  rooms: { hall: { id: string; name: string }; lounge: { id: string; name: string } };
  gates: { entrance: Gate; lounge: Gate };
}

export interface StaffUser {
  id: string;
  email: string;
  password: string;
  role: string;
}

/** Invite a staff member and redeem the emailed activation link through POST /auth/activate. */
export async function createStaff(admin: Caller, role: string, label = role): Promise<StaffUser> {
  const email = `${uniq(`e2e-${label}`)}@synan.dev`.toLowerCase();
  const password = `pw-${randomUUID()}`;
  const mark = await mailMark();
  const user = await admin.call<{ id: string }>("POST", "/staff", { email, role, display_name: `E2E ${label}` });
  const mail = await waitForMail({ to: email, tag: "staff.invite", after: mark });
  const token = new URL(linkIn(mail)).hash.match(/token=([^&]+)/)?.[1];
  if (!token) throw new Error(`no activation token in ${linkIn(mail)}`);
  await api("POST", "/auth/activate", { body: { token: decodeURIComponent(token), password } });
  return { id: user.id, email, password, role };
}

export async function signIn(email: string, password: string): Promise<Caller> {
  const pair = await api<TokenPair>("POST", "/auth/login", { body: { email, password } });
  return caller(pair.access_token);
}

/** A shift from an hour ago to eight hours from now at this gate. */
export async function assign(admin: Caller, userId: string, checkpointId: string, eventId: string) {
  const { now } = await ctl.clock();
  return admin.call<{ id: string }>("POST", "/staff-assignments", {
    user_id: userId, checkpoint_id: checkpointId, event_id: eventId,
    shift_start: new Date(now - 1 * H).toISOString(), shift_end: new Date(now + 8 * H).toISOString(),
  });
}

/**
 * A venue ("E2E Hall …") with one zone and two rooms drawn on the grid, a perimeter entrance and an
 * interior lounge door (wristband only), and a live event on it with ORDINARY admitted to the hall
 * and VIP to both rooms. One security-staff member is on shift at each gate.
 */
export async function createWorld(opts: { name?: string } = {}): Promise<World> {
  const admin = await adminApi();
  const { now } = await ctl.clock();
  const tag = uniq(opts.name ?? "w");
  const venueName = `E2E Hall ${tag}`;
  const venue = await admin.call<{ id: string }>("POST", "/venues", { name: venueName, address: "1 Test Street", timezone: "Africa/Kampala", city: "Kampala", floors: ["Ground"] });
  const detail = await admin.call<{ layout_version?: number; zones: { id: string }[] }>("GET", `/venues/${venue.id}`);
  const zoneId = randomUUID();
  const hall = { id: randomUUID(), name: "Main Hall" };
  const lounge = { id: randomUUID(), name: "Green Lounge" };
  await admin.call("PUT", `/venues/${venue.id}/layout`, {
    expected_version: detail.layout_version ?? 0,
    floors: ["Ground"],
    zones: [{ id: zoneId, name: "Ground floor", floor: "Ground", geometry: { kind: "polygon", points: [[0, 0], [20, 0], [20, 12], [0, 12]] } }],
    rooms: [
      { id: hall.id, zone_id: zoneId, name: hall.name, capacity: 100, geometry: { kind: "rect", x: 1, y: 1, w: 10, h: 10 } },
      { id: lounge.id, zone_id: zoneId, name: lounge.name, capacity: 20, geometry: { kind: "rect", x: 12, y: 1, w: 7, h: 6 } },
    ],
  });
  const entrance = await admin.call<{ id: string }>("POST", "/checkpoints", {
    venue_id: venue.id, zone_id: zoneId, room_id: null, direction: "in", perimeter: true, hardware_id: null, label: "Front Door", position: { x: 5, y: 11, side: "s" },
  });
  const loungeDoor = await admin.call<{ id: string }>("POST", "/checkpoints", {
    venue_id: venue.id, zone_id: zoneId, room_id: lounge.id, direction: "in", perimeter: false, hardware_id: null, label: "Lounge Door", position: { x: 12, y: 3, side: "w" },
  });

  const slug = tag.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  const title = `E2E Event ${tag}`;
  const event = await admin.call<{ id: string }>("POST", "/events", {
    venue_id: venue.id, slug, title, description: "An event made by the end-to-end suite.",
    starts_at: new Date(now - 1 * H).toISOString(), ends_at: new Date(now + 8 * H).toISOString(), timezone: "Africa/Kampala",
    listed: true, rooms: [{ room_id: hall.id }, { room_id: lounge.id }], pass_template: { layout: "standard" },
    contact: { name: "E2E Organiser", email: "organiser-contact@synan.dev" },
  });
  const rules = await admin.call<{ version: number }>("GET", `/events/${event.id}/access-rules`);
  const permit = (tier: string, room: string) => ({ subject_kind: "tier", subject: tier, room_id: room, window_start: null, window_end: null, effect: "permit" });
  await admin.call("PUT", `/events/${event.id}/access-rules`, {
    expected_version: rules.version,
    rules: [permit("ORDINARY", hall.id), permit("VIP", hall.id), permit("VIP", lounge.id)],
  });
  const ready = await admin.raw("POST", `/events/${event.id}/publish`);
  if (ready.status !== 200) throw new Error(`publish refused: ${JSON.stringify(ready.body)}`);
  await admin.call("POST", `/events/${event.id}/state`, { state: "live" });

  const gate = async (id: string, label: string, perimeter: boolean, roomId: string | null): Promise<Gate> => {
    const staff = await createStaff(admin, "security_staff", `gate-${label.split(" ")[0]!.toLowerCase()}`);
    await assign(admin, staff.id, id, event.id);
    return { id, label, perimeter, roomId, staff };
  };
  return {
    admin, venueId: venue.id, venueName, eventId: event.id, slug, title, zoneId, rooms: { hall, lounge },
    gates: { entrance: await gate(entrance.id, "Front Door", true, null), lounge: await gate(loungeDoor.id, "Lounge Door", false, lounge.id) },
  };
}

/** Close the world's event (its gates stop admitting, it leaves the live list). Best effort. */
export async function closeWorld(w: World) {
  const admin = await adminApi();
  await admin.raw("POST", `/events/${w.eventId}/state`, { state: "closed" });
}

export interface Guest {
  email: string;
  name: string;
  attendeeId: string;
  registrationId: string;
  credentialId: string;
  /** The attendee's own API session (from the emailed link). */
  me: Caller;
}

/**
 * An attendee who registered themselves (POST /users/register, the A3 flow) and opened the emailed
 * link (POST /auth/verify), which confirms the registration and issues the pass. `tier: "VIP"` is
 * then given by the admin (PATCH /registrations/:id/tier, with the second factor).
 */
export async function registerGuest(w: Pick<World, "slug" | "eventId" | "admin">, opts: { tier?: "ORDINARY" | "VIP"; name?: string } = {}): Promise<Guest> {
  const email = `${uniq("e2e-guest")}@synan.dev`.toLowerCase();
  const name = opts.name ?? `Guest ${email.slice(10, 18)}`;
  const mark = await mailMark();
  await api("POST", "/users/register", { body: { email, full_name: name, event_slug: w.slug, profile: {}, zone_presence_consent: true } });
  const mail = await waitForMail({ to: email, tag: "auth.link", after: mark });
  const token = decodeURIComponent(new URL(linkIn(mail)).hash.match(/token=([^&]+)/)![1]!);
  const pair = await api<TokenPair & { sub?: string }>("POST", "/auth/verify", { body: { token } });
  const me = caller(pair.access_token);
  const self = await me.call<{ id: string }>("GET", "/me");
  const regs = await me.call<{ items: { registration_id: string; event: { id: string } }[] }>("GET", "/me/registrations");
  const reg = regs.items.find((r) => r.event.id === w.eventId);
  if (!reg) throw new Error(`registration for ${email} not confirmed: ${JSON.stringify(regs)}`);
  if (opts.tier && opts.tier !== "ORDINARY") {
    await w.admin.call("PATCH", `/registrations/${reg.registration_id}/tier`, { tier: opts.tier, reason: "End-to-end fixture" });
  }
  const creds = await w.admin.call<{ items: { id: string; registration_id: string; state: string }[] }>("GET", `/credentials?event_id=${w.eventId}&limit=200`);
  const cred = creds.items.find((c) => c.registration_id === reg.registration_id && c.state !== "replaced");
  if (!cred) throw new Error(`no credential for ${email}: ${JSON.stringify(creds.items.slice(0, 3))}`);
  return { email, name, attendeeId: self.id, registrationId: reg.registration_id, credentialId: cred.id, me };
}

/** Invite addresses to the world's event (POST /invitations); returns each invitation's token from its email. */
export async function invite(w: Pick<World, "eventId" | "admin">, email: string): Promise<string> {
  const mark = await mailMark();
  await w.admin.call("POST", "/invitations", { event_id: w.eventId, emails: [email] });
  const mail = await waitForMail({ to: email, tag: "invitation", after: mark });
  return decodeURIComponent(new URL(linkIn(mail)).hash.match(/token=([^&]+)/)![1]!);
}

/** A wristband number as printed inside a band: 14 hex digits (a 7-byte NFC UID). */
export const newBandUid = () => randomUUID().replace(/-/g, "").slice(0, 14).toUpperCase();

/** Put new bands into stock, as a box arriving at the desk would be (POST /carriers/import). */
export async function stockBands(admin: Caller, n = 1): Promise<string[]> {
  const uids = Array.from({ length: n }, newBandUid);
  await admin.call("POST", "/carriers/import", { chip_profile: "ntag_uid", identifiers: uids });
  return uids;
}

/** Bind a new band from stock to the guest's pass through the desk endpoint (POST /carriers/bind), as the admin. */
export async function bindBand(w: Pick<World, "admin">, guest: Guest): Promise<string> {
  const [uid] = await stockBands(w.admin, 1);
  await w.admin.call("POST", "/carriers/bind", { identifier: uid, registration_id: guest.registrationId });
  return uid!;
}

/** The portal code valid now on the guest's pass (GET /me/credential/codes): what the phone shows. */
export async function currentPassCode(guest: Guest, eventId: string): Promise<string> {
  const batch = await guest.me.call<{ codes: { code: string; not_before: string; expires_at: string }[] }>("GET", `/me/credential/codes?event_id=${eventId}`);
  const { now } = await ctl.clock();
  const c = batch.codes.find((x) => Date.parse(x.not_before) <= now && Date.parse(x.expires_at) > now);
  if (!c) throw new Error("no code valid now");
  return c.code;
}
