#!/usr/bin/env node
/**
 * Dependency audit (pnpm audit, the npm advisory database). Fails when a high or critical advisory
 * affects a production dependency (what ships: `pnpm audit --prod`); every other advisory, including
 * development-only ones, is reported in the table and the job summary but does not fail.
 *
 *   node scripts/audit.mjs
 *
 * To accept a specific advisory deliberately, use pnpm's own `auditConfig.ignoreGhsas` in the root
 * package.json, with the reason in the pull request; never by lowering the threshold here.
 */
import { annotate, mdTable, pnpm, summary, textTable } from "./lib/util.mjs";

const ORDER = ["critical", "high", "moderate", "low", "info"];

function audit(prod) {
  const r = pnpm(["audit", "--json", ...(prod ? ["--prod"] : [])], { capture: true });
  let j;
  try {
    j = JSON.parse(r.stdout);
  } catch {
    throw new Error(`pnpm audit${prod ? " --prod" : ""} gave no JSON (exit ${r.status}): ${(r.stderr || r.stdout).slice(0, 2000)}`);
  }
  if (j.error) throw new Error(`pnpm audit failed: ${JSON.stringify(j.error)}`);
  return Object.values(j.advisories ?? {});
}

const prod = audit(true);
const all = audit(false);
const prodIds = new Set(prod.map((a) => a.id));
const rows = all
  .sort((a, b) => ORDER.indexOf(a.severity) - ORDER.indexOf(b.severity) || a.module_name.localeCompare(b.module_name))
  .map((a) => {
    const versions = [...new Set(a.findings.map((f) => f.version))].join(", ");
    const via = [...new Set(a.findings.flatMap((f) => f.paths))].slice(0, 2).join("; ");
    return [a.severity, prodIds.has(a.id) ? "production" : "development", `${a.module_name} ${versions}`, a.github_advisory_id ?? String(a.id), a.title, `patched: ${a.patched_versions}`, via];
  });
const blocking = prod.filter((a) => a.severity === "critical" || a.severity === "high");
const count = (list) => ORDER.map((s) => `${list.filter((a) => a.severity === s).length} ${s}`).join(", ");

console.log(`Production dependencies: ${count(prod)}`);
console.log(`All dependencies:        ${count(all)}`);
const headers = ["Severity", "Scope", "Package", "Advisory", "Title", "Fix", "Path"];
if (rows.length) console.log(`\n${textTable(headers, rows)}`);
summary(
  `### Dependency audit: ${blocking.length ? `**${blocking.length} high/critical in production — failing**` : "pass"}\n\n` +
    `- Production: ${count(prod)}\n- All, including development: ${count(all)}\n\n` +
    (rows.length ? mdTable(headers, rows.map((r) => r.map((c) => String(c).replace(/\|/g, "\\|")))) : "No advisories."),
);
for (const a of blocking) annotate("error", `${a.module_name}: ${a.title} (${a.github_advisory_id ?? a.id}), patched ${a.patched_versions}`, `${a.severity} advisory in a production dependency`);
const blockingIds = new Set(blocking.map((a) => a.id));
for (const a of all.filter((x) => !blockingIds.has(x.id))) {
  annotate("warning", `${a.module_name}: ${a.title} (${a.github_advisory_id ?? a.id})`, `${a.severity} advisory${prodIds.has(a.id) ? "" : " (development only)"}`);
}
process.exit(blocking.length ? 1 : 0);
