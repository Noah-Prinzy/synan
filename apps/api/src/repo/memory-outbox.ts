/**
 * In-memory email outbox and unit of work, mirroring @synan/db migration 0020 (email_claim /
 * email_finish). Not encrypted (memory backend); recipients never leave this map except to the mailer.
 */
import { randomUUID } from "node:crypto";
import { EMAIL_CLAIM_LEASE_SECONDS } from "@synan/db";
import type { EmailContent, EmailOutboxRepo, Repos, TxScope } from "./types.js";

export interface MemEmail {
  id: string;
  template: string;
  to: string;
  content: EmailContent;
  state: "queued" | "sending" | "sent" | "failed";
  attempts: number;
  last_error: string | null;
  created_at: Date;
  sent_at: Date | null;
  /** When the current `sending` claim was taken (the lease runs from here). */
  claimed_at: Date | null;
  seq: number;
}

let seq = 0;

/** As public.email_claim / email_due (0022): queued, failed with attempts left, or `sending` past its lease. */
function claimable(e: MemEmail, maxAttempts: number, now: Date, leaseSeconds = EMAIL_CLAIM_LEASE_SECONDS): boolean {
  if (e.attempts >= maxAttempts) return false;
  if (e.state === "queued" || e.state === "failed") return true;
  return e.state === "sending" && (e.claimed_at === null || e.claimed_at.getTime() <= now.getTime() - leaseSeconds * 1000);
}
const clone = <T>(v: T): T => structuredClone(v);

/** The outbox over `emails`; with `buffer`, enqueued rows go there instead (stored on commit). */
export function memoryEmailOutbox(emails: Map<string, MemEmail>, buffer?: MemEmail[]): EmailOutboxRepo {
  return {
    async enqueue(i) {
      const row: MemEmail = {
        id: randomUUID(), template: i.template, to: i.to, content: clone(i.content), state: "queued", attempts: 0, last_error: null,
        created_at: i.now, sent_at: null, claimed_at: null, seq: seq++,
      };
      if (buffer) buffer.push(row);
      else emails.set(row.id, row);
      return row.id;
    },
    async claim(id, { maxAttempts, now, leaseSeconds }) {
      const e = emails.get(id);
      if (!e || !claimable(e, maxAttempts, now, leaseSeconds)) return null;
      e.state = "sending";
      e.attempts += 1;
      e.claimed_at = now;
      return { id, template: e.template, to: e.to, content: clone(e.content), attempts: e.attempts };
    },
    async finish(id, i) {
      const e = emails.get(id);
      if (!e || e.state !== "sending" || (i.attempt !== undefined && e.attempts !== i.attempt)) return null;
      e.state = i.ok ? "sent" : "failed";
      e.sent_at = i.ok ? i.now : null;
      e.last_error = i.ok ? null : (i.error ?? "").slice(0, 500);
      return e.state;
    },
    async due({ maxAttempts, limit, now, leaseSeconds }) {
      return [...emails.values()]
        .filter((e) => claimable(e, maxAttempts, now, leaseSeconds))
        .sort((a, b) => a.created_at.getTime() - b.created_at.getTime() || a.seq - b.seq)
        .slice(0, limit)
        .map((e) => e.id);
    },
    async stats(maxAttempts) {
      const s = { queued: 0, sending: 0, sent: 0, failed: 0, dead: 0 };
      for (const e of emails.values()) {
        s[e.state]++;
        if (e.state === "failed" && e.attempts >= maxAttempts) s.dead++;
      }
      return s;
    },
  };
}

/**
 * The memory unit of work: no rollback of ordinary writes (there is no storage to protect), but
 * outbox rows exist only once `fn` succeeds, so a failed state change never sends its email.
 */
export function memoryTransaction(repos: () => Repos, emails: Map<string, MemEmail>) {
  return async function transaction<T>(fn: (scope: TxScope) => Promise<T>): Promise<T> {
    const pending: MemEmail[] = [];
    const hooks: (() => void)[] = [];
    const scoped: Repos = { ...repos(), emailOutbox: memoryEmailOutbox(emails, pending) };
    const scope: TxScope = { repos: scoped, handle: null, afterCommit: (f) => void hooks.push(f) };
    scoped.transaction = (inner) => inner(scope);
    const out = await fn(scope);
    for (const e of pending) emails.set(e.id, e);
    for (const f of hooks) f();
    return out;
  };
}
