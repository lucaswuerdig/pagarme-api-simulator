# TechSpec: Fake Pagar.me API (Homologation Test Double)

## Executive Summary

This service is a standalone HTTP test double for Pagar.me v5, implemented in **Node.js + Express
with TypeScript**. It exposes the exact five `/core/v5/...` credit-card routes the consuming Laravel
app calls — create order, capture charge, cancel/refund charge, tokenize card — and returns response
bodies whose fields match what that app's parser reads (`_idea.md` §3, §4). Approval is conveyed in
the **response body** (`last_transaction.status` + `success`), not the HTTP status: business outcomes
return HTTP 200 and only simulated gateway outages return 5xx. Outcomes are selected deterministically
from the incoming card number/token via a fixed magic-card table ([ADR-003](adrs/adr-003.md)). A
single in-memory store keyed by `charge_id` keeps the sale → capture → cancel lifecycle coherent
([ADR-001](adrs/adr-001.md), [ADR-005](adrs/adr-005.md)).

The primary technical trade-off: TypeScript adds a `tsc` build step and a Node runtime in the image
in exchange for compile-time protection over the many response fields the consuming app reads
downstream ([ADR-004](adrs/adr-004.md)). A second deliberate trade-off — a test-only `POST /__reset`
route and opaque (non-sequential) IDs — favors robust shared-instance test isolation over a strictly
zero-extra-surface stub ([ADR-005](adrs/adr-005.md)). The deliverable is the service plus a Dockerfile,
docker-compose, and a connection guide; no code is committed to the consuming app's repository
([ADR-002](adrs/adr-002.md)).

## System Architecture

### Component Overview

A single Express process. A request flows: **Router → Magic-card resolver → Response builder ↔
Order store → JSON response.**

- **HTTP server / router** (`src/server.ts`, `src/routes/`): registers the five Pagar.me routes plus
  `GET /health` and `POST /__reset`. Parses JSON, dispatches to handlers. Boundary: HTTP in/out only;
  no business logic.
- **Magic-card resolver** (`src/magic/cards.ts`): pure function mapping an incoming card number or
  `card_id`/`card_token` to one of six outcomes (approved+captured, approved-no-capture, declined,
  transaction error, order failed, gateway unavailable). Single source of scenario truth.
- **Response builders** (`src/responses/`): pure functions that assemble the contract-faithful order,
  charge, and token bodies for a given outcome and the persisted record. Owns every ⭐ field.
- **Order store** (`src/store/orderStore.ts`): in-memory `Map<chargeId, OrderRecord>`. Created on
  `POST /orders`; read/updated on capture and cancel; cleared by `/__reset` or restart
  ([ADR-005](adrs/adr-005.md)).
- **ID + type support** (`src/util/ids.ts`, `src/types/pagarme.ts`): opaque ID minting and the
  TypeScript contract models.

**Data flow.** `POST /orders` resolves the outcome from the card, mints `order_id`/`charge_id`/
`card_id`, persists an `OrderRecord`, and returns the order body. `POST /charges/{id}/capture` and
`DELETE /charges/{id}` look up the record by `charge_id`, update its status, and return a charge body.
`POST /tokens` returns a token body (tokenization is stateless beyond echoing card metadata).

**External system interactions.** None at runtime — the fake performs no real card processing, stores
no real card data, and accepts but ignores the `Authorization` header (`_idea.md` §2).

## Implementation Design

### Core Interfaces

The store other components depend on, and the resolved-outcome contract:

```typescript
// src/store/orderStore.ts
export interface OrderRecord {
  orderId: string;        // or_fake_...
  chargeId: string;       // ch_fake_...  (Map key)
  cardId: string;         // card_fake_...
  code: string;           // echoed from request
  amount: number;         // minor units (cents)
  status: ChargeStatus;   // paid | authorized_pending_capture | canceled | refunded | failed
  outcome: Outcome;       // resolved magic-card scenario
  metadata: Record<string, unknown>;
}

export interface OrderStore {
  create(record: OrderRecord): OrderRecord;
  get(chargeId: string): OrderRecord | undefined;
  update(chargeId: string, patch: Partial<OrderRecord>): OrderRecord | undefined;
  clear(): void;          // backs POST /__reset
}
```

```typescript
// src/magic/cards.ts
export type Outcome =
  | "approved_captured"      // 200, last_transaction.status=captured, success=true
  | "approved_no_capture"    // 200, status=authorized_pending_capture, success=true
  | "declined"               // 200, status=not_authorized, success=false, return_code=57
  | "transaction_error"      // 200, last_transaction.status=with_error, success=false
  | "order_failed"           // 200, root status=failed
  | "gateway_unavailable";   // 5xx

// Resolves from credit_card.card.number, or card_id / card_token. Defaults to approved_captured.
export function resolveOutcome(input: { number?: string; cardId?: string; cardToken?: string }): Outcome;
```

**Error handling conventions.** Business outcomes (approved/declined/error/order-failed) always
return HTTP 200 with the result encoded in the body — never a 4xx — so the consuming app's Guzzle
client reaches the body parser rather than its infra-error path (`_idea.md` §3.3). `gateway_unavailable`
returns 500/503. Capture/cancel against an unknown `charge_id` return a body-level error
(`last_transaction.status=with_error`, `success=false`) at HTTP 200. Tokenization errors may use 4xx.

### Data Models

Contract models in `src/types/pagarme.ts`, mirroring `_idea.md` §4 exactly (snake_case on the wire):

- **Order** (response): `id`, `code`, `status`, `amount`, `currency`, `closed`, `customer`,
  `charges: Charge[]`, `metadata`.
- **Charge**: `id`, `code`, `amount`, `status`, `payment_method`, `last_transaction`,
  optionally `canceled_amount` / `refunded_amount`.
- **Transaction** (`last_transaction`): `id`, `transaction_type`, `amount`, `status`, `success`,
  `operation_type`, `installments`, `statement_descriptor`, `acquirer_name`, `acquirer_tid`,
  `acquirer_nsu`, `acquirer_auth_code`, `acquirer_return_code`, `gateway_id`, `gateway_response?`,
  `card: Card`.
- **Card**: `id`, `first_six_digits`, `last_four_digits`, `brand`, `holder_name`, `exp_month`,
  `exp_year`.
- **Token** (tokens response): `id`, `type`, `created_at`, `expires_at`, `card: Card`.
- **OrderRecord** (internal storage): see Core Interfaces above.

**Request types** are accepted loosely (the consuming app pre-validates per `_idea.md` §4.1); only the
fields needed to resolve the outcome and build the response are read: `payments[0].amount`,
`payments[0].credit_card.card.number` / `card_id` / `card_token`, `payments[0].credit_card.operation_type`,
`payments[0].credit_card.installments`, `code`, `metadata`. `first_six_digits`/`last_four_digits` derive
from the card number; brand defaults to `Visa`.

**Storage.** In-memory `Map<chargeId, OrderRecord>`; no database, no durable persistence
([ADR-005](adrs/adr-005.md)).

### API Endpoints

Routes are served under the `/core/v5/...` prefix exactly as the real Pagar.me, because the consuming
app concatenates `apiUrl + resource` (`_idea.md` §7).

| Method | Path | Description |
|--------|------|-------------|
| POST | `/core/v5/orders` | Create order — sale with capture (`auth_and_capture`) or pre-auth (`auth_only`). Resolves outcome from card; persists record. Returns order body (200) or 5xx for the outage card. |
| POST | `/core/v5/charges/{charge_id}/capture` | Capture a prior authorization. Looks up record, sets `captured`. Body `{ amount }`. Returns a **charge** object with root-level `last_transaction` (200). |
| DELETE | `/core/v5/charges/{charge_id}` | Cancel/refund (full = no body, partial = `{ amount }`). Sets `voided`/`refunded`, records `canceled_amount`/`refunded_amount`. Returns charge object (200). |
| POST | `/core/v5/tokens?appId={public_key}` | Tokenize a card. Returns token + card metadata (200/201). |
| GET | `/health` | Liveness check. Returns `{ "status": "ok" }` (200). |
| POST | `/__reset` | **Test-only**, not a Pagar.me route. Clears the store. Returns 204. ([ADR-005](adrs/adr-005.md)) |

Required response fields per route are the ⭐ checklist in `_idea.md` §8 — the build order treats that
checklist as the acceptance contract for the response builders.

## Integration Points

The fake calls no external systems. Its sole integration is being the URL target of the consuming
Laravel app during homologation, delivered as documentation only ([ADR-002](adrs/adr-002.md)):

- **Consuming app (separate repo)**: points `PAGARME_API_URL` at the fake (e.g.
  `http://localhost:8088`). This is a **URL swap, not a key swap** — the fake accepts and ignores the
  `Authorization` header (`_idea.md` §2).
- **Auth approach**: none enforced; the header is ignored. Optionally a missing/malformed `Basic`
  header may return 401 for auth-error tests (out of MVP scope unless requested).
- **Production safety**: the guide mandates leaving `PAGARME_API_URL` unset in production so the app
  falls back to the real `https://api.pagar.me` ([ADR-002](adrs/adr-002.md)).

## Impact Analysis

| Component | Impact Type | Description and Risk | Required Action |
|-----------|-------------|----------------------|-----------------|
| Express service (`src/`) | new | Entire fake service. Risk: response bodies omitting a ⭐ field break the consuming app downstream. | Build response builders against the `_idea.md` §8 checklist; cover with integration tests. |
| In-memory order store | new | Lifecycle state for capture/cancel. Risk: lost on restart; shared-instance cross-suite interference. | Key by `charge_id`; expose `/__reset`; document state is ephemeral. |
| Magic-card resolver | new | Single source of outcome selection. Risk: a needed scenario not mapped. | Implement the six-row table from `_idea.md` §5; extend with reserved numbers if a gap appears. |
| Dockerfile + docker-compose | new | Packaging for the shared instance. Risk: misconfigured port. | Multi-stage build; `PORT` env (default 8088). |
| Connection guide (docs) | new | Adoption instructions. Risk: misconfig into production. | Reproduce `_idea.md` §7; stress test-only, URL-swap, unset in prod. |
| Consuming Laravel app | out of scope | `config/pagarme.php`, `setApiUrl()`, `.env` edits. | Documented in the guide only; owned by that team ([ADR-002](adrs/adr-002.md)). |

## Testing Approach

Test runner **vitest**; HTTP assertions via **supertest** against the in-process Express app
([ADR-004](adrs/adr-004.md)). Both unit and integration layers.

### Unit Tests

- **Magic-card resolver**: each of the six card numbers/tokens maps to the correct `Outcome`;
  unknown card defaults to `approved_captured`.
- **Response builders**: for each outcome, the assembled body contains every ⭐ field with the right
  values (`status`, `last_transaction.status`, `success`, `card.id`, `acquirer_*`, `metadata.site`,
  echoed `code`).
- **Order store**: `create`/`get`/`update`/`clear` behave correctly; `update` is a no-op for unknown
  `charge_id`.
- **ID util**: minted IDs carry the right prefix and are unique across calls.
- **Mock boundaries**: none needed — all units are pure functions plus an in-memory map.

### Integration Tests

- **Per-scenario route tests**: drive `POST /core/v5/orders` with each magic card and assert the
  HTTP status (200 for business outcomes, 5xx for the outage card) and the body-based approval fields.
- **Lifecycle**: `POST /orders` (pre-auth) → capture using the returned `charge_id` → assert
  `captured`; and sale → `DELETE /charges/{id}` → assert `voided`/`refunded` with `canceled_amount`.
- **Tokenization**: `POST /core/v5/tokens` returns `id` + `card.{id,first_six_digits,last_four_digits,brand}`.
- **Reset & health**: `/health` returns ok; `/__reset` clears state so a subsequent capture against a
  pre-reset `charge_id` resolves as not-found (body-level error).
- **Test data**: the magic-card numbers from `_idea.md` §5 and a minimal valid order request fixture.
- **Environment dependencies**: none; the app boots in-process on an ephemeral port.

## Development Sequencing

### Build Order

1. **Project scaffold** — `package.json`, `tsconfig.json`, vitest config, `src/` layout, Express
   bootstrap in `src/server.ts` reading `PORT` (default 8088). No dependencies.
2. **Contract types** (`src/types/pagarme.ts`) — Order, Charge, Transaction, Card, Token, OrderRecord.
   Depends on step 1.
3. **ID util + order store** (`src/util/ids.ts`, `src/store/orderStore.ts`) — opaque ID minting and
   the in-memory `Map`. Depends on step 2 (uses `OrderRecord`).
4. **Magic-card resolver** (`src/magic/cards.ts`) — the six-outcome table from `_idea.md` §5. Depends
   on step 2 (uses `Outcome`).
5. **Response builders** (`src/responses/`) — assemble order/charge/token bodies per outcome, owning
   every ⭐ field. Depends on steps 2–4.
6. **Routes** (`src/routes/`) — wire `POST /orders`, capture, cancel, tokens, `GET /health`,
   `POST /__reset` into Express; persist on create, look up on capture/cancel. Depends on steps 3–5.
7. **Unit tests** — resolver, builders, store, ids. Depends on steps 3–5.
8. **Integration tests** (supertest) — per-scenario routes + lifecycle + reset/health. Depends on
   steps 6–7.
9. **Packaging** — multi-stage `Dockerfile` (build TS → run `node dist/server.js`) and
   `docker-compose.yml` (port 8088, `PORT` env). Depends on steps 1–6.
10. **Connection guide + README** — reproduce `_idea.md` §7 and document the magic-card table and
    `/__reset`. Depends on step 6 (final route surface known).

### Technical Dependencies

- **Infrastructure**: none for build/test (in-process). For deployment, a Docker host for the shared
  always-on instance — hosting target/ownership is an open ops question (PRD Open Questions), not a
  build blocker.
- **External services**: none.
- **Team deliverables**: the consuming-app team applies the connection guide in their own repo
  ([ADR-002](adrs/adr-002.md)); not required to ship or test the fake.

## Monitoring and Observability

Lightweight, matching a homologation tool:

- **Health**: `GET /health` for the homologation environment and operators to confirm liveness.
- **Logs**: structured per-request line on each `/core/v5/...` call — method, path, resolved
  `outcome`, minted/looked-up `charge_id`, and response status. Enough to debug a failing suite.
- **Metrics/alerting**: none in MVP (deliberate YAGNI); the shared instance's uptime is owned by the
  hosting team. A request counter per outcome can be added later if a need emerges.

## Technical Considerations

### Key Decisions

- **Decision**: Node.js + Express + TypeScript. **Rationale**: team preference for the JS ecosystem
  plus compile-time safety on the ⭐ contract fields. **Trade-offs**: a `tsc` build step and a Node
  runtime in the image. **Alternatives rejected**: Go (smaller binary, less JSON-ergonomic),
  PHP/Laravel (heavy runtime), Python/FastAPI (no edge over TS here). See [ADR-004](adrs/adr-004.md).
- **Decision**: In-memory store + opaque IDs + test-only `/__reset`. **Rationale**: coherent
  lifecycle without a database; robust under concurrency; clean suite isolation on the shared box.
  **Trade-offs**: state lost on restart; a small non-Pagar.me reset surface. **Alternatives
  rejected**: pure in-memory (no isolation), sequential IDs (flaky under concurrency), file
  persistence (YAGNI). See [ADR-005](adrs/adr-005.md).
- **Decision**: Body-based outcomes at HTTP 200, 5xx only for outages. **Rationale**: the consuming
  app parses the body, not the status (`_idea.md` §3.3); a 4xx would divert it to its infra-error
  path. **Trade-offs**: none — this is contract fidelity.

### Known Risks

- **Contract drift** (medium likelihood): the real Pagar.me changes its v5 contract and the fake
  silently diverges. **Mitigation**: types and builders are pinned to `_idea.md`; recommend periodic
  comparison against the real sandbox when available.
- **Missing ⭐ field** (low, high impact): an omitted response field breaks the consuming app
  downstream. **Mitigation**: integration tests assert the `_idea.md` §8 checklist for each route.
- **Shared-instance state interference** (low): concurrent suites collide. **Mitigation**: opaque
  per-order IDs avoid coupling; `/__reset` for suite setup; persistence intentionally deferred.
- **`/__reset` misuse** (low): a reset wipes another suite's in-flight state. **Mitigation**: document
  as suite-setup-only; can be env-gated if abuse appears.

## Architecture Decision Records

- [ADR-001: Stateful, contract-faithful fake over stateless stub](adrs/adr-001.md) — Build a
  lifecycle-aware fake so sale→capture→cancel flows stay coherent.
- [ADR-002: Deliverable boundary — fake service only; consuming-app integration as a guide](adrs/adr-002.md)
  — Ship the service here; app-side wiring is documented, not committed cross-repo.
- [ADR-003: Credit-card-only scope with deterministic magic-card outcomes](adrs/adr-003.md) — Cover
  only the five credit-card routes; outcomes selected purely by card number/token.
- [ADR-004: Node.js + Express + TypeScript implementation stack](adrs/adr-004.md) — Implement the fake
  in TypeScript on Express for contract-typing and ecosystem fit, over Go/PHP/Python.
- [ADR-005: In-memory store with opaque IDs and a test-only reset route](adrs/adr-005.md) — Keep
  lifecycle state in an in-memory Map, mint opaque IDs, and expose `POST /__reset` for suite isolation.
