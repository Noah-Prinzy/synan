#!/usr/bin/env node
/**
 * Every theme token a class name uses must be registered with Tailwind.
 *
 * A token declared in packages/ui/src/styles/theme.css (say `--surface-2`) only becomes a utility
 * (`bg-surface-2`) when `@theme inline` registers it (`--color-surface-2: var(--surface-2)`).
 * Without that line Tailwind emits no rule for the class and the control silently draws with no
 * fill: a build, a typecheck and the unit tests all still pass. This check reads the tokens the
 * theme declares, finds every class in packages/ui and the three apps that names one of them
 * through a colour or shadow utility, and fails when the registration is missing.
 *
 *   node scripts/check-theme-utilities.mjs
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { ROOT } from "./lib/util.mjs";

const theme = readFileSync(join(ROOT, "packages/ui/src/styles/theme.css"), "utf8");
const block = theme.match(/@theme inline\s*\{([\s\S]*?)\n\}/);
if (!block) throw new Error("theme.css: no @theme inline block");
const registered = new Set([...block[1].matchAll(/--(color|shadow)-([a-z0-9-]+)\s*:/g)].map((m) => `${m[1]}:${m[2]}`));
// Tokens the theme declares outside @theme (the palette): the names a utility could refer to.
const declared = new Set([...theme.replace(block[0], "").matchAll(/^\s*--([a-z][a-z0-9-]*)\s*:/gm)].map((m) => m[1]));

const COLOUR = ["bg", "text", "fill", "stroke", "border", "outline", "ring", "decoration", "caret", "accent", "divide", "from", "via", "to", "placeholder"];
const pattern = new RegExp(`(?<![\\w-])(?:[a-z-]+:)*(${[...COLOUR, "shadow"].join("|")})-([a-z][a-z0-9-]*?)(?:\\/\\d+)?(?![\\w-])`, "g");

const roots = ["packages/ui/src", "apps/attendee/src", "apps/admin/src", "apps/scanner/src"];
const skip = /(^|[\\/])(node_modules|mockups|dist)([\\/]|$)/;
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
for (const file of files) {
  const text = readFileSync(file, "utf8");
  for (const m of text.matchAll(pattern)) {
    const [, kind, name] = m;
    if (!declared.has(name)) continue; // not one of the theme's own tokens (a Tailwind built-in, or a size)
    const key = kind === "shadow" ? `shadow:${name}` : `color:${name}`;
    if (registered.has(key)) continue;
    const where = `${relative(ROOT, file)} (${m[0]})`;
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
  process.exit(1);
}
console.log(`Theme utilities: ${files.length} files checked; every theme token used as a utility is registered.`);
