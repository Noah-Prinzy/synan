#!/usr/bin/env node
/**
 * Reads a semgrep JSON report, prints every finding, writes the job summary, and exits 1 when a
 * finding of severity ERROR (or CRITICAL / HIGH, in rules that use those) remains after the
 * reviewed exceptions in .github/semgrep-accepted.json ({ rule, path, reason } — the rule id and the file, with the reason a reviewer accepted it).
 * WARNING, MEDIUM, LOW and INFO findings are reported only.
 *
 *   node scripts/semgrep-report.mjs semgrep.json
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { annotate, mdTable, ROOT, summary, textTable } from "./lib/util.mjs";

const file = process.argv[2] ?? "semgrep.json";
if (!existsSync(file)) {
  annotate("error", `${file} not found: semgrep did not produce a report`, "static analysis");
  process.exit(1);
}
const report = JSON.parse(readFileSync(file, "utf8"));
const acceptedPath = join(ROOT, ".github/semgrep-accepted.json");
const accepted = existsSync(acceptedPath) ? JSON.parse(readFileSync(acceptedPath, "utf8")).accepted ?? [] : [];
const norm = (p) => p.split(String.fromCharCode(92)).join("/").replace(/^\.\//, "");
const shortRule = (id) => id.split(".").slice(-1)[0];
const isAccepted = (r) => accepted.some((a) => (a.rule === r.check_id || a.rule === shortRule(r.check_id)) && a.path === norm(r.path));

const ORDER = ["CRITICAL", "ERROR", "HIGH", "WARNING", "MEDIUM", "LOW", "INFO"];
const BLOCKING = new Set(["CRITICAL", "ERROR", "HIGH"]);
const findings = report.results
  .map((r) => ({ severity: r.extra.severity, rule: r.check_id, where: `${norm(r.path)}:${r.start.line}`, message: r.extra.message.replace(/\s+/g, " ").slice(0, 160), accepted: isAccepted(r) }))
  .sort((a, b) => ORDER.indexOf(a.severity) - ORDER.indexOf(b.severity) || a.where.localeCompare(b.where));
const blocking = findings.filter((f) => BLOCKING.has(f.severity) && !f.accepted);
const tally = ORDER.map((s) => [s, findings.filter((f) => f.severity === s).length]).filter(([, n]) => n).map(([s, n]) => `${n} ${s.toLowerCase()}`).join(", ") || "no findings";
const scanned = report.paths?.scanned?.length ?? 0;
const rows = findings.map((f) => [f.severity + (f.accepted ? " (accepted)" : ""), shortRule(f.rule), f.where, f.message]);
const headers = ["Severity", "Rule", "Where", "Message"];

console.log(`semgrep: ${scanned} files scanned; ${tally}; ${blocking.length} blocking; ${report.errors?.length ?? 0} scan errors (files or rules semgrep could not fully parse or finish).`);
if (rows.length) console.log(`\n${textTable(headers, rows)}`);
for (const e of report.errors ?? []) console.log(`scan error (${e.type}): ${String(e.message ?? "").slice(0, 300)}`);
summary(
  `### Static analysis (semgrep open rules): ${blocking.length ? `**${blocking.length} blocking finding(s) — failing**` : "pass"}\n\n` +
    `${scanned} files; ${tally}. Reviewed exceptions: \`.github/semgrep-accepted.json\`.\n\n` +
    (rows.length ? mdTable(headers, rows.map((r) => r.map((c) => String(c).replace(/\|/g, "\\|")))) : "No findings."),
);
for (const f of findings) {
  const [path, line] = f.where.split(":");
  const level = BLOCKING.has(f.severity) && !f.accepted ? "error" : "warning";
  if (process.env.GITHUB_ACTIONS) console.log(`::${level} file=${path},line=${line},title=${shortRule(f.rule)}::${f.message}`);
}
process.exit(blocking.length ? 1 : 0);
