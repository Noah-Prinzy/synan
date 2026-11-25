import { defineConfig } from "vitest/config";

// `--mode pglite` runs every file against an in-process PostgreSQL. Each file migrates its own
// database in beforeAll; with many files in parallel that is CPU-bound, so the SQL run gets longer
// hook timeouts and fewer concurrent files. `--mode realpg` (needs REAL_PG_ADMIN_URL) runs every file
// against a real PostgreSQL server: each app gets a fresh clone of a migrated template database and
// connects through the three role logins (test/helpers.ts). test/realpg/ holds what needs the real
// server (pg-boss with its own connections) and runs in that mode only.
export default defineConfig(({ mode }) => {
  const sql = mode === "pglite" || mode === "realpg";
  return {
    test: {
      environment: "node",
      include: ["test/**/*.test.ts"],
      exclude: ["**/node_modules/**", ...(mode === "realpg" ? [] : ["test/realpg/**"])],
      ...(mode === "realpg" ? { setupFiles: ["test/realpg-setup.ts"] } : {}),
      testTimeout: sql ? 60_000 : 20_000,
      hookTimeout: sql ? 180_000 : 20_000,
      ...(sql ? { maxWorkers: 4, minWorkers: 1 } : {}),
    },
  };
});
