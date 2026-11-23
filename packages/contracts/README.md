# @synan/contracts

Zod schemas and inferred types for every API payload. The product name lives only in `src/brand.ts`. Source-only: import it directly, no build
step. Specification: [docs/02-architecture.md §5–§7](../../docs/02-architecture.md).

```ts
import { ScanResult, AttendeeTier } from "@synan/contracts/enums";
import { SCAN_RESULT_COPY, ERROR_COPY, ApiError } from "@synan/contracts/errors";
import { endpoints, type ResponseOf } from "@synan/contracts/rest";
import { TelemetryServerMessage, ClientMessage } from "@synan/contracts/ws";

type Events = ResponseOf<typeof endpoints.listEvents>;
const parsed = endpoints.listEvents.response.parse(await res.json());
```

- `src/enums` — every enum, as a Zod schema, a TS union, and a `*_VALUES` tuple.
- `src/errors` — `ErrorCode`, `ERROR_COPY`, `SCAN_RESULT_COPY` (the only place UI copy for results and
  errors lives), `ApiError` body schema.
- `src/rest` — `endpoints`: one entry per 02 §5 endpoint with `method`, `path`, `access`, `mfa`,
  `params`, `query`, `body`, `response`. MSW handlers and the API are both built from it.
- `src/ws` — per-channel discriminated unions, `ClientMessage`, close codes.

`pnpm --filter @synan/contracts typecheck` · `pnpm --filter @synan/contracts test`
