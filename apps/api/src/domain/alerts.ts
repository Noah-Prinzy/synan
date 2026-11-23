/** Breach alert creation and fan-out (03 §8.2). */
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import type { BreachAlert } from "@synan/contracts/rest";
import type { Clock } from "../lib/clock.js";
import type { AlertsRepo, BreachAlertRow } from "../repo/types.js";
import type { AlertSpec } from "./decision.js";

export function toAlertDto(r: BreachAlertRow): BreachAlert {
  return {
    id: r.id,
    event_id: r.event_id,
    severity: r.severity,
    kind: r.kind,
    checkpoint_id: r.checkpoint_id,
    credential_id: r.credential_id,
    occurred_at: r.occurred_at.toISOString(),
    state: r.state,
    acked_by: r.acked_by,
    acked_at: r.acked_at?.toISOString() ?? null,
    resolution_note: r.resolution_note,
    scan_ids: r.scan_ids,
    detail: r.detail,
  };
}

export class AlertService {
  /** Emits `raised` and `updated` with a BreachAlert DTO. `/stream/alerts` and webhooks subscribe here. */
  readonly events = new EventEmitter();

  constructor(
    private readonly repo: AlertsRepo,
    private readonly clock: Clock,
  ) {}

  async raise(
    spec: AlertSpec,
    ctx: { eventId: string; checkpointId: string | null; roomId?: string | null; credentialId: string | null; occurredAt?: Date; scanIds?: string[] },
  ): Promise<BreachAlertRow> {
    const row: BreachAlertRow = {
      id: randomUUID(),
      event_id: ctx.eventId,
      severity: spec.severity,
      kind: spec.kind,
      checkpoint_id: ctx.checkpointId,
      room_id: ctx.roomId ?? null,
      credential_id: ctx.credentialId,
      occurred_at: ctx.occurredAt ?? new Date(this.clock.now()),
      state: "open",
      acked_by: null,
      acked_at: null,
      resolved_by: null,
      resolved_at: null,
      resolution_note: null,
      scan_ids: ctx.scanIds ?? [],
      detail: spec.detail,
    };
    await this.repo.insert(row);
    this.events.emit("raised", toAlertDto(row));
    return row;
  }

  async update(id: string, patch: Partial<BreachAlertRow>): Promise<BreachAlertRow> {
    const row = await this.repo.update(id, patch);
    this.events.emit("updated", toAlertDto(row));
    return row;
  }
}
