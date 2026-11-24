/**
 * Replacing a band (POST /carriers/:id/rebind, second factor). Two flows on one endpoint:
 *
 *   Rebind      the band is here but does not work (damaged, does not read, wrong size). The
 *               old band is retired; the pass stays the same. `disposition: damaged`.
 *   Lost band   the band is gone (01 §5.3). The old band is marked lost, the pass is replaced
 *               (old QR and emailed copy stop working, a new pass is emailed) and the new band
 *               is bound to the new pass. `disposition: lost`. Done only for the person the
 *               band belongs to, so the clerk confirms a photo ID first.
 *
 * Steps in reading order: (lost: photo ID) → what happened → the new band → confirm. A scan into
 * the band field submits the whole step, so a clerk with a reader finishes with the scan.
 */
import { useRef, useState } from "react";
import { Button, Checkbox, Field } from "@synan/ui/components";
import type { DeskRegistration } from "@synan/mock/command";
import { Notice } from "../kit";
import { BandField, type BandFieldHandle } from "./band-field";
import { DeskInput } from "./desk-input";
import { bandProblem, displayName, maskBand, normaliseBand } from "./copy";
import { desk, deskErrorCode, deskFailure, fieldMessage } from "./desk-api";
import { Consequences, FlowFrame, ReasonChips, type DeskOutcome } from "./flow-parts";
import { StepUpCancelled, useStepUp } from "./step-up-guard";
import { track } from "./use-online";

const REASONS = {
  damaged: ["Does not read at the gate", "Band is damaged", "Wrong size"],
  lost: ["Lost on site", "Left at the hotel or at home", "Stolen"],
} as const;

export function ReplaceFlow({
  row,
  disposition,
  disabled,
  onCancel,
  onDone,
}: {
  row: DeskRegistration;
  disposition: "damaged" | "lost";
  disabled: boolean;
  onCancel: () => void;
  onDone: (outcome: DeskOutcome) => void;
}) {
  const lost = disposition === "lost";
  const name = displayName(row);
  const stepUp = useStepUp();
  const [idChecked, setIdChecked] = useState(false);
  const [idError, setIdError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [band, setBand] = useState("");
  const [bandError, setBandError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "neutral" | "danger"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const field = useRef<BandFieldHandle>(null);
  const reasonInput = useRef<HTMLInputElement>(null);
  const idBox = useRef<HTMLInputElement>(null);
  const inFlight = useRef(false);
  const old = row.band_hint ?? null;

  const submit = async (raw: string) => {
    if (inFlight.current || disabled) return;
    const missingId = lost && !idChecked;
    const shortReason = reason.trim().length < 3;
    const problem = bandProblem(raw);
    setIdError(missingId ? `Check a photo ID first: a lost band is replaced only for ${name}.` : null);
    setReasonError(shortReason ? "Say in a few words what happened, or pick one of the reasons." : null);
    setBandError(problem);
    if (missingId) return idBox.current?.focus();
    if (shortReason) return reasonInput.current?.focus();
    if (problem) return field.current?.focus(true);
    if (!row.carrier_id) {
      setNotice({ tone: "danger", text: "The desk cannot see which band they have now. Search for them again, then retry." });
      return;
    }

    inFlight.current = true;
    setBusy(true);
    setNotice(null);
    try {
      await stepUp(() => track(desk.rebind(row.carrier_id as string, { identifier: normaliseBand(raw), reason: reason.trim(), disposition })));
      onDone(
        lost
          ? { kind: "replaced", band: maskBand(raw), old, emailed: Boolean(row.attendee.email) }
          : { kind: "rebound", band: maskBand(raw), old },
      );
    } catch (failure) {
      if (failure instanceof StepUpCancelled) {
        setNotice({ tone: "neutral", text: "Nothing changed: the second factor was not confirmed. Press the button again when you are ready." });
        return;
      }
      const bandMessage = fieldMessage(failure, "identifier");
      const reasonMessage = fieldMessage(failure, "reason");
      if (bandMessage) {
        setBandError(bandMessage);
        field.current?.focus(true);
      } else if (reasonMessage) {
        setReasonError(reasonMessage);
        reasonInput.current?.focus();
      } else if (deskErrorCode(failure) === "CONFLICT") {
        setBandError("This band is already in use, or their band changed a moment ago. Take a fresh band, and search for them again if it repeats.");
        field.current?.focus(true);
      } else {
        setNotice({ tone: "danger", text: deskFailure(failure, lost ? "The lost band was not replaced" : "The band was not rebound") });
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return (
    <FlowFrame
      id={lost ? "desk-lost" : "desk-rebind"}
      title={lost ? "Lost band" : "Rebind"}
      description={
        lost
          ? "Mark their band lost and bind a new one. Asks for your second factor."
          : "Swap a band that does not work for a new one. Their pass stays the same. Asks for your second factor."
      }
      onCancel={onCancel}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit(band);
        }}
      >
        {lost ? (
          <div className="flex flex-col gap-1.5">
            <Checkbox
              ref={idBox}
              checked={idChecked}
              onChange={(event) => {
                setIdChecked(event.target.checked);
                if (event.target.checked) setIdError(null);
              }}
              label={<>I checked a photo ID, and it matches {row.attendee.full_name ? <span className="font-medium">{name}</span> : "this registration"}</>}
              description="Anyone can say they lost a band. The replacement goes only to the person it belongs to."
              aria-invalid={idError ? true : undefined}
              className="min-h-11 py-1"
            />
            {idError ? <p className="text-12 text-destructive">{idError}</p> : null}
          </div>
        ) : null}

        <div className="flex flex-col gap-2">
          <Field label={lost ? "What happened to the band" : "What is wrong with the band"} error={reasonError}>
            <DeskInput
              ref={reasonInput}
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
                if (reasonError) setReasonError(null);
              }}
              maxLength={500}
              placeholder="A few words, for the audit log"
            />
          </Field>
          <ReasonChips
            options={REASONS[disposition]}
            value={reason}
            onPick={(next) => {
              setReason(next);
              setReasonError(null);
              field.current?.focus();
            }}
          />
        </div>

        <BandField
          ref={field}
          label="New band"
          hint="Scan a fresh band from the box, or type its number and press Enter."
          value={band}
          onChange={(next) => {
            setBand(next);
            if (bandError) setBandError(null);
          }}
          onSubmit={(next) => void submit(next)}
          error={bandError}
        />

        <Consequences
          items={
            lost
              ? [
                  { signal: "stop", text: <>Band {old ? <span className="font-mono text-12">{old}</span> : "they had"} is marked lost. Every gate refuses it.</> },
                  {
                    signal: "idle",
                    text: row.attendee.email
                      ? "Their pass is replaced: the QR on their phone refreshes by itself, the old emailed pass stops working, and a new one is emailed."
                      : "Their pass is replaced: the old pass stops working.",
                  },
                  { signal: "ok", text: "The new band opens the same doors as before." },
                ]
              : [
                  { signal: "idle", text: <>Band {old ? <span className="font-mono text-12">{old}</span> : "they have"} is retired. Gates stop accepting it.</> },
                  { signal: "ok", text: "The new band opens the same doors. Their pass and QR do not change." },
                ]
          }
        />

        {notice ? <Notice tone={notice.tone}>{notice.text}</Notice> : null}

        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" variant="primary" size="sm" loading={busy} disabled={disabled} className="w-full sm:w-auto">
            {lost ? "Mark lost and bind new band" : "Rebind band"}
          </Button>
          <Button type="button" variant="quiet" size="sm" onClick={onCancel} className="w-full sm:w-auto">
            Cancel
          </Button>
        </div>
      </form>
    </FlowFrame>
  );
}
