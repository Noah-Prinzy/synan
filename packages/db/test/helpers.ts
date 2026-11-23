import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { sql } from "drizzle-orm";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { MIGRATIONS_FOLDER } from "../src/migrate";
import { createMigratedPglite } from "../src/testing";
import * as schema from "../src/schema/index";

export type TestDb = PgliteDatabase<typeof schema> & { $client: PGlite };

/** Number of migrations in the journal. */
export const JOURNAL_ENTRIES: number = (
  JSON.parse(readFileSync(join(MIGRATIONS_FOLDER, "meta", "_journal.json"), "utf8")) as { entries: unknown[] }
).entries.length;

/** A fresh in-process PostgreSQL (PGlite) with every migration applied. */
export async function createTestDb(): Promise<TestDb> {
  const client = await createMigratedPglite();
  const db = drizzle(client, { schema }) as TestDb;
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER }); // a no-op on the snapshot; keeps the journal honest
  return db;
}

/** Runs a raw statement and returns its rows. */
export async function q<T = Record<string, unknown>>(db: TestDb, text: string, params: unknown[] = []): Promise<T[]> {
  const res = await db.$client.query<T>(text, params);
  return res.rows;
}

/** Expects a promise to reject with a Postgres error whose message matches. */
export async function rejects(p: Promise<unknown>, match: RegExp): Promise<void> {
  let err: unknown;
  try {
    await p;
  } catch (e) {
    err = e;
  }
  if (!err) throw new Error(`expected rejection matching ${match}, but it succeeded`);
  // Drizzle wraps the driver error ("Failed query: …") and keeps the Postgres error in `cause`.
  const parts: string[] = [];
  for (let e: any = err; e; e = e.cause) {
    parts.push(String(e.message ?? e));
    if (e.constraint) parts.push(`constraint=${e.constraint}`);
  }
  const msg = parts.join(" | ");
  if (!match.test(msg)) throw new Error(`expected rejection matching ${match}, got: ${msg}`);
}

export { sql };

/**
 * Drops the encryption constraints switched on by migrations 0008–0010, to simulate a database written
 * before enforcement (legacy plaintext) in the re-encryption tests.
 */
export async function dropEncryptionEnforcement(db: TestDb): Promise<void> {
  await db.$client.exec(`
    alter table pii_vault.attendees drop constraint if exists attendees_email_encrypted;
    alter table pii_vault.attendees drop constraint if exists attendees_full_name_encrypted;
    alter table pii_vault.attendees drop constraint if exists attendees_profile_encrypted;
    alter table public.users drop constraint if exists users_mfa_secret_encrypted;
    alter table public.signing_keys drop constraint if exists signing_keys_private_key_encrypted;
    alter table public.users drop constraint if exists users_email_encrypted;
    alter table public.users drop constraint if exists users_email_hash_required;
    alter table public.users alter column email_hash drop not null;
  `);
}
