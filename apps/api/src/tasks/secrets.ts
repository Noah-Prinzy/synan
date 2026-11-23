/**
 * One-off secret maintenance on the SQL backend (@synan/db src/secrets.ts):
 *   1. reencryptSecrets (including users.email) — encrypts any legacy plaintext in the encrypted columns and rewrites every
 *      envelope under the active data key (resumable, safe while the API is live);
 *   2. reindexEmailBlindIndex — recomputes attendees.email_hash and users.email_hash under the active key.
 *
 * Run after first adopting encryption, and after every data-key or blind-index-key rotation:
 *
 *   REPO=postgres DATABASE_URL=… DATABASE_VAULT_URL=… DB_DATA_KEYS=… DB_BLIND_INDEX_KEYS=… \
 *     corepack pnpm --filter @synan/api secrets:maintain
 *
 * Remove an old data key only once a run reports zero updates for every target.
 */
import { reencryptSecrets, reindexEmailBlindIndex } from "@synan/db";
import type { DrizzleRepos } from "../repo/drizzle.js";

export interface MaintenanceReport {
  reencrypted: Record<string, { updated: number; raced: number }>;
  reindexed: { updated: number; scanned: number; usersUpdated: number };
}

export async function runSecretMaintenance(repos: DrizzleRepos): Promise<MaintenanceReport> {
  const { db, vault } = repos.conn;
  const reencrypted = await reencryptSecrets({ db, vault, cipher: repos.cipher, includeUserEmail: true });
  // Passing db re-indexes operator addresses (users.email_hash, "user" domain) as well as attendees.
  const { updated, scanned, usersUpdated } = await reindexEmailBlindIndex({ vault, db, cipher: repos.cipher });
  return { reencrypted, reindexed: { updated, scanned, usersUpdated } };
}

const isMain = process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop()!);
if (isMain) {
  const { loadConfig } = await import("../config.js");
  const { createRepos } = await import("../app.js");
  const config = loadConfig();
  if (config.repo === "memory") {
    console.error("secrets:maintain needs REPO=postgres (or pglite); the in-memory repository stores no secrets at rest.");
    process.exit(2);
  }
  const repos = (await createRepos(config)) as DrizzleRepos;
  try {
    const report = await runSecretMaintenance(repos);
    console.log(JSON.stringify(report, null, 2));
    const raced = Object.values(report.reencrypted).reduce((n, t) => n + t.raced, 0);
    if (raced > 0) console.log(`${raced} row(s) changed during the run; run again to finish them.`);
  } finally {
    await repos.close?.();
  }
}
