/**
 * The configure side of Admin Command on the real API: `ConfigureApi` (first run, venues and their
 * layout, events and the wizard, the event workspace, the registration desk), call for call,
 * returning exactly the shapes the screens consume today. Differences are bridged here or in
 * adapters.ts; index.ts lists them.
 */
import type { CredentialState } from "@synan/contracts/enums";
import type { EventAdmin, Organization } from "@synan/contracts/rest";
import type {
  AttendeeListRow,
  ConfigureApi,
  CredentialOverview,
  DeskAttendee,
  EventPatch,
  EventRecord,
  ReadinessItem,
  RuleInput,
} from "@synan/mock/command";
import {
  carrierCounts,
  credentialCounts,
  layoutIssues,
  toAssignmentRow,
  toAttendeeRow,
  toEventRecord,
  toEventRow,
  toStaffRow,
  toVenueDetail,
  toVenueRow,
  zoneOf,
} from "./adapters";
import { allPages, type ApiClient } from "./client";
import type { SharedCache } from "./command";
import { ApiFailure, type Issue } from "./failure";

/** Registrations read per list (4 pages of 500): the attendee table and the desk's lookups. */
const REGISTRATION_PAGES = 4;

/** The mock's slug rule (contracts' Slug): lowercase letters, digits, single hyphens, at most 80. */
function slugify(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/, "");
}

const isSlugTaken = (error: unknown) =>
  error instanceof ApiFailure && error.code === "CONFLICT" && error.issues.some((issue) => issue.path === "body.slug");

/** `UpdateEvent` from the wizard's patch (rules and nothing else go elsewhere). */
function updateBody(patch: EventPatch) {
  const { rules: _rules, pass_template, venue_id, rooms, ...rest } = patch;
  return {
    ...rest,
    // null clears a draft's venue (UpdateEvent.venue_id is nullable).
    ...(venue_id !== undefined ? { venue_id } : {}),
    ...(rooms ? { rooms: rooms.map((r) => ({ room_id: r.room_id, capacity_override: r.capacity_override })) } : {}),
    ...(pass_template !== undefined ? { pass_template: pass_template ? { ...pass_template } : null } : {}),
  };
}

export function createConfigureApi(client: ApiClient, cache: SharedCache): ConfigureApi {
  let organization: Promise<Organization | null> | null = null;
  const org = () => {
    organization ??= client.call("currentOrganization").then(
      (s) => s.organization,
      (error: unknown) => {
        organization = null;
        throw error;
      },
    );
    return organization;
  };

  const eventRecord = async (id: string): Promise<EventRecord> => toEventRecord(await client.call("getEventAdmin", { params: { id } }));

  const remember = (e: EventAdmin) => {
    if (e.venue) cache.venueOfEvent.set(e.id, e.venue.id);
    cache.checkpoints.delete(e.id);
    return e;
  };

  /** PUT the whole rule set against the current version (drafts: the wizard's matrix). */
  const replaceRules = async (eventId: string, rules: RuleInput[]) => {
    const current = await client.call("getAccessRules", { params: { id: eventId } });
    return client.call("putAccessRules", { params: { id: eventId }, body: { expected_version: current.version, rules } });
  };

  const registrations = (eventId: string, query: { q?: string; tier?: AttendeeListRow["tier"]; credential?: CredentialState; unbound?: boolean } = {}) =>
    allPages(
      (cursor) =>
        client.call("eventRegistrations", {
          params: { id: eventId },
          query: {
            limit: 500,
            cursor,
            q: query.q?.trim() || undefined,
            tier: query.tier,
            credential: query.credential,
            unbound: query.unbound ? "true" : undefined,
          },
        }),
      REGISTRATION_PAGES,
    );

  /**
   * One registration as the desk sees it: GET /registrations/:id, which carries the band to act on
   * (`carrier_id`: the live band, else a lost one) and when the pass last went out. When the band last
   * changed is its `bound_at`, from GET /credentials.
   */
  const deskAttendee = async (eventId: string, registrationId: string): Promise<DeskAttendee> => {
    const row = await client.call("getRegistration", { params: { id: registrationId } });
    if (row.event_id !== eventId) throw new ApiFailure("NOT_FOUND", 404);
    const carrier = row.credential_id && row.band_hint ? await liveBand(eventId, row.credential_id).catch(() => null) : null;
    return {
      ...toAttendeeRow(row),
      credential_id: row.credential_id ?? null,
      carrier_id: row.carrier_id ?? carrier?.id ?? null,
      pass_sent_at: row.pass_sent_at ?? null,
      band_changed_at: carrier?.bound_at ?? null,
    };
  };

  /** The credential's live wristband (assigned, bound or active), from GET /credentials. */
  const liveBand = async (eventId: string, credentialId: string) => {
    const { items } = await allPages((cursor) => client.call("listCredentials", { query: { event_id: eventId, limit: 500, cursor } }), REGISTRATION_PAGES);
    const credential = items.find((c) => c.id === credentialId);
    return credential?.carriers.find((c) => c.kind === "nfc" && (c.state === "assigned" || c.state === "bound" || c.state === "active")) ?? null;
  };

  /** The desk's band field: the server's `identifier` issues and conflicts, under `identifier` (as the mock). */
  const deskFailure = (error: unknown): unknown => {
    if (!(error instanceof ApiFailure) || error.kind !== "http") return error;
    if (error.code === "CONFLICT" && error.issues.length === 0 && error.detail) {
      return error.recode("CONFLICT", [{ path: "identifier", message: error.detail }]);
    }
    return error;
  };

  const api: ConfigureApi = {
    async setupStatus() {
      const status = await client.call("currentOrganization");
      organization = Promise.resolve(status.organization);
      return status;
    },

    async createOrganization(body) {
      const created = await client.call("createOrganization", { body });
      organization = Promise.resolve(created);
      return created;
    },

    async venues() {
      const { items } = await allPages((cursor) => client.call("listVenues", { query: { limit: 500, cursor } }));
      return items.map(toVenueRow);
    },

    async venue(id) {
      return toVenueDetail(await client.call("getVenue", { params: { id } }));
    },

    async createVenue(body) {
      // DIFFERENCE: the mock fills a missing address with the city; the server keeps "".
      return client.call("createVenue", {
        body: {
          name: body.name.trim(),
          city: body.city.trim() || null,
          address: body.address?.trim() || body.city.trim(),
          timezone: body.timezone,
          floors: body.floors.map((f) => f.trim()).filter(Boolean),
          capacity_default: body.capacity_default ?? null,
        },
      });
    },

    /**
     * PUT /venues/:id/layout. MFA while an event at the venue is live (the client prompts).
     * DIFFERENCES: (1) row issues by index become `room:<id>` / `zone:<id>`; (2) a zone or room in use
     * that the layout would remove answers 409 CONFLICT with `zone:<id>` issues on the server — the
     * editor shows CONFLICT as "someone else published", so that case is re-coded VALIDATION_FAILED
     * (fields kept, `serverCode` CONFLICT) and the editor marks the zone or room. A stale
     * `expected_version` stays CONFLICT.
     */
    async publishLayout(id, body) {
      const request = {
        expected_version: body.expected_version,
        floors: body.floors,
        zones: body.zones.map((z) => ({ id: z.id, name: z.name, floor: z.floor, geometry: z.geometry })),
        rooms: body.rooms.map((r) => ({
          id: r.id,
          zone_id: r.zone_id,
          name: r.name,
          capacity: r.capacity,
          warn_at_pct: r.warn_at_pct,
          block_at_pct: r.block_at_pct,
          continuous: r.continuous,
          capacity_policy: r.capacity_policy,
          geometry: r.geometry,
        })),
      };
      try {
        const detail = toVenueDetail(await client.call("publishLayout", { params: { id }, body: request }));
        cache.checkpoints.clear();
        return detail;
      } catch (error) {
        if (!(error instanceof ApiFailure)) throw error;
        const issues = layoutIssues(error.issues, request);
        const blocked = issues.some((issue) => /^(zone|room):/.test(issue.path));
        if (error.code === "CONFLICT" && blocked) throw error.recode("VALIDATION_FAILED", issues);
        if (error.code === "VALIDATION_FAILED") throw error.recode("VALIDATION_FAILED", issues);
        throw error;
      }
    },

    async eventRows() {
      const { items } = await allPages((cursor) => client.call("listEventsAdmin", { query: { limit: 500, cursor } }));
      return items.map(toEventRow);
    },

    event: eventRecord,

    /**
     * POST /events. DIFFERENCES: the server needs a title (min 1) and a slug, and a time zone; the
     * mock accepts an empty title and makes the slug unique itself. Here: an empty title becomes
     * "Untitled event", the slug comes from the title (or "untitled-event") and gets -2, -3 … while
     * taken, the time zone defaults to the organisation's. Draft rules go to PUT /access-rules.
     */
    async createDraft(patch) {
      const title = patch.title?.trim() || "Untitled event";
      const base = patch.slug ?? (slugify(title) || "untitled-event");
      const timezone = patch.timezone ?? zoneOf(await org().catch(() => null));
      let created: EventAdmin | null = null;
      for (let i = 1; !created; i++) {
        const slug = i === 1 ? base : `${base.slice(0, 75).replace(/-+$/, "")}-${i}`;
        try {
          created = await client.call("createEvent", {
            body: {
              slug,
              title,
              timezone,
              description: patch.description,
              starts_at: patch.starts_at ?? undefined,
              ends_at: patch.ends_at ?? undefined,
              venue_id: patch.venue_id ?? undefined,
              wizard_step: patch.wizard_step,
              listed: patch.listed,
              grace_buffer_hours: patch.grace_buffer_hours,
              rooms: patch.rooms?.map((r) => ({ room_id: r.room_id, capacity_override: r.capacity_override })),
              pass_template: patch.pass_template ? { ...patch.pass_template } : patch.pass_template,
            },
          });
        } catch (error) {
          // The mock picks the next free slug; so does this, unless the caller named one.
          if (isSlugTaken(error) && patch.slug === undefined && i < 20) continue;
          throw error;
        }
      }
      remember(created);
      if (patch.rules && patch.rules.length > 0) {
        await replaceRules(created.id, patch.rules);
        return eventRecord(created.id);
      }
      return toEventRecord(created);
    },

    /**
     * PATCH /events/:id, then (when the patch carries `rules`) PUT /events/:id/access-rules against
     * the current version. DIFFERENCE: the mock refuses `rules` on a published event (CONFLICT); here
     * they are republished, which needs MFA while live — the workspace uses putAccessRules for that.
     */
    async updateEvent(id, patch) {
      const body = updateBody(patch);
      let record: EventAdmin | null = null;
      if (Object.keys(body).length > 0 || !patch.rules) record = remember(await client.call("updateEvent", { params: { id }, body }));
      if (patch.rules) {
        await replaceRules(id, patch.rules);
        return eventRecord(id);
      }
      return toEventRecord(record!);
    },

    async duplicateEvent(id) {
      return toEventRecord(remember(await client.call("duplicateEvent", { params: { id }, body: {} })));
    },

    async deleteDraft(id) {
      await client.call("deleteEvent", { params: { id } });
      cache.venueOfEvent.delete(id);
    },

    /**
     * GET /events/:id/readiness. DIFFERENCE: `{ event_id, ready, items }` on the server; the mock
     * answers the items. The server has three more keys (doors, gate, sessions), all non-blocking.
     */
    async readiness(id) {
      const { items } = await client.call("eventReadiness", { params: { id } });
      return items as ReadinessItem[];
    },

    /**
     * POST /events/:id/publish. DIFFERENCE: unmet blocking lines answer 409 CONFLICT on the server
     * (issues keyed by the checklist key); the mock answers VALIDATION_FAILED, and the review step
     * reads CONFLICT as "no longer a draft". Re-coded VALIDATION_FAILED when the issues are checklist keys.
     */
    async publishEvent(id) {
      try {
        return toEventRecord(remember(await client.call("publishEvent", { params: { id } })));
      } catch (error) {
        if (error instanceof ApiFailure && error.code === "CONFLICT" && error.issues.length > 0 && error.issues.every((i) => !i.path.includes("."))) {
          throw error.recode("VALIDATION_FAILED");
        }
        throw error;
      }
    },

    async transitionEvent(id, state) {
      return toEventRecord(remember(await client.call("transitionEvent", { params: { id }, body: { state } })));
    },

    async sessions(eventId) {
      const { items } = await client.call("eventSessions", { params: { id: eventId } });
      return [...items].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    },

    createSession: (eventId, body) => client.call("createSession", { params: { id: eventId }, body: { ...body, title: body.title.trim() } }),

    updateSession: (eventId, sessionId, body) =>
      client.call("updateSession", { params: { id: eventId, sessionId }, body: { ...body, title: body.title.trim() } }),

    async deleteSession(eventId, sessionId) {
      await client.call("deleteSession", { params: { id: eventId, sessionId } });
    },

    async accessRules(eventId) {
      return client.call("getAccessRules", { params: { id: eventId } });
    },

    /** MFA while the event is live (the client prompts). */
    async putAccessRules(eventId, body) {
      return client.call("putAccessRules", { params: { id: eventId }, body });
    },

    /**
     * GET /events/:id/registrations, up to 2,000 rows. `q` is matched by the server: name, email, a pass
     * id or reference, a band UID, or a band hint's last four (`81BF`, `••••81BF`), so kiosk walk-ins
     * with no name or email are found. DIFFERENCES: `last_scan_at` is not served (null); `total` is the
     * event's registrations in every state before filters.
     */
    async attendees(eventId, query = {}) {
      let items;
      let total: number | undefined;
      const first = await client.call("eventRegistrations", {
        params: { id: eventId },
        query: { limit: 500, q: query.q?.trim() || undefined, tier: query.tier, credential: query.credential, unbound: query.unbound ? "true" : undefined },
      });
      total = first.total;
      if (first.next_cursor) {
        const rest = await registrations(eventId, query);
        items = rest.items;
      } else items = first.items;
      return { items: items.map(toAttendeeRow), total: total ?? items.length };
    },

    /**
     * GET /credentials/inventory?event_id, with the latest band actions (`recent`). DIFFERENCE: the
     * server names no attendee there (ids and band hints only), so the name shows as a dash; only
     * binds and replacements are listed (the screen's vocabulary). A lost-band replacement reads
     * `replaced` on the new band (listed) and `lost` on the old one (left out, as it is the same swap);
     * a damaged swap's old band reads `retired` (left out too). Band hints as the server gives them.
     */
    async credentialOverview(eventId) {
      const inventory = await client.call("inventory", { query: { event_id: eventId } });
      const overview: CredentialOverview = {
        by_state: carrierCounts(inventory.by_state),
        by_chip_profile: { ...inventory.by_chip_profile },
        credentials: credentialCounts(inventory.credentials),
        recent: (inventory.recent ?? [])
          .filter((r): r is typeof r & { action: "bound" | "replaced" } => r.action === "bound" || r.action === "replaced")
          .map((r) => ({ at: r.at, band_hint: r.band_hint, attendee: "—", action: r.action })),
      };
      return overview;
    },

    deskAttendee,

    async bindBand(eventId, body) {
      try {
        await client.call("bindCarrier", { body: { registration_id: body.registration_id, identifier: body.identifier.replace(/[\s:-]/g, "").toUpperCase() } });
      } catch (error) {
        throw deskFailure(error);
      }
      return deskAttendee(eventId, body.registration_id);
    },

    /** POST /carriers/:id/rebind (MFA: the client prompts). The old band's carrier id is looked up first. */
    async replaceBand(eventId, body) {
      const current = await deskAttendee(eventId, body.registration_id);
      if (!current.carrier_id) {
        throw new ApiFailure("CONFLICT", 409, { issues: [{ path: "identifier", message: "This attendee has no band yet. Use Bind band instead." }] });
      }
      try {
        await client.call("rebindCarrier", {
          params: { id: current.carrier_id },
          body: { identifier: body.identifier.replace(/[\s:-]/g, "").toUpperCase(), reason: body.reason.trim(), disposition: body.disposition },
        });
      } catch (error) {
        throw deskFailure(error);
      }
      return deskAttendee(eventId, body.registration_id);
    },

    /** POST /credentials/:id/resend (MFA: the client prompts). */
    async resendPass(eventId, registrationId) {
      const current = await deskAttendee(eventId, registrationId);
      if (!current.credential_id) throw new ApiFailure("NO_CREDENTIAL", 404);
      await client.call("resend", { params: { id: current.credential_id } });
      return deskAttendee(eventId, registrationId);
    },

    /** POST /credentials/:id/clear-review (a supervisor needs MFA: the client prompts). */
    async reviewCredential(eventId, registrationId, body) {
      const current = await deskAttendee(eventId, registrationId);
      if (!current.credential_id) throw new ApiFailure("NO_CREDENTIAL", 404);
      try {
        await client.call("clearReview", { params: { id: current.credential_id }, body: { outcome: body.outcome, note: body.note.trim() } });
      } catch (error) {
        if (error instanceof ApiFailure && error.code === "CONFLICT" && error.issues.length === 0) {
          throw error.recode("CONFLICT", [{ path: "review", message: "This pass is no longer under review. Someone may have decided already." }]);
        }
        throw error;
      }
      return deskAttendee(eventId, registrationId);
    },

    /** POST /credentials/:id/revoke (audited; a supervisor would need a fresh second factor). Revoking twice is a no-op on the server. */
    async revokeCredential(eventId, registrationId, body) {
      const current = await deskAttendee(eventId, registrationId);
      if (!current.credential_id) {
        throw new ApiFailure("CONFLICT", 409, { issues: [{ path: "revoke", message: "This registration has no pass to revoke." }] });
      }
      try {
        await client.call("revoke", { params: { id: current.credential_id }, body: { reason: body.reason.trim() } });
      } catch (error) {
        if (error instanceof ApiFailure && error.code === "CONFLICT" && error.issues.length === 0) {
          throw error.recode("CONFLICT", [{ path: "revoke", message: "This pass can no longer be revoked: it may have been replaced meanwhile." }]);
        }
        throw error;
      }
      return deskAttendee(eventId, registrationId);
    },

    /** PATCH /registrations/:id/tier (MFA: the client prompts; audited). The server refuses a closed event or a cancelled registration. */
    async changeTier(eventId, registrationId, body) {
      try {
        await client.call("changeTier", { params: { id: registrationId }, body: { tier: body.tier, reason: body.reason.trim() } });
      } catch (error) {
        if (error instanceof ApiFailure && error.code === "CONFLICT" && error.issues.length === 0) {
          throw error.recode("CONFLICT", [{ path: "tier", message: "The tier cannot change now: the event has closed or the registration was cancelled." }]);
        }
        throw error;
      }
      return deskAttendee(eventId, registrationId);
    },

    /** GET /credentials/inventory: the stock, the event's bands, and this desk's own work this shift (`today`; zeros with no shift). */
    async deskStock(eventId) {
      const [all, event] = await Promise.all([client.call("inventory", {}), client.call("inventory", { query: { event_id: eventId } })]);
      const stock = carrierCounts(all.by_state);
      const mine = carrierCounts(event.by_state);
      const today = event.today ?? null;
      return { stock: stock.stock, bound: mine.bound + mine.active, lost: mine.lost, today: { bound: today?.bound ?? 0, replaced: today?.replaced ?? 0, resent: today?.resent ?? 0 } };
    },

    async staff() {
      const { items } = await allPages((cursor) => client.call("listStaff", { query: { limit: 500, cursor } }));
      return items.map(toStaffRow);
    },

    async checkpoints(eventId) {
      const { items } = await allPages((cursor) => client.call("listCheckpoints", { query: { event_id: eventId, limit: 500, cursor } }));
      return items;
    },

    async assignments(eventId) {
      const { items } = await allPages((cursor) => client.call("listAssignments", { query: { event_id: eventId, limit: 500, cursor } }));
      return items.map(toAssignmentRow);
    },

    /**
     * POST /staff-assignments with the event. DIFFERENCE: the mock reports shift problems under
     * `shift`; the server under `shift_start` / `shift_end`, and an overlap as a bare 409 — both are
     * also put under `shift`.
     */
    async createAssignment(eventId, body) {
      try {
        return toAssignmentRow(await client.call("createAssignment", { body: { ...body, event_id: eventId } }));
      } catch (error) {
        if (!(error instanceof ApiFailure) || error.kind !== "http") throw error;
        const shift: Issue[] = error.issues.filter((i) => /shift_(start|end)$/.test(i.path)).map((i) => ({ path: "shift", message: i.message }));
        if (error.code === "CONFLICT" && error.issues.length === 0 && error.detail) shift.push({ path: "shift", message: error.detail });
        throw shift.length ? error.recode(error.code, [...error.issues, ...shift]) : error;
      }
    },

    handover: (assignmentId) => client.call("handover", { params: { id: assignmentId } }),
  };

  return api;
}
