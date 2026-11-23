# @synan/mock

Deterministic mock layer for the Synan apps. Usage only; the strategy is in
[docs/02-architecture.md §8](../../docs/02-architecture.md). Payload shapes come from
`@synan/contracts` (type-only imports, so no Zod at runtime).

```ts
import { MockClock, createPortalStore, MockRealtime, DEMO_NOW } from "@synan/mock";

const clock = new MockClock(DEMO_NOW);                  // set(), advance(), setRate(0) pauses
const portal = createPortalStore({ clock, storage: localStorage });
const realtime = new MockRealtime({ clock, portal });

portal.listEvents();                                     // listed events, contract EventDetail inside
portal.codes();                                          // PortalCodeBatch: rotating signed-QR shape
realtime.subscribe("/stream/me", (message) => { /* pass.status, … */ });
realtime.play("credential_revoked_mid_pass");            // any name in SCENARIO_NAMES
```

Operator-scale data (2 venues, 60 rooms, 1,400 attendees, 40,000 scans) is generated on demand
from a separate entry so the Attendee Portal never bundles it:

```ts
import { generateSeed } from "@synan/mock/seed";
```

Desk codes for the bind screen: `K4M2PZ` binds, `BUSY27` is already bound to someone else.
