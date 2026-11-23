/**
 * In-memory implementations of the short-lived single-use codes for the memory backend, mirroring
 * @synan/db's desk_code_create / desk_code_consume and user_invite_create / user_invite_consume.
 */
import { createHash, randomBytes, randomInt } from "node:crypto";
import type { CarrierRow, DeskCodesRepo, UserInvitesRepo } from "./types.js";

const DESK_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function inProcessDeskCodes(carrierByIdentifier: (h: string) => CarrierRow | undefined): DeskCodesRepo {
  const byHash = new Map<string, { band: string; expiresAt: Date; used: boolean }>();
  const failures = new Map<string, number[]>();
  const h = (code: string) => createHash("sha256").update(`desk_code ${code.replace(/[\s-]/g, "").toUpperCase()}`).digest("base64url");
  return {
    async create({ bandIdentifier, now }) {
      const band = carrierByIdentifier(bandIdentifier);
      if (!band) return { status: "unknown_carrier", code: null, expires_at: null };
      if (band.state !== "stock") return { status: "not_in_stock", code: null, expires_at: null };
      for (const [k, v] of byHash) if (v.band === bandIdentifier && !v.used) byHash.delete(k);
      const code = Array.from({ length: 6 }, () => DESK_ALPHABET[randomInt(DESK_ALPHABET.length)]).join("");
      const expiresAt = new Date(now.getTime() + 10 * 60_000);
      byHash.set(h(code), { band: bandIdentifier, expiresAt, used: false });
      return { status: "created", code, expires_at: expiresAt };
    },
    async consume({ code, attendeeId, now }) {
      const recent = (failures.get(attendeeId) ?? []).filter((t) => t > now.getTime() - 10 * 60_000);
      if (recent.length >= 5) return { status: "too_many_attempts", carrier_identifier: null };
      const fail = (status: "invalid" | "expired" | "already_used") => {
        failures.set(attendeeId, [...recent, now.getTime()]);
        return { status, carrier_identifier: null };
      };
      const c = byHash.get(h(code));
      if (!c) return fail("invalid");
      if (c.used) return fail("already_used");
      if (c.expiresAt.getTime() <= now.getTime()) return fail("expired");
      c.used = true;
      return { status: "consumed", carrier_identifier: c.band };
    },
  };
}

export function inProcessUserInvites(): UserInvitesRepo {
  const byHash = new Map<string, { userId: string; expiresAt: Date; used: boolean }>();
  const h = (t: string) => createHash("sha256").update(t).digest("base64url");
  return {
    async create({ userId, now }) {
      for (const [k, v] of byHash) if (v.userId === userId) byHash.delete(k);
      const token = randomBytes(32).toString("base64url");
      byHash.set(h(token), { userId, expiresAt: new Date(now.getTime() + 72 * 3600_000), used: false });
      return token;
    },
    async consume(token, now) {
      const v = byHash.get(h(token));
      if (!v || v.used || v.expiresAt.getTime() <= now.getTime()) return null;
      v.used = true;
      return v.userId;
    },
  };
}
