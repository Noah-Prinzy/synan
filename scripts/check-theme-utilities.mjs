#!/usr/bin/env node
/**
 * Every theme token a class name uses must be registered with Tailwind, and the Gate Scanner's
 * ruled tokens stay in the scanner.
 *
 * A token declared in packages/ui/src/styles/theme.css (say `--surface-2`) only becomes a utility
 * (`bg-surface-2`) when `@theme inline` registers it (`--color-surface-2: var(--surface-2)`).
 * Without that line Tailwind emits no rule for the class and the control silently draws with no
 * fill: a build, a typecheck and the unit tests all still pass. This check reads the tokens the
 * theme (and the scanner's scanner-lines.css) declares, finds every class in packages/ui and the
 * three apps that names one of them through a colour or shadow utility, and fails when the
 * registration is missing.
 *
 * It also fails when the Attendee Portal, Admin Command or the shared package names a token that
 * only scanner-lines.css declares (`--border`, `--input`): those are the scanner's hairlines, and
 * D-37 draws no lines anywhere else.
 *
 *   node scripts/check-theme-utilities.mjs
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { ROOT } from "./lib/util.mjs";

const read = (f) => readFileSync(join(ROOT, "packages/ui/src/styles", f), "utf8").replace(/\r\n/g, "\n");
const theme = read("theme.css");
const scanner = read("scanner-lines.css");
const THEME_BLOCK = /@theme inline\s*\{([\s\S]*?)\n\}/g;
const DECL = /^\s*--([a-z][a-z0-9-]*)\s*:/gm;

const blocks = [...theme.matchAll(THEME_BLOCK), ...scanner.matchAll(THEME_BLOCK)];
if (!blocks.length) throw new Error("theme.css: no @theme inline block");
const registered = new Set(blocks.flatMap((b) => [...b[1].matchAll(/--(color|shadow)-([a-z0-9-]+)\s*:/g)].map((m) => `${m[1]}:${m[2]}`)));
// Tokens the sheets declare outside @theme (the palette): the names a utility could refer to.
const outside = (text) => text.replace(THEME_BLOCK, "");
const themeTokens = new Set([...outside(theme).matchAll(DECL)].map((m) => m[1]));
const scannerTokens = new Set([...outside(scanner).matchAll(DECL)].map((m) => m[1]));
const scannerOnly = new Set([...scannerTokens].filter((n) => !themeTokens.has(n)));
const declared = new Set([...themeTokens, ...scannerTokens]);

const COLOUR = ["bg", "text", "fill", "stroke", "border", "outline", "ring", "decoration", "caret", "accent", "divide", "from", "via", "to", "placeholder"];
const pattern = new RegExp(`(?<![\\w-])(?:[a-z-]+:)*(${[...COLOUR, "shadow"].join("|")})-([a-z][a-z0-9-]*?)(?:\\/\\d+)?(?![\\w-])`, "g");

const roots = ["packages/ui/src", "apps/attendee/src", "apps/admin/src", "apps/scanner/src"];
const skip = /(^|[\\/])(node_modules|dist)([\\/]|$)/;
const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (skip.test(p)) continue;
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(tsx?|css)$/.test(name) && !/\.test\./.test(name)) files.push(p);
  }
};
for (const r of roots) walk(join(ROOT, r));

const missing = new Map();
const ruled = [];
for (const file of files) {
  const text = readFileSync(file, "utf8");
  const inScanner = /[\\/]apps[\\/]scanner[\\/]|scanner-lines\.css$/.test(file);
  for (const m of text.matchAll(pattern)) {
    const [, kind, name] = m;
    if (!declared.has(name)) continue; // not one of the theme's own tokens (a Tailwind built-in, or a size)
    const where = `${relative(ROOT, file)} (${m[0]})`;
    if (scannerOnly.has(name) && !inScanner) ruled.push(where);
    const key = kind === "shadow" ? `shadow:${name}` : `color:${name}`;
    if (registered.has(key)) continue;
    if (!missing.has(key)) missing.set(key, []);
    missing.get(key).push(where);
  }
}

if (missing.size) {
  console.error("Theme tokens used as utilities but not registered in @theme inline (packages/ui/src/styles/theme.css):");
  for (const [key, where] of missing) {
    const [kind, name] = key.split(":");
    console.error(`  --${kind}-${name}: var(--${name});   used in ${where.slice(0, 3).join(", ")}${where.length > 3 ? ` and ${where.length - 3} more` : ""}`);
  }
}
if (ruled.length) {
  console.error("The Gate Scanner's ruled tokens used outside the scanner (D-37: no lines in the Attendee Portal or Admin Command):");
  for (const w of ruled) console.error(`  ${w}`);
}
if (missing.size || ruled.length) process.exit(1);
console.log(`Theme utilities: ${files.length} files checked; every theme token used as a utility is registered, and the scanner's ruled tokens stay in the scanner.`);
