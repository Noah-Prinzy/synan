/**
 * Every credential state change reaches its holder (01 §5.2, D-06): a `pass.status` frame on
 * `/stream/me` for each transition, whoever makes it — the scan path (first admission, impossible
 * travel, an offline conflict found at sync), an operator (revoke, clear or revoke a review), the
 * desk (a lost band's replacement) — and the stored notification where the product has one. And
 * the state is written in one place only, so a new caller cannot forget the holder.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import type { TokenPair, WsTicket } from "@synan/contracts/rest";
import { serverMessageByChannel } from "@synan/contracts/ws";
import { nfcIdentifier } from "../src/domain/scan-service.js";
import { addAttendee, band, mfaCode, postScans, scan, startHarness, type Harness } from "./helpers.js";

const MIN = 60_000;
type Msg = { type: string; data?: Record<string, unknown> };

let h: Harness;
let organiser: string;
let adminMfa: string;
beforeAll(async () => {
  h = await startHarness();
  organiser = (await h.login(h.seed.emails.organiser)).access_token;
  const admin = (await h.login(h.seed.emails.admin)).access_token;
  adminMfa = (await h.call<TokenPair>("POST", "/auth/mfa/verify", { token: admin, body: { code: mfaCode(h) } })).body.access_token;
});
afterAll(async () => h.close());

/** A fresh attendee (confirmed, pass issued, band bound), signed in, with /stream/me open on the event. */
async function holder() {
  const a = await addAttendee(h, "ORDINARY");
  const email = (await h.app.ctx.repos.attendees.byId(a.id))!.email!;
  await h.call("POST", "/auth/email-link", { body: { email } });
  const link = /#token=([A-Za-z0-9_-]+)/.exec(h.mailer.last("auth.link")!.text)![1]!;
  const token = (await h.call<TokenPair>("POST", "/auth/verify", { body: { token: link } })).body.access_token;
  const t = await h.call<WsTicket>("POST", "/auth/ws-ticket", { token, body: { channel: "/stream/me", event_id: h.seed.eventId } });
  expect(t.status).toBe(200);
  const ws = new WebSocket(`${h.base.replace("http", "ws")}/stream/me`, t.body.protocols);
  const messages: Msg[] = [];
  await new Promise<void>((res, rej) => {
    ws.on("open", () => res());
    ws.on("error", rej);
  });
  ws.on("message", (raw) => messages.push(serverMessageByChannel["/stream/me"].parse(JSON.parse(String(raw))) as Msg));
  ws.send(JSON.stringify({ type: "hello" }));
  const until = async (pred: () => boolean, what: string, ms = 3000) => {
    const end = Date.now() + ms;
    while (!pred()) {
      if (Date.now() > end) throw new Error(`timeout waiting for ${what}; got ${JSON.stringify(messages)}`);
      await new Promise((r) => setTimeout(r, 20));
    }
  };
  await until(() => messages.some((m) => m.type === "ready"), "ready");
  const states = () => messages.filter((m) => m.type === "pass.status").map((m) => m.data!.state);
  const notices = async () =>
    (await h.call<{ items: { title: string }[] }>("GET", "/me/notifications", { token })).body.items.map((n) => n.title);
  return {
    ...a,
    states,
    notices,
    /** The pass.status frames so far are exactly these states, in order (no more within 150 ms). */
    async framesAre(expected: string[]) {
      await until(() => states().length >= expected.length, `frames ${expected.join(", ")}`);
      await new Promise((r) => setTimeout(r, 150));
      expect(states()).toEqual(expected);
      for (const m of messages.filter((x) => x.type === "pass.status")) expect(m.data!.event_id).toBe(h.seed.eventId);
    },
    close: () => ws.close(),
  };
}

const credentialState = async (id: string) => (await h.app.ctx.repos.credentials.byId(id))!.state;
const post = (scans: Parameters<typeof postScans>[1]) => postScans<{ results: { result: string }[] }>(h, scans);

describe("credential state changes reach the holder", () => {
  it("first admission (issued → active): a frame, no notice", async () => {
    const p = await holder();
    const before = await p.notices();
    expect(await credentialState(p.credentialId)).toBe("issued");
    expect((await post([scan(h, h.seed.checkpoints.mainIn, band(p.uid))])).body.results[0]!.result).toBe("admitted");
    await p.framesAre(["active"]);
    expect(await p.notices()).toEqual(before);
    // Another passage changes no state: no frame.
    h.clock.advance(2 * MIN);
    await post([scan(h, h.seed.checkpoints.mainOut, band(p.uid))]);
    await p.framesAre(["active"]);
    p.close();
  });

  it("impossible travel at a gate (→ suspended_review), then a supervisor's clear (→ active): a frame and a notice each", async () => {
    const p = await holder();
    await post([scan(h, h.seed.checkpoints.eastIn, band(p.uid))]);
    h.clock.advance(90_000); // East Entrance → VIP Lounge takes at least 300 s
    expect((await post([scan(h, h.seed.checkpoints.vip, band(p.uid))])).body.results[0]!.result).toBe("suspended");
    expect(await credentialState(p.credentialId)).toBe("suspended_review");
    await p.framesAre(["active", "suspended_review"]);
    expect(await p.notices()).toContain("Your pass is under review");
    const r = await h.call("POST", `/credentials/${p.credentialId}/clear-review`, { token: organiser, body: { outcome: "clear", note: "ID checked at the door" } });
    expect(r.status).toBe(200);
    await p.framesAre(["active", "suspended_review", "active"]);
    expect(await p.notices()).toContain("Your pass works again");
    p.close();
  });

  it("an offline conflict found at sync (→ suspended_review), then revoked from review (→ revoked): a frame and a notice each", async () => {
    const p = await holder();
    await post([scan(h, h.seed.checkpoints.mainIn, band(p.uid))]);
    h.clock.advance(2 * MIN);
    await post([scan(h, h.seed.checkpoints.press, band(p.uid))]);
    h.clock.advance(2 * MIN);
    const r = await post([scan(h, h.seed.checkpoints.eastIn, band(p.uid), { offline: true, local_result: "admitted" })]);
    expect(r.body.results[0]!.result).toBe("already_inside");
    expect(await credentialState(p.credentialId)).toBe("suspended_review");
    await p.framesAre(["active", "suspended_review"]);
    expect((await p.notices()).filter((t) => t === "Your pass is under review")).toHaveLength(1);
    // A second conflicting scan while under review changes nothing: no frame, no second notice.
    h.clock.advance(2 * MIN);
    await post([scan(h, h.seed.checkpoints.mainIn, band(p.uid), { offline: true, local_result: "admitted" })]);
    await p.framesAre(["active", "suspended_review"]);
    expect((await p.notices()).filter((t) => t === "Your pass is under review")).toHaveLength(1);
    const rv = await h.call("POST", `/credentials/${p.credentialId}/clear-review`, { token: organiser, body: { outcome: "revoke", note: "Pass-back confirmed" } });
    expect(rv.status).toBe(200);
    await p.framesAre(["active", "suspended_review", "revoked"]);
    expect(await p.notices()).toContain("Your pass was cancelled");
    p.close();
  });

  it("an operator revokes an issued pass (→ revoked): a frame and a notice", async () => {
    const p = await holder();
    await h.call("POST", `/credentials/${p.credentialId}/revoke`, { token: organiser, body: { reason: "refund" } });
    await p.framesAre(["revoked"]);
    expect(await p.notices()).toContain("Your pass was cancelled");
    // Revoking again is no transition.
    await h.call("POST", `/credentials/${p.credentialId}/revoke`, { token: organiser, body: { reason: "refund" } });
    await p.framesAre(["revoked"]);
    p.close();
  });

  it("the desk replaces a lost band (the store's one-step → replaced): a frame and the re-issued notice", async () => {
    const p = await holder();
    const fresh = randomBytes(7).toString("hex").toUpperCase();
    await h.app.ctx.repos.carriers.insert({ id: randomUUID(), credential_id: null, kind: "nfc", identifier: nfcIdentifier(fresh), chip_profile: "ntag_uid", state: "stock", bound_at: null, redeemed_at: null });
    const old = (await h.app.ctx.repos.carriers.forCredential(p.credentialId)).find((c) => c.kind === "nfc")!;
    const r = await h.call("POST", `/carriers/${old.id}/rebind`, { token: adminMfa, body: { identifier: fresh, reason: "lost at lunch", disposition: "lost" } });
    expect(r.status).toBe(200);
    expect(await credentialState(p.credentialId)).toBe("replaced");
    await p.framesAre(["replaced"]);
    expect((await p.notices()).filter((t) => t === "Your pass was re-issued")).toHaveLength(1);
    p.close();
  });
});

describe("one write path", () => {
  it("only domain/credential-state.ts writes a credential's state", () => {
    const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = path.join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (name.endsWith(".ts")) files.push(p);
      }
    };
    walk(src);
    const callers = files.filter((f) => /credentials\.setState\(/.test(readFileSync(f, "utf8"))).map((f) => path.relative(src, f).replace(/\\/g, "/"));
    expect(callers).toEqual(["domain/credential-state.ts"]);
    // And no other write names a state through the general update.
    const stray = files.filter((f) => /credentials\.update\([^)]*\bstate:/.test(readFileSync(f, "utf8")));
    expect(stray).toEqual([]);
  });
});
