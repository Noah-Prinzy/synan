/**
 * Fan-out with replay for the event channels (`/stream/scans`, `/stream/alerts`, `/stream/me`).
 * Every event gets a cursor `<bootId>.<seq>` and is kept in a ring buffer; a reconnecting client
 * that sends `last_event_id` gets exactly the events after it that its own view admits. A cursor
 * from another boot, or older than the buffer, gets `resumed: false` and nothing replayed.
 *
 * Each subscriber has a `view`: it decides whether an event is visible to that subscriber and may
 * reshape it (for example, staff never see an alert's credential link). Single-process, like the
 * telemetry hub; behind PostgreSQL LISTEN/NOTIFY when there is more than one instance (D-17).
 */
import { randomBytes } from "node:crypto";
import type { Clock } from "../lib/clock.js";

export interface HubEvent<M> {
  id: string;
  type: string;
  at: string;
  data: unknown;
  /** Routing facts (event, checkpoint, attendee) used by views; never sent. */
  meta: M;
}
export type Envelope = { id: string; type: string; at: string; data: unknown };
export type View<M> = (e: HubEvent<M>) => Envelope | null;

export class ChannelHub<M> {
  readonly bootId = randomBytes(4).toString("hex");
  private seq = 0;
  private ring: HubEvent<M>[] = [];
  private subs = new Set<{ view: View<M>; send: (m: Envelope) => void }>();

  constructor(
    private readonly clock: Clock,
    private readonly ringSize = 1000,
  ) {}

  /** Connected subscribers (a producer may skip work nobody would receive). */
  get subscribers(): number {
    return this.subs.size;
  }

  publish(type: string, data: unknown, meta: M) {
    const e: HubEvent<M> = { id: `${this.bootId}.${++this.seq}`, type, at: new Date(this.clock.now()).toISOString(), data, meta };
    this.ring.push(e);
    if (this.ring.length > this.ringSize) this.ring.shift();
    for (const s of this.subs) {
      const out = s.view(e);
      if (out) s.send(out);
    }
  }

  subscribe(view: View<M>, send: (m: Envelope) => void, lastEventId?: string) {
    const sub = { view, send };
    this.subs.add(sub);
    let resumed = false;
    const catchUp: Envelope[] = [];
    if (lastEventId) {
      const [boot, n] = lastEventId.split(".");
      const seq = Number(n);
      const oldest = this.ring[0] ? Number(this.ring[0].id.split(".")[1]) : this.seq + 1;
      if (boot === this.bootId && Number.isInteger(seq) && seq >= oldest - 1 && seq <= this.seq) {
        resumed = true;
        for (const e of this.ring) {
          if (Number(e.id.split(".")[1]) <= seq) continue;
          const out = view(e);
          if (out) catchUp.push(out);
        }
      }
    }
    return { resumed, catchUp, unsubscribe: () => void this.subs.delete(sub) };
  }
}
