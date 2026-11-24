/** A7: GET /me/notifications and POST /me/notifications/read. */
import type { Notification } from "@synan/contracts/rest";
import { backend } from "./backend";

export type { Notification };

/** For the screen's loading state. */
export function loadNotifications(): Notification[] | Promise<Notification[]> {
  return backend.loadNotifications();
}

/** The list as it is now (after a load), so "Mark all read" updates in place. */
export function getNotifications(): Notification[] {
  return backend.notifications();
}

export function markAllRead(): void | Promise<void> {
  return backend.markAllRead();
}

export function hasUnread(): boolean {
  return backend.notifications().some((item) => !item.read);
}
