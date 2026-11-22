import { useEffect } from "react";
import { Link } from "react-router-dom";
import { getNotifications, markAllRead, hasUnread } from "../data/notifications";
import { useSession } from "../data/auth";
import { PageShell, Eyebrow } from "../components/page";

function SkipLink() {
  return (
    <a
      href="#content"
      className="absolute left-0 top-0 -translate-y-full bg-background px-4 py-3 text-sm text-foreground focus:translate-y-0 focus:outline-none"
    >
      Skip to content
    </a>
  );
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function NotificationRow({ notification, hasUnreadFlag }: { notification: any; hasUnreadFlag: boolean }) {
  return (
    <li className={`border-border border-b py-4 first:border-t-0 ${hasUnreadFlag ? "border-l-2 border-foreground" : ""}`}>
      <div className="flex gap-4">
        <div className="shrink-0">
          <p className="font-mono text-[0.6875rem] uppercase tracking-wider text-muted-foreground">
            {formatDate(notification.at)}
          </p>
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-serif text-[1rem] leading-tight">{notification.title}</p>
          <p className="mt-1 text-sm text-muted-foreground">{notification.body}</p>
          {hasUnreadFlag && (
            <p className="font-mono text-[0.6875rem] mt-1 uppercase tracking-wider text-muted-foreground">
              Unread
            </p>
          )}
        </div>
      </div>
    </li>
  );
}

export default function Notifications() {
  useEffect(() => {
    document.title = "Updates · Connexia";
  }, []);

  const session = useSession();
  const notifications = getNotifications();
  const unreadExists = hasUnread();

  // Check if there are any notifications
  const hasNotifications = notifications.length > 0;

  const handleMarkAllRead = () => {
    markAllRead();
    // Force re-render by updating state
    window.location.reload();
  };

  return (
    <PageShell>
      <SkipLink />
      <div className="pt-10 md:pt-14 xl:pt-16">
        <Eyebrow>Updates</Eyebrow>
        <h1 className="mt-2 font-serif text-2xl leading-tight">Updates</h1>

        {!hasNotifications && (
          <div className="mt-12 text-center">
            <p className="font-serif text-[1.125rem] leading-tight">
              Nothing yet — we&apos;ll only message you when it matters.
            </p>
          </div>
        )}

        {hasNotifications && (
          <>
            {unreadExists && (
              <button
                onClick={handleMarkAllRead}
                className="mt-6 font-mono text-[0.6875rem] uppercase tracking-wider text-muted-foreground hover:text-foreground"
              >
                Mark all read
              </button>
            )}
            <ul className="mt-8">
              {notifications.map((notification) => (
                <NotificationRow
                  key={notification.id}
                  notification={notification}
                  hasUnreadFlag={!notification.read}
                />
              ))}
            </ul>
          </>
        )}
      </div>
    </PageShell>
  );
}
