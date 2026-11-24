/**
 * The switch between the two data sources. `VITE_API_URL` unset (the default): the in-process
 * mock (data/mock-backend.ts), exactly as before. Set: the real API (data/api/backend.ts).
 *
 * The choice is a build-time constant and each side is a dynamic import, so a production build
 * with `VITE_API_URL` set contains no mock code, and a default build contains no API client.
 * Screens never import either side: they import the modules in src/data, which call `backend`.
 */
import type { MyCredential, Notification, PortalCodeBatch } from "@synan/contracts/rest";
import type { AgendaSession } from "./agenda";
import type { EventDetail, EventSummary } from "./events";
import type { Pass } from "./pass";
import type { ProfileField, RegistrationDraft } from "./registration";

export type Session = { email: string; name: string };

export type BindResult =
  | { ok: true; band: { uid: string } }
  | { ok: false; reason: "already_bound" | "unknown_band" }
  /** Anything else (offline, rate limited, revoked pass): `message` is contracts' copy. */
  | { ok: false; reason: "failed"; message: string };

/** `unreachable`: no answer from the server (offline, or it is down); the link may still be good. */
export type VerifyOutcome = { ok: true; next: string } | { ok: false; problem: "expired" | "invalid" | "unreachable" };

export type SubmitOutcome = { ok: true } | { ok: false; reason: "offline" | "error" };

export type PassLoad = { pass: Pass } | { pass: null };

export interface Backend {
  readonly mode: "mock" | "api";
  /** Development affordances read from the URL once per page load (mock only). */
  applyDevParams(search: string): void;

  /** "Now" for every time comparison: the mock clock, or the device clock corrected by server time. */
  now(): number;
  subscribeClock(listener: () => void): () => void;
  /** Every change to data the screens read live (pass state, band, read state, session). */
  subscribe(listener: () => void): () => void;
  version(): number;

  /* A1, A2 */
  getEvents(): EventSummary[] | Promise<EventSummary[]>;
  getEventDetail(slug: string | undefined): EventDetail | null | Promise<EventDetail | null>;

  /* A3 */
  loadRegistration(slug: string): RegistrationForm | Promise<RegistrationForm>;
  isDuplicateEmail(email: string): boolean;
  submitRegistration(slug: string, draft: RegistrationDraft, session: Session | null): Promise<SubmitOutcome>;
  /** Mock build only: the path standing in for the emailed link. */
  emailedLinkFor(email: string, next: string): string | null;

  /* A9 */
  readSession(): Session | null;
  requestSignInLink(email: string, next: string): Promise<void>;
  verifyLink(token: string, next: string): Promise<VerifyOutcome>;
  updateName(name: string): Promise<void>;
  signOut(): void;

  /* A4, A5, A8 */
  /** The pass if it is already known on this device (the mock always knows it). */
  peekPass(preview: string | null): Pass | null;
  /** Fetch (or re-fetch) the pass. `{ pass: null }`: signed in, but no pass issued. */
  loadPass(): PassLoad | Promise<PassLoad>;
  initialCodes(): PortalCodeBatch | null;
  getCodes(): PortalCodeBatch | Promise<PortalCodeBatch>;
  emailPassCopy(): Promise<void>;
  reportLostBand(): Promise<void>;
  /** /stream/me: the pass's state changed while the screen is open. */
  watchPass(onState: (state: MyCredential["state"]) => void): () => void;
  boundBand(): { uid: string; hint: string } | null;
  bindBand(binding: { via: "desk_code"; code: string } | { via: "nfc"; uid: string }): BindResult | Promise<BindResult>;
  /** Mock build only: a desk code that binds. */
  readonly devCodeHint: string | null;

  /* A6 */
  mySessions(): AgendaSession[] | Promise<AgendaSession[]>;

  /* A7 */
  loadNotifications(): Notification[] | Promise<Notification[]>;
  notifications(): Notification[];
  markAllRead(): void | Promise<void>;

  /* A8 */
  requestDataExport(): Promise<void>;
  requestErasure(): Promise<void>;
}

export type RegistrationForm = { event: EventSummary | undefined; fields: ProfileField[] };

const apiUrl = import.meta.env.VITE_API_URL;

export const backend: Backend = apiUrl
  ? (await import("./api/backend")).createApiBackend(apiUrl)
  : (await import("./mock-backend")).mockBackend;
