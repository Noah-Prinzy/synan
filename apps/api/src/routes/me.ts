/**
 * Slice 9 — attendee self-service and the operator queue of data-subject requests (03 §5).
 *
 * - Everything here is the caller's own data; ids come from the token, never from the request.
 * - Sessions: the schedule of every event the attendee is confirmed for (unlisted ones included,
 *   because they are registered for them).
 * - Notifications are derived from state (no notification store yet): pass issued / revoked / under
 *   review, sessions starting within 24 hours, data requests finished. Ids are stable per fact.
 * - Export: queued, built by a job, downloaded by the attendee only (GET /me/data-export/:id).
 * - Erasure: queued for an admin (MFA, audited), who processes or rejects it with a note. Processing
 *   scrubs the identity in place and ends the attendee's sessions; registrations and aggregates stay.
 */
import { createHash } from "node:crypto";
import type { Express } from "express";
import { ContractError } from "@synan/contracts/errors";
import { endpoints, type Notification } from "@synan/contracts/rest";
import type { AppContext } from "../app.js";
import { mount } from "../http/route.js";
import { JOB } from "../jobs.js";
import type { DataRequestRowT } from "../repo/types.js";

const H = 3600_000;
const stableId = (s: string) => {
  const h = createHash("sha256").update(s).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
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
    await app.reportStorage.put(key, Buffer.from(JSON.stringify(data), "utf8"), "application/json");
    await app.repos.dataRequests.finish(r.id, { state: "completed", objectKey: key, actorId: null, now: new Date(app.clock.now()) });
    const a = await app.repos.attendees.byId(r.attendee_id);
    if (a?.email) {
      void app.mailer
        .send({ to: a.email, tag: "data.export_ready", subject: "Your data export is ready", text: "Your data export is ready. Sign in to your account to download it." })
        .catch((e: unknown) => console.error("[mail] export notice failed:", e instanceof Error ? e.message : String(e)));
    }
  }
}

export function meRoutes(x: Express, app: AppContext) {
  const confirmedEvents = async (attendeeId: string) => (await app.repos.registrations.forAttendee(attendeeId)).filter((r) => r.state === "confirmed");

  mount(x, app, endpoints.mySessions, async ({ ctx }) => {
    const items = [];
    for (const r of await confirmedEvents(ctx!.sub)) {
      for (const s of await app.repos.events.sessions(r.event_id)) {
        items.push({ id: s.id, event_id: s.event_id, room_id: s.room_id, title: s.title, starts_at: s.starts_at.toISOString(), ends_at: s.ends_at.toISOString() });
      }
    }
    items.sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    return { items };
  });

  mount(x, app, endpoints.myNotifications, async ({ ctx }) => {
    const now = app.clock.now();
    const items: Notification[] = [];
    for (const r of await confirmedEvents(ctx!.sub)) {
      const e = await app.repos.events.byId(r.event_id);
      const cred = await app.repos.credentials.forRegistration(r.id);
      if (!e || !cred) continue;
      items.push({ id: stableId(`pass:${cred.id}`), kind: "pass", at: cred.issued_at.toISOString(), title: "Your pass is ready", body: `Your pass for ${e.title} is ready in the app and by email.`, read: false });
      if (cred.state === "revoked") {
        items.push({ id: stableId(`revoked:${cred.id}`), kind: "pass", at: (cred.revoked_at ?? cred.issued_at).toISOString(), title: "Your pass was cancelled", body: `Your pass for ${e.title} no longer opens doors.`, read: false });
      } else if (cred.state === "suspended_review") {
        items.push({ id: stableId(`review:${cred.id}`), kind: "pass", at: new Date(now).toISOString(), title: "Your pass is under review", body: "Please see a member of staff at the entrance.", read: false });
      }
      for (const s of await app.repos.events.sessions(e.id)) {
        const t = s.starts_at.getTime();
        if (t > now && t - now <= 24 * H) {
          items.push({ id: stableId(`session:${s.id}`), kind: "session", at: new Date(t - H).toISOString(), title: `${s.title} starts soon`, body: `${s.title} starts at ${s.starts_at.toISOString()}.`, read: false });
        }
      }
    }
    for (const d of await app.repos.dataRequests.forAttendee(ctx!.sub)) {
      if (d.state === "completed" || d.state === "rejected") {
        const title = d.kind === "export" ? (d.state === "completed" ? "Your data export is ready" : "Your data export was declined") : "Your erasure request was declined";
        items.push({ id: stableId(`dr:${d.id}`), kind: "security", at: (d.completed_at ?? d.requested_at).toISOString(), title, body: d.note ?? "See your account page.", read: false });
      }
    }
    items.sort((a, b) => b.at.localeCompare(a.at));
    return { items };
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
    return dataRequestDto((await app.repos.dataRequests.byId(r.id))!);
  });
}
