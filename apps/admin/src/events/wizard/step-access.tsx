/**
 * D5 step 3 · Access rules (P-04): which tier may enter which room, as the TierMatrix over the
 * rooms chosen in step 2. A room with no rules yet starts from a common setup (VIP and Ordinary
 * permitted; Invitation and Public denied) that the user then adjusts; the aside lists what
 * differs from the saved rules. Saved with the draft on Continue.
 */
import { useMemo, useState, type FormEvent } from "react";
import type { AttendeeTier } from "@synan/contracts/enums";
import type { EventRecord, RuleInput, VenueDetail } from "@synan/mock/command";
import { ErrorState, LoadingState, Notice, TIER_LABEL, TIER_ORDER, errorCopy, useResource } from "../../kit";
import { configure } from "../../live/backend";
import { RuleDiff, TierMatrix, diffRules, effectOf, setEffect, type MatrixRoom } from "../parts/tier-matrix";
import { AsideBlock, StepLayout, WizardFooter, matrixRooms, toRuleInput, type StepContext } from "./shared";

const STARTING: Record<AttendeeTier, "permit" | "deny"> = { VIP: "permit", ORDINARY: "permit", PRIVATE_INVITE: "deny", PUBLIC: "deny" };

/** Rules for the event's rooms only, with the starting setup for rooms that have no tier rules. */
function prepare(rules: RuleInput[], rooms: MatrixRoom[]): { rules: RuleInput[]; seeded: number } {
  const ids = new Set(rooms.map((room) => room.id));
  let next = rules.filter((rule) => ids.has(rule.room_id));
  let seeded = 0;
  for (const room of rooms) {
    if (TIER_ORDER.some((tier) => effectOf(next, tier, room.id) !== null)) continue;
    seeded += 1;
    for (const tier of TIER_ORDER) next = setEffect(next, tier, room.id, STARTING[tier]);
  }
  return { rules: next, seeded };
}

interface Loaded {
  saved: RuleInput[];
  venue: VenueDetail;
}

export function AccessStep({ record, forms, setForm, saved, goto, close, loadVenue }: StepContext & { record: EventRecord }) {
  const [problem, setProblem] = useState<string | null>(null);
  const loaded = useResource<Loaded | null>(async () => {
    if (!record.venue_id) return null;
    const [set, venue] = await Promise.all([configure.accessRules(record.id), loadVenue(record.venue_id)]);
    return { saved: set.rules.map(toRuleInput), venue };
  }, [record.id, record.venue_id]);

  const data = loaded.status === "ready" ? loaded.data : null;
  const rooms = useMemo(() => (data ? matrixRooms(data.venue, record.rooms) : []), [data, record.rooms]);
  // The starting point: the saved rules, plus the common setup for rooms that have none. Cells
  // changed from it carry the marker, and the aside lists them.
  const start = useMemo(() => (data ? prepare(data.saved, rooms) : { rules: [], seeded: 0 }), [data, rooms]);
  // Unsaved edits from earlier in this session; rooms added since then get the starting setup.
  const rules = useMemo(() => (forms.access ? prepare(forms.access, rooms).rules : start.rules), [forms.access, rooms, start]);
  const changes = useMemo(() => diffRules(start.rules, rules, rooms), [start, rules, rooms]);
  const nothingSaved = data !== null && data.saved.length === 0;

  const persist = async (next: "pass" | null): Promise<EventRecord> => {
    setProblem(null);
    const ids = new Set(rooms.map((room) => room.id));
    try {
      const result = await configure.updateEvent(record.id, { rules: rules.filter((rule) => ids.has(rule.room_id)), wizard_step: next ?? "access" });
      saved(result);
      setForm("access", undefined);
      loaded.set((current) => (current ? { ...current, saved: rules } : current));
      return result;
    } catch (error) {
      const copy = errorCopy(error);
      setProblem(`${copy.title}. ${copy.message}`);
      throw error;
    }
  };

  const tiersIn = TIER_ORDER.filter((tier) => rooms.some((room) => effectOf(rules, tier, room.id) === "permit"));
  const shut = TIER_ORDER.filter((tier) => !tiersIn.includes(tier));

  const body = (() => {
    if (!record.venue_id || record.rooms.length === 0) {
      return (
        <Notice tone="warning">
          <span>
            Choose the venue and its rooms first.{" "}
            <button type="button" className="underline underline-offset-4" onClick={() => goto("venue")}>
              Go to Venue & rooms
            </button>
          </span>
        </Notice>
      );
    }
    if (loaded.status === "loading") return <LoadingState label="Loading the rooms and rules…" rows={6} className="px-0 sm:px-0" />;
    if (loaded.status === "error") return <ErrorState title="Could not load the access rules" error={loaded.error} onRetry={() => loaded.reload()} className="m-0 sm:m-0" />;
    return (
      <div className="flex flex-col gap-4">
        <p className="max-w-160 text-13 text-muted-foreground">
          Choose who may enter each room. A tier without a permit is refused at the door. Press a cell to switch it, or use Allow all and
          Deny all on a column.
        </p>
        {start.seeded > 0 && nothingSaved ? (
          <Notice className="max-w-160">
            Started with a common setup: VIP and Ordinary everywhere, Invitation and Public nowhere. Allow Public only in the rooms that are
            open to walk-ins. Nothing is saved until you continue.
          </Notice>
        ) : start.seeded > 0 ? (
          <Notice className="max-w-160">
            {start.seeded} {start.seeded === 1 ? "room had" : "rooms had"} no rules yet and started with VIP and Ordinary permitted.
          </Notice>
        ) : null}
        <TierMatrix rooms={rooms} rules={rules} onChange={(next) => setForm("access", next)} baseline={start.rules} caption="Tier × room" />
      </div>
    );
  })();

  const ready = loaded.status === "ready" && rooms.length > 0;

  return (
    <StepLayout
      width="wide"
      asideAlways
      asideLabel="Access summary"
      aside={
        ready ? (
          <>
            <AsideBlock title="Who gets in">
              <ul className="text-13">
                {TIER_ORDER.map((tier) => {
                  const n = rooms.filter((room) => effectOf(rules, tier, room.id) === "permit").length;
                  return (
                    <li key={tier} className="flex items-baseline justify-between gap-3 border-b border-border py-2 last:border-b-0">
                      <span>{TIER_LABEL[tier]}</span>
                      <span className={n === 0 ? "text-muted-foreground" : undefined}>
                        {n === 0 ? (
                          "no rooms"
                        ) : n === rooms.length ? (
                          "every room"
                        ) : (
                          <>
                            <span className="font-mono tabular-nums">{n}</span> of <span className="font-mono tabular-nums">{rooms.length}</span> rooms
                          </>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
              {shut.length > 0 && tiersIn.length > 0 ? (
                <p className="mt-2 text-12 text-muted-foreground">
                  {shut.map((tier) => TIER_LABEL[tier]).join(" and ")} {shut.length === 1 ? "is" : "are"} refused at every door, which is right
                  when the event has no such guests.
                </p>
              ) : null}
              {tiersIn.length === 0 ? (
                <p className="mt-2 text-12 text-warning">No tier can enter any room: every attendee would be refused at the door.</p>
              ) : null}
            </AsideBlock>
            <AsideBlock title={changes.length ? `Your changes · ${changes.length}` : "Your changes"}>
              <RuleDiff changes={changes} limit={12} />
              {changes.length > 0 ? <p className="mt-2 text-12 text-muted-foreground">Saved when you continue.</p> : null}
            </AsideBlock>
          </>
        ) : null
      }
    >
      <form noValidate aria-label="Access rules" onSubmit={(event: FormEvent) => event.preventDefault()}>
        {body}
        {problem ? (
          <Notice tone="danger" className="mt-4 max-w-160">
            {problem}
          </Notice>
        ) : null}
        <div className="mt-4 max-w-5xl">
          <WizardFooter
            onBack={() => goto("venue")}
            onSaveClose={ready ? async () => close(await persist(null)) : async () => close(record)}
            onContinue={ready ? async () => goto("pass", (await persist("pass")).id) : undefined}
          />
        </div>
      </form>
    </StepLayout>
  );
}
