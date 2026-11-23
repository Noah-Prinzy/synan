/** In-memory attendee notifications, mirroring @synan/db 0020 (notifications_for_attendee and read receipts). */
import { randomUUID } from "node:crypto";
import type { MemoryTables } from "./memory.js";
import type { NotificationKindT, NotificationRow, NotificationsRepo } from "./types.js";

export interface MemNotification {
  id: string;
  attendee_id: string | null;
  event_id: string | null;
  audience_tier: string | null;
  kind: NotificationKindT;
  title: string;
  body: string;
  created_at: Date;
  expires_at: Date;
  seq: number;
}

let seq = 0;
const DAY = 86_400_000;

export function memoryNotifications(t: MemoryTables): NotificationsRepo {
  const visible = (attendeeId: string, now: Date) =>
    [...t.notifications.values()].filter(
      (n) =>
        n.expires_at > now &&
        (n.attendee_id === attendeeId ||
          (n.attendee_id === null &&
            [...t.registrations.values()].some(
              (g) => g.event_id === n.event_id && g.attendee_id === attendeeId && g.state === "confirmed" && (n.audience_tier === null || g.tier === n.audience_tier),
            ))),
    );
  return {
    async notify(i) {
      if (i.title.length > 200 || i.body.length > 2000) throw new Error("notifications_length");
      const id = randomUUID();
      t.notifications.set(id, {
        id, attendee_id: i.attendeeId, event_id: i.eventId, audience_tier: null, kind: i.kind, title: i.title, body: i.body,
        created_at: i.now, expires_at: new Date(i.now.getTime() + 30 * DAY), seq: seq++,
      });
      return id;
    },
    async broadcast(i) {
      const e = t.events.get(i.eventId);
      if (!e) throw new Error(`event ${i.eventId} does not exist`);
      if (i.title.length > 200 || i.body.length > 2000) throw new Error("notifications_length");
      const id = randomUUID();
      t.notifications.set(id, {
        id, attendee_id: null, event_id: i.eventId, audience_tier: i.tier, kind: i.kind, title: i.title, body: i.body,
        created_at: i.now, expires_at: new Date(e.ends_at.getTime() + 7 * DAY), seq: seq++,
      });
      return id;
    },
    async list(attendeeId, { now, limit }) {
      return visible(attendeeId, now)
        .sort((a, b) => b.created_at.getTime() - a.created_at.getTime() || b.seq - a.seq)
        .slice(0, limit)
        .map((n): NotificationRow => ({ id: n.id, kind: n.kind, at: n.created_at, title: n.title, body: n.body, read: t.notificationReads.has(`${n.id}|${attendeeId}`) }));
    },
    async markRead(attendeeId, ids, now) {
      const mine = new Set(visible(attendeeId, now).map((n) => n.id));
      let n = 0;
      for (const id of ids) {
        const k = `${id}|${attendeeId}`;
        if (mine.has(id) && !t.notificationReads.has(k)) {
          t.notificationReads.set(k, now);
          n++;
        }
      }
      return n;
    },
  };
}

/** Erasure removes the attendee's personal notifications and read receipts (as @synan/db data_request_finish does). */
export function eraseMemoryNotifications(t: MemoryTables, attendeeId: string) {
  for (const [id, n] of t.notifications) if (n.attendee_id === attendeeId) t.notifications.delete(id);
  for (const k of [...t.notificationReads.keys()]) if (k.endsWith(`|${attendeeId}`)) t.notificationReads.delete(k);
}
