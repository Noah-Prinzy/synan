/**
 * One attendee, opened from the D6.4 table: the registration's facts and the actions the full
 * attendee console (D7) will carry. Those actions are shown so the operator knows where they
 * live, but disabled with the reason: they need D7's second-factor prompt and audit trail.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@synan/ui/components";
import { SignalShape } from "@synan/ui/data";
import type { AttendeeListRow } from "@synan/mock/command";
import { useCan } from "../../access/session";
import { KeyValues, TIER_LABEL, formatStamp, linkClass } from "../../kit";
import { ReviewPass } from "../../people/review-pass";
import { CREDENTIAL_VIEW, REGISTRATION_VIEW } from "./copy";

const ACTIONS = [
  ["Resend pass", "Sends the pass email again."],
  ["Revoke credential", "Stops the pass and any band at every gate."],
  ["Rebind band", "Moves the credential to a new band; the old one stops working."],
  ["Change tier", "Changes where they may go; asks for your second factor."],
] as const;

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
        ["Band", row.band_hint ? <span className="font-mono text-12">{row.band_hint}</span> : <span className="text-muted-foreground">Not yet bound</span>],
        ["Checked in", row.checked_in ? "Yes" : <span className="text-muted-foreground">Not yet</span>],
        [
          "Last scan",
          row.last_scan_at ? (
            <span className="font-mono text-12 tabular-nums">{formatStamp(row.last_scan_at, timeZone)}</span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
        ],
        ["Registration ID", <span key="id" className="font-mono text-11 break-all text-muted-foreground">{row.registration_id}</span>],
      ]}
    />
  );
}

/** A pass under review gets its decision here; the rest waits for D7. */
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
          className="border-t border-border px-4 py-4"
        />
      ) : null}
      {can("attendees.manage") ? <LaterActions /> : null}
    </>
  );
}

function LaterActions() {
  return (
    <div className="border-t border-border px-4 py-3">
      <p className="text-12 text-muted-foreground">
        These actions arrive with the attendee console (D7), which asks for your second factor and records each one in
        the audit log. Bands and resends are done at the{" "}
        <Link to="/desk" className={linkClass}>
          wristband desk
        </Link>
        .
      </p>
      <ul className="mt-3 flex flex-col gap-2">
        {ACTIONS.map(([label, detail]) => (
          <li key={label} className="flex items-center justify-between gap-3">
            <span className="min-w-0 text-12 text-muted-foreground">{detail}</span>
            <Button variant="secondary" size="compact" disabled title="Coming with the attendee console (D7)">
              {label}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
