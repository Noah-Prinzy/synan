import { pageTitle } from "@synan/ui/brand";
import { useEffect } from "react";
import { getNotifications, loadNotifications, markAllRead, type Notification } from "../data/notifications";
import { useDataVersion } from "../data/live";
import { useResource } from "../data/resource";
import { usePass } from "../data/pass";
import { PageHeader, PageShell } from "../components/page";
import { ErrorState, OfflineState, SkeletonCells, StateBlock } from "../components/states";

/** In the event's own time zone, like every time on the portal. */
function formatDate(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
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

function NotificationRow({ notification, index, timeZone }: { notification: Notification; index: number; timeZone: string }) {
  const unread = !notification.read;
  const kind = kindLabel[notification.kind];
  return (
    <li
      className={`enter relative grid gap-2 border-b border-border px-4 py-5 sm:px-6 md:grid-cols-[14rem_minmax(0,1fr)] md:gap-0 md:px-0 md:py-0 ${
        unread ? "before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-foreground" : ""
      }`}
      style={{ ["--i" as string]: index }}
    >
      <div className="md:border-r md:border-border md:px-10 md:py-6">
        <p className="text-13 font-medium text-muted-foreground">
          <span aria-hidden="true" className="mr-2 font-mono">
            {kind.glyph}
          </span>
          {kind.label}
        </p>
        <p className="mt-1 font-mono text-13 text-muted-foreground">
          <time dateTime={notification.at}>{formatDate(notification.at, timeZone)}</time>
        </p>
      </div>
      <div className="min-w-0 md:px-10 md:py-6">
        <p className="text-17 font-medium leading-snug">
          {unread ? <span className="sr-only">Unread: </span> : null}
          {notification.title}
        </p>
        <p className="mt-1 max-w-[62ch] text-15 text-muted-foreground">{notification.body}</p>
      </div>
    </li>
  );
}

export default function Notifications() {
  useEffect(() => {
    document.title = pageTitle("Updates");
  }, []);

  // Load once (the screen's loading/error/offline states); afterwards read live, so
  // "Mark all read" updates in place without a reload.
  useDataVersion();
  const notifications = useResource("notifications", loadNotifications);
  const list = notifications.status === "ready" ? getNotifications() : [];
  const unread = list.filter((item) => !item.read).length;
  // Times read in the event's zone; without a pass on this device, in the device's own zone.
  const pass = usePass();
  const timeZone = pass.status === "ready" ? pass.data.event.timezone : Intl.DateTimeFormat().resolvedOptions().timeZone;

  return (
    <PageShell bleed>
      <PageHeader
        label="From the organisers"
        title="Updates"
        aside={
          unread > 0 ? (
            <button
              type="button"
              onClick={() => void markAllRead()}
              className="inline-flex min-h-11 items-center text-15 text-muted-foreground underline-offset-4 transition-colors duration-120 ease-standard hover:text-foreground hover:underline motion-reduce:transition-none"
            >
              Mark all <span className="mx-1 font-mono">{unread}</span> read
            </button>
          ) : undefined
        }
      >
        Changes to your pass, your sessions and the venue. We only message you when it matters.
      </PageHeader>

      {notifications.status === "loading" ? (
        <SkeletonCells count={2} />
      ) : notifications.status === "offline" ? (
        <OfflineState what="Your updates" onRetry={notifications.retry} />
      ) : notifications.status === "error" ? (
        <ErrorState what="your updates" onRetry={notifications.retry} />
      ) : list.length === 0 ? (
        <StateBlock glyph="·" title="Nothing yet.">
          We'll only message you when it matters.
        </StateBlock>
      ) : (
        <ul>
          {list.map((notification, index) => (
            <NotificationRow key={notification.id} notification={notification} index={index} timeZone={timeZone} />
          ))}
        </ul>
      )}
    </PageShell>
  );
}
