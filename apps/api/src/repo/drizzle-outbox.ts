/**
 * The email outbox over @synan/db (migrations 0020, 0022). Recipient and content are encrypted
 * envelopes bound to the row (enqueueEmail / claimEmail); `due` and `stats` read only ids, states and
 * counts. A claim holds the row for EMAIL_CLAIM_LEASE_SECONDS; a `sending` row past its lease (the
 * worker crashed) is due again and reclaimed, the lost try counting as an attempt.
 */
import { and, eq, sql } from "drizzle-orm";
import { claimEmail, email_outbox, emailsDue, enqueueEmail, finishEmail, type AnyDb, type Cipher } from "@synan/db";
import type { EmailOutboxRepo } from "./types.js";

export function drizzleEmailOutbox(db: AnyDb, cipher: Cipher): EmailOutboxRepo {
  return {
    async enqueue(i) {
      return enqueueEmail(db, cipher, { template: i.template, to: i.to, content: { subject: i.content.subject, text: i.content.text }, now: i.now });
    },
    async claim(id, { maxAttempts, now, leaseSeconds }) {
      const r = await claimEmail(db, cipher, id, { maxAttempts, now, leaseSeconds });
      return r ? { id: r.id, template: r.template, to: r.to, content: { subject: String(r.content.subject), text: String(r.content.text) }, attempts: r.attempts } : null;
    },
    async finish(id, i) {
      if (i.attempt === undefined) return finishEmail(db, id, { ok: i.ok, error: i.error, now: i.now });
      // public.email_finish with one more condition — the row is still on the attempt this worker
      // claimed — in the same single UPDATE, so a reclaim between the check and the write is impossible.
      // (Proposed for @synan/db: an optional p_attempt on email_finish, then this delegates to it.)
      const r = await db
        .update(email_outbox)
        .set({
          state: i.ok ? "sent" : "failed",
          sent_at: i.ok ? i.now : null,
          last_error: i.ok ? null : (i.error ?? "").slice(0, 500),
        })
        .where(and(eq(email_outbox.id, id), eq(email_outbox.state, "sending"), eq(email_outbox.attempts, i.attempt)))
        .returning({ state: email_outbox.state });
      return (r[0]?.state as "sent" | "failed" | undefined) ?? null;
    },
    async due({ maxAttempts, limit, now, leaseSeconds }) {
      return emailsDue(db, { maxAttempts, limit, now, leaseSeconds });
    },
    async stats(maxAttempts) {
      const r = await db
        .select({ state: email_outbox.state, dead: sql<boolean>`${email_outbox.state} = 'failed' and ${email_outbox.attempts} >= ${maxAttempts}`, n: sql<number>`count(*)` })
        .from(email_outbox)
        .groupBy(email_outbox.state, sql`2`);
      const s = { queued: 0, sending: 0, sent: 0, failed: 0, dead: 0 };
      for (const x of r) {
        s[x.state] += Number(x.n);
        if (x.dead) s.dead += Number(x.n);
      }
      return s;
    },
  };
}
