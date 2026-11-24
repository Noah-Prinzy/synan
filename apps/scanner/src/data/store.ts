/**
 * This device's state: the gate it is paired to, the scans it has decided, the offline
 * queue, the last sync, and the operator's sound and vibration choices. Persisted to
 * localStorage so a reload, a crash or a dead battery mid-shift loses nothing (the real
 * queue moves to IndexedDB with the Phase 3 ingest, D-17).
 *
 * The decision follows docs/01 §7 in order; the mock decides locally online and offline
 * alike, and marks offline decisions LOCAL and queues them (docs/01 §8).
 */
import { useSyncExternalStore } from "react";
import { SCAN_RESULT_COPY } from "@synan/contracts/copy";
import { QR_PREFIX_EMAIL, parseSignedQr } from "@synan/contracts/qr";
import type { AttendeeTier, ScanResult } from "@synan/contracts/enums";
import { BANDS, QR_REFS, gateById, roomState, type Gate, type Holder } from "./mock";
import { API_MODE } from "./api/config";
import { runtime } from "./api/runtime";

export interface Scan {
  id: string;
  /** Device time, ms. */
  at: number;
  gateId: string;
  result: ScanResult;
  medium: "qr" | "nfc";
  /** Shown in mono: the band UID, or the code's type. */
  identifier: string;
  /** Who it is, where known. NOT IN CONTRACTS: ScanOutcome has no name today. */
  name: string | null;
  tier: AttendeeTier | null;
  /** Rooms this pass opens, for the ADMITTED chips. */
  rooms: string[] | null;
  /** "Last in 4 min ago" for ALREADY INSIDE. */
  lastInAt: number | null;
  offline: boolean;
  synced: boolean;
  /** An operator undid this admission (a correction record; the scan is never deleted). */
  undone: boolean;
  credential: string | null;
  /** API mode: the server refused to record this scan (never counted, or not yet), with its reason. */
  refused?: string | null;
  /** API mode: until when (device ms) Undo can still succeed; null = not undoable. Unset on the mock (60 s from `at`). */
  undoUntil?: number | null;
  /** API mode: what became of an undo the server had to agree to, when it did not. */
  undoNote?: string | null;
  /** API mode: undone on this device before it was ever sent, so it is kept here and never sent. */
  heldBack?: boolean;
  /** API mode: counted under a shift that had already ended or been handed over. */
  lateSynced?: boolean;
  /** API mode: made by another staff member's earlier shift on this device. */
  earlierShift?: boolean;
}

interface State {
  gateId: string | null;
  shiftStartedAt: number | null;
  scans: Scan[];
  lastSyncAt: number | null;
  /** When the pass list was issued (device time); null when this device holds no trusted list. */
  allowlistAt: number | null;
  clockOffsetMs: number;
  spentEmailCodes: string[];
  sound: boolean;
  vibrate: boolean;
  /** Development: behave as if the network were down (?offline=1). */
  forceOffline: boolean;
  /** API mode: the server answered recently (not persisted). */
  apiReachable: boolean;
}

// API mode keeps its scans in IndexedDB (data/api); only settings and the gate live here.
const KEY = API_MODE ? "syn.scanner.api.v1" : "syn.scanner.v1";
const KEEP = 200;

function initial(): State {
  return {
    gateId: null,
    shiftStartedAt: null,
    scans: [],
    lastSyncAt: null,
    allowlistAt: Date.now(),
    clockOffsetMs: 0,
    spentEmailCodes: [],
    sound: true,
    vibrate: true,
    forceOffline: false,
    apiReachable: true,
  };
}

function load(): State {
  try {
    const raw = window.localStorage.getItem(KEY);
    const loaded = raw ? { ...initial(), ...(JSON.parse(raw) as Partial<State>) } : initial();
    return API_MODE ? { ...loaded, scans: [], apiReachable: true, allowlistAt: null } : loaded;
  } catch {
    return initial();
  }
}

let state: State = load();
const listeners = new Set<() => void>();

function set(patch: Partial<State>): void {
  state = { ...state, ...patch };
  try {
    const { apiReachable: _reachable, ...persisted } = state;
    window.localStorage.setItem(KEY, JSON.stringify(API_MODE ? { ...persisted, scans: [] } : persisted));
  } catch {
    /* storage full or blocked: keep going in memory, the queue must not stop */
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useScanner(): State {
  return useSyncExternalStore(subscribe, () => state);
}

export function getState(): State {
  return state;
}

/* ------------------------------------------------------------------ link */

function linkUp(): boolean {
  return navigator.onLine && !state.forceOffline && (!API_MODE || state.apiReachable);
}

function subscribeLink(listener: () => void): () => void {
  window.addEventListener("online", listener);
  window.addEventListener("offline", listener);
  const unsubscribe = subscribe(listener);
  return () => {
    window.removeEventListener("online", listener);
    window.removeEventListener("offline", listener);
    unsubscribe();
  };
}

export function useOnline(): boolean {
  return useSyncExternalStore(subscribeLink, linkUp, () => true);
}

/* ----------------------------------------------------------- gate, shift */

export function pairGate(gate: Gate): void {
  set({ gateId: gate.id, shiftStartedAt: state.shiftStartedAt ?? Date.now() });
  if (API_MODE) runtime.pair(gate);
}

export async function endShift(): Promise<void> {
  if (API_MODE) await runtime.endShift(runtime.gateById(state.gateId));
  set({ gateId: null, shiftStartedAt: null });
}

export function setPreference(key: "sound" | "vibrate", value: boolean): void {
  set({ [key]: value });
}

export function setForceOffline(value: boolean): void {
  set({ forceOffline: value });
  if (API_MODE) runtime.forceOffline(value);
  else if (!value) void sync();
}

/* -------------------------------------------------------------- decision */

const DEBOUNCE_MS = 60_000;

export type Presented = { medium: "qr"; data: string } | { medium: "nfc"; uid: string };

/** Normalise what a reader typed or Web NFC reported: "04:a2:9f…" → "04A29F…". */
export function normaliseUid(raw: string): string | null {
  const uid = raw.replace(/[\s:-]/g, "").toUpperCase();
  return /^[0-9A-F]{8,32}$/.test(uid) ? uid : null;
}

export function shortUid(uid: string): string {
  return uid.length > 8 ? `${uid.slice(0, 4)}…${uid.slice(-4)}` : uid;
}

function resolve(presented: Presented): { credential: string | null; holder: Holder | null; identifier: string; email: boolean } {
  if (presented.medium === "nfc") {
    return { credential: presented.uid, holder: BANDS[presented.uid] ?? null, identifier: shortUid(presented.uid), email: false };
  }
  const parsed = parseSignedQr(presented.data);
  if (!parsed) return { credential: null, holder: null, identifier: "Not a pass", email: false };
  // Mock: the signature and time window are not checked (no keys, and the portal runs on
  // its own demo clock). Phase 3 verifies with the event's public key (D-12).
  const known = QR_REFS[parsed.ref];
  const holder: Holder = known?.holder ?? { name: "Guest", tier: "ORDINARY", rooms: null, state: "active" };
  return {
    credential: known?.bandUid ?? parsed.ref,
    holder,
    identifier: parsed.kind === "email" ? "Emailed code" : "App pass",
    email: parsed.kind === "email",
  };
}

function decideResult(presented: Presented, gate: Gate, now: number): Omit<Scan, "id" | "at" | "gateId" | "offline" | "synced" | "undone"> {
  const { credential, holder, identifier, email } = resolve(presented);
  const base = {
    medium: presented.medium,
    identifier,
    name: holder?.name ?? null,
    tier: holder?.tier ?? null,
    rooms: holder?.rooms ?? null,
    lastInAt: null as number | null,
    credential,
  };
  // 1. Known credential?
  if (!holder || !credential) return { ...base, result: "unknown_token", name: null, tier: null };
  // 2. Carrier accepted here? (D-11)
  if (presented.medium === "qr" && !gate.perimeter) return { ...base, result: "wristband_required" };
  if (email && state.spentEmailCodes.includes(presented.medium === "qr" ? presented.data : "")) return { ...base, result: "pass_spent" };
  // 3. Revoked or held?
  if (holder.state === "revoked") return { ...base, result: "revoked" };
  if (holder.state === "suspended") return { ...base, result: "suspended" };
  const admissions = state.scans.filter((scan) => scan.credential === credential && SCAN_RESULT_COPY[scan.result].admits && scan.result !== "duplicate_read" && !scan.undone);
  // 4. Same credential, same gate, within 60 s of the last admission.
  const lastHere = admissions.find((scan) => scan.gateId === gate.id);
  if (lastHere && now - lastHere.at < DEBOUNCE_MS) return { ...base, result: "duplicate_read" };
  // 5. Tier permits this room?
  if (gate.roomId && holder.rooms && !holder.rooms.includes(gate.roomId)) return { ...base, result: "denied_room" };
  // 6. Already inside? Zone at a perimeter gate, room at an interior gate.
  const inside = admissions.find((scan) => {
    const other = gateById(scan.gateId);
    return other && (gate.perimeter ? other.perimeter : other.roomId === gate.roomId);
  });
  if (inside) return { ...base, result: "already_inside", lastInAt: inside.at };
  // 7. Room at its blocking threshold?
  if (gate.roomId) {
    const room = roomState(gate.roomId);
    const admittedHere = state.scans.filter((scan) => scan.gateId === gate.id && scan.result === "admitted" && !scan.undone).length;
    if (room && room.occupancy + admittedHere >= room.capacity) return { ...base, result: "capacity_block" };
  }
  return { ...base, result: "admitted" };
}

let seq = 0;

/**
 * Decide a read at this gate, record it, and queue it when offline. Mock: instant. API mode: a
 * promise — the server's verdict while the link is up, the local one (LOCAL) otherwise.
 */
export function decide(presented: Presented, gate: Gate): Scan | Promise<Scan> {
  if (API_MODE) return runtime.decide(presented, gate);
  const now = Date.now();
  const decided = decideResult(presented, gate, now);
  const offline = !linkUp();
  const scan: Scan = {
    ...decided,
    id: `${now.toString(36)}-${(seq++).toString(36)}`,
    at: now,
    gateId: gate.id,
    offline,
    synced: !offline,
    undone: false,
  };
  const spent =
    presented.medium === "qr" && decided.result === "admitted" && presented.data.startsWith(QR_PREFIX_EMAIL)
      ? [...state.spentEmailCodes, presented.data]
      : state.spentEmailCodes;
  set({ scans: [scan, ...state.scans].slice(0, KEEP), spentEmailCodes: spent });
  return scan;
}

/** Undo an admission made in error, within 60 s: writes a correction, never deletes. */
export const UNDO_WINDOW_MS = 60_000;
/** Until when Undo is offered for a scan, or null (API mode: the runtime says; mock: 60 s after an admission). */
export function undoDeadline(scan: Scan): number | null {
  if (scan.undoUntil !== undefined) return scan.undoUntil;
  return scan.result === "admitted" && !scan.undone ? scan.at + UNDO_WINDOW_MS : null;
}
/** API mode: resolves when undone (on the device, or by the server); rejects when it could not be. */
export function undo(id: string): void | Promise<void> {
  if (API_MODE) return runtime.undo(id);
  set({ scans: state.scans.map((scan) => (scan.id === id ? { ...scan, undone: true, synced: !linkUp() ? false : scan.synced } : scan)) });
}

/* ------------------------------------------------------------------ sync */

export function queued(): Scan[] {
  return state.scans.filter((scan) => !scan.synced);
}

let syncing: Promise<void> | null = null;

/** Send the queue (mock: 700 ms). Rejects when the link is down. */
export function sync(): Promise<void> {
  if (API_MODE) return runtime.syncNow();
  if (!linkUp()) return Promise.reject(new Error("offline"));
  if (syncing) return syncing;
  syncing = new Promise<void>((resolve) => {
    window.setTimeout(() => {
      syncing = null;
      const now = Date.now();
      set({
        scans: state.scans.map((scan) => (scan.synced ? scan : { ...scan, synced: true })),
        lastSyncAt: now,
        allowlistAt: now,
        clockOffsetMs: 0,
      });
      resolve();
    }, 700);
  });
  return syncing;
}

// Sync as soon as the link returns.
if (typeof window !== "undefined" && !API_MODE) {
  window.addEventListener("online", () => {
    if (queued().length > 0) void sync().catch(() => {});
  });
}

/** Allowlist older than the fail-open window (O-05: 15 minutes). */
export const STALE_MS = 15 * 60_000;

// API mode: the runtime writes the state the screens read (scans, sync, pass list, clock, link).
if (API_MODE && typeof window !== "undefined") {
  runtime.connect({ get: () => state, patch: (p) => set(p) });
}
