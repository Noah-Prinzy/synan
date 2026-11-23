# @synan/scanner

Gate Scanner. Usage only; screens are specified in
[docs/06-screens.md §3](../../docs/06-screens.md).

```text
corepack pnpm --filter @synan/scanner dev        # http://localhost:5175/scan/
corepack pnpm --filter @synan/scanner typecheck
corepack pnpm --filter @synan/scanner build      # also writes manifest.webmanifest and sw.js
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
