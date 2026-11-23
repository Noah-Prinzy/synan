/**
 * Checks that need a real PostgreSQL server (PGlite is a single session, connects as a superuser,
 * and cannot run concurrent transactions). Skipped unless REAL_PG_ADMIN_URL is set:
 *
 *   REAL_PG_ADMIN_URL=postgres://admin:pw@host:5432/postgres corepack pnpm --filter ./packages/db test real-postgres
 *
 * The admin login needs CREATEDB and CREATEROLE (a managed service's admin user is enough). The test
 * creates a throwaway database and four LOGIN roles, migrates as the admin (the "migrating role"),
 * runs the checks, and drops everything it created. Optional REAL_PG_MIGRATOR_URL: a non-superuser
 * login used instead of the admin to run the migrations (proves the managed-service privileges).
 */
import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { replaceAccessRules } from "../src/access-rules";
import { consumeWsTicket, createLink, hashToken, mintWsTicket, newToken, redeemLink, rotateSession, startSession } from "../src/auth";
import { bindCarrier, importCarrierIdentifiers } from "../src/carriers";
import { assertRoleSeparation, createDatabases, createDb, withVaultScope, type Databases, type Db } from "../src/client";
import { createCipher, devKeyProvider } from "../src/crypto/index";
import { auditVerify, purgeEventMovementData } from "../src/functions";
import { createJobs, JOB_QUEUES } from "../src/jobs";
import { runMigrations } from "../src/migrate";
import { createInvitation } from "../src/registration";
import * as s from "../src/schema/index";
import { createAttendee, insertUser, readAttendee } from "../src/secrets";

const ADMIN = process.env.REAL_PG_ADMIN_URL;
const suffix = randomBytes(4).toString("hex");
const dbName = `check_${suffix}`;
const logins = { api: `api_${suffix}`, vault: `vault_${suffix}`, scan: `scan_${suffix}`, jobs: `jobs_${suffix}` };
const password = randomBytes(12).toString("base64url");
const urlFor = (base: string, user?: string) => {
  const u = new URL(base);
  u.pathname = `/${dbName}`;
  if (user) {
    u.username = user;
    u.password = password;
  }
  return u.toString();
};

describe.skipIf(!ADMIN)("real PostgreSQL", () => {
  let admin: pg.Client;
  let owner: Db;
  let dbs: Databases;
  let eventId: string;
  let checkpointId: string;
  const cipherP = createCipher(devKeyProvider());

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: ADMIN });
    await admin.connect();
    await admin.query(`create database ${dbName}`);
    await runMigrations(urlFor(process.env.REAL_PG_MIGRATOR_URL ?? ADMIN!));
    for (const [k, login] of Object.entries(logins)) {
      const role = k === "jobs" ? "app_jobs, app_api" : `app_${k}`;
      await admin.query(`create role ${login} login password '${password}' in role ${role}`);
    }
    owner = createDb(urlFor(process.env.REAL_PG_MIGRATOR_URL ?? ADMIN!), { max: 20 });
    dbs = createDatabases({
      url: urlFor(ADMIN!, logins.api), vaultUrl: urlFor(ADMIN!, logins.vault), scanUrl: urlFor(ADMIN!, logins.scan), max: 20, requireSeparateRoles: true,
    });
    // Minimal venue and live event.
    const [o] = await owner.insert(s.organizations).values({ name: "o", timezone: "UTC", support_email: "o@example.test" }).returning();
    const [v] = await owner.insert(s.venues).values({ org_id: o!.id, name: "v", timezone: "UTC" }).returning();
    const [z] = await owner.insert(s.zones).values({ venue_id: v!.id, name: "z" }).returning();
    const [r] = await owner.insert(s.rooms).values({ venue_id: v!.id, zone_id: z!.id, name: "r", capacity: 100 }).returning();
    const [c] = await owner.insert(s.checkpoints).values({ venue_id: v!.id, zone_id: z!.id, room_id: r!.id, direction: "in", label: "c" }).returning();
    checkpointId = c!.id;
    const [e] = await owner.insert(s.events).values({
      org_id: o!.id, venue_id: v!.id, slug: `e-${suffix}`, title: "e", timezone: "UTC", state: "live",
      starts_at: new Date(Date.now() - 3600_000), ends_at: new Date(Date.now() + 3600_000), pass_template_jsonb: {},
    }).returning();
    eventId = e!.id;
    await owner.insert(s.event_rooms).values({ event_id: eventId, room_id: r!.id });
  }, 300_000);

  afterAll(async () => {
    await dbs?.end();
    await owner?.$client.end();
    if (admin) {
      await admin.query(`drop database if exists ${dbName} with (force)`);
      for (const login of Object.values(logins)) await admin.query(`drop role if exists ${login}`);
      await admin.end();
    }
  });

  it("role logins: each pool holds exactly its role; the general pool cannot read identity", async () => {
    await assertRoleSeparation(dbs);
    const cipher = await cipherP;
    const id = await createAttendee(dbs.db, cipher, { email: "real@example.test", full_name: "Real Person" }); // write-only
    await expect(withVaultScope(dbs.db, "system", (tx) => tx.select().from(s.attendees))).rejects.toThrow(/permission denied/);
    expect((await readAttendee(dbs.vault, cipher, id, "operator"))!.email).toBe("real@example.test");
  });

  it("refresh rotation under concurrency: exactly one exchange wins, the rest are treated as reuse", async () => {
    const u = { id: await insertUser(owner, await cipherP, { email: `u-${suffix}@example.test`, role: "admin" }) };
    const token = newToken();
    const family = randomUUID();
    await startSession(dbs.db, { holder: { userId: u!.id }, familyId: family, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 3600_000) });
    const results = await Promise.all(
      Array.from({ length: 10 }, () => rotateSession(dbs.db, { tokenHash: hashToken(token), newTokenHash: hashToken(newToken()), expiresAt: new Date(Date.now() + 3600_000) })),
    );
    expect(results.filter((r) => r.status === "rotated")).toHaveLength(1);
    expect(results.every((r) => ["rotated", "reuse_detected", "revoked"].includes(r.status))).toBe(true);
  });

  it("single-use links, tickets and invitations under concurrency: exactly one success each", async () => {
    const cipher = await cipherP;
    const att = await createAttendee(dbs.db, cipher, {});
    const lt = newToken();
    await createLink(dbs.db, { tokenHash: hashToken(lt), attendeeId: att, expiresAt: new Date(Date.now() + 600_000) });
    const links = await Promise.all(Array.from({ length: 10 }, () => redeemLink(dbs.db, hashToken(lt))));
    expect(links.filter((x) => x.status === "redeemed")).toHaveLength(1);
    const tt = newToken();
    await mintWsTicket(dbs.db, { ticketHash: hashToken(tt), holder: { attendeeId: att }, channel: "/stream/me", expiresAt: new Date(Date.now() + 30_000) });
    const tickets = await Promise.all(Array.from({ length: 10 }, () => consumeWsTicket(dbs.db, hashToken(tt))));
    expect(tickets.filter((x) => x.status === "valid")).toHaveLength(1);
    const inv = await createInvitation(dbs.db, cipher, { eventId, email: "inv@example.test", expiresAt: new Date(Date.now() + 600_000) });
    const { rsvpInvitation } = await import("../src/registration");
    const rsvps = await Promise.all(Array.from({ length: 5 }, () => rsvpInvitation(dbs.db, cipher, { token: inv.token!, email: "inv@example.test", zonePresenceConsent: false })));
    expect(rsvps.filter((x) => x.status === "registered")).toHaveLength(1);
  });

  it("carrier binding and access-rule republish under concurrency", async () => {
    const band = randomBytes(32).toString("base64url").slice(0, 43);
    await importCarrierIdentifiers(dbs.db, [band]);
    const { registerAttendee } = await import("../src/registration");
    const cipher = await cipherP;
    const creds: string[] = [];
    for (let i = 0; i < 2; i++) {
      const r = await registerAttendee(dbs.db, cipher, { eventId, tier: "ORDINARY", state: "confirmed", email: `bind${i}@example.test`, zonePresenceConsent: false, credentialRef: randomBytes(16).toString("base64url") });
      creds.push(r.credential_id!);
    }
    const binds = await Promise.all(creds.map((c) => bindCarrier(dbs.db, { identifier: band, credentialId: c })));
    expect(binds.map((b) => b.status).sort()).toEqual(["bound", "not_in_stock"]);
    const v = (await owner.select().from(s.events)).find((e) => e.id === eventId)!.access_rules_version;
    const reps = await Promise.all([1, 2].map(() => replaceAccessRules(dbs.db, eventId, v, [])));
    expect(reps.map((r) => r.status).sort()).toEqual(["ok", "version_conflict"]);
  });

  it("report schedules and the email outbox under concurrent workers: each claimed once", async () => {
    const cipher = await cipherP;
    const { createReportSchedule, claimDueReportSchedules, enqueueEmail, claimEmail } = await import("../src/delivery");
    const due = new Date(Date.now() - 60_000);
    for (let i = 0; i < 6; i++) {
      await createReportSchedule(dbs.db, cipher, { eventId, recipients: [`ops${i}@example.test`], cadence: "daily", firstRunAt: due });
    }
    const claims = await Promise.all(Array.from({ length: 4 }, () => claimDueReportSchedules(dbs.db, cipher, { limit: 3 })));
    const ids = claims.flat().map((x) => x.id);
    expect(ids).toHaveLength(6);
    expect(new Set(ids).size).toBe(6);
    const mail = await enqueueEmail(dbs.db, cipher, { template: "t", to: "c@example.test", content: { subject: "s", text: "x" } });
    const sends = await Promise.all(Array.from({ length: 8 }, () => claimEmail(dbs.db, cipher, mail)));
    expect(sends.filter(Boolean)).toHaveLength(1);
    // A crashed worker's claim: once the lease has run out, concurrent sweepers reclaim it exactly once.
    await owner.$client.query(`update email_outbox set claimed_at = now() - interval '10 minutes' where id = $1`, [mail]);
    const reclaims = await Promise.all(Array.from({ length: 8 }, () => claimEmail(dbs.db, cipher, mail)));
    expect(reclaims.filter(Boolean).map((x) => x!.attempts)).toEqual([2]);
  });

  it("audit chain under 50 concurrent appends stays intact", async () => {
    await Promise.all(Array.from({ length: 50 }, (_, i) => dbs.db.insert(s.audit_log).values({ action: "concurrency", target: `t:${i}` })));
    expect(await auditVerify(dbs.db)).toEqual([]);
  });

  it("partition create and purge while another event takes scans", async () => {
    let stop = false;
    let inserted = 0;
    const writer = (async () => {
      while (!stop) {
        await dbs.db.insert(s.scans).values({ event_id: eventId, checkpoint_id: checkpointId, result: "unknown_token", occurred_at: new Date(), idem_key: randomUUID() });
        inserted++;
      }
    })();
    const [ev0] = await owner.select().from(s.events).limit(1);
    const others: string[] = [];
    for (let i = 0; i < 5; i++) {
      const [e] = await dbs.db.insert(s.events).values({
        org_id: ev0!.org_id, venue_id: ev0!.venue_id, slug: `p-${suffix}-${i}`, title: "p", timezone: "UTC", state: "closed",
        starts_at: new Date(Date.now() - 7200_000), ends_at: new Date(Date.now() - 3600_000),
      }).returning();
      others.push(e!.id);
    }
    for (const id of others) await purgeEventMovementData(dbs.db, id, { force: true });
    stop = true;
    await writer;
    const n = await owner.$client.query(`select count(*)::int n from scans where event_id = $1`, [eventId]);
    expect(n.rows[0].n).toBeGreaterThanOrEqual(inserted);
  });

  it("pg-boss over node-postgres: app_api works jobs, app_jobs supervises", async () => {
    const worker = createJobs({ connectionString: urlFor(ADMIN!, logins.api) });
    const maint = createJobs({ connectionString: urlFor(ADMIN!, logins.jobs), mode: "maintenance" });
    worker.on("error", () => undefined);
    maint.on("error", () => undefined);
    await worker.start();
    await maint.start();
    try {
      await worker.send(JOB_QUEUES.email, { to: "x" });
      expect(await worker.fetch(JOB_QUEUES.email)).toHaveLength(1);
      await maint.supervise();
    } finally {
      await worker.stop({ graceful: false } as never);
      await maint.stop({ graceful: false } as never);
    }
  });
});
