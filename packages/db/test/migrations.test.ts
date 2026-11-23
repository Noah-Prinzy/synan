import { is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { beforeAll, describe, expect, it } from "vitest";
import * as schema from "../src/schema/index";
import { createTestDb, JOURNAL_ENTRIES, q, type TestDb } from "./helpers";

let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
});

describe("migrations", () => {
  it("apply cleanly and are recorded", async () => {
    const applied = await q(db, `select count(*)::int as n from drizzle.__drizzle_migrations`);
    expect(applied[0]!.n).toBe(JOURNAL_ENTRIES);
  });

  it("are idempotent when re-run", async () => {
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    const { MIGRATIONS_FOLDER } = await import("../src/migrate");
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    const applied = await q(db, `select count(*)::int as n from drizzle.__drizzle_migrations`);
    expect(applied[0]!.n).toBe(JOURNAL_ENTRIES);
  });

  it("create every table of docs/02 §4.1–§4.5 with the spec's names", async () => {
    const expected = [
      "public.organizations", "public.venues", "public.zones", "public.rooms", "public.checkpoints",
      "public.transit_times", "public.events", "public.event_rooms", "public.sessions",
      "public.users", "public.staff_assignments", "pii_vault.attendees", "public.invitations",
      "public.registrations", "public.access_rules",
      "public.credentials", "public.carriers", "public.signing_keys",
      "pii_vault.ephemeral_ids", "public.scans", "public.occupancy_adjustments", "public.breach_alerts",
      "public.audit_log", "public.webhook_endpoints",
      "public.occupancy_rollups", "public.gate_rate_rollups", "public.attendance_snapshots", "public.event_reports",
    ];
    const rows = await q<{ t: string }>(
      db,
      `select table_schema || '.' || table_name as t from information_schema.tables
        where table_schema in ('public','pii_vault') and table_type in ('BASE TABLE')
        union select n.nspname || '.' || c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where c.relkind = 'p'`,
    );
    const have = new Set(rows.map((r) => r.t));
    for (const t of expected) expect(have, t).toContain(t);
  });

  it("match the Drizzle definitions column for column (incl. the hand-edited partitioned scans)", async () => {
    const tables = (Object.values(schema) as unknown[]).filter((v): v is PgTable => is(v, PgTable));
    expect(tables.length).toBe(31);
    for (const t of tables) {
      const cfg = getTableConfig(t);
      const s = cfg.schema ?? "public";
      const cols = await q<{ column_name: string }>(
        db,
        `select column_name from information_schema.columns where table_schema = $1 and table_name = $2`,
        [s, cfg.name],
      );
      expect(cols.map((c) => c.column_name).sort(), `${s}.${cfg.name}`).toEqual(cfg.columns.map((c) => c.name).sort());
    }
  });

  it("make scans a LIST partitioned table on event_id", async () => {
    const r = await q<{ strategy: string; key: string }>(
      db,
      `select partstrat as strategy, pg_get_partkeydef('public.scans'::regclass) as key
         from pg_partitioned_table where partrelid = 'public.scans'::regclass`,
    );
    expect(r[0]).toEqual({ strategy: "l", key: "LIST (event_id)" });
  });

  it("put the identity vault in its own schema with forced RLS", async () => {
    const r = await q<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      db,
      `select c.relname, c.relrowsecurity, c.relforcerowsecurity from pg_class c
         join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'pii_vault' and c.relkind = 'r' order by 1`,
    );
    expect(r).toEqual([
      { relname: "attendees", relrowsecurity: true, relforcerowsecurity: true },
      { relname: "ephemeral_ids", relrowsecurity: true, relforcerowsecurity: true },
    ]);
  });
});
