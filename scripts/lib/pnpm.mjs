#!/usr/bin/env node
/**
 * Runs pnpm with the given arguments from a package.json script, whether or not pnpm is on PATH
 * (corepack without `corepack enable`): `node scripts/lib/pnpm.mjs --filter x run build`.
 */
import { pnpm } from "./util.mjs";

process.exit(pnpm(process.argv.slice(2), { cwd: process.cwd() }));
