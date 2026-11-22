export type ScanVerdict = "ALLOWED" | "DUPLICATE" | "DENIED";
export type GateState = "online" | "degraded";

export interface Scan {
  time: string;
  gate: string;
  verdict: ScanVerdict;
  credential: string;
}

export interface HourlyAdmission {
  hour: string;
  count: number;
  current?: boolean;
}

export interface Zone {
  name: string;
  pct: number;
}

export interface Gate {
  name: string;
  state: GateState;
  heartbeat: string;
}

export const event = {
  name: "Nexus Summit 2026",
  venue: "Nexus Hall · Kampala",
  doors: "Doors 09:00",
  registered: 1200,
  admitted: 864,
  onSite: 796,
  capacityRisk: 1,
  openAlerts: 2,
  updatedSeconds: 12,
};

export const admissions: HourlyAdmission[] = [
  { hour: "09:00", count: 64 },
  { hour: "10:00", count: 132 },
  { hour: "11:00", count: 168 },
  { hour: "12:00", count: 96 },
  { hour: "13:00", count: 88 },
  { hour: "14:00", count: 148 },
  { hour: "15:00", count: 218, current: true },
];

export const recentScans: Scan[] = [
  { time: "18:44:12", gate: "Gate 2", verdict: "ALLOWED", credential: "CNX·8F2A" },
  { time: "18:44:09", gate: "Gate 1", verdict: "ALLOWED", credential: "CNX·1C7D" },
  { time: "18:44:07", gate: "Gate 2", verdict: "DUPLICATE", credential: "CNX·4E90" },
  { time: "18:44:03", gate: "Gate 3", verdict: "ALLOWED", credential: "CNX·B215" },
  { time: "18:43:58", gate: "Gate 1", verdict: "DENIED", credential: "CNX·0D44" },
  { time: "18:43:55", gate: "Gate 2", verdict: "ALLOWED", credential: "CNX·77A6" },
  { time: "18:43:51", gate: "Gate 1", verdict: "ALLOWED", credential: "CNX·E3C1" },
];

export const zones: Zone[] = [
  { name: "Main Hall", pct: 88 },
  { name: "Workshop A", pct: 98 },
  { name: "Breakout 1", pct: 41 },
  { name: "West Terrace", pct: 63 },
];

export const gates: Gate[] = [
  { name: "Gate 1 · North", state: "online", heartbeat: "2s" },
  { name: "Gate 2 · North", state: "online", heartbeat: "4s" },
  { name: "Gate 3 · West", state: "degraded", heartbeat: "58s" },
  { name: "Gate 4 · East", state: "online", heartbeat: "7s" },
];

export const credentials = { ready: 968, unbound: 214, revoked: 18 };

export const peak = { time: "15:00", pct: 93, zone: "Main Hall", minutes: 12 };
