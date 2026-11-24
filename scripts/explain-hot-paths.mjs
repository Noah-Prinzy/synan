#!/usr/bin/env node
/**
 * Query plans of the hot paths, as the API really issues them, on the seeded load database
 * (`corepack pnpm db:seed:load` first; local server only, it reads the server log).
 *
 *   node scripts/explain-hot-paths.mjs [--port=5190] [--min-ms=0]
 *
 * Switches auto_explain on for the load database (ANALYZE, BUFFERS, nested statements, so statements
 * inside SQL functions are explained too), starts the API, calls each hot path once, and cuts each
 * call's plans out of the server log into <SYNAN_PG_HOME>/explain/<path>.log. Prints, per path, the
 * statements and their time, and every sequential scan that read more than 5,000 rows. Switches
 * auto_explain off again at the end.
 */
import { mkdirSync, openSync, readSync, statSync, writeFileSync, closeSync } from "node:fs";
import { join } from "node:path";
import { arg, bandUid, devDomain, home, load, pg, startApi, urlFor } from "./load-lib.mjs";
import { logFile } from "./pg-lib.mjs";

const PORT = Number(arg("port", 5190));
const MIN_MS = Number(arg("min-ms", 0));
const outDir = join(home, "explain");
mkdirSync(outDir, { recursive: true });

const admin = new pg.Client({ connectionString: urlFor() });
await admin.connect();
const db = `"${load.database}"`;
const settings = {
  session_preload_libraries: "auto_explain", "auto_explain.log_min_duration": `${MIN_MS}ms`, "auto_explain.log_analyze": "on",
  "auto_explain.log_buffers": "on", "auto_explain.log_timing": "on", "auto_explain.log_nested_statements": "on", "auto_explain.log_verbose": "off",
};
for (const [k, v] of Object.entries(settings)) await admin.query(`alter database ${db} set ${k} = '${v}'`);

const readFrom = (offset) => {
  const size = statSync(logFile).size;
  const buf = Buffer.alloc(size - offset);
  const fd = openSync(logFile, "r");
  readSync(fd, buf, 0, buf.length, offset);
  closeSync(fd);
  return buf.toString("utf8");
};
const summary = [];
let api;
try {
  api = await startApi(PORT);
  const organiser = await api.login(`organiser@${devDomain}`);
  const gate = load.gates.find((g) => g.direction === "in");
  const gateTok = await api.login(gate.email);
  const ev = load.eventId;
  const n = 12_340; // a seeded attendee with identity (every 20th has one)
  const scan = (k) => ({ idem_key: `explain-${Date.now()}-${String(k).padStart(4, "0")}`, checkpoint_id: gate.checkpoint_id, presented: { medium: "nfc", uid: bandUid(n + k) }, occurred_at: new Date().toISOString(), clock_offset_ms: 0, offline: false });
  const paths = [
    ["scan-ingest-cold", "POST", "/scans", { event_id: ev, device_id: "explain", scans: [scan(1)] }, gateTok],
    ["scan-ingest-warm", "POST", "/scans", { event_id: ev, device_id: "explain", scans: [scan(2)] }, gateTok],
    ["scan-ingest-batch-50", "POST", "/scans", { event_id: ev, device_id: "explain", scans: Array.from({ length: 50 }, (_, i) => scan(100 + i)) }, gateTok],
    ["allowlist", "GET", `/events/${ev}/allowlist?checkpoint_id=${gate.checkpoint_id}`, undefined, gateTok],
    ["event-summary", "GET", `/events/${ev}/summary`, undefined, organiser],
    ["registrations-page", "GET", `/events/${ev}/registrations?limit=50`, undefined, organiser],
    ["registrations-search-name", "GET", `/events/${ev}/registrations?limit=50&q=${encodeURIComponent(`Load Person ${n}`)}`, undefined, organiser],
    ["registrations-search-email", "GET", `/events/${ev}/registrations?limit=50&q=${encodeURIComponent(`load-${n}@${devDomain}`)}`, undefined, organiser],
    ["registrations-search-band-hint", "GET", `/events/${ev}/registrations?limit=50&q=${bandUid(n + 1).slice(-4)}`, undefined, organiser],
    ["attendees-search-email", "GET", `/attendees?limit=50&q=${encodeURIComponent(`load-${n}@${devDomain}`)}`, undefined, organiser],
    ["scans-list", "GET", `/scans?event_id=${ev}&limit=50`, undefined, organiser],
    ["audit-by-target (inventory)", "GET", `/credentials/inventory?event_id=${ev}`, undefined, organiser],
  ];
  for (const [name, method, path, body, token] of paths) {
    await new Promise((r) => setTimeout(r, 300)); // let earlier log lines land
    const offset = statSync(logFile).size;
    const r = await api.call(method, path, body, token);
    await new Promise((r) => setTimeout(r, 700));
    const text = readFrom(offset);
    const file = join(outDir, `${name.replace(/[^\w-]+/g, "_")}.log`);
    writeFileSync(file, text);
    const entries = text.split(/\n(?=\d{4}-\d\d-\d\d )/).filter((e) => /duration: [\d.]+ ms\s+plan:/.test(e) && e.includes(load.database));
    const statements = entries.map((e) => ({
      ms: Number(/duration: ([\d.]+) ms/.exec(e)[1]),
      query: (/Query Text: ([^\n]*)/.exec(e)?.[1] ?? "").slice(0, 110),
      seq: [...e.matchAll(/Seq Scan on (\S+)[^\n]*actual time=[^\n]*rows=(\d+)/g)].filter((m) => Number(m[2]) > 5000).map((m) => `${m[1]} (${m[2]} rows)`),
    }));
    const dbMs = statements.reduce((a, s) => a + s.ms, 0);
    summary.push({ name, status: r.status, ms: +r.ms.toFixed(1), statements: statements.length, dbMs: +dbMs.toFixed(1), seqScans: [...new Set(statements.flatMap((s) => s.seq))], slowest: [...statements].sort((a, b) => b.ms - a.ms).slice(0, 3) });
    console.log(`${name}: HTTP ${r.status} in ${r.ms.toFixed(0)} ms; ${statements.length} statements, ${dbMs.toFixed(1)} ms in the database${summary.at(-1).seqScans.length ? `; seq scans: ${summary.at(-1).seqScans.join(", ")}` : ""}`);
  }
} finally {
  for (const k of Object.keys(settings)) await admin.query(`alter database ${db} reset ${k}`).catch(() => undefined);
  await admin.end();
  api?.stop();
}
writeFileSync(join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
console.log(`plans in ${outDir}`);
process.exit(0);
