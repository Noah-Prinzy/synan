/**
 * A database of realistic size for query plans and load measurement (roadmap 5.1 / 5.4). Development
 * only; needs a real PostgreSQL server: REAL_PG_ADMIN_URL (root: `corepack pnpm db:seed:load`).
 *
 * Recreates the database `synan_load` (or LOAD_DB) as a clone of the migrated test template, then:
 *   - the dev fixture through the application itself (organisation, venue, rooms, 8 gates, operators,
 *     events), so encryption, blind indexes and password hashes are the real ones;
 *   - 92 more gates (100 in all), each with its own gate user on shift for the live event;
 *   - 3 events with registrations: the live event 50,000, a closed event 5,000, a published one 5,000;
 *     every registration has a credential and a bound NFC band whose UID is derivable (bandUid(n));
 *   - 300,000 scans (200,000 on the live event over the last two hours: in, out, in, out, so everyone ends
 *     outside; 100,000 on the closed one), 20,000 audit entries, rollups rebuilt, ANALYZE.
 * Attendee identity is encrypted through the application's own path (5 % of attendees carry an email so
 * desk search has realistic candidates); the bulk rows are written with set-based SQL as the admin.
 *
 * Writes `<SYNAN_PG_HOME>/synan-load.json` (no secrets beyond the published dev password) for
 * scripts/load-scans.mjs.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createDb } from "@synan/db";
import { realPgTemplate, realPgTestPassword, REAL_PG_TEST_LOGINS } from "@synan/db/testing";
import { createApp } from "../app.js";
import { devEmail } from "../brand.js";
import { hashPassword } from "../lib/crypto.js";
import { InProcessJobs } from "../lib/jobs.js";

const ADMIN = process.env.REAL_PG_ADMIN_URL;
if (!ADMIN) throw new Error("REAL_PG_ADMIN_URL is required (root: corepack pnpm db:seed:load)");
const DB = process.env.LOAD_DB || "synan_load";
const N_LIVE = Number(process.env.LOAD_REGISTRATIONS || 50_000);
const N_CLOSED = 5_000;
const N_PUBLISHED = 5_000;
const SCANS_PER_LIVE = 4; // 200,000 scans: in, out, in, out
const SCANS_PER_CLOSED = 20; // 100,000 scans
const GATES = 100;
const H = 3600_000;

/** Band UID of attendee n (7 bytes, upper-case hex), the same rule as scripts/load-scans.mjs. */
export const bandUid = (n: number) => (0x5a0000000000 + n).toString(16).toUpperCase().padStart(14, "0");

const t0 = Date.now();
const step = (s: string) => console.log(`[seed-load ${((Date.now() - t0) / 1000).toFixed(1)}s] ${s}`);
const urlFor = (user?: string) => {
  const u = new URL(ADMIN);
  u.pathname = `/${DB}`;
  if (user) {
    u.username = user;
    u.password = realPgTestPassword(ADMIN);
  }
  return u.toString();
};

// 1. A fresh clone of the migrated template.
const tpl = await realPgTemplate(ADMIN);
const root = createDb(ADMIN, { max: 1 });
await root.$client.query(`drop database if exists "${DB}" with (force)`);
await root.$client.query(`create database "${DB}" template "${tpl}"`);
await root.$client.end();
step(`created ${DB} from ${tpl}`);

const admin = createDb(urlFor(), { max: 4 });
const sql = async (text: string, params: unknown[] = []) => (await admin.$client.query(text, params)).rows as Record<string, unknown>[];

// 2. The dev fixture, and the per-gate users, through the application (role logins, real encryption).
const app = await createApp({
  seed: true,
  jobs: new InProcessJobs(),
  config: { repo: "postgres", databaseUrl: urlFor(REAL_PG_TEST_LOGINS.api), databaseVaultUrl: urlFor(REAL_PG_TEST_LOGINS.vault), databaseScanUrl: urlFor(REAL_PG_TEST_LOGINS.scan) },
});
await app.ctx.jobs.stop();
const seed = app.seed!;
const now = Date.now();
step("dev fixture seeded through the application");

const fx = app.ctx.repos.fixtures;
const pwHash = await hashPassword(seed.password, 12);
const gates: { checkpointId: string; email: string; direction: "in" | "out" }[] = [];
for (const [key, id] of Object.entries(seed.checkpoints)) {
  if (["mainIn", "mainOut", "eastIn"].includes(key)) gates.push({ checkpointId: id, email: seed.gateEmailByCheckpoint[id]!, direction: key === "mainOut" ? "out" : "in" });
}
const extra = GATES - Object.keys(seed.checkpoints).length;
const newGates: { id: string; userId: string; email: string; direction: "in" | "out" }[] = [];
for (let i = 1; i <= extra; i++) {
  const direction = i % 3 === 0 ? "out" : "in";
  const id = randomUUID();
  await fx.checkpoint({ id, venue_id: seed.venueId, zone_id: seed.zones.ground, room_id: null, direction, perimeter_bool: true, hardware_id: null, label: `Gate ${i}` });
  const userId = randomUUID();
  const email = devEmail(`load-gate-${i}`);
  await app.ctx.repos.users.insert({ id: userId, email, password_hash: pwHash, role: "security_staff", mfa_enrolled_at: null, mfa_secret: null });
  await fx.staffAssignment({ id: randomUUID(), user_id: userId, checkpoint_id: id, shift_start: new Date(now - 4 * H), shift_end: new Date(now + 20 * H) });
  newGates.push({ id, userId, email, direction });
  gates.push({ checkpointId: id, email, direction });
}
step(`${GATES} gates and their gate users`);

// The closed event (in the past) beside the live and the published ones.
const closedId = randomUUID();
await fx.event({
  id: closedId, org_id: seed.orgId, venue_id: seed.venueId, slug: "last-month-expo", title: "Last Month Expo", description: "Closed.",
  starts_at: new Date(now - 30 * 24 * H), ends_at: new Date(now - 30 * 24 * H + 10 * H), timezone: "Africa/Kampala", state: "live", listed_bool: true,
  grace_buffer: 72, pass_template_jsonb: { layout: "standard" }, profile_schema_jsonb: [], access_rules_version: 0, revocation_epoch: 0, closed_at: null,
  wizard_step: "review", published_at: new Date(now - 40 * 24 * H),
});
for (const r of Object.values(seed.rooms)) await fx.eventRoom({ event_id: closedId, room_id: r, capacity_override: null });

// 3. Attendees through the application's encryption: identity for 5 %, the rest anonymous (as kiosk and
// band-only attendees are), in parallel.
const total = N_LIVE + N_CLOSED + N_PUBLISHED;
const ids: string[] = new Array(total);
let next = 0;
await Promise.all(
  Array.from({ length: 12 }, async () => {
    for (let n = next++; n < total; n = next++) {
      const id = randomUUID();
      ids[n] = id;
      const named = n % 20 === 0;
      await app.ctx.repos.attendees.insert({ id, user_id: null, email: named ? devEmail(`load-${n}`) : null, full_name: named ? `Load Person ${n}` : null, profile_jsonb: {} });
    }
  }),
);
await app.close();
step(`${total} attendees (identity encrypted)`);

// 4. Registrations, credentials, bands and the ephemeral mapping, set-based.
await sql(`create temporary table load_people (n int primary key, attendee_id uuid not null, event_id uuid not null)`);
const groups: [string, number, number][] = [[seed.eventId, 0, N_LIVE], [closedId, N_LIVE, N_CLOSED], [seed.publishedEventId, N_LIVE + N_CLOSED, N_PUBLISHED]];
for (const [eventId, from, count] of groups) {
  for (let i = 0; i < count; i += 5000) {
    const slice = ids.slice(from + i, from + Math.min(count, i + 5000));
    await sql(`insert into load_people select $1::int + o - 1, a, $2::uuid from unnest($3::uuid[]) with ordinality as t(a, o)`, [from + i, eventId, slice]);
  }
}
await sql(`analyze load_people`); // temporary tables are never analysed automatically
await sql(`
  insert into registrations (id, event_id, attendee_id, tier, state, zone_presence_consent_at, created_at)
  select gen_random_uuid(), p.event_id, p.attendee_id,
         (case when p.n % 20 = 1 then 'VIP' when p.n % 10 = 3 then 'PUBLIC' else 'ORDINARY' end)::attendee_tier,
         'confirmed', now() - interval '10 days', now() - interval '10 days' - (p.n || ' seconds')::interval
    from load_people p`);
await sql(`
  insert into credentials (id, registration_id, token_hash, state, issued_at)
  select gen_random_uuid(), r.id, substr(md5(r.id::text) || md5(random()::text), 1, 22), 'issued', now() - interval '9 days'
    from registrations r join load_people p on p.attendee_id = r.attendee_id and p.event_id = r.event_id`);
await sql(`
  insert into carriers (id, credential_id, kind, identifier, identifier_hint, chip_profile, state, bound_at)
  select gen_random_uuid(), c.id, 'nfc',
         rtrim(translate(encode(sha256(convert_to('nfc:' || u.uid, 'UTF8')), 'base64'), '+/', '-_'), '='),
         right(u.uid, 4), 'ntag_uid', 'bound', now() - interval '9 days'
    from load_people p
    join registrations r on r.attendee_id = p.attendee_id and r.event_id = p.event_id
    join credentials c on c.registration_id = r.id
    cross join lateral (select upper(lpad(to_hex(${0x5a0000000000}::bigint + p.n), 14, '0')) uid) u`);
await sql(`
  insert into pii_vault.ephemeral_ids (event_id, credential_id)
  select r.event_id, c.id from load_people p
    join registrations r on r.attendee_id = p.attendee_id and r.event_id = p.event_id
    join credentials c on c.registration_id = r.id
   where p.event_id in ($1, $2)`, [seed.eventId, closedId]);
step("registrations, credentials, bands, ephemeral ids");

// 5. Scans: in at an in-gate, out at an out-gate, alternating, ending outside (live event); closed event
// over its day. Seconds apart per person, spread over the window.
await sql(`create temporary table load_gates (k int primary key, checkpoint_id uuid, direction scan_direction)`);
const inGates = gates.filter((g) => g.direction === "in");
const outGates = gates.filter((g) => g.direction === "out");
await sql(`insert into load_gates select o - 1, c, 'in' from unnest($1::uuid[]) with ordinality t(c, o)`, [inGates.map((g) => g.checkpointId)]);
await sql(`insert into load_gates select 1000 + o - 1, c, 'out' from unnest($1::uuid[]) with ordinality t(c, o)`, [outGates.map((g) => g.checkpointId)]);
await sql(`analyze load_gates; analyze registrations; analyze credentials; analyze pii_vault.ephemeral_ids`);
const scanSql = (eventId: string, perPerson: number, windowStart: string, windowSeconds: number) => `
  insert into scans (event_id, checkpoint_id, ephemeral_id, carrier_kind, result, direction, occurred_at, received_at, idem_key, device_id, offline_bool)
  select '${eventId}', g.checkpoint_id, e.ephemeral_id, 'nfc', 'admitted', g.direction, t.ts, t.ts, 'seed-' || p.n || '-' || s.i, 'seed', false
    from load_people p
    join registrations r on r.attendee_id = p.attendee_id and r.event_id = p.event_id
    join credentials c on c.registration_id = r.id
    join pii_vault.ephemeral_ids e on e.credential_id = c.id and e.event_id = p.event_id
    cross join generate_series(0, ${perPerson - 1}) s(i)
    join load_gates g on g.k = case when s.i % 2 = 0 then (p.n + s.i) % ${inGates.length} else 1000 + (p.n + s.i) % ${outGates.length} end
    cross join lateral (select ${windowStart} + ((s.i * ${Math.floor(windowSeconds / perPerson)} + (p.n * 7919) % ${Math.floor(windowSeconds / perPerson)}) || ' seconds')::interval as ts) t
   where p.event_id = '${eventId}'`;
// The live event: everyone's scans in order over the last two hours, the last one an exit.
await sql(scanSql(seed.eventId, SCANS_PER_LIVE, "now() - interval '2 hours'", 7000));
await sql(scanSql(closedId, SCANS_PER_CLOSED, `timestamptz '${new Date(now - 30 * 24 * H).toISOString()}'`, 36000));
await sql(`update registrations r set checked_in_at = now() - interval '2 hours' from load_people p where p.attendee_id = r.attendee_id and p.event_id = r.event_id and p.event_id in ($1, $2)`, [seed.eventId, closedId]);
const sc = await sql(`select event_id, count(*)::int n from scans group by 1`);
step(`scans: ${sc.map((r) => r.n).join(" + ")}`);

// 6. Audit volume, the closed event closed, rollups, statistics.
await sql(`insert into audit_log (action, target, meta_jsonb) select 'load.seed', 'registration:' || gen_random_uuid(), jsonb_build_object('i', i) from generate_series(1, 20000) i`);
await sql(`update events set state = 'closed', closed_at = now() - interval '29 days' where id = $1`, [closedId]);
await sql(`select public.rebuild_event_rollups($1)`, [seed.eventId]);
await sql(`select public.rebuild_event_rollups($1)`, [closedId]);
await sql(`analyze`);
// Statement statistics for the load measurement (needs shared_preload_libraries; skipped if absent).
await sql(`create extension if not exists pg_stat_statements`).catch(() => console.warn("pg_stat_statements not available"));
step("audit entries, rollups, ANALYZE");

const sizes = await sql(`select relname, n_live_tup::int n from pg_stat_user_tables where n_live_tup > 1000 order by n_live_tup desc limit 12`);
const home = process.env.SYNAN_PG_HOME || join(homedir(), ".synan-tools");
if (!existsSync(home)) mkdirSync(home, { recursive: true });
const out = {
  database: DB, created_at: new Date().toISOString(), eventId: seed.eventId, closedEventId: closedId, publishedEventId: seed.publishedEventId,
  liveRegistrations: N_LIVE, bandUidBase: "5a0000000000", password: seed.password,
  gates: gates.map((g) => ({ checkpoint_id: g.checkpointId, email: g.email, direction: g.direction })),
};
writeFileSync(join(home, "synan-load.json"), JSON.stringify(out, null, 2));
await admin.$client.end();
console.log(sizes.map((r) => `  ${r.relname}: ${r.n}`).join("\n"));
step(`done; wrote ${join(home, "synan-load.json")}`);
process.exit(0);
