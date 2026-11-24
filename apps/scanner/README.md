# @synan/scanner

Gate Scanner. Usage only; screens are specified in
[docs/06-screens.md §3](../../docs/06-screens.md).

```text
corepack pnpm --filter @synan/scanner dev        # http://localhost:5175/scan/
corepack pnpm --filter @synan/scanner typecheck
corepack pnpm --filter @synan/scanner build      # also writes manifest.webmanifest and sw.js
corepack pnpm --filter @synan/scanner test       # offline core: QR and allowlist verification, decision, queue
```

Installable: `build` emits a web manifest and a small service worker (from
`packages/ui/src/components/mobile/pwa-plugin.ts`), so an installed scanner opens and decides
scans with no connection. The dev server never registers a worker.

All five routes work against the mock (`src/data/mock.ts`, `src/data/store.ts`): choose a gate,
scan, see recent scans with Undo, the offline queue, and the help screen. Decisions follow
docs/01 §7 locally and are kept on the device (localStorage until the Phase 3 IndexedDB queue).

Trying it in a desktop browser:

- Type a wristband number with **123**, or type it anywhere on the scan screen followed by Enter
  (that is how USB and Bluetooth readers arrive). Demo numbers are listed at the top of
  `src/data/mock.ts`: `04A29F31C7D0E2` admits, then reads as already inside; `04C1D2E3F4A5B6` is
  revoked; anything unknown is not recognised.
- `?offline=1` behaves as if the network were down (verdicts tagged LOCAL, scans queued);
  `?offline=0` restores it and sends the queue.
- The camera reads QR codes where the browser has `BarcodeDetector` (Chrome on Android). Web NFC
  needs Chrome on Android (D-09).

## Against the real API

Set `VITE_API_URL` to the API's origin; unset, the scanner runs on the mock exactly as above.

```text
VITE_API_URL=http://127.0.0.1:5180 corepack pnpm --filter @synan/scanner dev
```

The API must allow the scanner's origin (`ALLOWED_ORIGINS` in `apps/api/.env`; the default
includes `http://localhost:5175`). Sign in on S1 with a gate staff account from the dev seed (the
API prints them at start). Code lives in `src/data/api/`:

- `client.ts` typed fetch client (types from `@synan/contracts/rest`, no Zod in the bundle), the
  session, and refresh under a Web Lock shared by tabs (refresh tokens are single-use).
- `crypto.ts` WebCrypto Ed25519: portal and emailed QR codes, and the signed allowlist, verified
  with public keys from `GET /auth/signing-keys`. Without Ed25519 or outside a secure context
  (HTTPS or localhost) nothing is trusted offline: every offline read is refused.
- `decide.ts` the offline decision, in the server's order, for what a scanner can know.
- `queue.ts`, `idb.ts` the IndexedDB queue: each scan is stored before its verdict shows, with an
  idempotency key, `occurred_at` and the clock offset, and sent in order with `POST /scans`.
- `stream.ts` `/stream/scans` with a single-use ticket in the subprotocol, heartbeats, backoff.
- `runtime.ts` ties it together and feeds the existing screens through `src/data/store.ts`.
