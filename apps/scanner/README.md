# @synan/scanner

Gate Scanner. Usage only; screens are specified in
[docs/06-screens.md §3](../../docs/06-screens.md).

```
corepack pnpm --filter @synan/scanner dev        # http://localhost:5175/scan/
corepack pnpm --filter @synan/scanner typecheck
corepack pnpm --filter @synan/scanner build
```

The five routes (`/scan`, `/scan/pair`, `/scan/recent`, `/scan/queue`, `/scan/help`) are placeholders
until Phase 3. `/scan` listens to `MockRealtime` from `@synan/mock` so a scenario can be replayed.
