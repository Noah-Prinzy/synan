#!/usr/bin/env node
/**
 * Repository hygiene, over the files git tracks:
 *   1. nothing at the repository root outside the allow-list below;
 *   2. no file over MAX_BYTES outside docs/archive (raise the limit here, in review, if needed);
 *   3. no environment files (.env, .env.local, …); `*.example` templates are allowed.
 * Exits 1 on any finding. The lockfile check (`pnpm install --frozen-lockfile`) and the Markdown
 * link check (scripts/check-links.mjs) are separate steps.
 */
import { statSync } from "node:fs";
import { join } from "node:path";
import { annotate, kb, mdTable, ROOT, summary, trackedFiles } from "./lib/util.mjs";

/** Top-level entries allowed in the repository. Add to this list in the same pull request as the file. */
const ROOT_ALLOW = new Set([
  // directories
  ".github", "apps", "docs", "e2e", "packages", "scripts",
  // files
  ".gitignore", ".gitattributes", ".editorconfig", ".markdownlint.json", ".npmrc", ".nvmrc", ".node-version",
  "CLAUDE.md", "CONTRIBUTING.md", "README.md", "LICENSE",
  "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "tsconfig.base.json",
]);
const MAX_BYTES = 1024 * 1024;
const SIZE_EXEMPT = /^docs\/archive\//;
const ENV_FILE = /(^|\/)\.env(\.[^/]*)?$/;
const ENV_TEMPLATE = /\.example$/;

const files = trackedFiles();
const findings = [];

const strayRoots = [...new Set(files.map((f) => f.split("/")[0]))].filter((top) => !ROOT_ALLOW.has(top));
for (const s of strayRoots) findings.push(["stray file at the root", s, "move it, or add it to ROOT_ALLOW in scripts/hygiene.mjs"]);

let largest = { file: "", size: 0 };
for (const f of files) {
  let size;
  try {
    size = statSync(join(ROOT, f)).size;
  } catch {
    continue; // deleted in the working tree, not yet committed
  }
  if (!SIZE_EXEMPT.test(f) && size > largest.size) largest = { file: f, size };
  if (!SIZE_EXEMPT.test(f) && size > MAX_BYTES) findings.push(["file over the size limit", f, `${kb(size)} KB > ${kb(MAX_BYTES)} KB`]);
  if (ENV_FILE.test(f) && !ENV_TEMPLATE.test(f)) findings.push(["environment file committed", f, "remove it from git; keep secrets out of the repository"]);
}

console.log(`Checked ${files.length} tracked files. Largest outside docs/archive: ${largest.file} (${kb(largest.size)} KB; limit ${kb(MAX_BYTES)} KB).`);
if (findings.length) {
  for (const [kind, file, fix] of findings) annotate("error", `${file}: ${fix}`, kind);
  summary(`### Repository hygiene: ${findings.length} finding(s)\n\n${mdTable(["Finding", "File", "Fix"], findings.map(([k, f, x]) => [k, `\`${f}\``, x]))}`);
  process.exit(1);
}
console.log("Repository hygiene: no findings (root allow-list, size limit, no .env files).");
summary(`### Repository hygiene: pass\n\n${files.length} tracked files; root allow-list, ${kb(MAX_BYTES)} KB size limit outside \`docs/archive\`, no \`.env\` files.`);
