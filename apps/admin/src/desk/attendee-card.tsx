/**
 * One attendee at the desk: who they are, where their registration, pass and band stand (in
 * the contracts' words, the band as its masked hint only), and what the desk can do for them.
 *
 * Someone with no band gets the bind step straight away: it is what most people at the desk
 * need. Someone with a band gets three plain choices: rebind, lost band, resend the pass. A pass
 * that is revoked or under review, or a registration that is not confirmed, says why the desk
 * cannot help and who can.
 */
import { useEffect, useState, type ReactNode } from "react";
import { ChevronRight, X } from "lucide-react";
import { cn } from "@synan/ui/components";
import { SignalShape } from "@synan/ui/data";
import type { DeskRegistration } from "@synan/mock/command";
import { Notice, formatStamp } from "../kit";
import { BindFlow } from "./bind-flow";
import {
  bandBlock,
  bandView,
  CREDENTIAL_STATE_COPY,
  displayName,
  REGISTRATION_STATE_COPY,
  resendBlock,
  signalText,
  TIER_LABEL,
} from "./copy";
import { desk } from "./desk-api";
import { OutcomePanel, type DeskOutcome } from "./flow-parts";
import { ReplaceFlow } from "./replace-flow";
import { ResendFlow } from "./resend-flow";
import { track } from "./use-online";

type Flow = "rebind" | "lost" | "resend";

export function AttendeeCard({
  initial,
  eventId,
  timeZone,
  readOnly,
  offline,
  focusBand,
  onClose,
  onChanged,
  onCompleted,
}: {
  initial: DeskRegistration;
  eventId: string;
  timeZone: string;
  /** The event is over: look people up, change nothing. */
  readOnly: boolean;
  offline: boolean;
  /** Put the cursor in the band field at once (a keyboard or a reader is at hand). */
  focusBand: boolean;
  onClose: () => void;
  /** A desk action landed: the fresher row, for the results and the stock. */
  onChanged: (row: DeskRegistration) => void;
  /** Once per completed action: hand the desk back to the search. */
  onCompleted: () => void;
}) {
  const [row, setRow] = useState(initial);
  const [flow, setFlow] = useState<Flow | null>(null);
  const [outcome, setOutcome] = useState<DeskOutcome | null>(null);

  // The result row may be a few seconds old: read this registration again on opening.
  useEffect(() => {
    let live = true;
    track(desk.registration(eventId, initial.id)).then(
      (fresh) => live && setRow(fresh),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [eventId, initial.id]);

  const complete = (result: DeskOutcome) => {
    setOutcome(result);
    setFlow(null);
    // Show the new band at once; the read that follows confirms it.
    const optimistic: DeskRegistration =
      result.kind === "resent" ? row : { ...row, band_hint: result.band, band_lost: false };
    setRow(optimistic);
    onChanged(optimistic);
    onCompleted();
    track(desk.registration(eventId, row.id)).then(
      (fresh) => {
        setRow(fresh);
        onChanged(fresh);
      },
      () => undefined,
    );
  };

  const name = displayName(row);
  const block = bandBlock(row);
  const band = bandView(row);
  const cannotResend = resendBlock(row);
  const pass = row.credential_state ? CREDENTIAL_STATE_COPY[row.credential_state] : null;
  const registration = REGISTRATION_STATE_COPY[row.state];
  // A band reported lost (by the attendee, or marked lost earlier) is replaced, not bound anew: the
  // replacement goes through the lost band's carrier, so the old one stays refused at the gates.
  const reportedLost = !row.band_hint && Boolean(row.band_lost) && Boolean(row.carrier_id);
  const canBind = !readOnly && !block && !row.band_hint && !reportedLost;
  const canReplace = !readOnly && !block && Boolean(row.band_hint);
  const canReplaceLost = !readOnly && !block && reportedLost;

  const start = (next: Flow) => {
    setOutcome(null);
    setFlow(next);
  };

  return (
    <article aria-labelledby="desk-card-name" className="min-w-0">
      <header className="flex items-start justify-between gap-3 px-4 pt-5 pb-4 sm:px-6">
        <div className="min-w-0">
          <p className="text-12 text-muted-foreground">{TIER_LABEL[row.tier]}</p>
          <h2 id="desk-card-name" className={cn("mt-0.5 font-display text-21 leading-tight tracking-tight wrap-break-word sm:text-28", !row.attendee.full_name && "text-muted-foreground")}>
            {name}
          </h2>
          <p className="mt-1 text-13 break-all text-muted-foreground">{row.attendee.email ?? "No email: a public visitor, with no personal data"}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close and go back to the search"
          className="pressable -mr-2 grid size-11 shrink-0 place-items-center text-muted-foreground transition-colors duration-120 ease-standard hover:text-foreground motion-reduce:transition-none"
        >
          <X size={18} strokeWidth={1.5} aria-hidden="true" />
        </button>
      </header>

      {/* What just happened sits right under the name, where the eye already is. */}
      {outcome ? <OutcomePanel outcome={outcome} name={name} /> : null}

      <dl className="grid grid-cols-2 gap-px border-y border-border bg-border">
        <Fact label="Registration">
          <State signal={registration.signal}>{registration.label}</State>
        </Fact>
        <Fact label="Pass">{pass ? <State signal={pass.signal}>{pass.label}</State> : <span className="text-muted-foreground">No pass yet</span>}</Fact>
        <Fact label="Band" wide>
          <State signal={band.signal}>{band.label}</State>
          {band.hint ? <span className="ml-2 font-mono text-13 text-foreground tabular-nums">{band.hint}</span> : null}
        </Fact>
      </dl>
      <p className="flex flex-wrap gap-x-4 gap-y-1 px-4 pt-2.5 text-12 text-muted-foreground sm:px-6">
        <span>
          {row.checked_in_at ? (
            <>
              Checked in <Stamp iso={row.checked_in_at} timeZone={timeZone} />
            </>
          ) : (
            "Not checked in yet"
          )}
        </span>
        {row.pass_sent_at ? (
          <span>
            Pass emailed <Stamp iso={row.pass_sent_at} timeZone={timeZone} />
          </span>
        ) : null}
      </p>

      {block ? (
        <div className="px-4 pt-4 sm:px-6">
          <Notice tone={block.signal === "stop" ? "danger" : block.signal === "warn" ? "warning" : "neutral"}>
            <span className="block font-medium">{block.title}</span>
            <span className="mt-0.5 block text-muted-foreground">{block.body}</span>
          </Notice>
        </div>
      ) : null}

      <div className="mt-4">
        {flow === "rebind" || flow === "lost" ? (
          <ReplaceFlow row={row} disposition={flow === "lost" ? "lost" : "damaged"} disabled={offline} onCancel={() => setFlow(null)} onDone={complete} />
        ) : flow === "resend" ? (
          <ResendFlow row={row} timeZone={timeZone} disabled={offline} onCancel={() => setFlow(null)} onDone={complete} />
        ) : (
          <>
            {canBind && !outcome ? <BindFlow row={row} eventId={eventId} autoFocus={focusBand} disabled={offline} onDone={complete} /> : null}
            <ActionList>
              {canReplace ? (
                <>
                  <ActionRow title="Rebind" detail="The band is here but does not work. Their pass stays the same." onClick={() => start("rebind")} />
                  <ActionRow title="Lost band" detail="The band is gone. Mark it lost and bind a new one." onClick={() => start("lost")} />
                </>
              ) : null}
              {canReplaceLost ? (
                <ActionRow
                  title="Replace the lost band"
                  detail="Their band was reported lost and gates already refuse it. Check their ID, then bind a new one."
                  onClick={() => start("lost")}
                />
              ) : null}
              {!readOnly && !cannotResend ? (
                <ActionRow title="Resend the pass" detail={`Email a fresh copy to ${row.attendee.email ?? ""}.`} onClick={() => start("resend")} />
              ) : null}
            </ActionList>
          </>
        )}
      </div>
    </article>
  );
}

function Fact({ label, wide, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return (
    <div className={cn("min-w-0 bg-background px-4 py-3 sm:px-6", wide && "col-span-2")}>
      <dt className="text-12 text-muted-foreground">{label}</dt>
      <dd className="mt-1 flex flex-wrap items-center text-15">{children}</dd>
    </div>
  );
}

function State({ signal, children }: { signal: keyof typeof signalText; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2">
      <SignalShape state={signal} className={signalText[signal]} />
      <span className={signal === "idle" ? "text-foreground" : signalText[signal]}>{children}</span>
    </span>
  );
}

function Stamp({ iso, timeZone }: { iso: string; timeZone: string }) {
  return <span className="font-mono text-foreground tabular-nums">{formatStamp(iso, timeZone)}</span>;
}

function ActionList({ children }: { children: ReactNode }) {
  return <div className="border-t border-border empty:hidden">{children}</div>;
}

function ActionRow({ title, detail, onClick }: { title: string; detail: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="pressable group flex min-h-16 w-full items-center gap-3 border-b border-border px-4 py-2.5 text-left transition-colors duration-120 ease-standard hover:bg-foreground/3 focus-visible:outline focus-visible:-outline-offset-1 focus-visible:outline-brand motion-reduce:transition-none sm:px-6"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-15 font-medium">{title}</span>
        <span className="mt-0.5 block text-12 text-muted-foreground">{detail}</span>
      </span>
      <ChevronRight size={16} strokeWidth={1.5} aria-hidden="true" className="shrink-0 text-muted-foreground transition-colors duration-120 group-hover:text-foreground" />
    </button>
  );
}
