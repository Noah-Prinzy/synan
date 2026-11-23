/** Attendee notifications over @synan/db (migration 0020). */
import { broadcastNotification, listNotifications, markNotificationsRead, notifyAttendee, type AnyDb } from "@synan/db";
import type { NotificationsRepo } from "./types.js";

export function drizzleNotifications(db: AnyDb): NotificationsRepo {
  return {
    async notify(i) {
      return notifyAttendee(db, { attendeeId: i.attendeeId, kind: i.kind, title: i.title, body: i.body, eventId: i.eventId, now: i.now });
    },
    async broadcast(i) {
      return broadcastNotification(db, { eventId: i.eventId, tier: i.tier, kind: i.kind, title: i.title, body: i.body, now: i.now });
    },
    async list(attendeeId, { now, limit }) {
      return listNotifications(db, attendeeId, { now, limit });
    },
    async markRead(attendeeId, ids, now) {
      return markNotificationsRead(db, attendeeId, ids, now);
    },
  };
}
