#!/usr/bin/env node
/**
 * Test-count guard (roadmap §2.6): the number of passing tests per suite may not drop without a
 * marker that explains it. The baseline is scripts/test-counts.json, committed and reviewed.
 *
 *   node scripts/test-counts.mjs check  [--suites a,b | --except a,b] [--base <git ref>]
 *   node scripts/test-counts.mjs update [--suites a,b] [--reason "why fewer tests"]
 *
 * check:  reads the vitest JSON reports written by scripts/run-suite.mjs and fails when a suite
 *         passed fewer tests than its baseline, or did not report at all. A suite above its
 *         baseline passes with a notice to raise it. With --base, also fails when the committed
 *         baseline was lowered (or a suite removed) since that ref without a `reductions` entry
 *         { suite, from, to, reason } that matches.
 * update: sets each reported suite's baseline to its passed count. Lowering one needs --reason,
 *         which is recorded as a `reductions` entry — the marker a reviewer sees in the diff.
 *
 * Counted: passed tests. A test turned into `.skip` therefore counts as a drop.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readCounts, resultsDir } from "./run-suite.mjs";
import { annotate, git, mdTable, ROOT, summary, textTable } from "./lib/util.mjs";

const FILE = "scripts/test-counts.json";
const [cmd, ...rest] = process.argv.slice(2);
const opt = (name) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : undefined;
};
const baseline = JSON.parse(readFileSync(join(ROOT, FILE), "utf8"));
const only = opt("suites")?.split(",").filter(Boolean);
// --except: every baseline suite but these (CI checks the end-to-end suite in its own, non-required job).
const except = new Set(opt("except")?.split(",").filter(Boolean) ?? []);
const suites = (only ?? Object.keys(baseline.suites)).filter((s) => !except.has(s));
const dir = resultsDir();

if (cmd === "update") {
  const reason = opt("reason");
  const today = new Date().toISOString().slice(0, 10);
  let refused = false;
  for (const s of suites) {
    const c = readCounts(join(dir, `${s}.json`));
    if (!c) continue;
    const before = baseline.suites[s];
    if (before !== undefined && c.passed < before) {
      if (!reason) {
        console.error(`${s}: ${before} → ${c.passed} is a drop; run again with --reason "<why>" to record it.`);
        refused = true;
        continue;
      }
      baseline.reductions.push({ suite: s, from: before, to: c.passed, reason, date: today });
    }
    if (before !== c.passed) console.log(`${s}: ${before ?? "(new)"} → ${c.passed}`);
    baseline.suites[s] = c.passed;
  }
  writeFileSync(join(ROOT, FILE), `${JSON.stringify(baseline, null, 2)}\n`);
  process.exit(refused ? 1 : 0);
}

if (cmd !== "check") {
  console.error("usage: test-counts.mjs check|update [--suites a,b] [--except a,b] [--base ref] [--reason text]");
  process.exit(2);
}

const errors = [];
const rows = [];
for (const s of suites) {
  const want = baseline.suites[s];
  const c = readCounts(join(dir, `${s}.json`));
  if (want === undefined) {
    errors.push(`${s}: not in ${FILE}; add it with \`node scripts/test-counts.mjs update --suites ${s}\``);
    rows.push([s, "-", c ? String(c.passed) : "-", c ? String(c.skipped) : "-", "", "NOT IN BASELINE"]);
    continue;
  }
  if (!c) {
    errors.push(`${s}: no results in ${dir} (the suite did not run or did not finish)`);
    rows.push([s, String(want), "-", "-", "", "NO RESULTS"]);
    continue;
  }
  const delta = c.passed - want;
  let result = "ok";
  if (delta < 0) {
    result = "DROPPED";
    errors.push(`${s}: ${c.passed} passed, baseline ${want} (${delta}). If deliberate, record it: \`node scripts/test-counts.mjs update --suites ${s} --reason "<why>"\`, and have the change reviewed independently (§2.6).`);
  } else if (delta > 0) {
    result = "above baseline";
    annotate("notice", `${s}: ${c.passed} passed, baseline ${want}. Raise it: node scripts/test-counts.mjs update --suites ${s}`, "test count");
  }
  rows.push([s, String(want), String(c.passed), String(c.skipped), delta ? (delta > 0 ? `+${delta}` : String(delta)) : "0", result]);
}

// The committed baseline itself: lowered since --base only with a matching reductions entry.
const baseRef = opt("base");
if (baseRef) {
  const old = git(["show", `${baseRef}:${FILE}`], { allowFail: true });
  if (old === null) console.log(`No ${FILE} at ${baseRef}: nothing to compare the baseline with.`);
  else {
    const before = JSON.parse(old).suites;
    for (const [s, n] of Object.entries(before)) {
      const now = baseline.suites[s] ?? 0;
      if (now >= n) continue;
      const marked = baseline.reductions.some((r) => r.suite === s && r.from === n && r.to === now && String(r.reason ?? "").trim().length >= 10);
      if (!marked) errors.push(`${s}: the baseline went from ${n} to ${now} since ${baseRef} without a \`reductions\` entry { suite, from: ${n}, to: ${now}, reason } in ${FILE}.`);
      else console.log(`${s}: baseline lowered ${n} → ${now}, recorded with a reason (needs independent review).`);
    }
  }
}

const headers = ["Suite", "Baseline", "Passed", "Skipped", "Change", "Result"];
const align = ["l", "r", "r", "r", "r", "l"];
console.log(textTable(headers, rows, align));
summary(`### Test counts against \`${FILE}\`\n\n${mdTable(headers, rows, align)}${errors.length ? `\n\n**${errors.length} problem(s):**\n\n${errors.map((e) => `- ${e}`).join("\n")}` : ""}`);
for (const e of errors) annotate("error", e, "test count");
process.exit(errors.length ? 1 : 0);
