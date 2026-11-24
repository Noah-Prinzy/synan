/**
 * The scanner against the real API (roadmap Phase 3). Owns: the session, the gates from
 * GET /me/assignments, the clock offset (GET /time, D-14), the public keys and the signed
 * allowlist (verified before use, kept in IndexedDB), the durable queue and its sync, REST
 * heartbeats and `/stream/scans`, and the link state.
 *
 * It never imports the screens' store: data/store.ts hands it a small `Host` to write the state
 * the screens already read (scans, last sync, pass-list age, clock offset, link).
 */
import { parseSignedQr } from "@synan/contracts/qr";
import type { ScanDirection } from "@synan/contracts/enums";
import type { EventSummary, ScanSubmission, SignedAllowlist, SigningKey, StaffAssignment } from "@synan/contracts/rest";
import type { Gate } from "../mock";
import type { Presented, Scan } from "../store";
import { ApiFailure, call, currentSession, onSession, signIn as clientSignIn, signOut as clientSignOut } from "./client";
import {
  ALLOWLIST_REFRESH_MS,
  CLOCK_REFRESH_MS,
  ONLINE_VERDICT_TIMEOUT_MS,
  REST_HEARTBEAT_MS,
  SYNC_BATCH,
} from "./config";
import { AllowlistRejected, ed25519Supported, importKeys, nfcHash, verifyAllowlistJws, verifyQr, type TrustedKey } from "./crypto";
import { decideLocally, indexAllowlist, type AllowlistIndex, type LocalCheckpoint, type Resolution } from "./decide";
import { Idb, KV } from "./idb";
import { historyOf, isConflict, resultOf, ScanQueue, syncQueue, type QueueRecord, type SendResult } from "./queue";
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
  /** Refused by the server (never counted), with its message. */
  refused: string | null;
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
  /** Queued scans that belong to another signed-in user (they sync when that user signs in). */
  heldForOtherUser: number;
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
  heldForOtherUser: 0,
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
function deviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = `scanner-${newIdemKey()}`;
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return (memDevice ??= `scanner-${newIdemKey()}`);
  }
}
let memDevice: string | null = null;

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
}
interface KeysCache {
  keys: SigningKey[];
  fetched_at: number;
}

interface Trusted {
  idx: AllowlistIndex;
  eventId: string;
  checkpointId: string;
  issuedAtMs: number;
  fetchedAt: number;
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
  private stream: ScanStream | null = null;
  private timers: ReturnType<typeof setInterval>[] = [];
  private probe: ReturnType<typeof setTimeout> | null = null;
  private probeAttempt = 0;
  private channel: BroadcastChannel | null = null;
  private syncing: Promise<void> | null = null;
  /** Stable id of this scanner install (created on first use, API mode only). */
  private get device(): string {
    return deviceId();
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
      await this.queue.prune(Date.now(), 24 * 3600_000, 2000);
      const clock = await this.idb.get<{ offset: number }>(KV, "clock");
      if (clock) this.setOffset(clock.offset);
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
    this.timers.push(setInterval(() => setApi({ gates: this.refreshShift(api.gates) }), 30_000));
    this.timers.push(setInterval(() => void this.tick(), 15_000));
    this.timers.push(setInterval(() => void this.restHeartbeat(), REST_HEARTBEAT_MS));
    setApi({ ready: true });
    await this.probeOnce();
    if (this.linkUp() && api.session) void this.loadGates();
    const gate = this.currentGate();
    if (gate) this.startGate(gate);
  }

  /* ---------------------------------------------------------- link */

  linkUp(): boolean {
    const h = this.host.get();
    return (typeof navigator === "undefined" || navigator.onLine) && !h.forceOffline && h.apiReachable;
  }

  private setReachable(up: boolean) {
    const was = this.host.get().apiReachable;
    if (was !== up) this.host.patch({ apiReachable: up });
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

  /** GET /time: a reachability probe that also measures the clock offset (D-14). */
  private async probeOnce(): Promise<boolean> {
    if (this.host.get().forceOffline) return false;
    try {
      const t0 = Date.now();
      const r = await call("time", {}, { auth: false, timeoutMs: 5000 });
      const t1 = Date.now();
      this.setOffset(r.epoch_ms - (t0 + t1) / 2);
      void this.idb?.put(KV, { offset: this.offset, at: t1 }, "clock");
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
    if (on) {
      this.stream?.stop();
    } else {
      const gate = this.currentGate();
      if (gate) this.startGate(gate);
      this.probeNow();
    }
  }

  /** Every 15 s: drain what is due, refresh what is old. */
  private async tick() {
    if (!this.linkUp()) return;
    const gate = this.currentGate();
    if (this.records.some((r) => r.state === "pending" && r.user === api.session?.sub)) await this.syncNow().catch(() => undefined);
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
    this.setReachable(true);
    await this.loadGates();
  }

  async signOut(): Promise<void> {
    this.stopGate();
    this.host.patch({ gateId: null });
    await clientSignOut();
    setApi({ session: null, gates: [], event: null, roomNames: {} });
    await this.idb?.put(KV, null, "gates");
  }

  /** GET /me/assignments, then the checkpoints and the live event they belong to. */
  async loadGates(): Promise<void> {
    const s = currentSession();
    if (!s) return;
    setApi({ gatesLoading: true, gatesError: null });
    try {
      const [assignments, checkpoints, live] = await Promise.all([
        call("myAssignments"),
        call("listCheckpoints", { query: { limit: 500 } }),
        call("listEvents", { query: { state: "live", limit: 100 } }),
      ]);
      const cps = new Map(checkpoints.items.map((c) => [c.id, c]));
      const events = new Map<string, EventSummary>(live.items.map((e) => [e.id, e]));
      const roomNames: Record<string, string> = {};
      const details = new Map<string, Promise<void>>();
      const detail = (e: EventSummary) => {
        if (!details.has(e.id)) {
          details.set(
            e.id,
            call("getEvent", { params: { slug: e.slug } }).then(
              (d) => {
                for (const r of d.rooms) roomNames[r.room_id] = r.name;
              },
              () => undefined,
            ),
          );
        }
        return details.get(e.id)!;
      };
      // One row per checkpoint: the current shift, else the next one.
      const now = Date.now() + this.offset;
      const byCp = new Map<string, StaffAssignment>();
      for (const a of [...assignments.items].sort((x, y) => Date.parse(x.shift_start) - Date.parse(y.shift_start))) {
        const prev = byCp.get(a.checkpoint_id);
        const current = Date.parse(a.shift_start) <= now && now < Date.parse(a.shift_end);
        if (!prev || (current && !(Date.parse(prev.shift_start) <= now && now < Date.parse(prev.shift_end)))) byCp.set(a.checkpoint_id, a);
      }
      const gates: Gate[] = [];
      let event: { id: string; title: string } | null = null;
      for (const a of byCp.values()) {
        const cp = cps.get(a.checkpoint_id);
        if (!cp) continue;
        // NOT IN CONTRACTS: assignments carry no event when event_id is null; the live event at the venue stands in.
        const ev = (a.event_id ? events.get(a.event_id) : undefined) ?? [...events.values()].find((e) => e.venue.id === cp.venue_id) ?? null;
        const eventId = a.event_id ?? ev?.id ?? null;
        if (!eventId) continue;
        if (ev) await detail(ev);
        event ??= { id: eventId, title: ev?.title ?? "" };
        gates.push({
          id: cp.id,
          label: cp.label,
          perimeter: cp.perimeter,
          roomId: cp.room_id,
          roomName: null,
          shift: { starts: "", ends: "", now: false },
          api: {
            eventId,
            venueId: cp.venue_id,
            zoneId: cp.zone_id,
            direction: cp.direction,
            assignmentId: a.id,
            shiftStart: Date.parse(a.shift_start),
            shiftEnd: Date.parse(a.shift_end),
          },
        });
      }
      for (const g of gates) g.roomName = g.roomId ? (roomNames[g.roomId] ?? null) : null;
      const fresh = this.refreshShift(gates);
      setApi({ gates: fresh, event, roomNames, gatesLoading: false, gatesError: assignments.items.length > 0 && gates.length === 0 ? "No live event for your gates." : null });
      await this.idb?.put(KV, { user: s.sub, event, roomNames, gates: fresh } satisfies GateCache, "gates");
    } catch (e) {
      setApi({ gatesLoading: false, gatesError: failureMessage(e) });
      if (e instanceof ApiFailure && e.ambiguous) this.setReachable(false);
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
        heartbeat: () => ({ queue_depth: this.depth(), clock_offset_ms: Math.round(this.offset), online: this.linkUp(), device_id: this.device }),
        onState: (st) => setApi({ stream: st }),
        onAlive: () => {
          if (!this.host.get().apiReachable) this.setReachable(true);
        },
      });
      if (!this.host.get().forceOffline) this.stream.start();
    }
    if (!this.allow || this.allow.checkpointId !== gate.id) void this.refreshAllowlist(gate).catch(() => undefined);
    void this.restHeartbeat();
  }
  private streamFor: string | null = null;

  private stopGate() {
    this.stream?.stop();
    this.stream = null;
    this.streamFor = null;
  }

  /** Shift end (docs/06 §3.1): hand the shift over on the server when the link allows. */
  async endShift(gate: Gate | null): Promise<void> {
    this.stopGate();
    if (gate?.api && this.linkUp()) {
      await call("handover", { params: { id: gate.api.assignmentId } }).catch(() => undefined);
    }
  }

  /* ---------------------------------------------------------- heartbeat */

  private depth(): number {
    return this.records.filter((r) => r.state === "pending").length;
  }

  private async restHeartbeat() {
    const gate = this.currentGate();
    if (!gate?.api || !this.linkUp() || !api.session) return;
    if (this.stream?.state === "open") return; // the stream carries it
    try {
      await call("gateHeartbeat", {
        body: { checkpoint_id: gate.id, device_id: this.device, queue_depth: this.depth(), clock_offset_ms: Math.round(this.offset), online: true },
      });
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
    }
  }

  private async fetchKeys() {
    const r = await call("signingKeys", {}, { auth: false });
    this.keys = await importKeys(r.keys);
    this.keysFetchedAt = Date.now();
    await this.idb?.put(KV, { keys: r.keys, fetched_at: this.keysFetchedAt } satisfies KeysCache, "keys");
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
    this.allow = { idx: indexAllowlist(payload), eventId: payload.event_id, checkpointId: c.checkpoint_id, issuedAtMs, fetchedAt: c.fetched_at };
    // Pass-list age on S4 is shown in device time.
    this.host.patch({ allowlistAt: issuedAtMs - this.offset });
    setApi({ allowlistError: null });
  }

  /** GET /events/:id/allowlist for this gate, verified with an `allowlist` key before it is stored or used. */
  async refreshAllowlist(gate: Gate): Promise<void> {
    if (!gate.api || !this.linkUp()) return;
    if (!(await ed25519Supported())) {
      setApi({ allowlistError: "Ed25519 not supported by this browser" });
      return;
    }
    if (this.keys.length === 0 || Date.now() - this.keysFetchedAt > 3600_000) await this.fetchKeys();
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
    const cache: AllowlistCache = { event_id: payload.event_id, checkpoint_id: gate.id, kid: signed.kid, jws: signed.jws, fetched_at: Date.now() };
    await this.idb?.put(KV, cache, "allowlist");
    this.trust(payload, cache);
    this.channel?.postMessage({ type: "allowlist" });
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

  private toScan(r: QueueRecord): Scan {
    return {
      id: r.idem_key,
      at: r.at,
      gateId: r.checkpoint.id,
      result: resultOf(r),
      medium: r.display.medium,
      identifier: r.display.identifier,
      name: null,
      tier: r.outcome?.tier ?? r.display.tier,
      rooms: r.display.rooms,
      lastInAt: r.display.lastInAt,
      offline: r.decided_by === "local",
      synced: r.state !== "pending",
      undone: r.undone,
      credential: r.credential_key,
      refused: r.rejection?.message ?? null,
    };
  }

  private publish() {
    const sorted = [...this.records].sort((a, b) => b.at - a.at);
    const pending = sorted.filter((r) => r.state === "pending");
    const rest = sorted.filter((r) => r.state !== "pending").slice(0, 300);
    const scans = [...pending, ...rest].sort((a, b) => b.at - a.at).map((r) => this.toScan(r));
    const sent = this.records.filter((r) => r.synced_at !== null);
    const lastSyncAt = sent.reduce<number | null>((m, r) => (m === null || r.synced_at! > m ? r.synced_at : m), this.host.get().lastSyncAt);
    this.host.patch({ scans, lastSyncAt });
    const me = api.session?.sub;
    setApi({
      conflicts: sorted
        .filter(isConflict)
        .slice(0, 50)
        .map((r) => ({ id: r.idem_key, at: r.at, identifier: r.display.identifier, shown: r.shown, recorded: r.outcome?.result ?? null, alerts: r.outcome?.alert_ids.length ?? 0, refused: r.rejection?.message ?? null })),
      heldForOtherUser: pending.filter((r) => r.user !== me).length,
    });
    this.stream?.heartbeatNow();
  }

  private changed() {
    this.channel?.postMessage({ type: "changed" });
  }

  /* ---------------------------------------------------------- decide */

  private allowFor(eventId: string, checkpointId: string): AllowlistIndex | null {
    const a = this.allow;
    return a && a.eventId === eventId && a.checkpointId === checkpointId ? a.idx : null;
  }

  private async resolve(p: Presented, gate: Gate, correctedNow: number): Promise<{ r: Resolution; identifier: string }> {
    const idx = this.allowFor(gate.api!.eventId, gate.id);
    const trustedCrypto = await ed25519Supported();
    if (p.medium === "qr") {
      const q = parseSignedQr(p.data);
      if (!q) return { r: { known: false, credentialKey: null }, identifier: "Not a pass" };
      const identifier = q.kind === "email" ? "Emailed code" : "App pass";
      const unknown = { r: { known: false, credentialKey: q.ref } as Resolution, identifier };
      if (!idx || !trustedCrypto) return unknown;
      const check = await verifyQr(q, this.keys, correctedNow);
      if (!check.ok) return unknown;
      const entry = idx.byCredential.get(q.ref);
      if (!entry) return unknown;
      return {
        r: { known: true, credentialKey: entry.credential_hash, carrier: q.kind === "email" ? "qr_email" : "qr_portal", entry, deadBand: false, emailCid: q.kind === "email" ? q.cid : null },
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
      this.records.filter((x) => x.email_cid && x.state !== "rejected" && x.direction === "in" && !x.undone && (resultOf(x) === "admitted" || resultOf(x) === "already_inside")).map((x) => x.email_cid!),
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
      event_id: gate.api.eventId,
      device_id: this.device,
      offline: { ...base, offline: true, local_result: local.result },
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
      display: {
        medium: presented.medium,
        identifier,
        tier: r.known ? r.entry.tier : null,
        rooms: r.known ? r.entry.permitted_room_ids : [],
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
    return this.toScan(this.records.find((x) => x.idem_key === idem)!);
  }

  private replace(r: QueueRecord) {
    const i = this.records.findIndex((x) => x.idem_key === r.idem_key);
    if (i >= 0) this.records[i] = r;
    else this.records.push(r);
    this.publish();
  }

  /** S3 Undo. NOT IN CONTRACTS: there is no correction endpoint, so the undo is local only. */
  async undo(id: string) {
    const r = await this.queue?.setUndone(id);
    if (r) this.replace(r);
    this.changed();
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
    const s = currentSession();
    if (!s || !this.queue) throw new Error("signed out");
    const queue = this.queue;
    const run = () => syncQueue({ queue, send: (b) => this.send(b), now: Date.now, user: s.sub, batch: SYNC_BATCH });
    const locks = navigator.locks;
    // One tab syncs at a time; idempotency keys make a second one harmless anyway.
    const rep = locks ? await locks.request("synan-scanner-sync", { ifAvailable: true }, (lock) => (lock ? run() : null)) : await run();
    await this.reloadRecords();
    this.changed();
    if (!rep) return;
    if (rep.sent > 0 || rep.rejected > 0) {
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
