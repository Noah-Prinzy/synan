import { defineConfig } from "drizzle-kit";

/**
 * Migrations are generated with `corepack pnpm --filter ./packages/db db:generate` and applied with
 * `db:migrate`. Never use `drizzle-kit push`: partitioning, RLS, triggers and functions live in
 * hand-written migrations that push does not know about and would drop.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./migrations",
  schemaFilter: ["public", "pii_vault"],
  dbCredentials: { url: process.env.DATABASE_URL ?? "postgres://localhost:5432/app" },
  strict: true,
  verbose: true,
});
