import { pageTitle } from "@synan/ui/brand";
import { useEffect } from "react";
import { getNotifications, markAllRead, type Notification } from "../data/notifications";
import { usePortalVersion } from "../data/mock";
import { PageShell } from "../components/page";

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Kampala",
  }).format(new Date(iso));
}

/** Every kind gets a glyph and a word, so the kind never relies on colour (docs/05 §1.9). */
const kindLabel: Record<Notification["kind"], { glyph: string; label: string }> = {
  pass: { glyph: "▤", label: "Your pass" },
  session: { glyph: "◷", label: "Schedule" },
  capacity: { glyph: "▲", label: "Room capacity" },
  event: { glyph: "◇", label: "Event news" },
  security: { glyph: "!", label: "Safety" },
};

function NotificationRow({ notification }: { notification: Notification }) {
  const unread = !notification.read;
  const kind = kindLabel[notification.kind];
  return (
    <li className={`border-b border-border py-5 ${unread ? "border-l-2 border-l-foreground" : ""}`}>
      <div className="flex flex-col gap-2 pl-4 sm:flex-row sm:gap-6">
        <div className="shrink-0 sm:w-36">
          <p className="text-13 font-medium text-muted-foreground">
            <span aria-hidden="true" className="mr-2 font-mono">{kind.glyph}</span>
            {kind.label}
          </p>
          <p className="mt-1 font-mono text-13 text-muted-foreground">
            <time dateTime={notification.at}>{formatDate(notification.at)}</time>
          </p>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-17 font-medium leading-snug">
            {unread ? <span className="sr-only">Unread: </span> : null}
            {notification.title}
          </p>
          <p className="mt-1 text-15 text-muted-foreground">{notification.body}</p>
        </div>
      </div>
    </li>
  );
}

export default function Notifications() {
  useEffect(() => {
    document.title = pageTitle("Updates");
  }, []);

  usePortalVersion();
  const notifications = getNotifications();
  const unreadExists = notifications.some((item) => !item.read);

  return (
    <PageShell>
      <div className="max-w-[48rem]">
        <h1 className="font-display text-40">Updates</h1>

        {notifications.length === 0 ? (
          <p className="mt-12 text-17 text-muted-foreground">
            Nothing yet — we&apos;ll only message you when it matters.
          </p>
        ) : (
          <>
            {unreadExists ? (
              <button
                type="button"
                onClick={markAllRead}
                className="mt-6 inline-flex min-h-11 items-center text-15 text-muted-foreground underline-offset-4 hover:underline transition-colors duration-[120ms] ease-[cubic-bezier(.2,0,0,1)] hover:text-foreground motion-reduce:transition-none"
              >
                Mark all read
              </button>
            ) : null}
            <ul className="mt-8 border-t border-border">
              {notifications.map((notification) => (
                <NotificationRow key={notification.id} notification={notification} />
              ))}
            </ul>
          </>
        )}
      </div>
    </PageShell>
  );
}
