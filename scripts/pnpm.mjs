#!/usr/bin/env node
/**
 * Runs pnpm from a root package script whether or not `pnpm` is on PATH (on this machine it is reached
 * only through corepack). pnpm sets npm_execpath to its own entry script for the scripts it runs.
 *
 *   node scripts/pnpm.mjs --filter ./packages/db migrations:verify
 */
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

/** [command, args, needsShell] that runs pnpm with `args`. */
export function pnpmCommand(args) {
  const exec = process.env.npm_execpath;
  if (exec && /pnpm/i.test(exec) && /\.(c?js|mjs)$/.test(exec)) return [process.execPath, [exec, ...args], false];
  return ["corepack", ["pnpm", ...args], process.platform === "win32"];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [cmd, args, shell] = pnpmCommand(process.argv.slice(2));
  const child = spawn(cmd, args, { stdio: "inherit", shell });
  child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
}
