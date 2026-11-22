export interface Notification {
  id: string;
  kind: "message" | "admission" | "session" | "system";
  title: string;
  body: string;
  at: string; // ISO timestamp
  read: boolean;
}

// Mock notifications data
const notificationsStore: Notification[] = [
  {
    id: "n-001",
    kind: "admission",
    title: "You're in!",
    body: "Your registration for Nexus Summit 2026 is confirmed. Collect your wristband at the North entrance desk.",
    at: "2026-11-20T10:30:00+03:00",
    read: false,
  },
  {
    id: "n-002",
    kind: "session",
    title: "Fireside chat added",
    body: "A new fireside chat on 'The Future of Infrastructure in Africa' has been added to Day 2, 3:00 PM in Nexus Hall.",
    at: "2026-11-20T14:00:00+03:00",
    read: false,
  },
  {
    id: "n-003",
    kind: "system",
    title: "Desk locations updated",
    body: "Registration desk 2 has moved to the North entrance. South entrance desk is closed today.",
    at: "2026-11-21T08:00:00+03:00",
    read: true,
  },
  {
    id: "n-004",
    kind: "message",
    title: "Venue access",
    body: "Main venue opens at 8:00 AM. Please arrive 15 minutes early for security screening.",
    at: "2026-11-21T09:00:00+03:00",
    read: true,
  },
  {
    id: "n-005",
    kind: "session",
    title: "Workshop capacity",
    body: "Workshop A has reached capacity. If you registered for this workshop, please arrive 10 minutes early to secure your spot.",
    at: "2026-11-21T12:00:00+03:00",
    read: false,
  },
  {
    id: "n-006",
    kind: "system",
    title: "WiFi network",
    body: "Connect to 'Nexus-Event' network for complimentary WiFi. Password: check your registration email.",
    at: "2026-11-22T08:30:00+03:00",
    read: false,
  },
];

export function getNotifications(): Notification[] {
  return [...notificationsStore].sort(
    (a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()
  );
}

export function markAllRead(): void {
  for (const n of notificationsStore) {
    n.read = true;
  }
  // Persist
  try {
    localStorage.setItem("cnx.notifications.read", "true");
  } catch {
    // Storage not available
  }
}

export function markAsRead(id: string): void {
  const notification = notificationsStore.find((n) => n.id === id);
  if (notification) {
    notification.read = true;
  }
}

export function hasUnread(): boolean {
  return notificationsStore.some((n) => !n.read);
}

export function getUnreadCount(): number {
  return notificationsStore.filter((n) => !n.read).length;
}
