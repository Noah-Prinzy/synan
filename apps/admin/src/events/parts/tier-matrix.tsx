/**
 * TierMatrix and RuleDiff (docs/06 D5 step 3 and D6.3, P-04): who may enter which room, as a
 * tier × room grid of permit/deny cells. Rows are rooms grouped under their zone; columns are
 * the four tiers. Each cell is a toggle button with a glyph and a word (never colour alone).
 * Blue marks only focus, the press and the "changed" marker against a baseline.
 *
 * The matrix edits only *tier rules with no time window*. Role rules and windowed tier rules
 * pass through untouched, so the screens that own them can keep them.
 *
 * Keyboard: one tab stop for the grid (roving tabindex). Arrows move, Home/End go to the ends
 * of the row, Ctrl+Home/End to the first/last cell, Space/Enter toggle.
 */
import { Fragment, useMemo, useRef, useState, type JSX, type KeyboardEvent } from "react";
import { Check, Minus } from "lucide-react";
import type { AttendeeTier } from "@synan/contracts/enums";
import type { RuleInput } from "@synan/mock/command";
import { cn } from "@synan/ui/components";
import { formatNumber } from "@synan/ui/data";
import { TIER_LABEL, TIER_ORDER } from "../../kit";

export interface MatrixRoom {
  id: string;
  name: string;
  zone: string | null;
  capacity: number;
}

/** null = no rule for this cell (refused at the gate, like deny). */
export type CellEffect = "permit" | "deny" | null;

const isCellRule = (rule: RuleInput, tier: AttendeeTier, roomId: string) =>
  rule.subject_kind === "tier" &&
  rule.subject === tier &&
  rule.room_id === roomId &&
  rule.window_start === null &&
  rule.window_end === null;

/** The effect of the untimed tier rule for a cell. If rules disagree, deny wins (as at the gate). */
export function effectOf(rules: RuleInput[], tier: AttendeeTier, roomId: string): CellEffect {
  let found: CellEffect = null;
  for (const rule of rules) {
    if (!isCellRule(rule, tier, roomId)) continue;
    if (rule.effect === "deny") return "deny";
    found = "permit";
  }
  return found;
}

/** A new rule list with the cell set; role rules and windowed rules are kept as they are. */
export function setEffect(rules: RuleInput[], tier: AttendeeTier, roomId: string, effect: "permit" | "deny"): RuleInput[] {
  const next: RuleInput[] = [];
  let placed = false;
  const rule: RuleInput = { subject_kind: "tier", subject: tier, room_id: roomId, window_start: null, window_end: null, effect };
  for (const existing of rules) {
    if (isCellRule(existing, tier, roomId)) {
      if (!placed) next.push(rule);
      placed = true;
    } else {
      next.push(existing);
    }
  }
  if (!placed) next.push(rule);
  return next;
}

export interface RuleChange {
  roomId: string;
  roomName: string;
  tier: AttendeeTier;
  from: CellEffect;
  to: CellEffect;
}

const admits = (effect: CellEffect) => effect === "permit";

/**
 * What changes at the door between two rule lists, room by room in the rooms' order, tiers in
 * TIER_ORDER. "No rule" and "deny" both refuse entry, so a move between them is not a change.
 */
export function diffRules(before: RuleInput[], after: RuleInput[], rooms: MatrixRoom[]): RuleChange[] {
  const changes: RuleChange[] = [];
  for (const room of rooms) {
    for (const tier of TIER_ORDER) {
      const from = effectOf(before, tier, room.id);
      const to = effectOf(after, tier, room.id);
      if (admits(from) !== admits(to)) changes.push({ roomId: room.id, roomName: room.name, tier, from, to });
    }
  }
  return changes;
}

const EFFECT_WORD: Record<"permit" | "deny" | "none", string> = { permit: "permitted", deny: "denied", none: "no rule" };
const effectWord = (effect: CellEffect) => EFFECT_WORD[effect ?? "none"];

interface Group {
  zone: string | null;
  rooms: MatrixRoom[];
}

function groupRooms(rooms: MatrixRoom[]): Group[] {
  const groups: Group[] = [];
  const byZone = new Map<string | null, Group>();
  for (const room of rooms) {
    let group = byZone.get(room.zone);
    if (!group) {
      group = { zone: room.zone, rooms: [] };
      byZone.set(room.zone, group);
      groups.push(group);
    }
    group.rooms.push(room);
  }
  return groups;
}

export function TierMatrix({
  rooms,
  rules,
  onChange,
  baseline,
  disabled = false,
  caption,
}: {
  rooms: MatrixRoom[];
  rules: RuleInput[];
  onChange?: (rules: RuleInput[]) => void;
  /** The saved rules; cells that differ carry a small brand marker. */
  baseline?: RuleInput[];
  disabled?: boolean;
  caption?: string;
}): JSX.Element {
  const editable = Boolean(onChange) && !disabled;
  const groups = useMemo(() => groupRooms(rooms), [rooms]);
  // Rooms in display order (grouped), so arrow keys follow what is on screen.
  const ordered = useMemo(() => groups.flatMap((g) => g.rooms), [groups]);
  const [active, setActive] = useState<{ row: number; col: number }>({ row: 0, col: 0 });
  const cells = useRef(new Map<string, HTMLButtonElement | null>());
  const changeCount = useMemo(() => (baseline ? diffRules(baseline, rules, rooms).length : 0), [baseline, rules, rooms]);
  const label = caption ?? "Access by tier and room";

  const row = Math.min(active.row, Math.max(0, ordered.length - 1));
  const col = Math.min(active.col, TIER_ORDER.length - 1);

  const focusCell = (r: number, c: number) => {
    setActive({ row: r, col: c });
    const room = ordered[r];
    const tier = TIER_ORDER[c];
    if (room && tier) cells.current.get(`${room.id}:${tier}`)?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, r: number, c: number) => {
    const lastRow = ordered.length - 1;
    const lastCol = TIER_ORDER.length - 1;
    let target: [number, number] | null = null;
    switch (event.key) {
      case "ArrowRight":
        target = [r, Math.min(lastCol, c + 1)];
        break;
      case "ArrowLeft":
        target = [r, Math.max(0, c - 1)];
        break;
      case "ArrowDown":
        target = [Math.min(lastRow, r + 1), c];
        break;
      case "ArrowUp":
        target = [Math.max(0, r - 1), c];
        break;
      case "Home":
        target = event.ctrlKey ? [0, 0] : [r, 0];
        break;
      case "End":
        target = event.ctrlKey ? [lastRow, lastCol] : [r, lastCol];
        break;
      default:
        return;
    }
    event.preventDefault();
    focusCell(target[0], target[1]);
  };

  const toggle = (tier: AttendeeTier, roomId: string) => {
    if (!editable || !onChange) return;
    const now = effectOf(rules, tier, roomId);
    onChange(setEffect(rules, tier, roomId, now === "permit" ? "deny" : "permit"));
  };

  const setColumn = (tier: AttendeeTier, effect: "permit" | "deny") => {
    if (!editable || !onChange) return;
    let next = rules;
    for (const room of rooms) next = setEffect(next, tier, room.id, effect);
    onChange(next);
  };

  if (rooms.length === 0) {
    return (
      <div className="px-4 py-6 text-13 text-muted-foreground">
        No rooms to set access for yet. Pick the event's rooms first.
      </div>
    );
  }

  return (
    <div className="min-w-0">
      {caption || baseline ? (
        <div className="flex min-h-10 items-center justify-between gap-3 px-4">
          <p className="py-2 text-13 font-medium">{caption ?? "Access"}</p>
          {baseline ? (
            <p role="status" aria-live="polite" className={cn("flex items-center gap-1.5 text-12", changeCount ? "text-foreground" : "text-muted-foreground")}>
              {changeCount ? <span aria-hidden="true" className="size-1.5 bg-brand" /> : null}
              {changeCount === 0 ? (
                "No changes"
              ) : (
                <>
                  <span className="font-mono tabular-nums">{formatNumber(changeCount)}</span> {changeCount === 1 ? "change" : "changes"}
                </>
              )}
            </p>
          ) : null}
        </div>
      ) : null}
      <div className="max-h-[min(70vh,44rem)] overflow-auto">
        <table aria-label={label} className="w-full min-w-xl border-collapse text-13">
          <thead>
            <tr>
              <th
                scope="col"
                className="sticky top-0 left-0 z-3 h-9 bg-background px-4 text-left align-bottom text-12 font-normal text-muted-foreground"
              >
                <span className="block pb-2.5">Room</span>
              </th>
              {TIER_ORDER.map((tier) => {
                const permitted = rooms.filter((room) => effectOf(rules, tier, room.id) === "permit").length;
                return (
                  <th
                    key={tier}
                    scope="col"
                    className="sticky top-0 z-2 w-36 bg-background px-3 pt-2.5 pb-2 text-left align-bottom font-normal"
                  >
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="text-13 font-medium text-foreground">{TIER_LABEL[tier]}</span>
                      <span className="text-12 whitespace-nowrap text-muted-foreground">
                        <span className="font-mono tabular-nums">{permitted}</span> of <span className="font-mono tabular-nums">{rooms.length}</span>
                      </span>
                    </span>
                    {editable ? (
                      <span className="mt-1.5 flex gap-3 text-12 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => setColumn(tier, "permit")}
                          aria-label={`Allow ${TIER_LABEL[tier]} in all rooms`}
                          className="text-muted-foreground underline decoration-foreground/30 underline-offset-2 hover:text-foreground hover:decoration-brand pointer-coarse:py-2"
                        >
                          Allow all
                        </button>
                        <button
                          type="button"
                          onClick={() => setColumn(tier, "deny")}
                          aria-label={`Deny ${TIER_LABEL[tier]} in all rooms`}
                          className="text-muted-foreground underline decoration-foreground/30 underline-offset-2 hover:text-foreground hover:decoration-brand pointer-coarse:py-2"
                        >
                          Deny all
                        </button>
                      </span>
                    ) : null}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => (
              <Fragment key={group.zone ?? "__none"}>
                {groups.length > 1 || group.zone ? (
                  <tr>
                    <th
                      scope="colgroup"
                      colSpan={TIER_ORDER.length + 1}
                      className="h-9 bg-surface px-4 text-left text-12 font-normal text-muted-foreground"
                    >
                      {group.zone ?? "Other rooms"}
                    </th>
                  </tr>
                ) : null}
                {group.rooms.map((room) => {
                  const r = ordered.indexOf(room);
                  return (
                    <tr key={room.id}>
                      <th
                        scope="row"
                        className="sticky left-0 z-1 h-10 bg-background px-4 text-left font-normal"
                      >
                        <span className="flex items-baseline justify-between gap-3">
                          <span className="truncate">{room.name}</span>
                          <span className="shrink-0 font-mono text-12 text-muted-foreground tabular-nums">{formatNumber(room.capacity)}</span>
                        </span>
                      </th>
                      {TIER_ORDER.map((tier, c) => {
                        const effect = effectOf(rules, tier, room.id);
                        const changed = baseline ? admits(effectOf(baseline, tier, room.id)) !== admits(effect) : false;
                        const name = `${TIER_LABEL[tier]} in ${room.name}: ${effect === "permit" ? "permitted" : effect === "deny" ? "denied" : "denied, no rule"}${changed ? ", changed" : ""}`;
                        const body = (
                          <>
                            {effect === "permit" ? (
                              <Check size={14} strokeWidth={1.75} aria-hidden="true" className="shrink-0" />
                            ) : (
                              <Minus size={14} strokeWidth={1.5} aria-hidden="true" className="shrink-0 opacity-60" />
                            )}
                            <span>{effect === "permit" ? "Permit" : "Deny"}</span>
                            {changed ? <span aria-hidden="true" className="absolute top-1 right-1 size-1.5 bg-brand" /> : null}
                          </>
                        );
                        const cellClass = cn(
                          "relative flex h-10 w-full items-center gap-1.5 px-3 text-left text-13",
                          effect === "permit" ? "bg-surface-2 text-foreground" : "text-muted-foreground",
                        );
                        return (
                          <td key={tier} className="p-0">
                            {editable ? (
                              <button
                                type="button"
                                ref={(el) => {
                                  cells.current.set(`${room.id}:${tier}`, el);
                                }}
                                aria-pressed={effect === "permit"}
                                aria-label={name}
                                tabIndex={r === row && c === col ? 0 : -1}
                                onFocus={() => setActive({ row: r, col: c })}
                                onClick={() => toggle(tier, room.id)}
                                onKeyDown={(event) => onKeyDown(event, r, c)}
                                className={cn(
                                  cellClass,
                                  "pressable transition-colors duration-120 ease-standard hover:bg-surface-3 hover:text-foreground focus-visible:z-1 focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-brand motion-reduce:transition-none pointer-coarse:h-11",
                                )}
                              >
                                {body}
                              </button>
                            ) : (
                              <span className={cellClass}>
                                <span className="sr-only">{name}</span>
                                <span aria-hidden="true" className="contents">
                                  {body}
                                </span>
                              </span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** The changes in plain words: "Workshop A · Public: denied → permitted". */
export function RuleDiff({ changes, limit }: { changes: RuleChange[]; /** Show at most this many, then "and N more". */ limit?: number }): JSX.Element {
  if (changes.length === 0) return <p className="text-13 text-muted-foreground">No changes.</p>;
  const shown = limit !== undefined && changes.length > limit ? changes.slice(0, limit) : changes;
  const more = changes.length - shown.length;
  return (
    <ul className="text-13">
      {shown.map((change) => (
        <li key={`${change.roomId}:${change.tier}`} className="flex flex-wrap items-baseline gap-x-1.5 py-1.5">
          <span className="min-w-0">
            {change.roomName} <span className="text-muted-foreground">·</span> {TIER_LABEL[change.tier]}:
          </span>
          <span className="text-muted-foreground">{effectWord(change.from)}</span>
          <span aria-hidden="true" className="text-muted-foreground">
            →
          </span>
          <span className="sr-only">to</span>
          <span className={admits(change.to) ? "text-foreground" : "text-foreground/80"}>{effectWord(change.to)}</span>
        </li>
      ))}
      {more > 0 ? (
        <li className="py-1.5 text-12 text-muted-foreground">
          and <span className="font-mono tabular-nums">{more}</span> more
        </li>
      ) : null}
    </ul>
  );
}
