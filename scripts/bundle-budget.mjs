#!/usr/bin/env node
/**
 * Bundle budgets: follows each production build's own import graph (Vite's build manifest) and
 * sums what loads before a screen paints, gzip level 9. Prints a table, writes it to the job
 * summary, and exits 1 when an enforced budget is over.
 *
 *   node scripts/bundle-budget.mjs --mode api|mock [--json out.json]
 *
 * Needs `apps/<app>/dist/.vite/manifest.json`: build with `vite build --manifest` (the CLI flag only
 * adds the manifest file; the app's own build is unchanged). Budgets and the method live in
 * scripts/bundle-budgets.json.
 *
 * Method, per budget: start from the `roots` (manifest keys); for each, take its chunk file, its CSS
 * files, and recursively the same for every entry in its `imports` (static imports, which the
 * browser fetches before running the chunk). `dynamicImports` are not followed: a dynamic import
 * that is awaited at start-up is listed as a root instead. Each file is counted once. HTML is the
 * built index.html. Fonts, images and the service worker are not counted.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { annotate, kb, mdTable, ROOT, summary, textTable } from "./lib/util.mjs";

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const mode = opt("mode") ?? (process.env.VITE_API_URL ? "api" : "mock");
if (!["api", "mock"].includes(mode)) throw new Error(`--mode must be api or mock, not ${mode}`);

const config = JSON.parse(readFileSync(join(ROOT, "scripts/bundle-budgets.json"), "utf8"));
const gz = (buf) => gzipSync(buf, { level: 9 }).length;

const results = [];
let failed = false;

for (const b of config.budgets) {
  const dist = join(ROOT, "apps", b.app, "dist");
  const manifestPath = join(dist, ".vite", "manifest.json");
  if (!existsSync(manifestPath)) {
    annotate("error", `${manifestPath} not found: build ${b.app} with \`vite build --manifest\` first`, "bundle budget");
    failed = true;
    continue;
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const roots = b.roots[mode] ?? [];
  const js = new Set();
  const css = new Set();
  const missing = [];
  const visit = (key) => {
    const entry = manifest[key];
    if (!entry) return void missing.push(key);
    if (js.has(entry.file)) return;
    if (entry.file.endsWith(".js")) js.add(entry.file);
    else if (entry.file.endsWith(".css")) css.add(entry.file);
    for (const c of entry.css ?? []) css.add(c);
    for (const i of entry.imports ?? []) visit(i);
  };
  for (const r of roots) visit(r);
  if (missing.length) {
    // A renamed or removed root would silently shrink the measurement: fail instead.
    annotate("error", `${b.id}: root(s) not in the ${b.app} build manifest: ${missing.join(", ")}. Update scripts/bundle-budgets.json.`, "bundle budget");
    failed = true;
  }
  const size = (rel) => gz(readFileSync(join(dist, rel)));
  const parts = { html: 0, css: 0, js: 0 };
  if (b.count.includes("html")) parts.html = size("index.html");
  if (b.count.includes("css")) for (const f of css) parts.css += size(f);
  if (b.count.includes("js")) for (const f of js) parts.js += size(f);
  const total = parts.html + parts.css + parts.js;
  const limit = b.limitKb * 1024;
  const enforced = b.enforce.includes(mode);
  const over = total > limit;
  if (over && enforced) failed = true;
  const status = over ? (enforced ? "OVER BUDGET" : "over (report only)") : "within";
  results.push({ ...b, mode, parts, total, limit, enforced, over, status, files: { js: [...js], css: [...css] } });
  if (over && enforced) {
    annotate("error", `${b.label}: ${kb(total)} KB gzip, budget ${b.limitKb} KB (over by ${kb(total - limit)} KB)`, "bundle budget");
  }
}

const headers = ["Budget", "Mode", "HTML", "CSS", "JS", "Total KB", "Limit KB", "Headroom KB", "Result"];
const align = ["l", "l", "r", "r", "r", "r", "r", "r", "l"];
const rows = results.map((r) => [
  r.label + (r.provisional ? " (provisional limit)" : ""),
  r.mode,
  r.count.includes("html") ? kb(r.parts.html) : "-",
  r.count.includes("css") ? kb(r.parts.css) : "-",
  kb(r.parts.js),
  kb(r.total),
  String(r.limitKb),
  kb(r.limit - r.total),
  r.status,
]);
console.log(`\nBundle budgets, ${mode} build (gzip level 9, KB = 1024 bytes)\n`);
console.log(textTable(headers, rows, align));
for (const r of results) console.log(`\n${r.id}: ${r.files.js.length} JS, ${r.files.css.length} CSS\n  ${[...r.files.js, ...r.files.css].join("\n  ")}`);
summary(`### Bundle budgets — ${mode === "api" ? "real-API build (enforced)" : "mock build (report only)"}\n\n${mdTable(headers, rows.map((r) => r.map((c) => (c === "OVER BUDGET" ? "**OVER BUDGET**" : c))), align)}\n\nMethod: Vite build manifest, roots and their static imports, gzip level 9; fonts excluded. See \`scripts/bundle-budget.mjs\`.`);

const out = opt("json");
if (out) writeFileSync(out, JSON.stringify(results, null, 2));
process.exit(failed ? 1 : 0);
