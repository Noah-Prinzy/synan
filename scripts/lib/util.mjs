/**
 * Small helpers shared by the scripts in this folder (Node built-ins only, no dependencies).
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Absolute path of the repository root. */
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * How to call pnpm from a script. Inside `pnpm run` / `corepack pnpm run`, npm_execpath is pnpm's own
 * entry file, so this works where pnpm is not on PATH (corepack without `corepack enable`).
 */
export function pnpmCommand() {
  const exec = process.env.npm_execpath;
  if (exec && /pnpm(\.c?js)?$/i.test(exec)) return { cmd: process.execPath, pre: [exec] };
  // Otherwise corepack's own script, shipped with Node 24, run by this Node: no shell needed.
  const corepack = join(dirname(process.execPath), process.platform === "win32" ? "" : "../lib", "node_modules/corepack/dist/corepack.js");
  if (existsSync(corepack)) return { cmd: process.execPath, pre: [corepack, "pnpm"] };
  return { cmd: "pnpm", pre: [] }; // pnpm on PATH (e.g. after `corepack enable`)
}

/** Runs pnpm with these arguments, streaming output. Returns the exit status. */
export function pnpm(args, opts = {}) {
  const { cmd, pre } = pnpmCommand();
  const r = spawnSync(cmd, [...pre, ...args], { cwd: opts.cwd ?? ROOT, stdio: opts.capture ? "pipe" : "inherit", env: { ...process.env, ...opts.env }, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (r.error) throw r.error;
  return opts.capture ? r : r.status ?? 1;
}

/** Runs git and returns stdout (throws on failure unless allowFail). */
export function git(args, opts = {}) {
  const r = spawnSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0) {
    if (opts.allowFail) return null;
    throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  }
  return r.stdout;
}

/** Files tracked by git, relative to the root, with forward slashes. */
export function trackedFiles() {
  return git(["ls-files", "-z"]).split("\0").filter(Boolean);
}

/** A Markdown table. `align`: per column, "l" or "r". */
export function mdTable(headers, rows, align = []) {
  const sep = headers.map((_, i) => (align[i] === "r" ? "---:" : "---"));
  return [headers, sep, ...rows].map((r) => `| ${r.join(" | ")} |`).join("\n");
}

/** A plain-text table for the log. */
export function textTable(headers, rows, align = []) {
  const all = [headers, ...rows].map((r) => r.map(String));
  const w = headers.map((_, i) => Math.max(...all.map((r) => r[i].length)));
  const line = (r) => r.map((c, i) => (align[i] === "r" ? c.padStart(w[i]) : c.padEnd(w[i]))).join("  ");
  return [line(all[0]), w.map((n) => "-".repeat(n)).join("  "), ...all.slice(1).map(line)].join("\n");
}

/** Appends Markdown to the GitHub Actions job summary, when running there. */
export function summary(markdown) {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (file) appendFileSync(file, `${markdown}\n\n`);
}

/** A GitHub Actions annotation (shown on the run page), or a plain line elsewhere. */
export function annotate(level, message, title) {
  if (process.env.GITHUB_ACTIONS) console.log(`::${level}${title ? ` title=${title}` : ""}::${message.replace(/\n/g, "%0A")}`);
  else console.log(`${level.toUpperCase()}: ${title ? `${title}: ` : ""}${message}`);
}

export const kb = (bytes) => (bytes / 1024).toFixed(1);
