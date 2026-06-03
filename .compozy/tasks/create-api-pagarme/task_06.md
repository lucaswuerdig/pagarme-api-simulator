---
status: pending
title: HTTP routes (orders, capture, cancel, tokens, health, reset)
type: backend
complexity: high
dependencies:
  - task_03
  - task_04
  - task_05
---

# Task 6: HTTP routes (orders, capture, cancel, tokens, health, reset)

## Overview
Wire the Express route layer that ties resolver, builders, and store together: the five Pagar.me
`/core/v5/...` routes plus `GET /health` and the test-only `POST /__reset`. This is where requests
resolve an outcome, persist or look up a record, and return the correct body with the correct HTTP
status (200 for business outcomes, 5xx only for the outage card) — TechSpec "API Endpoints".

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST serve all routes under the `/core/v5/...` prefix exactly as the real Pagar.me (`_idea.md` §7): `POST /core/v5/orders`, `POST /core/v5/charges/:id/capture`, `DELETE /core/v5/charges/:id`, `POST /core/v5/tokens`.
- MUST return HTTP 200 for all business outcomes (approved/declined/error/order-failed) and 5xx ONLY for `gateway_unavailable` (`_idea.md` §3.3).
- MUST persist an `OrderRecord` on order creation and look it up by `charge_id` for capture and cancel, echoing the original amount and ids.
- MUST return a body-level error (`last_transaction.status = "with_error"`, `success: false`) at HTTP 200 when capture/cancel targets an unknown `charge_id`.
- MUST accept and ignore the `Authorization` header (no key validation) per `_idea.md` §2.
- MUST add `GET /health` returning `{ "status": "ok" }` and `POST /__reset` calling `store.clear()` (test-only, not a Pagar.me route).
- MUST consume the `OrderStore` via injection so tests can supply the in-memory store.
</requirements>

## Subtasks
- [ ] 6.1 Implement `POST /core/v5/orders`: resolve outcome, mint ids, persist record, return order body or 5xx.
- [ ] 6.2 Implement `POST /core/v5/charges/:id/capture`: look up record, set captured, return charge body.
- [ ] 6.3 Implement `DELETE /core/v5/charges/:id`: look up record, set voided/refunded, return charge body with canceled/refunded amount.
- [ ] 6.4 Implement `POST /core/v5/tokens`: resolve token outcome, return token body.
- [ ] 6.5 Implement `GET /health` and the test-only `POST /__reset`.
- [ ] 6.6 Mount all routers on the app from Task 01 with `OrderStore` injected.

## Implementation Details
Create route modules under `src/routes/` (orders, charges [capture + cancel], tokens, health, reset) and
mount them in `src/server.ts`. Handlers are thin: call `resolveOutcome` (Task 04), `store` create/get/
update (Task 03), and the builders (Task 05). The HTTP-status policy and route table are in TechSpec
"API Endpoints" and `_idea.md` §3.3/§4 — reference, do not duplicate. Inject the store via a factory
parameter so Task 07's KV store drops in without route changes.

### Relevant Files
- `src/routes/orders.ts` — create: `POST /core/v5/orders` handler.
- `src/routes/charges.ts` — create: capture + cancel/refund handlers.
- `src/routes/tokens.ts` — create: `POST /core/v5/tokens` handler.
- `src/routes/health.ts` — create: `GET /health`.
- `src/routes/reset.ts` — create: `POST /__reset`.
- `src/server.ts` — modify: mount routers, accept injected `OrderStore`.

### Dependent Files
- `api/index.ts` (Task 08) — serves these routes through the Vercel function.
- `src/store/*` (Tasks 03, 07) — injected store implementation.

### Related ADRs
- [ADR-001: Stateful, contract-faithful fake over stateless stub](adrs/adr-001.md) — Capture/cancel resolve the prior charge via the store.
- [ADR-003: Credit-card-only scope with deterministic magic-card outcomes](adrs/adr-003.md) — Only these five routes plus health/reset are exposed.
- [ADR-005: In-memory store with opaque IDs and a test-only reset route](adrs/adr-005.md) — `/__reset` and store injection.

## Deliverables
- All five Pagar.me routes plus `/health` and `/__reset`, mounted with an injected store.
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration tests (supertest) covering every scenario and the full lifecycle **(REQUIRED)**

## Tests
- Unit tests:
  - [ ] The order handler returns 5xx for the `gateway_unavailable` card and 200 for all other outcomes.
  - [ ] Capture handler against an unknown `charge_id` returns 200 with `last_transaction.status = "with_error"`, `success: false`.
- Integration tests (supertest, in-memory store):
  - [ ] `POST /core/v5/orders` with `4000000000000010` returns 200 with `captured`/`success: true`.
  - [ ] `POST /core/v5/orders` with `4000000000000002` returns 200 with `not_authorized`/`success: false`.
  - [ ] `POST /core/v5/orders` with `4000000000009999` returns HTTP 500/503.
  - [ ] Lifecycle: pre-auth order (`...0028`) → `POST /core/v5/charges/:id/capture` with the returned id → 200 `captured`.
  - [ ] Lifecycle: sale → `DELETE /core/v5/charges/:id` → 200 with `voided` and `canceled_amount`.
  - [ ] `POST /core/v5/tokens` returns 200/201 with `id` and `card.id`.
  - [ ] `GET /health` returns 200 `{ "status": "ok" }`.
  - [ ] `POST /__reset` then capture against a pre-reset `charge_id` resolves as not-found (body-level error).
  - [ ] A request with no/invalid `Authorization` header still succeeds (header ignored).
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- Every magic-card scenario is reachable via HTTP with the correct status and body
- sale→capture→cancel resolves against the stored charge id and amount
