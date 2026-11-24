/**
 * A pass under review (D-06, docs/01 §5.2): gates refuse it until someone with
 * `credentials.review` clears it back to active or revokes it. Both need a short note, which
 * goes in the audit log. Clearing is the good outcome and gets the reward; revoking is stated
 * plainly. Callers render this only for a `suspended_review` pass and a role that may decide.
 */
import { useId, useState } from "react";
import { Button, Field, RewardMoment, TextArea } from "@synan/ui/components";
import { SignalShape } from "@synan/ui/data";
import type { DeskAttendee } from "@synan/mock/command";
import { Notice, errorCopy, fieldErrors } from "../kit";
import { configure } from "../live/backend";

type Outcome = "clear" | "revoke";

export function ReviewPass({
  eventId,
  registrationId,
  onDone,
  className,
}: {
  eventId: string;
  registrationId: string;
  /** The attendee as the server returned them after the decision. */
  onDone: (attendee: DeskAttendee) => void;
  className?: string;
}) {
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState<Outcome | null>(null);
  const [done, setDone] = useState<Outcome | null>(null);
  const noteId = useId();

  const decide = async (outcome: Outcome) => {
    if (busy) return;
    setFailure(null);
    if (note.trim().length < 3) {
      setError(
        outcome === "clear"
          ? "Write a short note on why the pass is safe to clear: it goes in the audit log."
          : "Write a short note on why the pass is revoked: it goes in the audit log.",
      );
      document.getElementById(noteId)?.focus();
      return;
    }
    setError(null);
    setBusy(outcome);
    try {
      const attendee = await configure.reviewCredential(eventId, registrationId, { outcome, note: note.trim() });
      setDone(outcome);
      onDone(attendee);
    } catch (caught) {
      const fields = fieldErrors(caught);
      if (fields.note) setError(fields.note);
      else setFailure(fields.review ?? errorCopy(caught).message);
    } finally {
      setBusy(null);
    }
  };

  if (done) {
    return (
      <div className={className} role="status">
        {done === "clear" ? (
          <RewardMoment className="text-13 text-success">Pass cleared · gates admit it again</RewardMoment>
        ) : (
          <p className="flex items-center gap-2 text-13 text-destructive">
            <SignalShape state="stop" /> Pass revoked · every gate refuses it and any band bound to it
          </p>
        )}
      </div>
    );
  }

  return (
    <div className={className}>
      <Notice tone="warning">
        This pass is under review: gates refuse it until it is cleared or revoked. Check the attendee's photo ID before clearing.
      </Notice>
      <Field label="Note for the audit log" error={error} id={noteId} className="mt-3" hint="What you checked, in a sentence.">
        <TextArea rows={2} value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} />
      </Field>
      {failure ? <p role="alert" className="mt-2 text-12 text-destructive">{failure}</p> : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="secondary" size="compact" loading={busy === "clear"} disabled={busy !== null} onClick={() => void decide("clear")}>
          Clear pass
        </Button>
        <Button variant="danger" size="compact" loading={busy === "revoke"} disabled={busy !== null} onClick={() => void decide("revoke")}>
          Revoke pass
        </Button>
      </div>
    </div>
  );
}
