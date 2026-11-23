/**
 * The danger zone of D6.8 (docs/01 §9): close a published or live event, archive a closed one.
 * Closing stops every gate admitting for the event and starts the retention clock, so it asks
 * for the event's name to be typed. Archiving only files the event away. Drafts have neither:
 * they are finished in the wizard.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { Button, Dialog, Field, TextInput, buttonClass } from "@synan/ui/components";
import type { EventRecord } from "@synan/mock/command";
import { Notice, errorCopy, formatDate, formatStamp, linkClass } from "../../kit";
import { configure } from "../../live/backend";
import { useCommand } from "../../live/context";

export function DangerZone({ event, onChanged }: { event: EventRecord; onChanged: (record: EventRecord) => void }) {
  const { refreshEvents } = useCommand();
  const [dialog, setDialog] = useState<"close" | "archive" | null>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [justClosed, setJustClosed] = useState(false);

  if (event.state === "draft") {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 border border-border px-4 py-3">
        <p className="text-13 text-muted-foreground">
          <span className="text-foreground">Finish setup first.</span> A draft is not open to anyone yet; closing and archiving
          apply once it is published.
        </p>
        <Link to={`/events/new/${event.wizard_step}?draft=${event.id}`} className={buttonClass("secondary", "compact")}>
          Continue setup
        </Link>
      </div>
    );
  }

  const open = (which: "close" | "archive") => {
    setTyped("");
    setProblem(null);
    setDialog(which);
  };

  const run = async (state: "closed" | "archived") => {
    setBusy(true);
    setProblem(null);
    try {
      const record = await configure.transitionEvent(event.id, state);
      await refreshEvents().catch(() => undefined);
      onChanged(record);
      setDialog(null);
      if (state === "closed") setJustClosed(true);
    } catch (error) {
      const copy = errorCopy(error);
      setProblem(copy.code === "CONFLICT" ? "The event's state changed meanwhile. Close this dialog; the page shows the current state." : `${copy.title}. ${copy.message}`);
    } finally {
      setBusy(false);
    }
  };

  const nameMatches = typed.trim() === event.title.trim();
  const purgeAt = (from: string) => new Date(Date.parse(from) + event.grace_buffer_hours * 3_600_000).toISOString();

  return (
    <div className="border border-destructive/40">
      {justClosed || event.state === "closed" ? (
        <div className="border-b border-destructive/40 px-4 py-3">
          {justClosed ? (
            <Notice className="mb-3">
              The event is closed. Gates no longer admit for it.{" "}
              <Link to={`/events/${event.id}/summary`} className={linkClass}>
                See the event summary
              </Link>
            </Notice>
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-13 font-medium">Archive event</h3>
              <p className="text-12 text-muted-foreground">
                Files the event away from the active lists. Its summary and reports stay available; nothing else is deleted.
              </p>
            </div>
            <Button variant="danger" size="compact" onClick={() => open("archive")}>
              Archive event
            </Button>
          </div>
        </div>
      ) : null}

      {event.state === "published" || event.state === "live" ? (
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <h3 className="text-13 font-medium">Close event</h3>
            <p className="max-w-120 text-12 text-muted-foreground">
              Every gate stops admitting for it, registration ends, and the retention clock starts: individual scan records are
              deleted {event.grace_buffer_hours === 0 ? "straight away" : `${event.grace_buffer_hours} hours later`}. This cannot be undone.
            </p>
          </div>
          <Button variant="danger" size="compact" onClick={() => open("close")}>
            Close event
          </Button>
        </div>
      ) : null}

      {event.state === "closed" ? (
        <p className="px-4 py-3 text-12 text-muted-foreground">
          Closed {event.closed_at ? <span className="font-mono tabular-nums">{formatStamp(event.closed_at, event.timezone)}</span> : null}
          {event.closed_at ? (
            <>
              {" "}
              · scan records deleted on <span className="font-mono tabular-nums">{formatDate(purgeAt(event.closed_at), event.timezone)}</span>
            </>
          ) : null}
        </p>
      ) : null}

      {event.state === "archived" ? (
        <p className="px-4 py-3 text-13 text-muted-foreground">
          This event is archived. Nothing more can be done to it; its summary and reports stay available.
        </p>
      ) : null}

      <Dialog
        open={dialog === "close"}
        onClose={() => setDialog(null)}
        tone="danger"
        title={`Close ${event.title}?`}
        description="Gates stop admitting within a minute. Attendees on site are not removed, but no one else gets in."
        footer={
          <>
            <Button variant="secondary" size="compact" onClick={() => setDialog(null)}>
              Keep it open
            </Button>
            <Button variant="danger" size="compact" disabled={!nameMatches || busy} onClick={() => void run("closed")}>
              {busy ? "Closing…" : "Close event"}
            </Button>
          </>
        }
      >
        <form
          noValidate
          className="flex flex-col gap-3 px-5 py-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (nameMatches && !busy) void run("closed");
          }}
        >
          <p className="text-13 text-muted-foreground">
            Closing starts the retention clock. Individual scan records are deleted{" "}
            {event.grace_buffer_hours === 0 ? "at once" : `after ${event.grace_buffer_hours} hours`}; totals, peaks and flows are kept
            for the summary and reports.
          </p>
          <Field label={<>Type the event name, <span className="text-foreground">{event.title}</span>, to confirm</>}>
            <TextInput value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" autoFocus spellCheck={false} />
          </Field>
          {problem ? <Notice tone="danger">{problem}</Notice> : null}
        </form>
      </Dialog>

      <Dialog
        open={dialog === "archive"}
        onClose={() => setDialog(null)}
        tone="danger"
        width="sm"
        title={`Archive ${event.title}?`}
        description="It moves out of the active event lists and nothing in it can change again. Its summary and reports stay available."
        footer={
          <>
            <Button variant="secondary" size="compact" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button variant="danger" size="compact" disabled={busy} onClick={() => void run("archived")}>
              {busy ? "Archiving…" : "Archive event"}
            </Button>
          </>
        }
      >
        {problem ? <Notice tone="danger" className="mx-5 my-4">{problem}</Notice> : null}
      </Dialog>
    </div>
  );
}
