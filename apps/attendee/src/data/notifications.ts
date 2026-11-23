/** A7: GET /me/notifications, served by @synan/mock. */
import type { Notification } from "@synan/mock";
import { portal } from "./mock";

export type { Notification };

export function getNotifications(): Notification[] {
  return portal.notifications();
}

export function markAllRead(): void {
  portal.markAllRead();
}

export function hasUnread(): boolean {
  return portal.notifications().some((item) => !item.read);
}
