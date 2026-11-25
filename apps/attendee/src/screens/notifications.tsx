import { pageTitle } from "@synan/ui/brand";
import { useEffect } from "react";
import { getNotifications, loadNotifications, markAllRead, type Notification } from "../data/notifications";
import { useDataVersion } from "../data/live";
import { useResource } from "../data/resource";
import { usePass } from "../data/pass";
import { PANEL, PageHeader, PageShell } from "../components/page";
import { buttonClass } from "@synan/ui/components";
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
      className={`enter grid gap-2 px-5 py-5 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-6 ${unread ? PANEL : ""}`}
      style={{ ["--i" as string]: index }}
    >
      <div>
        <p className="flex items-center text-13 font-medium text-muted-foreground">
          {unread ? <span aria-hidden="true" className="mr-2 size-2 rounded-full bg-foreground" /> : null}
          <span aria-hidden="true" className="mr-2 font-mono">
            {kind.glyph}
          </span>
          {kind.label}
        </p>
        <p className="mt-1 font-mono text-13 text-muted-foreground">
          <time dateTime={notification.at}>{formatDate(notification.at, timeZone)}</time>
        </p>
      </div>
      <div className="min-w-0">
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
    <PageShell>
      <PageHeader
        label="From the organisers"
        title="Updates."
        more="We only message you when it matters."
        aside={
          unread > 0 ? (
            <button
              type="button"
              onClick={() => void markAllRead()}
              className={buttonClass("secondary", "md")}
            >
              Mark all <span className="mx-1 font-mono">{unread}</span> read
            </button>
          ) : undefined
        }
      >
        Changes to your pass, your sessions and the venue.
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
        <ul className="mx-auto mt-14 flex max-w-3xl flex-col gap-1">
          {list.map((notification, index) => (
            <NotificationRow key={notification.id} notification={notification} index={index} timeZone={timeZone} />
          ))}
        </ul>
      )}
    </PageShell>
  );
}
