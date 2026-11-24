/**
 * One attendee, opened from the D6.4 table: the registration's facts and what an operator does
 * to them (D7, docs/06 §2.3): resend the pass, revoke it, rebind the band, change the tier. Each
 * is offered only to a role holding the capability the server checks for it, and each says why
 * when it cannot apply to this attendee. Revoking, rebinding and changing the tier open a short
 * form in place (what and why, for the audit log) before anything happens; resending is one
 * press. On the real API the console's own prompt asks for the second factor when the server
 * wants it (resend, rebind, tier); cancelling it changes nothing. The row is refreshed from the
 * server's answer.
 */
import { useId, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { AttendeeTier } from "@synan/contracts/enums";
import { Button, Field, RewardMoment, Select, TextArea, TextInput } from "@synan/ui/components";
import { SignalShape } from "@synan/ui/data";
import type { AttendeeListRow, DeskAttendee } from "@synan/mock/command";
import { useCan } from "../../access/session";
import { FilterChips, KeyValues, Notice, TIER_LABEL, TIER_ORDER, errorCode, errorCopy, fieldErrors, formatStamp, linkClass } from "../../kit";
import { configure } from "../../live/backend";
import { ReviewPass } from "../../people/review-pass";
import { CREDENTIAL_VIEW, REGISTRATION_VIEW } from "./copy";

export function AttendeeFacts({ row, timeZone }: { row: AttendeeListRow; timeZone: string }) {
  const credential = row.credential_state ? CREDENTIAL_VIEW[row.credential_state] : null;
  const registration = REGISTRATION_VIEW[row.state];
  return (
    <KeyValues
      rows={[
        ["Name", row.full_name ?? <span className="text-muted-foreground">Public visitor (no personal data)</span>],
        ["Email", row.email ? <span className="break-all">{row.email}</span> : <span className="text-muted-foreground">—</span>],
        ["Tier", TIER_LABEL[row.tier]],
        [
          "Registration",
          <span key="r" className={`inline-flex items-center gap-1.5 ${registration.tone}`}>
            <SignalShape state={registration.shape} /> {registration.label}
          </span>,
        ],
        [
          "Credential",
          credential ? (
            <span key="c" className={`inline-flex items-center gap-1.5 ${credential.tone}`}>
              <SignalShape state={credential.shape} /> {credential.label}
            </span>
          ) : (
            <span className="text-muted-foreground">No pass issued</span>
          ),
        ],
        ["Band", row.band_hint ? <span className="font-mono tabular-nums">{row.band_hint}</span> : <span className="text-muted-foreground">Not yet bound</span>],
        ["Checked in", row.checked_in ? "Yes" : <span className="text-muted-foreground">Not yet</span>],
        [
          "Last scan",
          row.last_scan_at ? (
            <span className="font-mono tabular-nums">{formatStamp(row.last_scan_at, timeZone)}</span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
        ],
        ["Registration ID", <span key="id" className="font-mono text-12 break-all text-muted-foreground">{row.registration_id}</span>],
      ]}
    />
  );
}

/** A pass under review gets its decision here; then the operator's actions on the attendee. */
export function AttendeeActions({
  row,
  eventId,
  onChange,
}: {
  row: AttendeeListRow;
  eventId: string;
  onChange: (row: AttendeeListRow) => void;
}) {
  const can = useCan();
  // Keep the block (and its confirmation) on screen after the pass leaves review.
  const [decided, setDecided] = useState<string | null>(null);
  return (
    <>
      {(row.credential_state === "suspended_review" || decided === row.registration_id) && can("credentials.review") ? (
        <ReviewPass
          key={row.registration_id}
          eventId={eventId}
          registrationId={row.registration_id}
          onDone={(next) => {
            setDecided(next.registration_id);
            onChange(next);
          }}
          className="border-t border-border px-4 py-4 sm:px-5"
        />
      ) : null}
      {can("attendees.manage") ? <ManageActions key={row.registration_id} row={row} eventId={eventId} onChange={onChange} /> : null}
    </>
  );
}

/* ------------------------------------------------------------ the actions */

type Action = "resend" | "revoke" | "rebind" | "tier";
type Disposition = "damaged" | "lost";

/** Why an action cannot apply to this attendee now, in words; null when it can. */
function blocked(action: Action, row: AttendeeListRow): string | null {
  const pass = row.credential_state;
  if (action === "resend") {
    if (row.state === "cancelled") return "The registration is cancelled, so there is no pass to send.";
    if (row.state !== "confirmed") return "The pass is sent once the registration is approved.";
    if (!row.email) return "No email address on this registration: there is nowhere to send the pass.";
    if (!pass) return "No pass is issued yet.";
    if (pass === "revoked" || pass === "replaced") return "This pass no longer works, so it cannot be sent again.";
    return null;
  }
  if (action === "revoke") {
    if (!pass) return "No pass is issued yet.";
    if (pass === "revoked" || pass === "replaced") return "This pass already stops at every gate.";
    if (pass === "suspended_review") return "This pass is under review: clear or revoke it above.";
    return null;
  }
  if (action === "rebind") {
    if (!row.band_hint) return "No band is bound yet: bind one at the wristband desk.";
    if (pass === "revoked") return "The pass is revoked, so no band can be bound to it.";
    if (pass === "suspended_review") return "The pass is under review: it must be cleared first.";
    return null;
  }
  if (row.state === "cancelled") return "The registration is cancelled.";
  return null;
}

const ACTION_COPY: Record<Action, { label: string; detail: string }> = {
  resend: { label: "Resend pass", detail: "Sends the pass email again." },
  revoke: { label: "Revoke credential", detail: "Stops the pass and any band at every gate." },
  rebind: { label: "Rebind band", detail: "Moves the credential to a new band; the old one stops working." },
  tier: { label: "Change tier", detail: "Changes where they may go; asks for your second factor." },
};

interface Done {
  action: Action;
  text: ReactNode;
}

function ManageActions({ row, eventId, onChange }: { row: AttendeeListRow; eventId: string; onChange: (row: AttendeeListRow) => void }) {
  const can = useCan();
  const [open, setOpen] = useState<Action | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  // Resend, rebind: the desk's endpoints (desk.use); revoke and tier: the attendee console's.
  const actions: Action[] = (["resend", "revoke", "rebind", "tier"] as const).filter((action) =>
    action === "resend" || action === "rebind" ? can("desk.use") : true,
  );
  if (actions.length === 0) return null;

  const finish = (action: Action, text: ReactNode, next: DeskAttendee) => {
    setOpen(null);
    setDone({ action, text });
    onChange(next);
  };

  return (
    <div className="border-t border-border px-4 py-4 sm:px-5">
      {done ? (
        <div role="status" className="mb-3">
          {done.action === "revoke" ? (
            <p className="flex items-center gap-2 text-13 text-destructive">
              <SignalShape state="stop" /> {done.text}
            </p>
          ) : (
            <RewardMoment className="text-13 text-success">{done.text}</RewardMoment>
          )}
        </div>
      ) : null}
      <p className="text-12 leading-relaxed text-muted-foreground">Each action is recorded in the audit log.</p>
      <ul className="mt-3 border-t border-border">
        {actions.map((action) => {
          const reason = blocked(action, row);
          const copy = ACTION_COPY[action];
          return (
            <li key={action} className="border-b border-border py-2 last:border-b-0">
              <div className="flex min-h-10 items-center justify-between gap-4">
                <span className="min-w-0 text-12 text-muted-foreground">
                  {reason ?? copy.detail}
                  {reason && action === "rebind" && !row.band_hint && can("desk.use") ? (
                    <>
                      {" "}
                      <Link to="/desk" className={linkClass}>
                        Open the desk
                      </Link>
                    </>
                  ) : null}
                </span>
                {action === "resend" ? (
                  <ResendButton row={row} eventId={eventId} disabled={reason !== null} onDone={(next) => finish("resend", resentWords(next), next)} />
                ) : (
                  <Button
                    variant={action === "revoke" ? "danger" : "secondary"}
                    size="compact"
                    disabled={reason !== null}
                    aria-expanded={open === action}
                    onClick={() => {
                      setDone(null);
                      setOpen((current) => (current === action ? null : action));
                    }}
                    className="min-w-36 shrink-0"
                  >
                    {copy.label}
                  </Button>
                )}
              </div>
              {open === action && reason === null ? (
                action === "revoke" ? (
                  <RevokeForm row={row} eventId={eventId} onCancel={() => setOpen(null)} onDone={(next) => finish("revoke", "Pass revoked · every gate refuses it and any band bound to it", next)} />
                ) : action === "rebind" ? (
                  <RebindForm row={row} eventId={eventId} onCancel={() => setOpen(null)} onDone={(next, disposition) => finish("rebind", rebindWords(next, disposition), next)} />
                ) : action === "tier" ? (
                  <TierForm row={row} eventId={eventId} onCancel={() => setOpen(null)} onDone={(next) => finish("tier", <>Tier changed to {TIER_LABEL[next.tier]} · gates use it from the next scan</>, next)} />
                ) : null
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function resentWords(next: DeskAttendee): ReactNode {
  return next.email ? <>Pass sent again to <span className="break-all">{next.email}</span></> : "Pass sent again";
}

function rebindWords(next: DeskAttendee, disposition: Disposition): ReactNode {
  const band = next.band_hint ? <span className="font-mono tabular-nums">{next.band_hint}</span> : "the new band";
  if (disposition === "damaged") return <>Band {band} bound · the old band stops working</>;
  return <>Band {band} bound · the pass was replaced{next.email ? " and a new one emailed" : ""}</>;
}

/** Words for a failure that is not a field's: the second factor not given, the rate limit, or the server's. */
function failureWords(error: unknown, rateLimited = "Too many tries just now: wait a minute, then try again."): { tone: "neutral" | "warning" | "danger"; text: string } {
  const code = errorCode(error);
  if (code === "MFA_REQUIRED") return { tone: "neutral", text: "Nothing changed: the second factor was not confirmed." };
  if (code === "RATE_LIMITED") return { tone: "warning", text: rateLimited };
  const copy = errorCopy(error);
  return { tone: "danger", text: `${copy.title}. ${copy.message}` };
}

function ResendButton({ row, eventId, disabled, onDone }: { row: AttendeeListRow; eventId: string; disabled: boolean; onDone: (next: DeskAttendee) => void }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ tone: "neutral" | "warning" | "danger"; text: string } | null>(null);
  const send = async () => {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    try {
      onDone(await configure.resendPass(eventId, row.registration_id));
    } catch (error) {
      const field = fieldErrors(error).pass;
      setProblem(field ? { tone: "danger", text: field } : failureWords(error, "A pass went to them less than a minute ago. Ask them to look in spam; if it is not there, try again in a minute."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex shrink-0 flex-col items-end gap-1.5">
      <Button variant="secondary" size="compact" loading={busy} disabled={disabled} onClick={() => void send()} className="min-w-36">
        Resend pass
      </Button>
      {problem ? (
        <div role="alert" className="max-w-64 text-right">
          <Notice tone={problem.tone}>{problem.text}</Notice>
        </div>
      ) : null}
    </div>
  );
}

function ReasonField({ value, onChange, error, id, hint }: { value: string; onChange: (value: string) => void; error: string | null; id: string; hint: string }) {
  return (
    <Field label="Note for the audit log" error={error} id={id} hint={hint}>
      <TextArea rows={2} value={value} maxLength={500} onChange={(event) => onChange(event.target.value)} />
    </Field>
  );
}

/** The shared state of a confirm-in-place form: a note, field errors, a failure line, busy. */
function useActionForm() {
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<{ tone: "neutral" | "warning" | "danger"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const noteId = useId();

  /** Runs the call when the note is long enough; field errors land under their fields. */
  const run = async (fields: string[], call: () => Promise<void>) => {
    if (busy) return;
    setFailure(null);
    if (note.trim().length < 3) {
      setErrors({ reason: "Write a short note on why, in a sentence: it goes in the audit log." });
      document.getElementById(noteId)?.focus();
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await call();
    } catch (error) {
      const found = fieldErrors(error);
      const mine = Object.fromEntries(Object.entries(found).filter(([key]) => key === "reason" || fields.includes(key)));
      const general = Object.entries(found).find(([key]) => !(key === "reason" || fields.includes(key)))?.[1];
      if (Object.keys(mine).length > 0) setErrors(mine);
      if (general) setFailure({ tone: "danger", text: general });
      else if (Object.keys(mine).length === 0) setFailure(failureWords(error));
    } finally {
      setBusy(false);
    }
  };
  return { note, setNote, errors, setErrors, failure, busy, noteId, run };
}

const FORM = "mt-2 flex flex-col gap-3 border-t border-border pt-3 pb-1";

function RevokeForm({ row, eventId, onCancel, onDone }: { row: AttendeeListRow; eventId: string; onCancel: () => void; onDone: (next: DeskAttendee) => void }) {
  const form = useActionForm();
  const submit = () =>
    void form.run([], async () => onDone(await configure.revokeCredential(eventId, row.registration_id, { reason: form.note.trim() })));
  return (
    <form
      noValidate
      className={FORM}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <Notice tone="danger">
        Every gate refuses this pass at once{row.band_hint ? <>, and the band <span className="font-mono">{row.band_hint}</span> with it</> : null}. A revoked
        pass cannot be cleared again here.
      </Notice>
      <ReasonField value={form.note} onChange={form.setNote} error={form.errors.reason ?? null} id={form.noteId} hint="Why the pass is revoked." />
      {form.failure ? <Notice tone={form.failure.tone}>{form.failure.text}</Notice> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="danger" size="compact" loading={form.busy}>
          Revoke the pass
        </Button>
        <Button type="button" variant="quiet" size="compact" onClick={onCancel}>
          Keep it
        </Button>
      </div>
    </form>
  );
}

/** The band number's shape (contracts: hex, 8–32 characters), checked before sending, in the desk's words. */
function bandProblem(raw: string): string | null {
  const identifier = raw.replace(/[\s:-]/g, "");
  if (!identifier) return "Scan the new band, or type the number printed on it.";
  if (!/^[0-9A-Fa-f]+$/.test(identifier)) return "A band number has only the digits 0–9 and the letters A–F.";
  if (identifier.length < 8 || identifier.length > 32) return `A band number is 8 to 32 characters long; this one has ${identifier.length}.`;
  return null;
}

function RebindForm({
  row,
  eventId,
  onCancel,
  onDone,
}: {
  row: AttendeeListRow;
  eventId: string;
  onCancel: () => void;
  onDone: (next: DeskAttendee, disposition: Disposition) => void;
}) {
  const form = useActionForm();
  const [band, setBand] = useState("");
  const [disposition, setDisposition] = useState<Disposition>("damaged");
  const submit = () => {
    const problem = bandProblem(band);
    if (problem) {
      form.setErrors({ identifier: problem });
      return;
    }
    void form.run(["identifier"], async () => {
      const next = await configure.replaceBand(eventId, { registration_id: row.registration_id, identifier: band, reason: form.note.trim(), disposition });
      onDone(next, disposition);
    });
  };
  return (
    <form
      noValidate
      className={FORM}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <FilterChips<Disposition>
        label="What happened to the old band"
        value={disposition}
        onChange={setDisposition}
        options={[
          { value: "damaged", label: "Damaged" },
          { value: "lost", label: "Lost" },
        ]}
      />
      {disposition === "lost" ? (
        <Notice tone="warning">
          Check a photo ID first. The old band is marked lost and the pass is replaced: the QR on their phone refreshes by itself, the old
          emailed pass stops working{row.email ? ", and a new one is emailed" : ""}.
        </Notice>
      ) : (
        <p className="text-12 text-muted-foreground">The old band {row.band_hint ? <span className="font-mono">{row.band_hint}</span> : null} is retired; the pass stays the same.</p>
      )}
      <Field label="New band number" error={form.errors.identifier ?? null} hint="Scan it, or type the number printed on it.">
        <TextInput value={band} onChange={(event) => setBand(event.target.value)} autoComplete="off" spellCheck={false} className="font-mono" />
      </Field>
      <ReasonField value={form.note} onChange={form.setNote} error={form.errors.reason ?? null} id={form.noteId} hint="What happened to the old band." />
      {form.failure ? <Notice tone={form.failure.tone}>{form.failure.text}</Notice> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant={disposition === "lost" ? "danger" : "primary"} size="compact" loading={form.busy}>
          {disposition === "lost" ? "Replace the pass and bind" : "Rebind band"}
        </Button>
        <Button type="button" variant="quiet" size="compact" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function TierForm({ row, eventId, onCancel, onDone }: { row: AttendeeListRow; eventId: string; onCancel: () => void; onDone: (next: DeskAttendee) => void }) {
  const form = useActionForm();
  const [tier, setTier] = useState<AttendeeTier | null>(null);
  const submit = () => {
    if (!tier) {
      form.setErrors({ tier: "Choose the new tier." });
      return;
    }
    void form.run(["tier"], async () => onDone(await configure.changeTier(eventId, row.registration_id, { tier, reason: form.note.trim() })));
  };
  return (
    <form
      noValidate
      className={FORM}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <Field label="New tier" error={form.errors.tier ?? null} hint={`Now ${TIER_LABEL[row.tier]}. Gates apply the new tier's rooms from the next scan.`}>
        <Select<AttendeeTier>
          options={TIER_ORDER.filter((t) => t !== row.tier).map((t) => ({ value: t, label: TIER_LABEL[t] }))}
          value={tier}
          onChange={setTier}
          placeholder="Choose a tier…"
        />
      </Field>
      <ReasonField value={form.note} onChange={form.setNote} error={form.errors.reason ?? null} id={form.noteId} hint="Why the tier changes." />
      {form.failure ? <Notice tone={form.failure.tone}>{form.failure.text}</Notice> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" size="compact" loading={form.busy}>
          Change tier
        </Button>
        <Button type="button" variant="quiet" size="compact" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
