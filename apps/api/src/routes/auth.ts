import type { Express } from "express";
import { ContractError } from "@synan/contracts/errors";
import { endpoints, WS_SUBPROTOCOL, WS_TICKET_PREFIX } from "@synan/contracts/rest";
import type { AppContext } from "../app.js";
import { mount } from "../http/route.js";
import { authoriseChannel } from "../realtime/ws-server.js";
import { sha256b64url } from "../lib/crypto.js";
import { completePendingRegistration } from "./registration.js";
import type { ClientContext } from "../domain/auth-service.js";

/** What the session records about the client: a shortened user agent and the address (the store keeps only its prefix). */
export const clientOf = (req: { headers: Record<string, string | string[] | undefined> }, ip: string): ClientContext => {
  const ua = req.headers["user-agent"];
  return { userAgent: (Array.isArray(ua) ? ua[0] : ua)?.slice(0, 200) ?? null, ip: ip.replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, "") || null };
};

export function authRoutes(x: Express, app: AppContext) {
  mount(x, app, endpoints.login, async ({ body, req, ip }) => {
    // Per-account limit on failed attempts, on top of the per-IP limit: slows password guessing
    // against one operator from many IPs. Successful logins do not count.
    const key = `login-fail:${body.email.toLowerCase()}`;
    if (app.rateLimiter.blocked(key, 5, 15 * 60_000) !== null) throw new ContractError("RATE_LIMITED");
    try {
      const tokens = await app.auth.login(body.email, body.password, clientOf(req, ip));
      app.rateLimiter.clear(key);
      return tokens;
    } catch (e) {
      if (e instanceof ContractError && e.code === "INVALID_CREDENTIALS") app.rateLimiter.hit(key, 5, 15 * 60_000);
      throw e;
    }
  });

  mount(x, app, endpoints.refresh, async ({ body, req, ip }) => app.auth.refresh(body.refresh_token, clientOf(req, ip)));

  mount(x, app, endpoints.emailLink, async ({ body, ip }) => {
    // This endpoint never fails, so the route's "count failures only" rule would never charge it:
    // every request counts against the address (it is the enumeration surface).
    app.rateLimiter.hit(`ip:${ip}:${endpoints.emailLink.path}`, app.config.rateLimits.authPerMin, 60_000);
    const retry = app.rateLimiter.hit(`link:${body.email.toLowerCase()}`, 3, 15 * 60_000);
    if (retry === null) await app.auth.requestEmailLink(body.email, body.return_to);
    // Same answer whether the address exists, was limited, or was sent.
    return { accepted: true as const };
  });

  mount(x, app, endpoints.verify, async ({ body, req, ip }) => {
    const tokens = await app.auth.verifyEmailLink(body.token, clientOf(req, ip));
    // A registration kept pending with this link (POST /users/register) completes now, on this device.
    await completePendingRegistration(app, sha256b64url(body.token), tokens.principal.sub);
    return tokens;
  });

  mount(x, app, endpoints.logout, async ({ ctx }) => {
    await app.auth.logout(ctx!);
    return { ok: true as const };
  });

  mount(x, app, endpoints.mfaVerify, async ({ body, ctx, req, ip }) => {
    // Per-account limit on wrong codes (03 Â§3 "per-token"): 5 per 15 minutes, whatever the address.
    const key = `mfa-fail:${ctx!.sub}`;
    if (app.rateLimiter.blocked(key, 5, 15 * 60_000) !== null) throw new ContractError("RATE_LIMITED");
    try {
      const tokens = await app.auth.mfaVerify(ctx!, body.code, clientOf(req, ip));
      app.rateLimiter.clear(key);
      return tokens;
    } catch (e) {
      if (e instanceof ContractError && e.code === "INVALID_MFA_CODE") app.rateLimiter.hit(key, 5, 15 * 60_000);
      throw e;
    }
  });

  mount(x, app, endpoints.wsTicket, async ({ body, ctx, ip }) => {
    // Authorise the channel at mint time; the upgrade re-checks against the stored grant.
    try {
      await authoriseChannel(app, ctx!, body.channel, body.event_id ?? null, body.checkpoint_id ?? null);
    } catch (e) {
      // A scanner stream asked for a gate its user is not staffing now (03 Â§8.2).
      if (body.channel === "/stream/scans" && e instanceof ContractError && e.code === "CHECKPOINT_NOT_ASSIGNED") {
        await app.scannerTrust.refused({ reason: "not_assigned", channel: "POST /auth/ws-ticket /stream/scans", ip, userId: ctx!.sub, checkpointId: body.checkpoint_id ?? null, eventId: body.event_id ?? null });
      }
      throw e;
    }
    const { ticket, expiresAt } = await app.auth.mintWsTicket({
      ctx: ctx!,
      channel: body.channel,
      eventId: body.event_id ?? null,
      checkpointId: body.checkpoint_id ?? null,
    });
    return {
      ticket,
      expires_at: new Date(expiresAt).toISOString(),
      protocols: [WS_SUBPROTOCOL, `${WS_TICKET_PREFIX}${ticket}`] as [typeof WS_SUBPROTOCOL, string],
      channel: body.channel,
    };
  });

  // The QR leeway is published so an offline scanner verifies codes with the same tolerance (A6).
  mount(x, app, endpoints.signingKeys, async () => ({ keys: app.keys.publicKeys(), qr_leeway_s: app.config.qrLeewayS }));

  mount(x, app, endpoints.time, async () => {
    const now = app.clock.now();
    return { server_time: new Date(now).toISOString(), epoch_ms: now, qr_leeway_s: app.config.qrLeewayS };
  });
}
