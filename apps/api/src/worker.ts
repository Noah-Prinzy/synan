/**
 * The job worker process (roadmap fault 12): `corepack pnpm --filter ./apps/api worker`.
 *
 * Runs on PostgreSQL only (REPO=postgres). It builds the same application context as the API (the job
 * handlers need its services) but never listens for HTTP. It works every queue as app_api, like each
 * API process does, and runs the deployment's one pg-boss maintenance instance as the app_jobs login
 * (DATABASE_JOBS_URL): supervision, and the cron schedules of @synan/db JOB_SCHEDULES (purge, session
 * resets, rollups, sign-in clean-up, invitation expiry, webhooks, data requests, retention, scheduled
 * reports, delivery clean-up, and the export and email sweeps). Run exactly one.
 *
 * Not yet (roadmap 5.3): a record of each job's last success with an alert when one is overdue, a
 * health endpoint, and API processes that only send jobs and leave the work to workers.
 */
import { existsSync } from "node:fs";
if (existsSync(".env")) process.loadEnvFile(".env");

import { createApp } from "./app.js";
import { API_BRAND } from "./brand.js";
import { ConfigError, loadConfig } from "./config.js";
import { startJobMaintenance } from "./lib/pgboss-jobs.js";

const tag = `[${API_BRAND.serviceName} worker]`;
const config = loadConfig();
if (config.repo !== "postgres") throw new ConfigError("the worker runs on PostgreSQL only: set REPO=postgres");
if (!config.databaseJobsUrl) throw new ConfigError("DATABASE_JOBS_URL (a login in app_jobs and app_api) is required for the worker");

const app = await createApp({ seed: false }); // pg-boss worker on every registered queue (app_api)
const maintenance = await startJobMaintenance(config.databaseJobsUrl);
console.log(`${tag} working ${app.ctx.repos.kind} queues; maintenance and schedules running`);

let stopping = false;
const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  await maintenance.stop();
  await app.close();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
