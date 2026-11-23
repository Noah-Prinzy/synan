import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import type { PgDatabase, PgQueryResultHKT, PgTransaction } from "drizzle-orm/pg-core";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import pg from "pg";
import * as schema from "./schema/index";

export type Schema = typeof schema;

/** The database handle returned by createDb(). `db.$client` is the pg Pool (call `.end()` to close). */
export type Db = NodePgDatabase<Schema> & { $client: pg.Pool };

/** Any Drizzle Postgres database or transaction over this schema (node-postgres, PGlite, …). */
export type AnyDb = PgDatabase<PgQueryResultHKT, Schema>;
export type AnyTx = PgTransaction<PgQueryResultHKT, Schema, ExtractTablesWithRelations<Schema>>;

export interface CreateDbOptions {
  /** Pool size. Default 10. */
  max?: number;
  /** Log SQL to stdout. */
  logger?: boolean;
}

/**
 * Connects to PostgreSQL with node-postgres and returns a typed Drizzle instance.
 *
 *   const db = createDb(process.env.DATABASE_URL!);
 *   const rows = await db.select().from(schema.events);
 *   await db.$client.end();
 */
export function createDb(connectionString: string, options: CreateDbOptions = {}): Db {
  const pool = new pg.Pool({ connectionString, max: options.max ?? 10 });
  return drizzle(pool, { schema, logger: options.logger ?? false }) as Db;
}

/**
 * Connections for the role split (migration 0005):
 *   db     general application role (app_api) — every operational query
 *   vault  identity role (app_vault) — reading or changing pii_vault.attendees; erasure
 *   scan   scan-ingest role (app_scan) — app_api plus the ephemeral ID mapping
 * Each is a separate pool with separate login credentials: a role is never switched with SET ROLE
 * on a shared login, because anyone who can run SQL on that login could switch it back.
 *
 * Without vaultUrl/scanUrl (development, single-role) `vault` and `scan` are the same pool as `db`.
 */
export interface Databases {
  db: Db;
  vault: Db;
  scan: Db;
  /** True when vault and scan are separate pools from db. */
  separated: boolean;
  end(): Promise<void>;
}

export interface CreateDatabasesOptions {
  url: string;
  vaultUrl?: string;
  scanUrl?: string;
  max?: number;
  /** Small: identity paths are narrow. Default 4. */
  vaultMax?: number;
  scanMax?: number;
  logger?: boolean;
  /** Throw unless vaultUrl and scanUrl are both given (set this in production). */
  requireSeparateRoles?: boolean;
}

export function createDatabases(o: CreateDatabasesOptions): Databases {
  if (o.requireSeparateRoles && (!o.vaultUrl || !o.scanUrl)) {
    throw new Error("createDatabases: requireSeparateRoles is set but vaultUrl or scanUrl is missing");
  }
  const db = createDb(o.url, { max: o.max, logger: o.logger });
  const vault = o.vaultUrl ? createDb(o.vaultUrl, { max: o.vaultMax ?? 4, logger: o.logger }) : db;
  const scan = o.scanUrl ? createDb(o.scanUrl, { max: o.scanMax ?? o.max, logger: o.logger }) : db;
  const pools = [...new Set([db, vault, scan])];
  return {
    db,
    vault,
    scan,
    separated: vault !== db && scan !== db,
    end: async () => {
      await Promise.all(pools.map((p) => p.$client.end()));
    },
  };
}

export interface ConnectionRole {
  user: string;
  superuser: boolean;
  bypassRls: boolean;
  memberOf: { app_api: boolean; app_scan: boolean; app_vault: boolean };
}

/** Who a connection really is. Use at startup to refuse a misconfigured deployment. */
export async function describeConnection(db: AnyDb | AnyTx): Promise<ConnectionRole> {
  const res = (await db.execute(sql`
    select current_user::text as u, r.rolsuper as su, r.rolbypassrls as br,
           coalesce((select pg_has_role(current_user, 'app_api', 'MEMBER') where exists (select 1 from pg_roles where rolname = 'app_api')), false) as api,
           coalesce((select pg_has_role(current_user, 'app_scan', 'MEMBER') where exists (select 1 from pg_roles where rolname = 'app_scan')), false) as scan,
           coalesce((select pg_has_role(current_user, 'app_vault', 'MEMBER') where exists (select 1 from pg_roles where rolname = 'app_vault')), false) as vault
      from pg_roles r where r.rolname = current_user`)) as unknown as {
    rows: { u: string; su: boolean; br: boolean; api: boolean; scan: boolean; vault: boolean }[];
  };
  const r = res.rows[0]!;
  return { user: r.u, superuser: r.su, bypassRls: r.br, memberOf: { app_api: r.api, app_scan: r.scan, app_vault: r.vault } };
}

/**
 * Throws unless each pool holds exactly its intended role and none can bypass row-level security.
 * Call once at startup in production.
 */
export async function assertRoleSeparation(d: Databases): Promise<void> {
  const [g, v, s] = await Promise.all([describeConnection(d.db), describeConnection(d.vault), describeConnection(d.scan)]);
  const problems: string[] = [];
  for (const [name, c] of [["db", g], ["vault", v], ["scan", s]] as const) {
    if (c.superuser || c.bypassRls) problems.push(`${name} connects as ${c.user}, which bypasses row-level security`);
  }
  if (!g.memberOf.app_api || g.memberOf.app_vault || g.memberOf.app_scan) problems.push(`db (${g.user}) must be a member of app_api only`);
  if (!v.memberOf.app_vault || v.memberOf.app_api) problems.push(`vault (${v.user}) must be a member of app_vault only`);
  if (!s.memberOf.app_scan || s.memberOf.app_vault) problems.push(`scan (${s.user}) must be a member of app_scan only`);
  if (problems.length) throw new Error(`role separation not in place:\n- ${problems.join("\n- ")}`);
}

/**
 * Identity-vault access scopes (migration 0002 §E). The tables in `pii_vault` have FORCED row-level
 * security: outside a scope they return no rows and reject writes.
 *
 * - `system`   background jobs, purge, erasure, seed
 * - `operator` Admin Command: attendees read/write, no ephemeral mapping
 * - `attendee` one attendee's own row (pass `attendeeId`)
 * - `scan`     scan ingest: ephemeral_ids read/insert, no attendee rows
 */
export type VaultScope = "system" | "operator" | "attendee" | "scan";

/**
 * Runs `fn` in a transaction with the vault scope set (transaction-local, so it cannot leak to the
 * next user of a pooled connection).
 */
export async function withVaultScope<TDb extends AnyDb, T>(
  db: TDb,
  scope: VaultScope,
  fn: (tx: TxOf<TDb>) => Promise<T>,
  options: { attendeeId?: string } = {},
): Promise<T> {
  if (scope === "attendee" && !options.attendeeId) {
    throw new Error("withVaultScope('attendee') requires options.attendeeId");
  }
  return db.transaction(async (tx) => {
    await setVaultScope(tx, scope, options.attendeeId);
    return fn(tx as TxOf<TDb>);
  }) as Promise<T>;
}

/** The transaction type of a given database handle (keeps the driver's concrete result types). */
export type TxOf<TDb extends AnyDb> = Parameters<Parameters<TDb["transaction"]>[0]>[0];

/** Sets the vault scope on an existing transaction (transaction-local). */
export async function setVaultScope(tx: AnyDb | AnyTx, scope: VaultScope, attendeeId?: string) {
  await tx.execute(
    sql`select set_config('app.vault_scope', ${scope}, true), set_config('app.attendee_id', ${attendeeId ?? ""}, true)`,
  );
}
