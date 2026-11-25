/**
 * Outbound email, always through the outbox (D-17).
 *
 * - `send` writes the message to the email outbox inside the caller's unit of work (TxScope), so the
 *   email exists only if the state change it announces commits, and enqueues the `email.send` job
 *   in that same transaction (pg-boss) or after commit (in process). The job payload is
 *   `{ outbox_id }` alone: recipients, links and tokens never reach a job table, a job log or this
 *   process's log.
 * - `deliver` claims one row (atomic: a duplicate job never sends twice), hands it to the transport
 *   with a timeout, and records the outcome. A failure is retried (pg-boss retry with backoff; in
 *   process, the periodic sweep) until EMAIL_MAX_ATTEMPTS; after that the row stays `failed` and is
 *   never claimed again (dead). Stored errors and log lines are scrubbed of addresses.
 * - `background` runs work off the request path (the sign-in link: a known address must not answer
 *   differently from an unknown one); `settle` waits for it, `drain` waits and then sends everything
 *   due — the deterministic step tests use instead of sleeping.
 */
import { describeError, JOB_QUEUES } from "@synan/db";
import type { Clock } from "../lib/clock.js";
import type { Jobs } from "../lib/jobs.js";
import type { MailMessage, Mailer } from "../lib/mailer.js";
import type { Repos, TxScope } from "../repo/types.js";

export const EMAIL_JOB = JOB_QUEUES.email;
export const EMAIL_MAX_ATTEMPTS = 5;

/** Provider errors can echo the recipient: keep the gist, never an address. */
export const scrubError = (e: unknown) =>
  describeError(e).replace(/[^\s<>"'@]+@[^\s<>"'@]+/g, "[address]").slice(0, 200) || "send failed";

export class MailService {
  private readonly inflight = new Set<Promise<unknown>>();
  private sweeping: Promise<number> | null = null;

  constructor(
    private readonly deps: { repos: Repos; jobs: Jobs; clock: Clock; mailer: Mailer; sendTimeoutMs: number },
  ) {}

  private now() {
    return new Date(this.deps.clock.now());
  }

  /** Queue a message in the caller's unit of work (or a new one). Returns the outbox id. */
  async send(msg: MailMessage, scope?: TxScope): Promise<string> {
    if (!scope) return this.deps.repos.transaction((s) => this.send(msg, s));
    const id = await scope.repos.emailOutbox.enqueue({ template: msg.tag, to: msg.to, content: { subject: msg.subject, text: msg.text }, now: this.now() });
    await this.deps.jobs.enqueue(EMAIL_JOB, { outbox_id: id }, scope);
    return id;
  }

  /** Run `task` off the request path. Failures are logged by name only. */
  background(name: string, task: () => Promise<unknown>): void {
    const p: Promise<unknown> = task()
      .catch((e: unknown) => console.error(`[mail] ${name} failed: ${scrubError(e)}`))
      .finally(() => this.inflight.delete(p));
    this.inflight.add(p);
  }

  /** Wait for background work started so far (it has written its outbox rows when this resolves). */
  async settle(): Promise<void> {
    while (this.inflight.size) await Promise.allSettled([...this.inflight]);
  }

  /** Send one outbox email. Throws when the transport fails, so a queue can retry it. */
  async deliver(id: string): Promise<"sent" | "skipped"> {
    const { repos, mailer, sendTimeoutMs } = this.deps;
    const e = await repos.emailOutbox.claim(id, { maxAttempts: EMAIL_MAX_ATTEMPTS, now: this.now() });
    if (!e) return "skipped"; // sent already, in flight elsewhere under a live lease, or dead
    let timer: NodeJS.Timeout | undefined;
    // The outcome is recorded only while the row is still on this attempt: if this worker was so slow
    // that its lease ran out and another worker reclaimed the email, that worker's outcome stands.
    const finish = (ok: boolean, error: string | null) => repos.emailOutbox.finish(id, { ok, error, now: this.now(), attempt: e.attempts });
    try {
      await Promise.race([
        // The outbox id is the provider idempotency key: a provider that honours it drops the second
        // copy if a reclaim ever sends what a stalled worker had already handed over.
        mailer.send({ to: e.to, tag: e.template, subject: e.content.subject, text: e.content.text, idempotencyKey: id }),
        new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error("mail transport timed out")), sendTimeoutMs))),
      ]);
    } catch (err) {
      const reason = scrubError(err);
      await finish(false, reason);
      const left = EMAIL_MAX_ATTEMPTS - e.attempts;
      console.error(`[mail] ${e.template} ${id} attempt ${e.attempts} failed (${left ? `${left} left` : "dead"}): ${reason}`);
      throw new Error(`email ${id} not sent`);
    } finally {
      clearTimeout(timer);
    }
    if ((await finish(true, null)) === null) console.error(`[mail] ${e.template} ${id} attempt ${e.attempts} finished after its claim was taken over`);
    return "sent";
  }

  /** The job handler: one email by id (queued job), or every due one (sweep, kick, tests). */
  async run(data?: Record<string, unknown>): Promise<unknown> {
    if (typeof data?.outbox_id === "string") return this.deliver(data.outbox_id);
    return this.drain();
  }

  /** Wait for background work, then send everything due once. Concurrent calls queue up behind each other. */
  async drain(): Promise<number> {
    await this.settle();
    while (this.sweeping) await this.sweeping.catch(() => 0);
    this.sweeping = this.sweep().finally(() => (this.sweeping = null));
    return this.sweeping;
  }

  private async sweep(): Promise<number> {
    let sent = 0;
    // Due includes emails left `sending` by a crashed worker once their claim lease has run out.
    for (const id of await this.deps.repos.emailOutbox.due({ maxAttempts: EMAIL_MAX_ATTEMPTS, limit: 500, now: this.now() })) {
      try {
        if ((await this.deliver(id)) === "sent") sent++;
      } catch {
        // recorded on the row; the next sweep retries it while attempts remain
      }
    }
    return sent;
  }
}
