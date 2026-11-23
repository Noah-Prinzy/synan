/**
 * D6.6 · Staff `/events/:id/staff` (docs/06 §2.3; docs/01 §3 P-15). Who works which gate, when:
 * staff name, role, gate, shift window in the event's zone, and whether the shift is on, coming
 * up, ended or handed over. Assign opens the shift editor; an overlapping shift is refused with
 * the server's sentence. Handover ends a shift explicitly and shows what the gate did during it.
 * At ≥1280 a side column shows each gate's cover. Roles and permissions are D11, not here.
 *
 * States: loading, error with retry, no staff assigned, no gates at the venue, read-only.
 */
import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { Button, Dialog, cn } from "@synan/ui/components";
import { SignalShape, formatNumber, type SignalState } from "@synan/ui/data";
import type { HandoverSummary } from "@synan/contracts/rest";
import type { AssignmentRow } from "@synan/mock/command";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  Notice,
  SectionHead,
  Table,
  Td,
  Th,
  errorCopy,
  formatDate,
  formatStamp,
  formatTime,
  rowClass,
  toLocalInput,
  useDocumentTitle,
  useResource,
  zoneLabel,
} from "../kit";
import { clock, configure } from "../live/backend";
import { AssignmentDialog } from "./parts/assignment-dialog";
import { ReadOnlyNote, useWorkspaceEvent } from "./parts/context";
import { ROLE_LABEL, formatDuration } from "./parts/copy";

type ShiftState = "on" | "upcoming" | "ended" | "handed_over";

const SHIFT_VIEW: Record<ShiftState, { label: string; shape: SignalState; tone: string }> = {
  on: { label: "On shift", shape: "ok", tone: "text-success" },
  upcoming: { label: "Upcoming", shape: "idle", tone: "text-foreground" },
  ended: { label: "Ended, not handed over", shape: "warn", tone: "text-warning" },
  handed_over: { label: "Handed over", shape: "idle", tone: "text-muted-foreground" },
};

function shiftState(row: AssignmentRow, now: number): ShiftState {
  if (row.handed_over_at) return "handed_over";
  if (now < Date.parse(row.shift_start)) return "upcoming";
  if (now < Date.parse(row.shift_end)) return "on";
  return "ended";
}

/** "Sun 22 Nov, 08:00–14:00", or both dates when a shift crosses midnight. */
function shiftWindow(row: AssignmentRow, timeZone: string): string {
  const sameDay = toLocalInput(row.shift_start, timeZone).slice(0, 10) === toLocalInput(row.shift_end, timeZone).slice(0, 10);
  const day = formatDate(row.shift_start, timeZone, { weekday: true, year: false });
  return sameDay
    ? `${day}, ${formatTime(row.shift_start, timeZone)}–${formatTime(row.shift_end, timeZone)}`
    : `${formatStamp(row.shift_start, timeZone)} – ${formatStamp(row.shift_end, timeZone)}`;
}

export default function WorkspaceStaff() {
  const { event, readOnly, tabPrimary, reload: reloadEvent } = useWorkspaceEvent();
  useDocumentTitle(`Staff · ${event.title || "Untitled event"}`);
  const data = useResource(
    () => Promise.all([configure.assignments(event.id), configure.staff(), configure.checkpoints(event.id)]),
    [event.id],
  );
  const [assigning, setAssigning] = useState(false);
  const [confirming, setConfirming] = useState<AssignmentRow | null>(null);
  const [summary, setSummary] = useState<{ row: AssignmentRow; result: HandoverSummary } | null>(null);
  const [said, setSaid] = useState("");

  const tz = event.timezone;
  const now = clock.now();
  const [assignments, staff, gates] = data.status === "ready" ? data.data : [[], [], []];
  const roleOf = useMemo(() => new Map(staff.map((s) => [s.id, s.role])), [staff]);
  const sorted = useMemo(() => [...assignments].sort((a, b) => a.shift_start.localeCompare(b.shift_start) || a.staff_name.localeCompare(b.staff_name)), [assignments]);

  if (data.status === "loading") return <LoadingState label="Loading staff and gates…" rows={6} />;
  if (data.status === "error") return <ErrorState title="Could not load the staff" error={data.error} onRetry={() => data.reload()} />;

  const canAssign = !readOnly && gates.length > 0;
  const assignButton = (
    <Button variant={tabPrimary ? "primary" : "secondary"} size="compact" onClick={() => setAssigning(true)} disabled={!canAssign}>
      <Plus size={14} strokeWidth={1.5} aria-hidden="true" />
      Assign staff
    </Button>
  );

  return (
    <div className="pb-8">
      {readOnly ? <ReadOnlyNote event={event} what="its staff shifts" /> : null}
      {!readOnly && gates.length === 0 ? (
        <Notice tone="warning" className="mx-4 mt-4 sm:mx-6">
          This venue has no gates yet, so nobody can be assigned. Add gates in the venue editor first.
        </Notice>
      ) : null}
      <div className="xl:grid xl:grid-cols-12">
        <section aria-labelledby="staff-shifts" className="min-w-0 xl:col-span-8">
          <SectionHead
            id="staff-shifts"
            title="Shifts"
            meta={
              <>
                {assignments.length > 0 ? (
                  <>
                    <span className="font-mono tabular-nums">{formatNumber(assignments.length)}</span> assigned ·{" "}
                  </>
                ) : null}
                times in {zoneLabel(tz)}
              </>
            }
            actions={!readOnly && assignments.length > 0 ? assignButton : undefined}
          />
          {assignments.length === 0 ? (
            <EmptyState title="No staff assigned" action={readOnly ? undefined : assignButton}>
              <p>
                A gate scanner only works for someone assigned to that gate for the current shift: it pairs with the gate and
                caches that gate's offline allowlist. Assign security staff to every gate before doors open.
              </p>
            </EmptyState>
          ) : (
            <Table label="Staff shifts">
              <thead>
                <tr>
                  <Th>Staff</Th>
                  <Th>Role</Th>
                  <Th>Gate</Th>
                  <Th>Shift</Th>
                  <Th>State</Th>
                  {readOnly ? null : (
                    <Th>
                      <span className="sr-only">Actions</span>
                    </Th>
                  )}
                </tr>
              </thead>
              <tbody>
                {sorted.map((row) => {
                  const state = shiftState(row, now);
                  const view = SHIFT_VIEW[state];
                  const role = roleOf.get(row.user_id);
                  return (
                    <tr key={row.id} className={rowClass}>
                      <Td className="max-w-56 truncate">{row.staff_name}</Td>
                      <Td className="whitespace-nowrap text-muted-foreground">{role ? ROLE_LABEL[role] : "—"}</Td>
                      <Td className="max-w-56 truncate">{row.checkpoint_label}</Td>
                      <Td className="font-mono text-12 whitespace-nowrap tabular-nums">
                        {shiftWindow(row, tz)}
                        <span className="ml-2 text-muted-foreground">{formatDuration(Date.parse(row.shift_end) - Date.parse(row.shift_start))}</span>
                      </Td>
                      <Td className="whitespace-nowrap">
                        <span className={cn("inline-flex items-center gap-1.5 text-12", view.tone)}>
                          <SignalShape state={view.shape} />
                          {view.label}
                        </span>
                      </Td>
                      {readOnly ? null : (
                        <Td className="text-right whitespace-nowrap">
                          {state === "on" || state === "ended" ? (
                            <Button variant="secondary" size="compact" onClick={() => setConfirming(row)} aria-label={`Hand over ${row.staff_name}'s shift at ${row.checkpoint_label}`}>
                              Handover
                            </Button>
                          ) : null}
                        </Td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
          <p role="status" aria-live="polite" className="sr-only">
            {said}
          </p>
        </section>

        <aside aria-labelledby="staff-gates" className="min-w-0 border-t border-border xl:col-span-4 xl:border-t-0 xl:border-l">
          <SectionHead id="staff-gates" title="Gate cover" meta="now · shifts in all" />
          {gates.length === 0 ? (
            <p className="px-4 py-3 text-13 text-muted-foreground">No gates at this venue.</p>
          ) : (
            <ul className="py-1">
              {gates.map((gate) => {
                const own = assignments.filter((a) => a.checkpoint_id === gate.id);
                const covered = own.some((a) => shiftState(a, now) === "on");
                return (
                  <li key={gate.id} className="grid h-8 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 text-13">
                    <SignalShape state={covered ? "ok" : own.length > 0 ? "idle" : "warn"} className={covered ? "text-success" : own.length > 0 ? "text-muted-foreground" : "text-warning"} />
                    <span className="truncate">
                      {gate.label}
                      <span className="sr-only">: {covered ? "staffed now" : own.length > 0 ? "not staffed now" : "no shifts"}</span>
                    </span>
                    <span className="font-mono text-12 text-muted-foreground tabular-nums">{formatNumber(own.length)}</span>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="border-t border-border px-4 py-3 text-12 text-muted-foreground">
            One person cannot hold two shifts that overlap. Handing over ends a shift on the scanner and records what the gate did.
            Roles and permissions are managed in Settings.
          </p>
        </aside>
      </div>

      <AssignmentDialog
        open={assigning}
        event={event}
        staff={staff}
        gates={gates}
        onClose={() => setAssigning(false)}
        onCreated={(row) => {
          setAssigning(false);
          setSaid(`${row.staff_name} assigned to ${row.checkpoint_label}.`);
          data.reload(true);
          reloadEvent(true);
        }}
      />
      <HandoverConfirm
        row={confirming}
        timeZone={tz}
        onClose={() => setConfirming(null)}
        onDone={(row, result) => {
          setConfirming(null);
          setSummary({ row, result });
          setSaid(`${row.staff_name}'s shift at ${row.checkpoint_label} was handed over.`);
          data.reload(true);
        }}
      />
      <HandoverResult summary={summary} timeZone={tz} onClose={() => setSummary(null)} />
    </div>
  );
}

function HandoverConfirm({
  row,
  timeZone,
  onClose,
  onDone,
}: {
  row: AssignmentRow | null;
  timeZone: string;
  onClose: () => void;
  onDone: (row: AssignmentRow, result: HandoverSummary) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const run = async () => {
    if (!row) return;
    setBusy(true);
    setProblem(null);
    try {
      const result = await configure.handover(row.id);
      onDone(row, result);
    } catch (error) {
      const copy = errorCopy(error);
      setProblem(copy.code === "CONFLICT" ? "This shift was already handed over. Close this and the list will update." : `${copy.title}. ${copy.message}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={row !== null}
      onClose={onClose}
      width="sm"
      title={row ? `Hand over ${row.staff_name}'s shift?` : "Hand over this shift?"}
      description="Their scanner stops admitting at this gate, and you get a summary of the shift."
      footer={
        <>
          <Button variant="secondary" size="compact" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="compact" onClick={() => void run()} disabled={busy}>
            {busy ? "Handing over…" : "Hand over"}
          </Button>
        </>
      }
    >
      {row ? (
        <p className="px-5 py-4 text-13 text-muted-foreground">
          {row.checkpoint_label} · <span className="font-mono text-12 text-foreground tabular-nums">{shiftWindow(row, timeZone)}</span>
        </p>
      ) : null}
      {problem ? <Notice tone="danger" className="mx-5 mb-4">{problem}</Notice> : null}
    </Dialog>
  );
}

const RESULT_LABEL: Record<string, string> = {
  admitted: "Admitted",
  already_inside: "Already inside",
  denied_room: "Not permitted here",
  revoked: "Revoked pass",
  capacity_block: "Room full",
  unknown_token: "Unknown pass",
};

function HandoverResult({
  summary,
  timeZone,
  onClose,
}: {
  summary: { row: AssignmentRow; result: HandoverSummary } | null;
  timeZone: string;
  onClose: () => void;
}) {
  const result = summary?.result;
  return (
    <Dialog
      open={summary !== null}
      onClose={onClose}
      title={summary ? `Shift handed over · ${summary.row.checkpoint_label}` : "Shift handed over"}
      description={
        summary && result ? (
          <>
            {summary.row.staff_name} · handed over at <span className="font-mono tabular-nums">{formatStamp(result.handed_over_at, timeZone)}</span>
          </>
        ) : undefined
      }
      footer={
        <Button variant="secondary" size="compact" onClick={onClose}>
          Done
        </Button>
      }
    >
      {result ? (
        <>
          <dl className="grid grid-cols-3 gap-px border-b border-border bg-border">
            {(
              [
                ["Admitted", result.admitted, undefined],
                ["Refused", result.refused, result.refused > 0 ? "text-destructive" : undefined],
                ["Decided offline", result.queued, undefined],
              ] as const
            ).map(([label, value, tone]) => (
              <div key={label} className="bg-popover px-4 py-3">
                <dt className="text-12 text-muted-foreground">{label}</dt>
                <dd className={cn("mt-1 font-mono text-28 leading-none tabular-nums", tone)}>{formatNumber(value)}</dd>
              </div>
            ))}
          </dl>
          <h3 className="px-5 pt-3 text-12 font-medium">By result</h3>
          <ul className="px-5 pt-1 pb-4">
            {Object.entries(result.by_result).map(([key, n]) => (
              <li key={key} className="flex h-7 items-center justify-between border-b border-border text-13 last:border-b-0">
                <span>{RESULT_LABEL[key] ?? key.replace(/_/g, " ")}</span>
                <span className="font-mono text-12 tabular-nums">{formatNumber(n)}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </Dialog>
  );
}
