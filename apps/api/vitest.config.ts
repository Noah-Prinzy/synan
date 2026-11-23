import { defineConfig } from "vitest/config";

// `--mode pglite` runs every file against an in-process PostgreSQL. Each file migrates its own
// database in beforeAll; with many files in parallel that is CPU-bound, so the SQL run gets longer
// hook timeouts and fewer concurrent files.
export default defineConfig(({ mode }) => ({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    testTimeout: mode === "pglite" ? 60_000 : 20_000,
    hookTimeout: mode === "pglite" ? 180_000 : 20_000,
    ...(mode === "pglite" ? { maxWorkers: 4, minWorkers: 1 } : {}),
  },
}));
