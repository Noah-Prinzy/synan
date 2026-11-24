/**
 * The scanner against the real API (roadmap Phase 3). Owns: the session, the gates from
 * GET /me/assignments, the clock offset and QR leeway (GET /time, D-14), the public keys and the
 * signed allowlist (verified before use, kept in IndexedDB), the durable queue and its sync (including
 * scans an earlier shift left on this device), undo, REST heartbeats and `/stream/scans`, and the
 * link state.
 *
 * It never imports the screens' store: data/store.ts hands it a small `Host` to write the state
 * the screens already read (scans, last sync, pass-list age, clock offset, link).
 */
import { parseSignedQr } from "@synan/contracts/qr";
import type { ScanDirection } from "@synan/contracts/enums";
import type { HandoverSummary, ScanSubmission, SignedAllowlist, SigningKey, StaffAssignment } from "@synan/contracts/rest";
import type { Gate } from "../mock";
import type { Presented, Scan } from "../store";
import { ApiFailure, call, currentSession, onSession, signIn as clientSignIn, signOut as clientSignOut } from "./client";
import {
  ALLOWLIST_REFRESH_MS,
  CLOCK_REFRESH_MS,
  DEFAULT_QR_LEEWAY_S,
  ONLINE_VERDICT_TIMEOUT_MS,
  REST_HEARTBEAT_MS,
  SYNC_BATCH,
} from "./config";
import { AllowlistRejected, allowlistWindow, ed25519Supported, emailCidHash, importKeys, nfcHash, verifyAllowlistJws, verifyQr, type TrustedKey } from "./crypto";
import { decideLocally, indexAllowlist, type AllowlistIndex, type LocalCheckpoint, type Resolution } from "./decide";
import { Idb, KV } from "./idb";
import {
  canSend,
  due,
  historyOf,
  isConflict,
  resultOf,
  ScanQueue,
  syncQueue,
  undoUntil,
  undoWindowMs,
  unsent,
  type QueueRecord,
  type SendResult,
  type Signer,
} from "./queue";
import { ScanStream, type StreamState } from "./stream";

/* ------------------------------------------------------------ host */

export interface HostState {
  gateId: string | null;
  scans: Scan[];
  lastSyncAt: number | null;
  allowlistAt: number | null;
  clockOffsetMs: number;
  apiReachable: boolean;
  forceOffline: boolean;
}
export interface Host {
  get(): HostState;
  patch(p: Partial<HostState>): void;
}

/* ------------------------------------------------------------ public state */

export interface Conflict {
  id: string;
  at: number;
  identifier: string;
  shown: Scan["result"];
  recorded: Scan["result"] | null;
  alerts: number;
  /** Refused by the server (never counted, or not yet), or an undo it would not take, with its message. */
  refused: string | null;
}

/** Scans another staff member's earlier shift left on this device (01 §8, A1). */
export interface EarlierShift {
  /** Still to send. */
  waiting: number;
  /** Refused for now (not on shift at that gate, or outside the shift): kept, tried again by the next signer. */
  held: number;
  /** Counted by the server under that shift after it had ended (`late_synced`). */
  sentLate: number;
  /** The signed-in staff member can send the waiting ones (on shift at their gate). */
  canSend: boolean;
}

export interface ApiState {
  ready: boolean;
  session: { sub: string; email: string | null } | null;
  event: { id: string; title: string } | null;
  gates: Gate[];
  roomNames: Record<string, string>;
  gatesLoading: boolean;
  gatesError: string | null;
  stream: StreamState;
  ed25519: boolean | null;
  allowlistError: string | null;
  conflicts: Conflict[];
  earlier: EarlierShift;
}

let api: ApiState = {
  ready: false,
  session: null,
  event: null,
  gates: [],
  roomNames: {},
  gatesLoading: false,
  gatesError: null,
  stream: "idle",
  ed25519: null,
  allowlistError: null,
  conflicts: [],
  earlier: { waiting: 0, held: 0, sentLate: 0, canSend: false },
};
const apiListeners = new Set<() => void>();
function setApi(p: Partial<ApiState>) {
  api = { ...api, ...p };
  for (const l of apiListeners) l();
}
export function subscribeApi(l: () => void): () => void {
  apiListeners.add(l);
  return () => apiListeners.delete(l);
}
export function getApi(): ApiState {
  return api;
}

/* ------------------------------------------------------------ helpers */

const shortUid = (uid: string) => (uid.length > 8 ? `${uid.slice(0, 4)}…${uid.slice(-4)}` : uid);

/** 32 hex characters from the CSPRNG (works outside a secure context, unlike randomUUID). */
export function newIdemKey(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

const DEVICE_KEY = "syn.scanner.device.v1";
function readDeviceLs(): string | null {
  try {
    return localStorage.getItem(DEVICE_KEY);
  } catch {
    return null;
  }
}
function writeDeviceLs(id: string) {
  try {
    localStorage.setItem(DEVICE_KEY, id);
  } catch {
    /* storage blocked: IndexedDB keeps it */
  }
}

const hhmm = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });

function failureMessage(e: unknown): string {
  if (e instanceof ApiFailure) return e.kind === "network" ? "No connection to the server. Try again when the link is back." : e.message;
  return "Something went wrong. Try again.";
}

/* ------------------------------------------------------------ cached shapes */

interface GateCache {
  user: string;
  event: { id: string; title: string } | null;
  roomNames: Record<string, string>;
  gates: Gate[];
}
interface AllowlistCache {
  event_id: string;
  checkpoint_id: string;
  kid: string;
  jws: string;
  fetched_at: number;
  /** Who fetched it (session `sub`); absent on lists stored before it was recorded. */
  user?: string | null;
}
interface KeysCache {
  keys: SigningKey[];
  fetched_at: number;
  qr_leeway_s?: number;
  undo_window_s?: number;
}
interface ClockCache {
  offset: number;
  at: number;
  qr_leeway_s?: number;
  undo_window_s?: number;
}

interface Trusted {
  idx: AllowlistIndex;
  eventId: string;
  checkpointId: string;
  issuedAtMs: number;
  fetchedAt: number;
  /** The signed-in person it was fetched for; null when not known. */
  user: string | null;
}

/**
 * `allowlist_issued_at` for a heartbeat from this gate: the held list's `issued_at` only when it is
 * this gate's and was fetched for the person signed in now. After a user switch on the same phone the
 * previous person's list is still trusted for offline decisions, but gate health must not show its
 * age as the new person's: null until the new person's own list has been fetched.
 */
/** `allowlistError` while the held list is past its signed window. */
export const ALLOWLIST_ENDED = "allowlist past its validity window";

/**
 * The verified list this gate may decide with offline at `correctedNow` (server time): the held list
 * when it is this event's and this gate's and inside its signed window, else null, so an offline
 * read resolves as unknown and is refused (fail closed, 03 §4). `ended`: the held list is past its
 * window (docs/03 §4 and 01 §8 do not name this case; a list nobody vouches for is no list).
 */
export function offlineAllowlist(
  allow: Pick<Trusted, "idx" | "eventId" | "checkpointId"> | null,
  eventId: string,
  checkpointId: string,
  correctedNow: number,
): { idx: AllowlistIndex | null; ended: boolean } {
  if (!allow || allow.eventId !== eventId || allow.checkpointId !== checkpointId) return { idx: null, ended: false };
  const where = allowlistWindow(allow.idx.payload, correctedNow);
  return { idx: where === "inside" ? allow.idx : null, ended: where === "ended" };
}

export function heartbeatAllowlistAt(allow: Pick<Trusted, "checkpointId" | "issuedAtMs" | "user"> | null, checkpointId: string, user: string | null): string | null {
  if (!allow || allow.checkpointId !== checkpointId || !user || allow.user !== user) return null;
  return new Date(allow.issuedAtMs).toISOString();
}

/**
 * GET /me/assignments → the gates this person may choose: one row per checkpoint (the current shift,
 * else the next one). Each item carries its checkpoint and event; a shift between events (no event)
 * has nothing to scan for and is left out. Handed-over and ended shifts are not listed by the server.
 *
 * `roomNames` (the ADMITTED chips): each item's `event.rooms` and its gate's own room, so the chips
 * need no public event read and work for unlisted events too. `slugsWithoutRooms`: events whose items
 * carry no `rooms` (an older server); their names are read from GET /events/:slug instead.
 */
export function gatesFromAssignments(
  items: readonly StaffAssignment[],
  nowServerMs: number,
): { gates: Gate[]; event: { id: string; title: string } | null; roomNames: Record<string, string>; slugsWithoutRooms: string[] } {
  const roomNames: Record<string, string> = {};
  const slugsWithoutRooms = new Set<string>();
  for (const a of items) {
    if (!a.event_id || !a.event || a.event.id !== a.event_id) continue;
    if (a.event.rooms) for (const r of a.event.rooms) roomNames[r.room_id] = r.name;
    else if (a.event.slug) slugsWithoutRooms.add(a.event.slug);
  }
  const live = (a: StaffAssignment) => Date.parse(a.shift_start) <= nowServerMs && nowServerMs < Date.parse(a.shift_end);
  const byCp = new Map<string, StaffAssignment>();
  for (const a of [...items].sort((x, y) => Date.parse(x.shift_start) - Date.parse(y.shift_start))) {
    if (!a.checkpoint || !a.event_id || a.handed_over_at || Date.parse(a.shift_end) <= nowServerMs) continue;
    const prev = byCp.get(a.checkpoint_id);
    if (!prev || (live(a) && !live(prev))) byCp.set(a.checkpoint_id, a);
  }
  const gates: Gate[] = [];
  for (const a of byCp.values()) {
    const cp = a.checkpoint!;
    if (cp.room_id && cp.room_name) roomNames[cp.room_id] = cp.room_name;
    const ev = { id: a.event_id!, title: a.event && a.event.id === a.event_id ? a.event.title : "" };
    gates.push({
      id: cp.id,
      label: cp.label,
      perimeter: cp.perimeter,
      roomId: cp.room_id,
      roomName: cp.room_name,
      shift: { starts: "", ends: "", now: false },
      api: {
        eventId: ev.id,
        eventTitle: ev.title,
        zoneId: cp.zone_id,
        direction: cp.direction,
        assignmentId: a.id,
        shiftStart: Date.parse(a.shift_start),
        shiftEnd: Date.parse(a.shift_end),
      },
    });
  }
  // The event named on S1: the one of the shift on now, else of the next shift.
  const pick = gates.find((g) => g.api!.shiftStart <= nowServerMs) ?? gates[0];
  return { gates, event: pick ? { id: pick.api!.eventId, title: pick.api!.eventTitle } : null, roomNames, slugsWithoutRooms: [...slugsWithoutRooms] };
}

/* ------------------------------------------------------------ runtime */

class Runtime {
  private host!: Host;
  private idb: Idb | null = null;
  private queue: ScanQueue | null = null;
  private records: QueueRecord[] = [];
  private keys: TrustedKey[] = [];
  private keysFetchedAt = 0;
  private allow: Trusted | null = null;
  private offset = 0;
  /** The server's QR clock leeway (GET /time, GET /auth/signing-keys). */
  private leewayS = DEFAULT_QR_LEEWAY_S;
  /** The server's undo window (`undo_window_s` on GET /time and GET /auth/signing-keys), seconds; null until it has said (60 s). */
  private undoWindowS: number | null = null;
  private get undoMs(): number {
    return undoWindowMs(this.undoWindowS);
  }
  /** Read `undo_window_s` from a server answer or a cache; what Undo offers changes with it. */
  private setUndoWindow(s: number | undefined) {
    if (typeof s !== "number" || s === this.undoWindowS) return;
    this.undoWindowS = s;
    if (this.host) this.publish();
  }
  private stream: ScanStream | null = null;
  private timers: ReturnType<typeof setInterval>[] = [];
  private probe: ReturnType<typeof setTimeout> | null = null;
  private probeAttempt = 0;
  private channel: BroadcastChannel | null = null;
  private syncing: Promise<void> | null = null;
  private deviceIdValue: string | null = null;
  /**
   * Stable id of this scanner install, the same on POST /scans and both heartbeats, for every user
   * who signs in on it: the server lets the next staff member at a gate sync a queue only from the
   * install it was made on. Kept in localStorage and IndexedDB.
   */
  private get device(): string {
    if (!this.deviceIdValue) {
      this.deviceIdValue = readDeviceLs() ?? `scanner-${newIdemKey()}`;
      writeDeviceLs(this.deviceIdValue);
    }
    return this.deviceIdValue;
  }
  private initDone: Promise<void> | null = null;

  /** Called once by data/store.ts. */
  connect(host: Host) {
    this.host = host;
    this.initDone ??= this.init();
  }

  whenReady() {
    return this.initDone ?? Promise.resolve();
  }

  private async init() {
    const s = currentSession();
    setApi({ session: s ? { sub: s.sub, email: s.email } : null });
    onSession((next) => {
      setApi({ session: next ? { sub: next.sub, email: next.email } : null });
      void this.reloadRecords();
    });
    void ed25519Supported().then((ok) => setApi({ ed25519: ok }));
    try {
      this.idb = await Idb.open();
      this.queue = new ScanQueue(this.idb);
      await this.restoreDevice(this.idb);
      await this.queue.prune(Date.now(), 24 * 3600_000, 2000);
      const clock = await this.idb.get<ClockCache>(KV, "clock");
      if (clock) {
        this.setOffset(clock.offset);
        if (typeof clock.qr_leeway_s === "number") this.leewayS = clock.qr_leeway_s;
        this.setUndoWindow(clock.undo_window_s);
      }
      const gates = await this.idb.get<GateCache>(KV, "gates");
      if (gates && gates.user === s?.sub) setApi({ event: gates.event, gates: this.refreshShift(gates.gates), roomNames: gates.roomNames });
      await this.loadKeysFromCache();
      await this.loadAllowlistFromCache();
      await this.reloadRecords();
    } catch (e) {
      console.warn("[scanner] local storage unavailable", e);
    }
    if (typeof BroadcastChannel !== "undefined") {
      this.channel = new BroadcastChannel("synan-scanner");
      this.channel.onmessage = (e) => {
        if ((e.data as { type?: string })?.type === "changed") void this.reloadRecords();
        if ((e.data as { type?: string })?.type === "allowlist") void this.loadAllowlistFromCache();
      };
    }
    window.addEventListener("online", () => this.probeNow());
    window.addEventListener("offline", () => this.host.patch({}));
    // Shift windows move with the clock; the pair screen re-reads them.
    this.timers.push(
      setInterval(() => {
        setApi({ gates: this.refreshShift(api.gates) });
        this.publish();
      }, 30_000),
    );
    this.timers.push(setInterval(() => void this.tick(), 15_000));
    this.timers.push(setInterval(() => void this.restHeartbeat(), REST_HEARTBEAT_MS));
    setApi({ ready: true });
    await this.probeOnce();
    if (this.linkUp() && api.session) void this.loadGates();
    const gate = this.currentGate();
    if (gate) this.startGate(gate);
  }

  /** The device id survives a cleared localStorage (IndexedDB copy), and the other way round. */
  private async restoreDevice(idb: Idb) {
    const stored = await idb.get<string>(KV, "device");
    const ls = readDeviceLs();
    if (ls) {
      this.deviceIdValue = ls;
      if (stored !== ls) await idb.put(KV, ls, "device");
    } else if (stored) {
      this.deviceIdValue = stored;
      writeDeviceLs(stored);
    } else {
      await idb.put(KV, this.device, "device");
    }
  }

  /* ---------------------------------------------------------- link */

  linkUp(): boolean {
    const h = this.host.get();
    return (typeof navigator === "undefined" || navigator.onLine) && !h.forceOffline && h.apiReachable;
  }

  private setReachable(up: boolean) {
    const was = this.host.get().apiReachable;
    if (was !== up) {
      this.host.patch({ apiReachable: up });
      this.publish(); // what Undo can offer depends on the link
    }
    if (!up) this.scheduleProbe();
    else {
      this.probeAttempt = 0;
      if (!was) void this.onLinkUp();
    }
  }

  private scheduleProbe() {
    if (this.probe) return;
    const wait = Math.min(30_000, 2000 * 2 ** Math.min(this.probeAttempt, 4)) * (0.5 + Math.random() / 2);
    this.probeAttempt++;
    this.probe = setTimeout(() => {
      this.probe = null;
      void this.probeOnce();
    }, wait);
  }

  private probeNow() {
    if (this.probe) clearTimeout(this.probe);
    this.probe = null;
    void this.probeOnce();
  }

  /** GET /time: a reachability probe that also measures the clock offset (D-14) and reads the QR leeway. */
  private async probeOnce(): Promise<boolean> {
    if (this.host.get().forceOffline) return false;
    try {
      const t0 = Date.now();
      const r = await call("time", {}, { auth: false, timeoutMs: 5000 });
      const t1 = Date.now();
      this.setOffset(r.epoch_ms - (t0 + t1) / 2);
      if (typeof r.qr_leeway_s === "number") this.leewayS = r.qr_leeway_s;
      this.setUndoWindow(r.undo_window_s);
      void this.idb?.put(KV, { offset: this.offset, at: t1, qr_leeway_s: this.leewayS, undo_window_s: this.undoWindowS ?? undefined } satisfies ClockCache, "clock");
      this.setReachable(true);
      return true;
    } catch {
      this.setReachable(false);
      return false;
    }
  }

  private setOffset(ms: number) {
    this.offset = ms;
    this.host.patch({ clockOffsetMs: Math.round(ms) });
  }

  private async onLinkUp() {
    if (!api.session) return;
    if (api.gates.length === 0) void this.loadGates();
    await this.syncNow().catch(() => undefined);
    const gate = this.currentGate();
    if (gate && (!this.allow || Date.now() - this.allow.fetchedAt > ALLOWLIST_REFRESH_MS / 2)) void this.refreshAllowlist(gate).catch(() => undefined);
    this.stream?.kick();
    void this.restHeartbeat();
  }

  /** Dev flag ?offline=1|0. */
  forceOffline(on: boolean) {
    this.publish();
    if (on) {
      this.stream?.stop();
    } else {
      const gate = this.currentGate();
      if (gate) this.startGate(gate);
      this.probeNow();
    }
  }

  /** Every 15 s: drain what is due, settle undos, refresh what is old. */
  private async tick() {
    // Offline too: a list that has passed its window shows as no list (decisions check it anyway).
    this.checkWindow();
    if (!this.linkUp()) return;
    const gate = this.currentGate();
    const signer = this.signer();
    const now = Date.now();
    if (signer && this.records.some((r) => due(r, signer, now))) await this.syncNow().catch(() => undefined);
    else await this.settleUndos();
    if (gate && (!this.allow || Date.now() - this.allow.fetchedAt > ALLOWLIST_REFRESH_MS)) await this.refreshAllowlist(gate).catch(() => undefined);
    if (Date.now() - this.clockAt > CLOCK_REFRESH_MS) {
      this.clockAt = Date.now();
      await this.probeOnce();
    }
  }
  private clockAt = Date.now();

  /* ---------------------------------------------------------- session and gates */

  async signIn(email: string, password: string): Promise<void> {
    const s = await clientSignIn(email, password);
    setApi({ session: { sub: s.sub, email: s.email } });
    // The held list was issued for the previous shift's window: still trusted offline, refetched now.
    if (this.allow) this.allow = { ...this.allow, fetchedAt: 0 };
    this.setReachable(true);
    await this.loadGates();
  }

  /**
   * Sign out. The device lets go of the gate, but every scan not yet sent stays on it: the same
   * person can send it when they sign in again, and the next staff member on shift at that gate can
   * send it from this device (it names its assignment).
   */
  async signOut(): Promise<void> {
    this.stopGate();
    this.host.patch({ gateId: null });
    await clientSignOut();
    setApi({ session: null, gates: [], event: null, roomNames: {} });
    await this.idb?.put(KV, null, "gates");
    this.publish();
  }

  /** The signed-in person and the gates they are on shift at now (server time). */
  private signer(): Signer | null {
    const s = currentSession();
    if (!s) return null;
    const now = Date.now() + this.offset;
    const onShift = new Map<string, string>();
    for (const g of api.gates) if (g.api && g.api.shiftStart <= now && now < g.api.shiftEnd) onShift.set(g.id, g.api.assignmentId);
    return { user: s.sub, onShift };
  }

  /** GET /me/assignments: each item names its gate and event, so pairing needs nothing else. */
  async loadGates(): Promise<void> {
    const s = currentSession();
    if (!s) return;
    setApi({ gatesLoading: true, gatesError: null });
    try {
      const res = await call("myAssignments");
      const { gates, event, roomNames: named, slugsWithoutRooms } = gatesFromAssignments(res.items, Date.now() + this.offset);
      const roomNames: Record<string, string> = { ...(api.session?.sub === s.sub ? api.roomNames : {}), ...named };
      const fresh = this.refreshShift(gates);
      setApi({ gates: fresh, event, roomNames, gatesLoading: false, gatesError: res.items.length > 0 && gates.length === 0 ? "No live event for your gates." : null });
      await this.idb?.put(KV, { user: s.sub, event, roomNames, gates: fresh } satisfies GateCache, "gates");
      this.publish();
      void this.loadRoomNames(slugsWithoutRooms);
      // Scans this person (or an earlier shift at these gates) left queued on the device.
      if (this.linkUp()) void this.syncNow().catch(() => undefined);
    } catch (e) {
      setApi({ gatesLoading: false, gatesError: failureMessage(e) });
      if (e instanceof ApiFailure && e.ambiguous) this.setReachable(false);
    }
  }

  /**
   * Names for the ADMITTED room chips (ids come from the outcome or the allowlist) come with each
   * assignment (`event.rooms`). Only for an event whose items carry no rooms (an older server) are
   * they read from GET /events/:slug, by the slug the assignment names (unlisted events resolve by
   * slug too). Best effort: pairing and verdicts never wait on it; without it the chips are left out.
   */
  private async loadRoomNames(slugs: string[]) {
    if (slugs.length === 0) return;
    try {
      const names: Record<string, string> = {};
      for (const slug of slugs) {
        const d = await call("getEvent", { params: { slug } }, { auth: false });
        for (const r of d.rooms) names[r.room_id] = r.name;
      }
      if (Object.keys(names).length === 0) return;
      const roomNames = { ...api.roomNames, ...names };
      setApi({ roomNames });
      const s = currentSession();
      if (s) await this.idb?.put(KV, { user: s.sub, event: api.event, roomNames, gates: api.gates } satisfies GateCache, "gates");
    } catch {
      /* chips stay unnamed */
    }
  }

  private refreshShift(gates: Gate[]): Gate[] {
    const now = Date.now() + this.offset;
    return gates.map((g) =>
      g.api
        ? { ...g, shift: { starts: hhmm(g.api.shiftStart - this.offset), ends: hhmm(g.api.shiftEnd - this.offset), now: g.api.shiftStart <= now && now < g.api.shiftEnd } }
        : g,
    );
  }

  gateById(id: string | null): Gate | null {
    return api.gates.find((g) => g.id === id) ?? null;
  }

  private currentGate(): Gate | null {
    return this.gateById(this.host.get().gateId);
  }

  /** S1: a gate was chosen. */
  pair(gate: Gate) {
    this.startGate(gate);
  }

  private startGate(gate: Gate) {
    if (!gate.api) return;
    const { eventId } = gate.api;
    if (this.stream && this.streamFor === gate.id) {
      this.stream.start();
    } else {
      this.stream?.stop();
      this.streamFor = gate.id;
      this.stream = new ScanStream({
        eventId,
        checkpointId: gate.id,
        heartbeat: () => this.heartbeatBody(gate.id),
        onState: (st) => setApi({ stream: st }),
        onAlive: () => {
          if (!this.host.get().apiReachable) this.setReachable(true);
        },
      });
      if (!this.host.get().forceOffline) this.stream.start();
    }
    // Also refetched when the held list was fetched for someone else (a user switch on this phone).
    const fetchedForOther = this.allow !== null && this.allow.user !== (currentSession()?.sub ?? null);
    if (!this.allow || this.allow.checkpointId !== gate.id || this.allow.fetchedAt === 0 || fetchedForOther) void this.refreshAllowlist(gate).catch(() => undefined);
    void this.restHeartbeat();
  }
  private streamFor: string | null = null;

  private stopGate() {
    this.stream?.stop();
    this.stream = null;
    this.streamFor = null;
  }

  /**
   * Shift end (docs/06 §3.1): send what can be sent, then hand the shift over on the server. Resolves
   * with the server's summary of the shift (its `undone` count included), or null when the handover
   * could not be made (offline, refused).
   */
  async endShift(gate: Gate | null): Promise<HandoverSummary | null> {
    this.stopGate();
    if (gate?.api && this.linkUp()) {
      await this.syncNow().catch(() => undefined);
      return call("handover", { params: { id: gate.api.assignmentId } }).catch(() => null);
    }
    return null;
  }

  /* ---------------------------------------------------------- heartbeat */

  private depth(): number {
    return this.records.filter(unsent).length;
  }

  /**
   * `issued_at` of the trusted allowlist for this gate, for gate health and stale alerts: null when
   * none is held, or when the one held was fetched for the previous user of this phone.
   */
  private allowlistIssuedAt(checkpointId: string): string | null {
    return heartbeatAllowlistAt(this.allow, checkpointId, currentSession()?.sub ?? null);
  }

  /** One heartbeat body for both channels: same device id, queue depth, offset, allowlist age. */
  private heartbeatBody(checkpointId: string) {
    return {
      queue_depth: this.depth(),
      clock_offset_ms: Math.round(this.offset),
      online: this.linkUp(),
      device_id: this.device,
      allowlist_issued_at: this.allowlistIssuedAt(checkpointId),
    };
  }

  private async restHeartbeat() {
    const gate = this.currentGate();
    if (!gate?.api || !this.linkUp() || !api.session) return;
    if (this.stream?.state === "open") return; // the stream carries it
    try {
      await call("gateHeartbeat", { body: { checkpoint_id: gate.id, ...this.heartbeatBody(gate.id), online: true } });
    } catch (e) {
      if (e instanceof ApiFailure && e.ambiguous) this.setReachable(false);
    }
  }

  /* ---------------------------------------------------------- keys and allowlist */

  private async loadKeysFromCache() {
    const c = await this.idb?.get<KeysCache>(KV, "keys");
    if (c) {
      this.keys = await importKeys(c.keys);
      this.keysFetchedAt = c.fetched_at;
      if (typeof c.qr_leeway_s === "number") this.leewayS = c.qr_leeway_s;
      // GET /time (read later, and kept in "clock") is the fresher source; this only fills a gap.
      if (this.undoWindowS === null) this.setUndoWindow(c.undo_window_s);
    }
  }

  private async fetchKeys() {
    const r = await call("signingKeys", {}, { auth: false });
    this.keys = await importKeys(r.keys);
    this.keysFetchedAt = Date.now();
    if (typeof r.qr_leeway_s === "number") this.leewayS = r.qr_leeway_s;
    this.setUndoWindow(r.undo_window_s);
    await this.idb?.put(KV, { keys: r.keys, fetched_at: this.keysFetchedAt, qr_leeway_s: this.leewayS, undo_window_s: this.undoWindowS ?? undefined } satisfies KeysCache, "keys");
  }

  private async loadAllowlistFromCache() {
    const c = await this.idb?.get<AllowlistCache>(KV, "allowlist");
    if (!c) return;
    try {
      // Re-verified on every load: what sits in storage is trusted only as far as its signature.
      const payload = await verifyAllowlistJws(c.jws, c.kid, this.keys, Date.now() + this.offset);
      if (payload.event_id !== c.event_id || payload.checkpoint_id !== c.checkpoint_id) throw new AllowlistRejected("scope");
      this.trust(payload, c);
    } catch (e) {
      this.allow = null;
      this.host.patch({ allowlistAt: null });
      setApi({ allowlistError: e instanceof Error ? e.message : "allowlist" });
    }
  }

  private trust(payload: AllowlistIndex["payload"], c: AllowlistCache) {
    const issuedAtMs = Date.parse(payload.issued_at);
    this.allow = { idx: indexAllowlist(payload), eventId: payload.event_id, checkpointId: c.checkpoint_id, issuedAtMs, fetchedAt: c.fetched_at, user: c.user ?? null };
    // Pass-list age on S4 is shown in device time.
    this.host.patch({ allowlistAt: issuedAtMs - this.offset });
    setApi({ allowlistError: null });
    this.checkWindow();
  }

  /**
   * A held list past its signed window decides nothing offline (`offlineAllowlist`); the screens then
   * show the no-list state, not its age, so S4 does not say known passes are still let in.
   */
  private checkWindow() {
    const a = this.allow;
    if (!a || allowlistWindow(a.idx.payload, Date.now() + this.offset) !== "ended") return;
    if (this.host.get().allowlistAt !== null) this.host.patch({ allowlistAt: null });
    if (getApi().allowlistError !== ALLOWLIST_ENDED) setApi({ allowlistError: ALLOWLIST_ENDED });
  }

  /** GET /events/:id/allowlist for this gate, verified with an `allowlist` key before it is stored or used. */
  async refreshAllowlist(gate: Gate): Promise<void> {
    if (!gate.api || !this.linkUp()) return;
    if (!(await ed25519Supported())) {
      setApi({ allowlistError: "Ed25519 not supported by this browser" });
      return;
    }
    if (this.keys.length === 0 || Date.now() - this.keysFetchedAt > 3600_000) await this.fetchKeys();
    // Who the list is fetched for, before the request goes (a sign-out or switch meanwhile does not take it over).
    const fetchedFor = currentSession()?.sub ?? null;
    let signed: SignedAllowlist;
    try {
      signed = await call("allowlist", { params: { id: gate.api.eventId }, query: { checkpoint_id: gate.id } });
    } catch (e) {
      if (e instanceof ApiFailure && e.ambiguous) this.setReachable(false);
      setApi({ allowlistError: failureMessage(e) });
      throw e;
    }
    const verify = () => verifyAllowlistJws(signed.jws, signed.kid, this.keys, Date.now() + this.offset);
    let payload;
    try {
      payload = await verify();
    } catch (e) {
      // A key rotated since we last fetched: refetch once, then decide.
      if (!(e instanceof AllowlistRejected && e.why === "unknown key")) throw this.rejectList(e);
      await this.fetchKeys();
      payload = await verify().catch((x: unknown) => {
        throw this.rejectList(x);
      });
    }
    if (payload.event_id !== gate.api.eventId || payload.checkpoint_id !== gate.id) throw this.rejectList(new AllowlistRejected("scope"));
    const cache: AllowlistCache = { event_id: payload.event_id, checkpoint_id: gate.id, kid: signed.kid, jws: signed.jws, fetched_at: Date.now(), user: fetchedFor };
    await this.idb?.put(KV, cache, "allowlist");
    this.trust(payload, cache);
    this.channel?.postMessage({ type: "allowlist" });
    // Gate health shows the list's age at once.
    if (this.stream?.state === "open") this.stream.heartbeatNow();
    else void this.restHeartbeat();
  }

  private rejectList(e: unknown) {
    const why = e instanceof Error ? e.message : "allowlist rejected";
    setApi({ allowlistError: why });
    console.warn(`[scanner] ${why}`);
    return e;
  }

  /* ---------------------------------------------------------- records */

  private async reloadRecords() {
    if (!this.queue) return;
    this.records = await this.queue.all();
    this.publish();
  }

  private toScan(r: QueueRecord, signer: Signer | null): Scan {
    const o = r.outcome;
    const undoNote =
      r.undo?.state === "refused"
        ? `Undo not recorded: ${r.undo.message ?? "the server refused it."}`
        : r.undo?.state === "requested"
          ? "Undo is sent when the link is back."
          : null;
    return {
      id: r.idem_key,
      at: r.at,
      gateId: r.checkpoint.id,
      result: resultOf(r),
      medium: r.display.medium,
      identifier: r.display.identifier,
      name: null,
      tier: o?.tier ?? r.display.tier,
      // Online: the rooms the server names (perimeter) or the gate's own room; offline: the allowlist's.
      rooms: o?.permitted_room_ids ?? (o?.room_id ? [o.room_id] : r.display.rooms),
      // `last_in_at` is server time; shown against `at`, in device time.
      lastInAt: o?.last_in_at ? Date.parse(o.last_in_at) - r.offline.clock_offset_ms : r.display.lastInAt,
      offline: r.decided_by === "local",
      synced: !unsent(r),
      undone: r.undone,
      credential: r.credential_key,
      refused: r.state === "rejected" || r.state === "held" ? (r.rejection?.message ?? "Refused by the server.") : null,
      // A scan the server has (or may have) is undone there, so only while the link is up.
      undoUntil: r.state === "pending" && r.online === null ? undoUntil(r, signer, this.undoMs) : this.linkUp() ? undoUntil(r, signer, this.undoMs) : null,
      undoNote,
      heldBack: r.state === "withheld",
      lateSynced: o?.late_synced === true,
      earlierShift: Boolean(signer && r.user !== signer.user),
    };
  }

  private publish() {
    const signer = this.signer();
    const sorted = [...this.records].sort((a, b) => b.at - a.at);
    const waiting = sorted.filter(unsent);
    const rest = sorted.filter((r) => !unsent(r)).slice(0, 300);
    const scans = [...waiting, ...rest].sort((a, b) => b.at - a.at).map((r) => this.toScan(r, signer));
    const sent = this.records.filter((r) => r.synced_at !== null);
    const lastSyncAt = sent.reduce<number | null>((m, r) => (m === null || r.synced_at! > m ? r.synced_at : m), this.host.get().lastSyncAt);
    this.host.patch({ scans, lastSyncAt });
    const others = this.records.filter((r) => r.user !== signer?.user);
    setApi({
      conflicts: sorted
        .filter(isConflict)
        .slice(0, 50)
        .map((r) => ({
          id: r.idem_key,
          at: r.at,
          identifier: r.display.identifier,
          shown: r.shown,
          recorded: r.outcome?.result ?? null,
          alerts: r.outcome?.alert_ids.length ?? 0,
          refused:
            r.state === "held"
              ? `${r.rejection?.message ?? "Refused for now."} Kept on this device; it is tried again when someone on shift at this gate signs in.`
              : r.state === "rejected"
                ? (r.rejection?.message ?? "Refused by the server.")
                : r.undo?.state === "refused"
                  ? `Undo not recorded: ${r.undo.message ?? "the server refused it."}`
                  : null,
        })),
      earlier: {
        waiting: others.filter((r) => r.state === "pending").length,
        held: others.filter((r) => r.state === "held").length,
        sentLate: others.filter((r) => r.outcome?.late_synced).length,
        canSend: Boolean(signer && others.some((r) => r.state === "pending" && canSend(r, signer))),
      },
    });
    this.stream?.heartbeatNow();
  }

  private changed() {
    this.channel?.postMessage({ type: "changed" });
  }

  /* ---------------------------------------------------------- decide */

  private allowFor(eventId: string, checkpointId: string, correctedNow: number): AllowlistIndex | null {
    const { idx, ended } = offlineAllowlist(this.allow, eventId, checkpointId, correctedNow);
    if (ended) this.checkWindow();
    return idx;
  }

  private async resolve(p: Presented, gate: Gate, correctedNow: number): Promise<{ r: Resolution; identifier: string }> {
    const idx = this.allowFor(gate.api!.eventId, gate.id, correctedNow);
    const trustedCrypto = await ed25519Supported();
    if (p.medium === "qr") {
      const q = parseSignedQr(p.data);
      if (!q) return { r: { known: false, credentialKey: null }, identifier: "Not a pass" };
      const identifier = q.kind === "email" ? "Emailed code" : "App pass";
      const unknown = { r: { known: false, credentialKey: q.ref } as Resolution, identifier };
      if (!idx || !trustedCrypto) return unknown;
      const check = await verifyQr(q, this.keys, correctedNow, this.leewayS);
      if (!check.ok) return unknown;
      const entry = idx.byCredential.get(q.ref);
      if (!entry) return unknown;
      const email = q.kind === "email";
      return {
        r: {
          known: true,
          credentialKey: entry.credential_hash,
          carrier: email ? "qr_email" : "qr_portal",
          entry,
          deadBand: false,
          emailCid: email ? q.cid : null,
          emailHash: email ? await emailCidHash(q.cid) : null,
        },
        identifier,
      };
    }
    const identifier = shortUid(p.uid);
    let h: string;
    try {
      h = await nfcHash(p.uid);
    } catch {
      return { r: { known: false, credentialKey: null }, identifier };
    }
    if (idx && trustedCrypto) {
      const live = idx.byNfc.get(h);
      if (live) return { r: { known: true, credentialKey: live.credential_hash, carrier: "nfc", entry: live, deadBand: false, emailCid: null }, identifier };
      const dead = idx.byDeadNfc.get(h);
      if (dead) return { r: { known: true, credentialKey: dead.credential_hash, carrier: "nfc", entry: dead, deadBand: true, emailCid: null }, identifier };
    }
    return { r: { known: false, credentialKey: h }, identifier };
  }

  /**
   * Decide one read. The record is in IndexedDB before anything is shown. Link up: the server
   * decides (2.5 s budget); otherwise, or when that fails, the local decision stands, tagged LOCAL.
   */
  async decide(presented: Presented, gate: Gate): Promise<Scan> {
    await this.whenReady();
    if (!gate.api || !this.queue) throw new Error("gate not ready");
    const s = currentSession();
    const user = s?.sub ?? api.session?.sub ?? "unknown";
    const now = Date.now();
    const offset = Math.round(this.offset);
    const corrected = now + offset;
    const direction: ScanDirection = gate.api.direction === "both" ? "in" : gate.api.direction;
    const cp: LocalCheckpoint = { id: gate.id, perimeter: gate.perimeter, zoneId: gate.api.zoneId, roomId: gate.roomId };
    const { r, identifier } = await this.resolve(presented, gate, corrected);
    const spent = new Set(
      this.records
        .filter((x) => x.email_cid && x.state !== "rejected" && x.direction === "in" && !x.undone && (resultOf(x) === "admitted" || resultOf(x) === "already_inside"))
        .map((x) => x.email_cid!),
    );
    const local = decideLocally({ resolution: r, medium: presented.medium, checkpoint: cp, direction, nowMs: corrected, history: historyOf(this.records), spentEmailCids: spent });

    const idem = newIdemKey();
    const base: Omit<ScanSubmission, "offline" | "local_result"> = {
      idem_key: idem,
      checkpoint_id: gate.id,
      presented: presented.medium === "qr" ? { medium: "qr", data: presented.data } : { medium: "nfc", uid: presented.uid },
      ...(gate.api.direction === "both" ? { direction } : {}),
      occurred_at: new Date(now).toISOString(),
      clock_offset_ms: offset,
    };
    const online = this.linkUp() && Boolean(s);
    const record: QueueRecord = {
      idem_key: idem,
      at: now,
      user,
      assignment_id: gate.api.assignmentId,
      event_id: gate.api.eventId,
      device_id: this.device,
      // The queued form names the assignment, so it still counts after a sign-out or handover (A1).
      offline: { ...base, offline: true, local_result: local.result, assignment_id: gate.api.assignmentId },
      online: online ? { ...base, offline: false } : null,
      send_as: "offline",
      state: "pending",
      inflight_until: online ? now + ONLINE_VERDICT_TIMEOUT_MS + 10_000 : 0,
      next_at: 0,
      attempts: 0,
      decided_by: "local",
      shown: local.result,
      outcome: null,
      rejection: null,
      synced_at: null,
      credential_key: r.credentialKey,
      checkpoint: cp,
      direction,
      email_cid: r.known ? r.emailCid : null,
      undone: false,
      undo: null,
      display: {
        medium: presented.medium,
        identifier,
        tier: r.known ? r.entry.tier : null,
        // Offline chips: at a perimeter gate the event rooms the pass may enter; inside, the gate's room.
        rooms: r.known ? (gate.perimeter ? (r.entry.perimeter_room_ids ?? r.entry.permitted_room_ids) : r.entry.permitted_room_ids) : [],
        lastInAt: local.lastInAtMs !== null ? local.lastInAtMs - offset : null,
      },
    };
    // Durable first: a crash after this line cannot lose the scan.
    await this.queue.add(record);
    this.records.push(record);

    if (online) {
      try {
        const res = await call("postScans", { body: { event_id: record.event_id, device_id: this.device, scans: [record.online!] } }, { timeoutMs: ONLINE_VERDICT_TIMEOUT_MS });
        const o = res.results.find((x) => x.idem_key === idem);
        const j = res.rejected?.find((x) => x.idem_key === idem);
        let next: QueueRecord | undefined;
        if (o) {
          next = await this.queue.update(idem, (x) => ({ ...x, state: "sent", outcome: o, decided_by: "server", shown: o.result, synced_at: Date.now(), inflight_until: 0 }));
        } else if (j && j.code !== "RATE_LIMITED" && j.code !== "IDEMPOTENCY_CONFLICT") {
          next = await this.queue.update(idem, (x) => ({ ...x, state: "rejected", rejection: { code: j.code, message: j.message }, inflight_until: 0 }));
        } else {
          next = await this.queue.release(idem); // rate-limited: stays queued, sent unchanged later
        }
        this.setReachable(true);
        this.replace(next ?? record);
      } catch (e) {
        if (e instanceof ApiFailure && e.ambiguous) this.setReachable(false);
        this.replace((await this.queue.release(idem)) ?? record);
      }
    } else {
      this.replace(record);
    }
    this.changed();
    return this.toScan(this.records.find((x) => x.idem_key === idem)!, this.signer());
  }

  private replace(r: QueueRecord) {
    const i = this.records.findIndex((x) => x.idem_key === r.idem_key);
    if (i >= 0) this.records[i] = r;
    else this.records.push(r);
    this.publish();
  }

  /* ---------------------------------------------------------- undo (S3) */

  /**
   * Undo a mistaken admission. Offered only while it can succeed (`undoUntil`). A scan that never
   * left the device is withheld: never sent, which is what the server's own undo amounts to (the
   * holder reads as if the scan had not happened), and the record stays here marked undone. A scan
   * the server has, or may have (an online attempt in flight), is undone on the server with
   * POST /scans/:id/undo — at once when sent, else right after it syncs. Rejects when it could not be.
   */
  async undo(id: string): Promise<void> {
    await this.whenReady();
    const queue = this.queue;
    const r = this.records.find((x) => x.idem_key === id);
    if (!queue || !r) throw new Error("scan not found");
    const until = undoUntil(r, this.signer(), this.undoMs);
    if (until === null || Date.now() >= until) throw new Error("The undo window for this scan has passed.");
    const next = await queue.undoLocally(id, Date.now());
    if (!next) throw new Error("scan not found");
    this.replace(next);
    this.changed();
    if (next.state === "withheld") return;
    if (this.linkUp()) {
      if (next.state === "pending") await this.syncNow().catch(() => undefined); // settles undos after it
      else await this.settleUndos();
    }
    const after = this.records.find((x) => x.idem_key === id);
    if (after?.undo?.state === "refused") throw new Error(after.undo.message ?? "Undo refused");
  }

  /** Undos waiting on the server: send them for scans that have synced; drop the ones that need none. */
  private async settleUndos() {
    const queue = this.queue;
    const s = currentSession();
    if (!queue || !s) return;
    const wanted = this.records.filter((r) => r.undo?.state === "requested");
    if (wanted.length === 0) return;
    for (const r of wanted) {
      let next: QueueRecord | undefined;
      if (r.state === "held") {
        // The server does not have it (it refused to store it): keep it here, never sent.
        next = await queue.update(r.idem_key, (x) => (x.state === "held" ? { ...x, state: "withheld", undo: { ...x.undo!, state: "withheld" } } : undefined));
      } else if (r.state === "rejected") {
        next = await queue.update(r.idem_key, (x) => ({ ...x, undo: { ...x.undo!, state: "withheld" } }));
      } else if (r.state === "sent" && r.outcome && r.user === s.sub && this.linkUp()) {
        if (r.outcome.result !== "admitted") {
          next = await queue.settleUndo(r.idem_key, false, Date.now(), "the server recorded this scan as something other than an admission.");
        } else {
          next = await this.undoOnServer(r);
        }
      }
      if (next) this.replace(next);
    }
    this.changed();
  }

  /** POST /scans/:id/undo; a lost answer is retried once (the server's undo is idempotent). */
  private async undoOnServer(r: QueueRecord): Promise<QueueRecord | undefined> {
    const queue = this.queue!;
    const send = () => call("undoScan", { params: { id: r.outcome!.scan_id }, body: { event_id: r.event_id } });
    try {
      await send().catch((e: unknown) => {
        if (e instanceof ApiFailure && e.ambiguous) return send();
        throw e;
      });
      return queue.settleUndo(r.idem_key, true, Date.now());
    } catch (e) {
      if (e instanceof ApiFailure && e.ambiguous) {
        this.setReachable(false);
        return undefined; // still requested: tried again when the link is back
      }
      return queue.settleUndo(r.idem_key, false, Date.now(), e instanceof ApiFailure ? e.message : "the server refused it.");
    }
  }

  /* ---------------------------------------------------------- sync */

  private async send(body: { event_id: string; device_id: string; scans: ScanSubmission[] }): Promise<SendResult> {
    try {
      return { ok: true, body: await call("postScans", { body }, { timeoutMs: 20_000 }) };
    } catch (e) {
      if (!(e instanceof ApiFailure) || e.ambiguous) return { ok: false, failure: { kind: "network" } };
      if (e.status === 401) return { ok: false, failure: { kind: "auth" } };
      if (e.status === 429) return { ok: false, failure: { kind: "rate_limited", retryAfterMs: e.retryAfterMs ?? 5000 } };
      if (e.status === 400) return { ok: false, failure: { kind: "invalid" } };
      return { ok: false, failure: { kind: "refused", code: e.code ?? "UNKNOWN", message: e.message } };
    }
  }

  /** Send the queue now (S4 Retry now, link restored, periodic). Rejects while offline. */
  syncNow(): Promise<void> {
    if (!this.linkUp()) return Promise.reject(new Error("offline"));
    this.syncing ??= this.runSync().finally(() => {
      this.syncing = null;
    });
    return this.syncing;
  }

  private async runSync() {
    const signer = this.signer();
    if (!signer || !this.queue) throw new Error("signed out");
    const queue = this.queue;
    const run = () => syncQueue({ queue, send: (b) => this.send(b), now: Date.now, signer, batch: SYNC_BATCH });
    const locks = navigator.locks;
    // One tab syncs at a time; idempotency keys make a second one harmless anyway.
    const rep = locks ? await locks.request("synan-scanner-sync", { ifAvailable: true }, (lock) => (lock ? run() : null)) : await run();
    await this.reloadRecords();
    await this.settleUndos();
    this.changed();
    if (!rep) return;
    if (rep.sent > 0 || rep.rejected > 0 || rep.held > 0) {
      this.host.patch({ lastSyncAt: Date.now() });
      // D-14: the offset is re-measured at every sync.
      void this.probeOnce();
    }
    if (rep.stoppedBy?.kind === "network") {
      this.setReachable(false);
      throw new Error("offline");
    }
    if (rep.stoppedBy) throw new Error(rep.stoppedBy.kind);
  }
}

export const runtime = new Runtime();

/* ------------------------------------------------------------ screen helpers */

export async function signIn(email: string, password: string) {
  return runtime.signIn(email, password);
}
export async function signOut() {
  return runtime.signOut();
}
export function reloadGates() {
  return runtime.loadGates();
}
