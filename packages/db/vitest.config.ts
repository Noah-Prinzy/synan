import { defineConfig } from "vitest/config";

// Default: PGlite (in process). `--mode realpg` (script test:realpg; needs REAL_PG_ADMIN_URL): every test
// database is a fresh clone of a migrated template on a real PostgreSQL server (test/helpers.ts).
export default defineConfig(({ mode }) => ({
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    // Each file boots its own PGlite instance (WASM); keep parallelism modest.
    maxWorkers: 4,
    ...(mode === "realpg" ? { setupFiles: ["test/realpg-setup.ts"], env: { DB_TEST_BACKEND: "realpg" } } : {}),
  },
}));
