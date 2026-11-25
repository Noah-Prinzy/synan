#!/usr/bin/env node
/**
 * Markdown link check: every relative link in the tracked Markdown files (docs/ and the READMEs;
 * not docs/archive) points at a file that exists, and every `#anchor` into a Markdown file names a
 * heading that exists (GitHub's heading slugs). External links (http, https, mailto) are counted,
 * not fetched, so the check never fails on someone else's website. Exits 1 on a broken link.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize, relative } from "node:path";
import { annotate, mdTable, ROOT, summary, trackedFiles } from "./lib/util.mjs";

const files = trackedFiles().filter((f) => f.endsWith(".md") && !f.startsWith("docs/archive/"));

/** Strips fenced code blocks and inline code, keeping line numbers. */
function prose(text) {
  let fence = null;
  return text.split("\n").map((line) => {
    const m = line.match(/^\s*(```+|~~~+)/);
    if (m) {
      if (!fence) fence = m[1][0];
      else if (m[1][0] === fence) fence = null;
      return "";
    }
    return fence ? "" : line.replace(/`[^`]*`/g, "");
  });
}

/** GitHub's heading anchors: lower case, punctuation dropped, spaces to hyphens, repeats numbered. */
function anchorsOf(file) {
  const seen = new Map();
  const out = new Set();
  for (const line of prose(readFileSync(file, "utf8"))) {
    const h = line.match(/^#{1,6}\s+(.*?)\s*#*\s*$/);
    if (!h) continue;
    const text = h[1].replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/<[^>]+>/g, "").replace(/[*_~]/g, (c) => (c === "_" ? "_" : ""));
    let slug = text.toLowerCase().replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, "").replace(/ /g, "-");
    const n = seen.get(slug) ?? 0;
    seen.set(slug, n + 1);
    if (n) slug = `${slug}-${n}`;
    out.add(slug);
  }
  // Explicit anchors: <a id="x"> or <a name="x">
  for (const m of readFileSync(file, "utf8").matchAll(/<a\s+(?:id|name)="([^"]+)"/g)) out.add(m[1]);
  return out;
}

const anchorCache = new Map();
const anchors = (f) => anchorCache.get(f) ?? anchorCache.set(f, anchorsOf(f)).get(f);

const broken = [];
let checked = 0;
let external = 0;
for (const f of files) {
  const abs = join(ROOT, f);
  const lines = prose(readFileSync(abs, "utf8"));
  lines.forEach((line, i) => {
    const targets = [
      ...[...line.matchAll(/!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)].map((m) => m[1]),
      ...[...line.matchAll(/^\s*\[[^\]]+\]:\s*<?(\S+?)>?(?:\s+.*)?$/g)].map((m) => m[1]),
    ];
    for (const raw of targets) {
      if (/^(https?:|mailto:|tel:)/i.test(raw)) {
        external++;
        continue;
      }
      checked++;
      const [pathPart, hash] = raw.split("#");
      const target = pathPart ? normalize(join(dirname(abs), decodeURIComponent(pathPart))) : abs;
      const where = `${f}:${i + 1}`;
      if (pathPart && !existsSync(target)) {
        broken.push([where, raw, "file not found"]);
        continue;
      }
      if (hash && target.endsWith(".md") && statSync(target).isFile() && !anchors(target).has(decodeURIComponent(hash).toLowerCase())) {
        broken.push([where, raw, `no heading #${hash} in ${relative(ROOT, target).replace(/\\/g, "/")}`]);
      }
    }
  });
}

console.log(`Checked ${checked} relative links in ${files.length} Markdown files (${external} external links not fetched).`);
if (broken.length) {
  for (const [where, link, why] of broken) annotate("error", `${where}: ${link} (${why})`, "broken link");
  summary(`### Markdown links: ${broken.length} broken\n\n${mdTable(["Where", "Link", "Problem"], broken.map(([w, l, p]) => [`\`${w}\``, `\`${l}\``, p]))}`);
  process.exit(1);
}
console.log("Markdown links: none broken.");
summary(`### Markdown links: pass\n\n${checked} relative links in ${files.length} files; ${external} external links not fetched.`);
