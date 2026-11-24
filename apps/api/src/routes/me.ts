/**
 * Slice 9 — attendee self-service and the operator queue of data-subject requests (03 §5).
 *
 * - Everything here is the caller's own data; ids come from the token, never from the request.
 * - Sessions: the schedule of every event the attendee is confirmed for (unlisted ones included,
 *   because they are registered for them).
 * - Notifications are stored when something happens (domain/notifications.ts) and read here; mark-read
 *   answers per item; operators broadcast to an event or one tier (audited).
 * - Export: queued, built by a job, downloaded by the attendee only (GET /me/data-export/:id).
 * - Erasure: queued for an admin (MFA, audited), who processes or rejects it with a note. Processing
 *   scrubs the identity in place and ends the attendee's sessions; registrations and aggregates stay.
 */
import type { Express } from "express";
import { ContractError } from "@synan/contracts/errors";
import { endpoints, type Notification } from "@synan/contracts/rest";
import type { AppContext } from "../app.js";
import { mount } from "../http/route.js";
import { JOB } from "../jobs.js";
import type { DataRequestRowT } from "../repo/types.js";
import { NOTE } from "../domain/notifications.js";

export const dataRequestDto = (r: DataRequestRowT) => ({
  id: r.id, attendee_id: r.attendee_id, kind: r.kind, state: r.state, requested_at: r.requested_at.toISOString(),
  completed_at: r.completed_at?.toISOString() ?? null, note: r.note,
});

/** Builds waiting exports (job `data-export`). */
export async function processDataExports(app: AppContext) {
  for (;;) {
    const r = await app.repos.dataRequests.claimExport(new Date(app.clock.now()));
    if (!r) return;
    const data = await app.repos.dataRequests.collectExport(r.attendee_id);
    const key = `data-exports/${r.attendee_id}/${r.id}.json`;
    const stored = await app.reportStorage.put(key, Buffer.from(JSON.stringify(data), "utf8"), "application/json");
    // Identity leaves the vault in this file: registered (audited) so retention deletes it.
    await app.repos.exportedFiles.record({
      reportId: null, dataRequestId: r.id, objectKey: key, contentType: "application/json", sizeBytes: stored.sizeBytes, containsIdentity: true,
      keyId: stored.keyId, retentionDays: app.config.exportRetentionDays, actorId: null, now: new Date(app.clock.now()),
    });
    const to = (await app.repos.attendees.byId(r.attendee_id))?.email ?? null;
    // Completion and its notice are one unit of work: no notice for an export that did not complete.
    await app.repos.transaction(async (s) => {
      await s.repos.dataRequests.finish(r.id, { state: "completed", objectKey: key, actorId: null, now: new Date(app.clock.now()) });
      if (to) {
        await app.mail.send({ to, tag: "data.export_ready", subject: "Your data export is ready", text: "Your data export is ready. Sign in to your account to download it." }, s);
      }
    });
    await app.notifications.forAttendee(r.attendee_id, NOTE.exportReady());
  }
}

export function meRoutes(x: Express, app: AppContext) {
  const confirmedEvents = async (attendeeId: string) => (await app.repos.registrations.forAttendee(attendeeId)).filter((r) => r.state === "confirmed");

  mount(x, app, endpoints.mySessions, async ({ ctx }) => {
    const items = [];
    for (const r of await confirmedEvents(ctx!.sub)) {
      const e = await app.repos.events.byId(r.event_id);
      if (!e) continue;
      // Each item says which event and room it is in, with the room's capacity in force for the event.
      const eventRooms = await app.repos.events.rooms(e.id);
      const override = new Map(eventRooms.map((x) => [x.room_id, x.capacity_override]));
      const rooms = new Map((await app.repos.venues.roomsByIds(eventRooms.map((x) => x.room_id))).map((x) => [x.id, x]));
      for (const s of await app.repos.events.sessions(r.event_id)) {
        const room = rooms.get(s.room_id);
        items.push({
          id: s.id, event_id: s.event_id, room_id: s.room_id, title: s.title, starts_at: s.starts_at.toISOString(), ends_at: s.ends_at.toISOString(),
          event_slug: e.slug, event_title: e.title, event_timezone: e.timezone,
          ...(room ? { room_name: room.name, room_capacity: override.get(room.id) ?? room.capacity } : {}),
        });
      }
    }
    items.sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    return { items };
  });

  // Stored notifications (written when something happens), newest first, with read state.
  mount(x, app, endpoints.myNotifications, async ({ ctx }) => {
    const rows = await app.repos.notifications.list(ctx!.sub, { now: new Date(app.clock.now()), limit: 100 });
    return { items: rows.map((n): Notification => ({ id: n.id, kind: n.kind, at: n.at.toISOString(), title: n.title, body: n.body, read: n.read })) };
  });

  // Per item: an id that is not the caller's answers exactly like an unknown one (read: false).
  mount(x, app, endpoints.markNotificationsRead, async ({ body, ctx }) => {
    const now = new Date(app.clock.now());
    const ids = [...new Set(body.ids)];
    const mine = new Set((await app.repos.notifications.list(ctx!.sub, { now, limit: 10_000 })).map((n) => n.id));
    await app.repos.notifications.markRead(ctx!.sub, ids.filter((id) => mine.has(id)), now);
    return { items: ids.map((id) => ({ id, read: mine.has(id) })) };
  });

  // Operator broadcast to an event (or one tier): audited with counts and lengths, never the text's audience.
  mount(x, app, endpoints.broadcastNotification, async ({ params, body, ctx }) => {
    const e = await app.repos.events.byId(params.id);
    if (!e) throw new ContractError("NOT_FOUND");
    if (e.state === "draft" || e.state === "archived") throw new ContractError("CONFLICT", "Only a published, live or closed event can be messaged.");
    const id = await app.notifications.broadcast({ eventId: e.id, tier: body.tier ?? null, kind: body.kind, title: body.title, body: body.body });
    await app.audit.append({
      actorId: ctx!.sub, action: "notification.broadcast", target: `event:${e.id}`,
      meta: { notification_id: id, tier: body.tier ?? null, kind: body.kind, title_length: body.title.length, body_length: body.body.length },
    });
    return { id, event_id: e.id, tier: body.tier ?? null, created_at: new Date(app.clock.now()).toISOString() };
  });

  mount(x, app, endpoints.dataExport, async ({ ctx }) => {
    const r = await app.repos.dataRequests.open(ctx!.sub, "export", new Date(app.clock.now()));
    app.jobs.kick(JOB.dataRequest);
    return { request_id: r.request_id, state: "queued" as const };
  });

  mount(x, app, endpoints.dataErasure, async ({ ctx }) => {
    const r = await app.repos.dataRequests.open(ctx!.sub, "erasure", new Date(app.clock.now()));
    return { request_id: r.request_id, state: "queued" as const };
  });

  mount(x, app, endpoints.myDataRequests, async ({ ctx }) => ({ items: (await app.repos.dataRequests.forAttendee(ctx!.sub)).map(dataRequestDto) }));

  mount(x, app, endpoints.myDataExport, async ({ params, ctx }) => {
    const r = await app.repos.dataRequests.byId(params.id);
    // Another attendee's request answers exactly like a missing one.
    if (!r || r.attendee_id !== ctx!.sub || r.kind !== "export") throw new ContractError("NOT_FOUND");
    if (r.state !== "completed" || !r.object_key) throw new ContractError("CONFLICT", "The export is not ready yet.");
    const data = await app.reportStorage.get(r.object_key);
    if (!data) throw new ContractError("NOT_FOUND");
    return { request_id: r.id, generated_at: (r.completed_at ?? r.requested_at).toISOString(), data: JSON.parse(data.toString("utf8")) as Record<string, unknown> };
  });

  /* ---- the operator queue ---- */
  mount(x, app, endpoints.listDataRequests, async ({ query }) => {
    const offset = query.cursor ? Number(query.cursor) : 0;
    if (!Number.isInteger(offset) || offset < 0) throw new ContractError("VALIDATION_FAILED", "invalid cursor", [{ path: "query.cursor", message: "invalid" }]);
    const rows = await app.repos.dataRequests.list({ state: query.state, kind: query.kind, offset, limit: query.limit + 1 });
    return { items: rows.slice(0, query.limit).map(dataRequestDto), next_cursor: rows.length > query.limit ? String(offset + query.limit) : null };
  });

  mount(x, app, endpoints.processDataRequest, async ({ params, ctx }) => {
    const r = await app.repos.dataRequests.byId(params.id);
    if (!r) throw new ContractError("NOT_FOUND");
    if (r.state !== "requested" && r.state !== "in_progress") throw new ContractError("CONFLICT", "This request is already closed.");
    if (r.kind === "erasure") {
      // Also deletes the attendee's pending self-service registrations (SQL: erase_attendee, 0031).
      await app.repos.dataRequests.erase(r, ctx!.sub, new Date(app.clock.now()));
      await app.audit.append({ actorId: ctx!.sub, action: "data_request.process", target: `data_request:${r.id}`, meta: { kind: r.kind } });
    } else {
      await app.audit.append({ actorId: ctx!.sub, action: "data_request.process", target: `data_request:${r.id}`, meta: { kind: r.kind } });
      await app.jobs.runNow(JOB.dataRequest);
    }
    return dataRequestDto((await app.repos.dataRequests.byId(r.id))!);
  });

  mount(x, app, endpoints.rejectDataRequest, async ({ params, body, ctx }) => {
    const r = await app.repos.dataRequests.byId(params.id);
    if (!r) throw new ContractError("NOT_FOUND");
    const s = await app.repos.dataRequests.finish(r.id, { state: "rejected", note: body.note, actorId: ctx!.sub, now: new Date(app.clock.now()) });
    if (s === "not_open") throw new ContractError("CONFLICT", "This request is already closed.");
    await app.audit.append({ actorId: ctx!.sub, action: "data_request.reject", target: `data_request:${r.id}`, meta: { kind: r.kind } });
    await app.notifications.forAttendee(r.attendee_id, r.kind === "export" ? NOTE.exportDeclined() : NOTE.erasureDeclined());
    return dataRequestDto((await app.repos.dataRequests.byId(r.id))!);
  });
}
