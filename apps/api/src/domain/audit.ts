/**
 * Hash-chained audit log (03 §7). hash = SHA-256(prev_hash ‖ canonical JSON of the entry).
 * Appends are serialised so the chain never forks.
 */
import { createHash } from "node:crypto";
import type { Clock } from "../lib/clock.js";
import type { AuditRepo, AuditRow } from "../repo/types.js";

export const GENESIS_HASH = "0".repeat(64);

/** Deterministic JSON: object keys sorted recursively. */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (v instanceof Date) return JSON.stringify(v.toISOString());
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
    .join(",")}}`;
}

export function entryHash(prevHash: string, e: Pick<AuditRow, "id" | "actor_id" | "action" | "target" | "meta_jsonb" | "at">): string {
  const body = canonicalJson({ id: e.id, actor_id: e.actor_id, action: e.action, target: e.target, meta: e.meta_jsonb, at: e.at.toISOString() });
  return createHash("sha256").update(prevHash).update("\n").update(body).digest("hex");
}

/** Returns the index of the first broken entry, or -1 if the chain is intact. */
export function verifyChain(rows: readonly AuditRow[]): number {
  let prev = GENESIS_HASH;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    if (r.prev_hash !== prev || entryHash(prev, r) !== r.hash) return i;
    prev = r.hash;
  }
  return -1;
}

export class AuditService {
  constructor(
    private readonly repo: AuditRepo,
    private readonly clock: Clock,
  ) {}

  /** The store chains the entry (in-memory: here; PostgreSQL: the audit_log_chain trigger under a lock). */
  append(entry: { actorId: string | null; action: string; target: string; meta?: Record<string, unknown> }): Promise<AuditRow> {
    return this.repo.append({
      actor_id: entry.actorId,
      action: entry.action,
      target: entry.target,
      meta_jsonb: entry.meta ?? {},
      at: new Date(this.clock.now()),
    });
  }
}
