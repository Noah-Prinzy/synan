#!/usr/bin/env node
/**
 * Scan-ingest baseline (roadmap 5.1 → 5.3/5.4): end-to-end POST /scans against the API on the seeded
 * real database (`corepack pnpm db:seed:load` first). Measures; does not optimise.
 *
 *   corepack pnpm load:scans [--seconds=10] [--repeats=3] [--port=5189]
 *
 * Starts the API itself (REPO=postgres, the three role logins of @synan/db/testing, no dev seed, rate
 * limits lifted), signs in the gate users, then:
 *   1. the first scan after start (the scan model replays the event's whole history: roadmap fault 9);
 *   2. single scans at concurrency 1, 4, 16, 32; batches of 10 and 50 at concurrency 1, 4, 16;
 *      each for --seconds, --repeats times, reporting the median run and the spread across runs.
 * Around every run pg_stat_statements is reset and read, giving statements per scan and database time
 * per scan; the rest of the latency is the API process (and its per-event lock) and the loopback.
 * Records the machine's CPU use during each run, since other work on the machine distorts the numbers.
 */
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { join } from "node:path";
import { arg, bandUid, home, load, pg, startApi, urlFor } from "./load-lib.mjs";

const SECONDS = Number(arg("seconds", 10));
const REPEATS = Number(arg("repeats", 3));
const PORT = Number(arg("port", 5189));

/* ------------------------------------------------------------------ the API */
const api = await startApi(PORT);
const post = (path, body, token) => api.call("POST", path, body, token);
const stopApi = () => api.stop();

/* ------------------------------------------------------------------ gates and people */
const inGates = load.gates.filter((g) => g.direction === "in");
const tokens = new Map();
await Promise.all(inGates.map(async (g) => tokens.set(g.checkpoint_id, await api.login(g.email))));
// A fresh run of people each time (offset from --people-offset or the clock), so a rerun admits people
// who are outside rather than re-presenting the last run's (already inside): the admission path, not the refusal.
let person = Number(arg("people-offset", Math.floor(Date.now() / 1000) % 50_000));
const nextScan = (gate) => ({
  idem_key: `L${randomBytes(15).toString("base64url")}`, // 21 characters: the contract wants 16–64
  checkpoint_id: gate.checkpoint_id,
  presented: { medium: "nfc", uid: bandUid((person++ * 7919) % load.liveRegistrations) },
  occurred_at: new Date().toISOString(),
  clock_offset_ms: 0,
  offline: false,
});

/* ------------------------------------------------------------------ measurement */
const admin = new pg.Client({ connectionString: urlFor() });
await admin.connect();
const statsReset = () => admin.query(`select pg_stat_statements_reset()`);
const statsRead = async () =>
  (await admin.query(`
    select s.calls::int calls, s.total_exec_time ms, s.query
      from pg_stat_statements s join pg_database d on d.oid = s.dbid
     where d.datname = $1 and s.query not ilike '%pg_stat_statements%'
     order by s.total_exec_time desc`, [load.database])).rows;
const cpuSnap = () => cpus().reduce((a, c) => ({ idle: a.idle + c.times.idle, total: a.total + Object.values(c.times).reduce((x, y) => x + y, 0) }), { idle: 0, total: 0 });
const pct = (xs, p) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};

async function run(batch, concurrency) {
  await statsReset();
  const c0 = cpuSnap();
  const lat = [];
  const results = {};
  let scans = 0;
  let errors = 0;
  const end = performance.now() + SECONDS * 1000;
  const t0 = performance.now();
  await Promise.all(Array.from({ length: concurrency }, async (_, w) => {
    let k = w;
    while (performance.now() < end) {
      const gate = inGates[k++ % inGates.length];
      const items = Array.from({ length: batch }, () => nextScan(gate));
      const r = await post("/scans", { event_id: load.eventId, device_id: `load-${w}`, scans: items }, tokens.get(gate.checkpoint_id));
      if (r.status !== 200) {
        errors++;
        // A measurement of refused requests measures nothing: stop at the first one, with its reason.
        if (scans === 0 && errors === 1) {
          console.error(`refused: HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 500)}`);
          process.exit(1);
        }
        continue;
      }
      lat.push(r.ms);
      scans += batch;
      for (const x of r.body.results ?? []) results[x.result ?? x.status ?? "?"] = (results[x.result ?? x.status ?? "?"] ?? 0) + 1;
    }
  }));
  const elapsed = (performance.now() - t0) / 1000;
  const c1 = cpuSnap();
  const st = await statsRead();
  const calls = st.reduce((a, s) => a + s.calls, 0);
  const dbMs = st.reduce((a, s) => a + s.ms, 0);
  return {
    batch, concurrency, seconds: +elapsed.toFixed(1), requests: lat.length, scans, errors,
    scansPerSec: +(scans / elapsed).toFixed(1), p50: +pct(lat, 50).toFixed(1), p95: +pct(lat, 95).toFixed(1), p99: +pct(lat, 99).toFixed(1),
    statementsPerScan: +(calls / Math.max(1, scans)).toFixed(1), dbMsPerScan: +(dbMs / Math.max(1, scans)).toFixed(2),
    machineCpuPct: +(100 * (1 - (c1.idle - c0.idle) / (c1.total - c0.total))).toFixed(0),
    results,
    top: st.slice(0, 8).map((s) => ({ calls: s.calls, ms: +s.ms.toFixed(0), perScan: +(s.calls / Math.max(1, scans)).toFixed(2), q: s.query.replace(/\s+/g, " ").slice(0, 140) })),
  };
}

const out = { started: new Date().toISOString(), cpus: cpus().length, cpuModel: cpus()[0]?.model, seconds: SECONDS, repeats: REPEATS, cold: null, runs: [] };

// 1. Cold: the first scan after start replays the event's history.
await statsReset();
const firstGate = inGates[0];
const cold = await post("/scans", { event_id: load.eventId, device_id: "load-cold", scans: [nextScan(firstGate)] }, tokens.get(firstGate.checkpoint_id));
const coldStats = await statsRead();
out.cold = { status: cold.status, ms: +cold.ms.toFixed(0), statements: coldStats.reduce((a, s) => a + s.calls, 0), top: coldStats.slice(0, 5).map((s) => ({ calls: s.calls, ms: +s.ms.toFixed(0), q: s.query.replace(/\s+/g, " ").slice(0, 140) })) };
if (cold.status !== 200) {
  console.error(`cold scan refused: HTTP ${cold.status} ${JSON.stringify(cold.body).slice(0, 500)}`);
  process.exit(1);
}
console.log(`cold first scan: ${out.cold.ms} ms (HTTP ${cold.status}), ${out.cold.statements} statements`);
const warm = await post("/scans", { event_id: load.eventId, device_id: "load-warm", scans: [nextScan(firstGate)] }, tokens.get(firstGate.checkpoint_id));
console.log(`second scan: ${warm.ms.toFixed(0)} ms`);

// 2. Scenarios.
const scenarios = [[1, 1], [1, 4], [1, 16], [1, 32], [10, 1], [10, 4], [10, 16], [50, 1], [50, 4], [50, 16]];
for (const [batch, concurrency] of scenarios) {
  const reps = [];
  for (let i = 0; i < REPEATS; i++) reps.push(await run(batch, concurrency));
  const sorted = [...reps].sort((a, b) => a.scansPerSec - b.scansPerSec);
  const median = sorted[Math.floor(sorted.length / 2)];
  const spread = (k) => `${Math.min(...reps.map((r) => r[k]))}–${Math.max(...reps.map((r) => r[k]))}`;
  out.runs.push({ ...median, spread: { scansPerSec: spread("scansPerSec"), p50: spread("p50"), p95: spread("p95"), machineCpuPct: spread("machineCpuPct") }, repeats: reps.map(({ top, results, ...r }) => r) });
  console.log(
    `batch ${String(batch).padStart(2)} × conc ${String(concurrency).padStart(2)}: ${String(median.scansPerSec).padStart(7)} scans/s (${spread("scansPerSec")}), ` +
      `request p50 ${median.p50} ms (${spread("p50")}), p95 ${median.p95} ms (${spread("p95")}), ${median.statementsPerScan} stmts/scan, ` +
      `${median.dbMsPerScan} ms db/scan, cpu ${spread("machineCpuPct")} %, errors ${median.errors}, results ${JSON.stringify(median.results)}`,
  );
}

await admin.end();
stopApi();
const file = arg("out", join(home, `load-scans-${Date.now()}.json`));
writeFileSync(file, JSON.stringify(out, null, 2));
console.log(`wrote ${file}`);
process.exit(0);
