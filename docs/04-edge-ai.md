# Synan — Edge AI

Local machine intelligence that turns Synan from a passive record of what happened into a
forecast of what is about to. **This is Phase 6, the last phase** (D-08): AI is integrated only
after the full system is built, hardened, and running. Until then, the deterministic rules in
[01 §7](01-product.md) do the work, and no screen, endpoint, or table depends on a model.

**The one thing done early.** Raw scans are destroyed after every event, so a forecasting model can
only learn from aggregates. Per-gate, per-minute scan rates are therefore recorded from the first
day the backend runs (D-16, [02 §4.5](02-architecture.md)). Every event held before Phase 6 becomes
training history instead of being lost.

---

## 1. Mandate

**All inference runs locally, on hardware at the venue. No cloud model API is called during a live
event.** This keeps anomaly classification under a second and keeps attendee data inside the venue
network.

---

## 2. Models and runtime

| Item | Choice | Why |
| --- | --- | --- |
| Primary model | Llama-3-8B | Mature open-weights ecosystem; fine-tunable with LoRA / QLoRA; strong reasoning across multi-sensor streams |
| Compact alternative | Gemma-2-2B | For resource-constrained checkpoint gateways |
| Quantisation | 4-bit integer (INT4) | Lower memory use with high batch throughput |
| Runtime | `llama.cpp` or vLLM | Local serving |

Open weights are chosen deliberately: full control of fine-tuning, deployment, and cost, with no
vendor lock-in. Hardware sizing per venue is open (O-12).

---

## 3. Intelligence modules

| Module | Reads | Produces |
| --- | --- | --- |
| **Security and anomaly detection** | Sequences of checkpoint scans, zone transition times | Flags impossible travel between distant zones, tailgating patterns, and unauthorised loitering. Raises alerts on `/stream/alerts`. |
| **Crowd and bottleneck forecasting** | Historical check-in velocity, live gate scan rates, current room density | Forecasts queue congestion and room saturation 15 to 30 minutes ahead. |
| **Schedule and space optimisation** | Live occupancy, session attendance trends, room capacity thresholds | Recommends room reallocations, overflow space activation, or session buffer changes to administrators. |
| **Attendee session recommendations** | Opt-in attendee interest tags, live track popularity, live room availability | Lightweight session suggestions that spread crowds across the venue. |

**Relationship to version 1.** Impossible travel already exists in version 1 as a fixed transit-time
rule. The anomaly module refines that rule; it does not introduce it. Capacity warnings already exist
as fixed thresholds; forecasting makes them earlier.

---

## 4. Guardrails

1. **Hybrid pipeline.** Hard boundaries — room capacity limits, revoked credentials, tier permissions
   — are enforced instantly by deterministic rules. The model evaluates only what rules cannot:
   behavioural patterns and multi-zone context.
2. **Advisory only.** The model classifies and forecasts. It never admits or refuses anyone, so it
   cannot be coerced into unlocking a restricted area.
3. **Structured input only.** The model never reads free text supplied by a user — no names, bios, or
   company titles. Its input is sanitised numeric and categorical arrays: `timestamp`, `zone_id`,
   `tier_code`, `scan_velocity`. This closes the prompt-injection route.
4. **No personal data.** Inference runs on ephemeral attendee IDs
   ([03 §5](03-security-privacy.md)). Recommendations use interest tags only where the attendee has
   opted in.
5. **Poisoning resistance.** Hardware tap debouncing and per-checkpoint rate limits stop a flooded
   sensor from skewing density forecasts.

---

## 5. Where AI appears in the interface

No screen depends on AI. When Phase 6 lands, these existing screens gain an additional element; the
screens themselves are specified in [06-screens.md](06-screens.md).

| Screen | Addition |
| --- | --- |
| D1 Command Center | Forecast warnings in the alert notice ("Hall B saturates in ~15 min"), with a suggested overflow route |
| D10 Security alerts | New alert kinds from the anomaly module: tailgating, loitering. Each is labelled as model-raised and shows the scans it was based on |
| D6 Event workspace → Schedule | Room reallocation and buffer suggestions, accepted or dismissed by an operator |
| A6 Agenda | Session suggestions, only for attendees who opted in to interest tags |

Every model-raised item is visibly marked as a suggestion and is never applied without a person
accepting it.
