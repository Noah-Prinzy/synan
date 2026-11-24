/**
 * Attendee notifications (/me/notifications), written at the moment something happens:
 * pass issued or re-issued, pass revoked or under review, a wristband bound, a session room full,
 * a schedule change, and operator broadcasts.
 *
 * Text is generic by construction (03 §5): the event and session titles are public; nothing names
 * a room, gate, zone, time of a passage, or another person. A failure to write one never undoes the
 * action that caused it (logged without detail).
 */
import { describeError } from "@synan/db";
import type { AttendeeTier } from "@synan/contracts/enums";
import type { Clock } from "../lib/clock.js";
import type { NotificationKindT, Repos } from "../repo/types.js";

export const NOTE = {
  passIssued: (event: string) => ({ kind: "pass" as const, title: "Your pass is ready", body: `Your pass for ${event} is ready in the app.` }),
  passReissued: (event: string) => ({ kind: "pass" as const, title: "Your pass was re-issued", body: `A new copy of your pass for ${event} has been issued. Earlier copies no longer work; the pass in the app is up to date.` }),
  passRevoked: (event: string) => ({ kind: "pass" as const, title: "Your pass was cancelled", body: `Your pass for ${event} no longer opens doors. Contact the organiser if you think this is a mistake.` }),
  passReview: (event: string) => ({ kind: "security" as const, title: "Your pass is under review", body: `Your pass for ${event} is paused for a check. Please speak to a member of staff.` }),
  passCleared: (event: string) => ({ kind: "pass" as const, title: "Your pass works again", body: `The check on your pass for ${event} is complete.` }),
  bandBound: (event: string) => ({ kind: "pass" as const, title: "Wristband linked", body: `A wristband is now linked to your pass for ${event}. If this was not you, contact the organiser.` }),
  sessionFull: (session: string) => ({ kind: "capacity" as const, title: `${session} is full`, body: `${session} has reached capacity. Staff will let people in as space frees up.` }),
  /** A new time, in the event's own time zone (e.g. "Tue 25 Nov, 14:30"). */
  sessionChanged: (session: string, startsAt: Date, timeZone = "UTC") => ({ kind: "session" as const, title: "Schedule change", body: `${session} now starts at ${localTime(startsAt, timeZone)}.` }),
  /** A different room: the notice never names it (03 §5); the agenda in the app shows where. */
  sessionMoved: (session: string) => ({ kind: "session" as const, title: "Schedule change", body: `${session} has moved to another room. The agenda in the app shows where.` }),
  exportReady: () => ({ kind: "security" as const, title: "Your data export is ready", body: "Download it from your account page. It is kept for 7 days." }),
  exportDeclined: () => ({ kind: "security" as const, title: "Your data export was declined", body: "See your account page for the reason." }),
  erasureDeclined: () => ({ kind: "security" as const, title: "Your erasure request was declined", body: "See your account page for the reason." }),
  sessionCancelled: (session: string) => ({ kind: "session" as const, title: "Schedule change", body: `${session} has been cancelled.` }),
};

type Note = { kind: NotificationKindT; title: string; body: string };

/** "Tue 25 Nov, 14:30" in the given zone (falls back to UTC for an unknown zone). */
export function localTime(at: Date, timeZone: string): string {
  const fmt = (zone: string) =>
    new Intl.DateTimeFormat("en-GB", { timeZone: zone, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(at);
  try {
    return fmt(timeZone);
  } catch {
    return `${fmt("UTC")} UTC`;
  }
}

export class NotificationService {
  /** Sessions already announced as full (one notice per session). */
  private announcedFull = new Set<string>();

  constructor(private readonly deps: { repos: Repos; clock: Clock }) {}

  private now() {
    return new Date(this.deps.clock.now());
  }

  private async safely(what: string, f: () => Promise<unknown>) {
    try {
      await f();
    } catch (e) {
      console.error(`[notifications] ${what} failed: ${describeError(e)}`);
    }
  }

  /** A personal notification for the holder of a registration (staff credentials have none). */
  async forRegistration(registrationId: string | null, note: (eventTitle: string) => Note, repos: Repos = this.deps.repos): Promise<void> {
    if (!registrationId) return;
    await this.safely("notify", async () => {
      const reg = await repos.registrations.byId(registrationId);
      const event = reg ? await repos.events.byId(reg.event_id) : null;
      if (!reg || !event) return;
      const n = note(event.title);
      await repos.notifications.notify({ attendeeId: reg.attendee_id, eventId: event.id, ...n, now: this.now() });
    });
  }

  /** A personal notification not tied to an event (data requests). */
  async forAttendee(attendeeId: string, note: Note, repos: Repos = this.deps.repos): Promise<void> {
    await this.safely("notify", () => repos.notifications.notify({ attendeeId, eventId: null, ...note, now: this.now() }));
  }

  async forCredential(credentialId: string, note: (eventTitle: string) => Note, repos: Repos = this.deps.repos): Promise<void> {
    const cred = await repos.credentials.byId(credentialId);
    if (cred) await this.forRegistration(cred.registration_id, note, repos);
  }

  async broadcast(i: { eventId: string; tier: AttendeeTier | null } & Note): Promise<string> {
    return this.deps.repos.notifications.broadcast({ ...i, now: this.now() });
  }

  /**
   * A room reached its blocking threshold: every session running in it now is announced once to the
   * event's attendees. The notice names the session only, never the room.
   */
  async roomFull(eventId: string, roomId: string, atMs: number): Promise<void> {
    await this.safely("room full", async () => {
      const sessions = (await this.deps.repos.events.sessions(eventId)).filter(
        (s) => s.room_id === roomId && s.starts_at.getTime() <= atMs && atMs < s.ends_at.getTime() && !this.announcedFull.has(s.id),
      );
      for (const s of sessions) {
        this.announcedFull.add(s.id);
        await this.broadcast({ eventId, tier: null, ...NOTE.sessionFull(s.title) });
      }
    });
  }

  async sessionChanged(eventId: string, note: Note): Promise<void> {
    await this.safely("schedule change", () => this.broadcast({ eventId, tier: null, ...note }));
  }
}
