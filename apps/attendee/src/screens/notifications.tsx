import { useEffect } from "react";
import { Link } from "react-router-dom";
import { getNotifications, markAllRead, hasUnread } from "../data/notifications";
import { useSession } from "../data/auth";
import { PageShell, Eyebrow } from "../components/page";

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
    <li className={`border-border border-b py-5 first:border-t-0 ${hasUnreadFlag ? "border-l-2 border-l-foreground" : ""}`}>
      <div className="flex gap-4 pl-4">
        <div className="shrink-0">
          <p className="font-mono text-[0.625rem] uppercase tracking-[0.12em] text-muted-foreground">
            {formatDate(notification.at)}
          </p>
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-serif text-[1.125rem] leading-tight">{notification.title}</p>
          <p className="mt-1 text-sm text-muted-foreground">{notification.body}</p>
          {hasUnreadFlag && (
            <p className="font-mono text-[0.625rem] mt-1 uppercase tracking-[0.12em] text-muted-foreground">
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
      <div className="max-w-[48rem]">
        <Eyebrow>Updates</Eyebrow>
        <h1 className="mt-2 font-serif text-[1.75rem] leading-tight">Updates</h1>

        {!hasNotifications && (
          <div className="mt-12 text-center">
            <p className="font-serif text-[1.125rem] leading-tight text-muted-foreground">
              Nothing yet — we&apos;ll only message you when it matters.
            </p>
          </div>
        )}

        {hasNotifications && (
          <>
            {unreadExists && (
              <button
                onClick={handleMarkAllRead}
                className="mt-6 font-mono text-[0.6875rem] uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground motion-reduce:transition-none"
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
