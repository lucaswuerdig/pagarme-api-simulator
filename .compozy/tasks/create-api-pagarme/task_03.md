---
status: pending
title: OrderStore interface, in-memory impl & opaque ID util
type: backend
complexity: medium
dependencies:
  - task_02
---

# Task 3: OrderStore interface, in-memory impl & opaque ID util

## Overview
Define the async `OrderStore` interface that the route layer depends on, provide the `InMemoryOrderStore`
implementation used for local dev and hermetic CI tests, and add the opaque ID utility that mints
`or_fake_`, `ch_fake_`, `card_fake_`, and `tran_fake_` identifiers. This is the persistence seam that
keeps the sale→capture→cancel lifecycle coherent (TechSpec "Core Interfaces"; ADR-005).

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST define the async `OrderStore` interface exactly as in TechSpec "Core Interfaces": `create`, `get`, `update`, `clear`, all returning Promises.
- MUST provide an `InMemoryOrderStore` backed by a `Map` keyed by `charge_id`.
- MUST make `update` a no-op returning `undefined` for an unknown `charge_id`.
- MUST mint opaque, collision-resistant IDs with the correct prefix per entity type (`or_fake_`, `ch_fake_`, `card_fake_`, `tran_fake_`), per ADR-005.
- MUST keep IDs opaque (random suffix), NOT sequential, so concurrent runs do not collide.
- MUST NOT implement the KV backend here (that is Task 07); the interface must be backend-agnostic.
</requirements>

## Subtasks
- [ ] 3.1 Define the async `OrderStore` interface in `src/store/orderStore.ts`.
- [ ] 3.2 Implement `InMemoryOrderStore` (Map keyed by `charge_id`) with create/get/update/clear.
- [ ] 3.3 Implement the opaque ID utility minting prefixed, unique identifiers.
- [ ] 3.4 Ensure `update` on a missing `charge_id` returns `undefined` without throwing.

## Implementation Details
Create `src/store/orderStore.ts` (interface), `src/store/inMemoryOrderStore.ts` (Map impl), and
`src/util/ids.ts` (ID minting). The interface signatures are defined in TechSpec "Core Interfaces" —
reference, do not duplicate. The shared store test suite written here is reused by Task 07 against a
mocked KV client. See ADR-005 for opaque-ID and reset rationale.

### Relevant Files
- `src/store/orderStore.ts` — create: the `OrderStore` interface.
- `src/store/inMemoryOrderStore.ts` — create: Map-backed implementation.
- `src/util/ids.ts` — create: prefixed opaque ID generator.

### Dependent Files
- `src/store/kvOrderStore.ts` + factory (Task 07) — implements the same interface.
- `src/routes/*` (Task 06) — call store create/get/update; `/__reset` calls `clear`.
- `src/responses/*` (Task 05) — consume minted IDs placed on the `OrderRecord`.

### Related ADRs
- [ADR-005: In-memory store with opaque IDs and a test-only reset route](adrs/adr-005.md) — Defines the in-memory impl, opaque IDs, and the clear/reset behavior.
- [ADR-001: Stateful, contract-faithful fake over stateless stub](adrs/adr-001.md) — Justifies keeping lifecycle state at all.

## Deliverables
- `OrderStore` interface + `InMemoryOrderStore` implementation + opaque ID utility.
- A reusable store contract test suite (consumed by Task 07).
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration tests for the create→get→update→clear lifecycle **(REQUIRED)**

## Tests
- Unit tests:
  - [ ] `create` then `get(chargeId)` returns the same `OrderRecord`.
  - [ ] `update(chargeId, { status: "canceled" })` mutates and returns the patched record.
  - [ ] `update("missing_id", ...)` returns `undefined` and does not throw.
  - [ ] `clear()` empties the store so a subsequent `get` returns `undefined`.
  - [ ] ID util produces values matching `^or_fake_`, `^ch_fake_`, `^card_fake_`, `^tran_fake_` prefixes.
  - [ ] 1000 minted IDs of one prefix are all unique (collision check).
- Integration tests:
  - [ ] Full lifecycle on `InMemoryOrderStore`: create (paid) → update to captured → update to canceled, reading the record at each step.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- `OrderStore` interface is backend-agnostic and reused unchanged by Task 07
- IDs are opaque, prefixed, and unique under repeated generation
