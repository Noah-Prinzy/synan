/**
 * D10's detail sheet (docs/06 §2.3): one alert — severity, kind, what happened, where and
 * when, who acknowledged it, the scans that triggered it, the credential involved, the rule
 * that fired — and the two things an operator does here: acknowledge (one click) and resolve
 * (a note is required; resolution is what takes an alert off the list).
 *
 * Impossible travel shows the last two checkpoints and lets a supervisor clear or revoke the
 * suspended pass (D-06). An offline conflict lists every scan involved side by side, with each
 * gate and its corrected time (D-13).
 */
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { BreachAlert } from "@synan/contracts/rest";
import { ActionButton, Button, Field, RewardMoment, TextArea, cn } from "@synan/ui/components";
import { ResultChip, SignalShape, StatusDot, formatAge } from "@synan/ui/data";
import type { AlertContext, AlertCredential, OpsScan } from "@synan/mock/command";
import { Can, useSession } from "../access/session";
import { KeyValues, Notice, TIER_LABEL, TYPE, errorCopy, fieldErrors, formatStamp, linkClass, useResource } from "../kit";
import { ALERT_KIND_LABEL, SEVERITY_VIEW } from "../live/alert-copy";
import { api, configure } from "../live/backend";
import { useCommand } from "../live/context";
import { useNow } from "../live/hooks";
import type { VenueLayout } from "../live/transport";
import { CREDENTIAL_VIEW } from "../workspace/parts/copy";
import { CARRIER_LABEL, formatScanTime } from "./shared";

export const ALERT_STATE_VIEW = {
  open: { state: "warn", label: "Open" },
  acked: { state: "idle", label: "Acknowledged" },
  resolved: { state: "ok", label: "Resolved" },
} as const;

const NOTE_MIN = 3;
const NOTE_MAX = 1000;

/** Contracts `ResolveAlert` (and ClearReview): 3–1000 characters, said in plain words. */
export function noteProblem(note: string, what = "note"): string | null {
  const length = note.trim().length;
  if (length < NOTE_MIN) return length === 0 ? `Write a short ${what}: it goes in the audit log.` : `Write at least ${NOTE_MIN} characters.`;
  if (length > NOTE_MAX) return `Keep it under 1,000 characters (now ${length.toLocaleString("en-GB")}).`;
  return null;
}

/** "Gate 3 · West" or "Door 4 · Workshop A · Workshop A" → the checkpoint, and its room when it is a door. */
export function whereOf(layout: VenueLayout | null, checkpointId: string | null): { label: string; room: string | null } | null {
  if (!layout || !checkpointId) return null;
  const checkpoint = layout.checkpoints.find((c) => c.id === checkpointId);
  if (!checkpoint) return null;
  const room = checkpoint.room_id ? (layout.rooms.find((r) => r.id === checkpoint.room_id)?.name ?? null) : null;
  return { label: checkpoint.label, room: room && !checkpoint.label.includes(room) ? room : null };
}

export function AlertDetail({
  alert,
  layout,
  timeZone,
  headingId,
  titled = false,
}: {
  alert: BreachAlert;
  layout: VenueLayout | null;
  timeZone: string;
  headingId?: string;
  /** The surrounding dialog already shows the kind, severity and state: do not repeat them. */
  titled?: boolean;
}) {
  const { store, event } = useCommand();
  const { can } = useSession();
  const now = useNow(1000);
  // Re-read the context when the alert changes state (acknowledged by, resolved).
  const context = useResource(() => api.alertContext(alert.id), [alert.id, alert.state]);
  const [resolvedHere, setResolvedHere] = useState(false);
  const view = SEVERITY_VIEW[alert.severity];
  const where = whereOf(layout, alert.checkpoint_id);
  const ctx = context.status === "ready" ? context.data : null;

  const facts: [ReactNode, ReactNode][] = [
    [
      "Severity",
      <span className={cn("inline-flex items-center gap-1.5", view.text)}>
        <SignalShape state={view.state} /> {view.label}
      </span>,
    ],
    [
      "Where",
      where ? (
        <span>
          {can("gates.view") && alert.checkpoint_id ? (
            <Link to={`/gates/${alert.checkpoint_id}`} className={linkClass}>
              {where.label}
            </Link>
          ) : (
            where.label
          )}
          {where.room ? <span className="text-muted-foreground"> · {where.room}</span> : null}
        </span>
      ) : (
        <span className="text-muted-foreground">Not tied to one gate</span>
      ),
    ],
    [
      "Occurred",
      <span>
        <span className={TYPE.value}>{formatStamp(alert.occurred_at, timeZone)}</span>
        <span className="text-muted-foreground"> · {formatAge(now - Date.parse(alert.occurred_at))} ago</span>
      </span>,
    ],
    [
      "Acknowledged",
      alert.acked_at ? (
        <span>
          {ctx?.acked_by_name ?? "…"}
          <span className="text-muted-foreground"> · </span>
          <span className={TYPE.value}>{formatStamp(alert.acked_at, timeZone)}</span>
        </span>
      ) : (
        <span className="text-muted-foreground">Not yet</span>
      ),
    ],
  ];

  return (
    <div className="pb-6">
      <div className="px-4 pt-4 pb-5 sm:px-5">
        {titled ? null : (
          <>
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-12">
              <StatusDot state={ALERT_STATE_VIEW[alert.state].state} label={ALERT_STATE_VIEW[alert.state].label} showLabel />
              <span className="text-muted-foreground">{view.label} severity</span>
            </p>
            <h3 id={headingId} tabIndex={-1} className="mt-2 font-display text-21 leading-tight text-balance outline-none">
              {ALERT_KIND_LABEL[alert.kind]}
            </h3>
          </>
        )}
        <p className={cn("text-13 leading-relaxed text-pretty text-muted-foreground", !titled && "mt-1.5")}>{alert.detail}</p>
        {alert.state === "open" && can("alerts.acknowledge") ? (
          <div className="mt-4">
            <ActionButton variant="quiet" size="compact" reward keepDone doneLabel="Acknowledged" action={() => store.ack(alert.id)}>
              Acknowledge
            </ActionButton>
          </div>
        ) : null}
      </div>

      <KeyValues rows={facts} className="border-t border-border" />

      <Block title="Rule that fired">
        {ctx ? <p className="text-13 leading-relaxed">{ctx.rule}</p> : <Pending status={context.status} onRetry={() => context.reload()} />}
      </Block>

      {ctx ? <Evidence alert={alert} ctx={ctx} timeZone={timeZone} /> : null}

      {ctx?.credential ? (
        <CredentialBlock alert={alert} credential={ctx.credential} eventId={event?.id ?? alert.event_id} onChanged={() => context.reload(true)} />
      ) : null}

      <Block title="Resolution">
        {alert.state === "resolved" ? (
          <div>
            {resolvedHere ? <RewardMoment className="text-13 text-success">Resolved</RewardMoment> : <StatusDot state="ok" label="Resolved" showLabel className="text-13" />}
            <p className="mt-2 text-13 leading-relaxed whitespace-pre-wrap">{alert.resolution_note ?? "—"}</p>
          </div>
        ) : can("alerts.resolve") ? (
          <ResolveForm alert={alert} onResolved={() => setResolvedHere(true)} />
        ) : (
          <p className="text-13 text-muted-foreground">A supervisor resolves this alert with a note. It stays on the list until then.</p>
        )}
      </Block>
    </div>
  );
}

/* --------------------------------------------------------------- sections */

/** A part of the detail: a hairline above, a 13px heading, the body on the panel's 16/20px edge. */
function Block({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="border-t border-border px-4 pt-3.5 pb-4 sm:px-5">
      <h4 className="mb-2.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <span className={TYPE.heading}>{title}</span>
        {aside ? <span className="text-12 text-muted-foreground">{aside}</span> : null}
      </h4>
      {children}
    </section>
  );
}

function Pending({ status, onRetry }: { status: "loading" | "error" | "ready"; onRetry: () => void }) {
  if (status === "error") {
    return (
      <p className="text-13 text-destructive">
        Could not load the alert's scans and rule.{" "}
        <button type="button" onClick={onRetry} className={cn(linkClass, "text-foreground")}>
          Try again
        </button>
      </p>
    );
  }
  return <p className="text-13 text-muted-foreground">Loading…</p>;
}

function Evidence({ alert, ctx, timeZone }: { alert: BreachAlert; ctx: AlertContext; timeZone: string }) {
  if (alert.kind === "impossible_travel" && ctx.scans.length >= 2) {
    const [a, b] = ctx.scans.slice(-2) as [AlertContext["scans"][number], AlertContext["scans"][number]];
    const gap = Date.parse(b.corrected_at) - Date.parse(a.corrected_at);
    return (
      <Block title="Last two checkpoints" aside={<span className="font-mono tabular-nums">{formatAge(gap, { fine: true })} apart</span>}>
        <ol className="border-t border-border">
          {[a, b].map((scan, i) => (
            <li key={scan.id} className="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-x-3 border-b border-border py-2.5">
              <span className="text-12 text-muted-foreground">{i === 0 ? "First" : "Then"}</span>
              <span className="min-w-0">
                <span className="flex items-baseline justify-between gap-3">
                  <span className="truncate text-13">{scan.checkpoint_label}</span>
                  <span className="shrink-0 font-mono text-12 text-muted-foreground tabular-nums">{formatScanTime(scan.corrected_at, timeZone)}</span>
                </span>
                <ResultChip result={scan.result} className="mt-1" />
              </span>
            </li>
          ))}
        </ol>
      </Block>
    );
  }

  if (alert.kind.startsWith("offline_conflict") && ctx.scans.length > 0) {
    return (
      <Block title="Scans involved" aside="Corrected times, oldest first">
        <ol className="border-t border-border">
          {ctx.scans.map((scan) => (
            <li key={scan.id} className="border-b border-border py-2.5 text-12">
              <p className="flex items-baseline justify-between gap-3">
                <span className="truncate text-13">{scan.checkpoint_label}</span>
                <span className={cn("shrink-0", TYPE.value)}>{formatScanTime(scan.corrected_at, timeZone)}</span>
              </p>
              <dl className="mt-1.5 grid grid-cols-[6rem_minmax(0,1fr)] gap-x-3 gap-y-1 text-muted-foreground">
                <dt>Device time</dt>
                <dd className="font-mono tabular-nums">{formatScanTime(scan.occurred_at, timeZone)}</dd>
                <dt>Synced</dt>
                <dd className="font-mono tabular-nums">{formatScanTime(scan.received_at, timeZone)}</dd>
                <dt>Carrier</dt>
                <dd>{scan.carrier_kind ? CARRIER_LABEL[scan.carrier_kind] : "Unknown"}</dd>
              </dl>
              <ResultChip result={scan.result} className="mt-1.5" />
            </li>
          ))}
        </ol>
      </Block>
    );
  }

  if (ctx.scans.length > 0) {
    return (
      <Block title={ctx.scans.length === 1 ? "Triggering scan" : "Triggering scans"}>
        <ScanLines scans={ctx.scans} timeZone={timeZone} />
      </Block>
    );
  }

  if (ctx.nearby.length > 0) {
    return (
      <Block title="Scans at this gate just before">
        <p className="mb-2 text-12 text-muted-foreground">No scan is attached to this alert. These were read at its gate in the minute before it fired.</p>
        <ScanLines scans={ctx.nearby} timeZone={timeZone} />
      </Block>
    );
  }

  return (
    <Block title="Triggering scans">
      <p className="text-13 text-muted-foreground">
        {alert.checkpoint_id ? "No scan is attached to this alert; it was raised from the gate's own state." : "No scan is attached to this alert."}
      </p>
    </Block>
  );
}

function ScanLines({ scans, timeZone }: { scans: (OpsScan & { checkpoint_label: string })[]; timeZone: string }) {
  return (
    <ul className="border-t border-border">
      {scans.map((scan) => (
        <li key={scan.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-1 border-b border-border py-2.5">
          <span className="truncate text-13">{scan.checkpoint_label}</span>
          <span className="font-mono text-12 text-muted-foreground tabular-nums">{formatScanTime(scan.corrected_at, timeZone)}</span>
          <ResultChip result={scan.result} className="col-span-2 justify-self-start" />
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------- credential */

function CredentialBlock({
  alert,
  credential,
  eventId,
  onChanged,
}: {
  alert: BreachAlert;
  credential: AlertCredential;
  eventId: string;
  onChanged: () => void;
}) {
  const [decided, setDecided] = useState<"clear" | "revoke" | null>(null);
  const state = credential.state ? CREDENTIAL_VIEW[credential.state] : null;
  const underReview = credential.state === "suspended_review";
  return (
    <Block title="Credential">
      <dl className="grid grid-cols-[6rem_minmax(0,1fr)] items-baseline gap-x-3 gap-y-2 text-13">
        <dt className="text-12 text-muted-foreground">Holder</dt>
        <dd className="truncate">{credential.full_name ?? <span className="text-muted-foreground">Public visitor</span>}</dd>
        <dt className="text-12 text-muted-foreground">Tier</dt>
        <dd>{TIER_LABEL[credential.tier]}</dd>
        <dt className="text-12 text-muted-foreground">Band</dt>
        <dd className={TYPE.value}>{credential.band_hint ?? <span className="font-sans text-muted-foreground">None bound</span>}</dd>
        <dt className="text-12 text-muted-foreground">State</dt>
        <dd>
          {state ? (
            <span className={cn("inline-flex items-center gap-1.5", state.tone)}>
              <SignalShape state={state.shape} /> {state.label}
            </span>
          ) : (
            "—"
          )}
        </dd>
      </dl>
      {decided ? (
        <p className="mt-3">
          <RewardMoment className="text-13">{decided === "clear" ? "Pass cleared" : "Pass revoked"}</RewardMoment>
        </p>
      ) : null}
      {underReview && alert.kind === "impossible_travel" ? (
        <Can
          I="credentials.review"
          otherwise={<p className="mt-3 text-12 text-muted-foreground">Gates refuse this pass until a supervisor clears or revokes it.</p>}
        >
          <ReviewActions
            eventId={eventId}
            registrationId={credential.registration_id}
            onDone={(outcome) => {
              setDecided(outcome);
              onChanged();
            }}
          />
        </Can>
      ) : null}
    </Block>
  );
}

function ReviewActions({
  eventId,
  registrationId,
  onDone,
}: {
  eventId: string;
  registrationId: string;
  onDone: (outcome: "clear" | "revoke") => void;
}) {
  const [mode, setMode] = useState<"clear" | "revoke" | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  // A new key after an edit puts the button back to its resting label.
  const [round, setRound] = useState(0);

  if (!mode) {
    return (
      <div className="mt-4">
        <p className="text-12 text-muted-foreground">Gates refuse this pass until you decide. Check the person at the gate first.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="secondary" size="compact" onClick={() => setMode("clear")}>
            Clear credential
          </Button>
          <Button variant="danger" size="compact" onClick={() => setMode("revoke")}>
            Revoke
          </Button>
        </div>
      </div>
    );
  }

  const decide = async () => {
    const problem = noteProblem(note);
    if (problem) {
      setError(problem);
      throw new Error("VALIDATION_FAILED");
    }
    setError(null);
    try {
      await configure.reviewCredential(eventId, registrationId, { outcome: mode, note: note.trim() });
      onDone(mode);
    } catch (failure) {
      setError(fieldErrors(failure).note ?? fieldErrors(failure).review ?? errorCopy(failure).message);
      throw failure;
    }
  };

  return (
    <div className="mt-4 border-t border-border pt-4">
      <Field
        label={mode === "clear" ? "Why is it safe to clear?" : "Why revoke?"}
        hint={mode === "clear" ? "The pass works again at once. Your note goes in the audit log." : "The pass stops working everywhere. Your note goes in the audit log."}
        error={error}
      >
        <TextArea
          rows={2}
          value={note}
          onChange={(e) => {
            setNote(e.target.value);
            if (error) {
              setError(null);
              setRound((n) => n + 1);
            }
          }}
        />
      </Field>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <Button
          variant="quiet"
          size="compact"
          onClick={() => {
            setMode(null);
            setError(null);
          }}
        >
          Cancel
        </Button>
        <ActionButton
          key={round}
          variant="quiet"
          size="compact"
          reward
          keepDone
          doneLabel={mode === "clear" ? "Cleared" : "Revoked"}
          failedLabel={error ? "Check the note" : "Didn't work — try again"}
          action={decide}
          className={mode === "revoke" ? "border-destructive/60 text-destructive hover:border-destructive" : undefined}
        >
          {mode === "clear" ? "Clear and reactivate" : "Revoke the pass"}
        </ActionButton>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- resolve */

function ResolveForm({ alert, onResolved }: { alert: BreachAlert; onResolved: () => void }) {
  const { store } = useCommand();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [round, setRound] = useState(0);
  const length = note.trim().length;

  const resolve = async () => {
    const problem = noteProblem(note, "note on what was done");
    if (problem) {
      setError(problem);
      throw new Error("VALIDATION_FAILED");
    }
    setError(null);
    try {
      await store.resolve(alert.id, note);
      onResolved();
    } catch (failure) {
      setError(fieldErrors(failure).note ?? errorCopy(failure).message);
      throw failure;
    }
  };

  return (
    <div>
      <Field
        label="What was done"
        hint="Required. The alert leaves the open list once it is resolved."
        error={error}
        aside={
          <span className={cn("font-mono tabular-nums", length > NOTE_MAX && "text-destructive")}>
            {length.toLocaleString("en-GB")}/1,000
          </span>
        }
      >
        <TextArea
          rows={3}
          value={note}
          onChange={(e) => {
            setNote(e.target.value);
            if (error) {
              setError(null);
              setRound((n) => n + 1);
            }
          }}
          placeholder="For example: checked the room, count confirmed, doors closed for five minutes."
        />
      </Field>
      {alert.state === "open" ? <Notice className="mt-2">Resolving also acknowledges it.</Notice> : null}
      <div className="mt-3 flex justify-end">
        <ActionButton
          key={round}
          variant="primary"
          size="compact"
          reward
          keepDone
          doneLabel="Resolved"
          failedLabel={error ? "Check the note" : "Didn't work — try again"}
          action={resolve}
        >
          Resolve
        </ActionButton>
      </div>
    </div>
  );
}
