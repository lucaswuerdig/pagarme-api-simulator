# TechSpec: Fake Pagar.me API (Homologation Test Double)

## Executive Summary

This service is a standalone HTTP test double for Pagar.me v5, implemented in **Node.js + Express
with TypeScript** and deployed on **Vercel** as a single serverless function. It exposes the exact
five `/core/v5/...` credit-card routes the consuming Laravel app calls — create order, capture charge,
cancel/refund charge, tokenize card — and returns response bodies whose fields match what that app's
parser reads (`_idea.md` §3, §4). Approval is conveyed in the **response body**
(`last_transaction.status` + `success`), not the HTTP status: business outcomes return HTTP 200 and
only simulated gateway outages return 5xx. Outcomes are selected deterministically from the incoming
card number/token via a fixed magic-card table ([ADR-003](adrs/adr-003.md)). Order/charge lifecycle
state lives in **Vercel KV (Upstash Redis)** keyed by `charge_id`, so sale → capture → cancel stays
coherent across stateless serverless invocations ([ADR-001](adrs/adr-001.md),
[ADR-006](adrs/adr-006.md)).

The primary technical trade-off: deploying on Vercel forces lifecycle state out of process memory into
Vercel KV — adding a managed dependency and per-request store latency — in exchange for coherent
multi-step flows on a stateless platform and a zero-maintenance host ([ADR-006](adrs/adr-006.md)). The
`OrderStore` interface is unchanged from the in-memory design; a `KvOrderStore` backs Vercel while an
`InMemoryOrderStore` backs local dev and CI tests, keeping the test suite hermetic
([ADR-005](adrs/adr-005.md)). Shipping is owned by a **GitHub Actions** pipeline that runs tests then
deploys via the **Vercel CLI** ([ADR-007](adrs/adr-007.md)). A Dockerfile + docker-compose is retained
for **local development only**; no code is committed to the consuming app's repository
([ADR-002](adrs/adr-002.md), [ADR-004](adrs/adr-004.md)).

## System Architecture

### Component Overview

A single Express app, deployed on Vercel as one serverless function. A request flows: **Vercel rewrite
→ Express router → Magic-card resolver → Response builder ↔ Order store (KV) → JSON response.**

- **Vercel function shim** (`api/index.ts`, `vercel.json`): exports the Express app as the function
  handler; `vercel.json` rewrites `/(.*)` → `/api` so every `/core/v5/...` path (including the dynamic
  `charge_id`) reaches the app unchanged ([ADR-006](adrs/adr-006.md)). Boundary: platform wiring only.
- **HTTP server / router** (`src/server.ts`, `src/routes/`): registers the five Pagar.me routes plus
  `GET /health` and `POST /__reset`. Parses JSON, dispatches to handlers. Runnable standalone for local
  dev/tests.
- **Magic-card resolver** (`src/magic/cards.ts`): pure function mapping an incoming card number or
  `card_id`/`card_token` to one of six outcomes. Single source of scenario truth.
- **Response builders** (`src/responses/`): pure functions assembling the contract-faithful order,
  charge, and token bodies. Own every ⭐ field.
- **Order store** (`src/store/`): the `OrderStore` interface with two implementations —
  `KvOrderStore` (Vercel KV, production) and `InMemoryOrderStore` (local dev + tests) — selected by the
  `STORE_BACKEND` env var. Created on `POST /orders`; read/updated on capture and cancel; cleared by
  `/__reset` (prefix-scoped) or KV TTL ([ADR-005](adrs/adr-005.md), [ADR-006](adrs/adr-006.md)).
- **ID + type support** (`src/util/ids.ts`, `src/types/pagarme.ts`): opaque ID minting and the
  TypeScript contract models.

**Data flow.** `POST /orders` resolves the outcome from the card, mints `order_id`/`charge_id`/
`card_id`, persists an `OrderRecord` (KV key `ch:<chargeId>`, TTL 24h), and returns the order body.
`POST /charges/{id}/capture` and `DELETE /charges/{id}` look up the record by `charge_id`, update its
status, and return a charge body. `POST /tokens` returns a token body (tokenization is stateless beyond
echoing card metadata).

**External system interactions.** Vercel KV (Upstash Redis) for lifecycle state. No real card
processing, no real card data; the `Authorization` header is accepted and ignored (`_idea.md` §2).

## Implementation Design

### Core Interfaces

The store other components depend on (interface unchanged; backend now pluggable), and the
resolved-outcome contract:

```typescript
// src/store/orderStore.ts
export interface OrderRecord {
  orderId: string;        // or_fake_...
  chargeId: string;       // ch_fake_...  (store key)
  cardId: string;         // card_fake_...
  code: string;           // echoed from request
  amount: number;         // minor units (cents)
  status: ChargeStatus;   // paid | authorized_pending_capture | canceled | refunded | failed
  outcome: Outcome;       // resolved magic-card scenario
  metadata: Record<string, unknown>;
}

export interface OrderStore {                       // KvOrderStore | InMemoryOrderStore
  create(record: OrderRecord): Promise<OrderRecord>;
  get(chargeId: string): Promise<OrderRecord | undefined>;
  update(chargeId: string, patch: Partial<OrderRecord>): Promise<OrderRecord | undefined>;
  clear(): Promise<void>;                           // backs POST /__reset (prefix-scoped on KV)
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

**Error handling conventions.** Business outcomes always return HTTP 200 with the result in the body —
never a 4xx — so the consuming app's Guzzle client reaches the body parser, not its infra-error path
(`_idea.md` §3.3). `gateway_unavailable` returns 500/503. Capture/cancel against an unknown `charge_id`
return a body-level error (`last_transaction.status=with_error`, `success=false`) at HTTP 200. Store
calls are async (`await`) because the KV backend is networked; a KV failure surfaces as a 5xx.

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

**Storage.** Vercel KV (Upstash Redis) in production: `OrderRecord` serialized under key `ch:<chargeId>`
with a 24h TTL; `InMemoryOrderStore` (a `Map`) for local dev and tests ([ADR-006](adrs/adr-006.md)).
No relational database.

### API Endpoints

Routes are served under the `/core/v5/...` prefix exactly as the real Pagar.me, because the consuming
app concatenates `apiUrl + resource` (`_idea.md` §7). On Vercel, `vercel.json` rewrites all paths to the
single function so these paths resolve unchanged.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/core/v5/orders` | Create order — sale with capture (`auth_and_capture`) or pre-auth (`auth_only`). Resolves outcome from card; persists record. Returns order body (200) or 5xx for the outage card. |
| POST | `/core/v5/charges/{charge_id}/capture` | Capture a prior authorization. Looks up record, sets `captured`. Body `{ amount }`. Returns a **charge** object with root-level `last_transaction` (200). |
| DELETE | `/core/v5/charges/{charge_id}` | Cancel/refund (full = no body, partial = `{ amount }`). Sets `voided`/`refunded`, records `canceled_amount`/`refunded_amount`. Returns charge object (200). |
| POST | `/core/v5/tokens?appId={public_key}` | Tokenize a card. Returns token + card metadata (200/201). |
| GET | `/health` | Liveness check. Returns `{ "status": "ok" }` (200). |
| POST | `/__reset` | **Test-only**, not a Pagar.me route. Clears store keys under the `ch:` prefix. Returns 204. ([ADR-005](adrs/adr-005.md), [ADR-006](adrs/adr-006.md)) |

Required response fields per route are the ⭐ checklist in `_idea.md` §8 — the build order treats that
checklist as the acceptance contract for the response builders.

## Integration Points

The fake calls no payment systems; its runtime dependency is Vercel KV, and its delivery boundary is
documentation for the consuming app ([ADR-002](adrs/adr-002.md)).

- **Vercel KV (Upstash Redis)**: lifecycle state store. Auth via `KV_REST_API_URL` and
  `KV_REST_API_TOKEN` env vars (provisioned in the Vercel project). Errors surface as 5xx; keys carry a
  TTL so abandoned state self-expires ([ADR-006](adrs/adr-006.md)).
- **Vercel platform**: hosts the single serverless function; `PORT` is platform-managed (local dev uses
  `PORT`, default 8088).
- **GitHub Actions → Vercel CLI**: the deploy pipeline authenticates with `VERCEL_TOKEN`,
  `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` ([ADR-007](adrs/adr-007.md)).
- **Consuming app (separate repo)**: points `PAGARME_API_URL` at the deployed Vercel URL. This is a
  **URL swap, not a key swap** — the `Authorization` header is ignored (`_idea.md` §2). The guide
  mandates leaving `PAGARME_API_URL` unset in production so the app falls back to the real
  `https://api.pagar.me` ([ADR-002](adrs/adr-002.md)).

## Impact Analysis

| Component | Impact Type | Description and Risk | Required Action |
|-----------|-------------|----------------------|-----------------|
| Express service (`src/`) | new | Entire fake service. Risk: response bodies omitting a ⭐ field break the consuming app downstream. | Build response builders against the `_idea.md` §8 checklist; cover with integration tests. |
| Order store (`OrderStore`) | new | Two impls — `KvOrderStore` (Vercel KV) and `InMemoryOrderStore` (local/tests). Risk: KV latency/availability; cross-suite interference on shared KV. | Async interface; key by `ch:<chargeId>` with TTL; `/__reset` prefix-scoped; `STORE_BACKEND` selector. |
| Magic-card resolver | new | Single source of outcome selection. Risk: a needed scenario not mapped. | Implement the six-row table from `_idea.md` §5; extend with reserved numbers if a gap appears. |
| Vercel function shim | new | `api/index.ts` + `vercel.json` rewrites. Risk: misconfigured rewrite or function path. | Single catch-all rewrite to `/api`; verify on a preview deploy. |
| GitHub Actions workflow | new | `.github/workflows/ci.yml` (test → deploy). Risk: leaked Vercel token; deploy without passing tests. | Encrypted secrets; `deploy` `needs: test` and runs only on `main`. |
| Dockerfile + docker-compose | new | Local-dev only (app + Redis). Risk: drift from Vercel runtime. | Use only for local parity; Vercel is the deploy target. |
| Connection guide (docs) | new | Adoption instructions. Risk: misconfig into production. | Reproduce `_idea.md` §7 against the Vercel URL; stress test-only, URL-swap, unset in prod. |
| Consuming Laravel app | out of scope | `config/pagarme.php`, `setApiUrl()`, `.env` edits. | Documented in the guide only; owned by that team ([ADR-002](adrs/adr-002.md)). |

## Testing Approach

Test runner **vitest**; HTTP assertions via **supertest** against the in-process Express app. Tests run
against `InMemoryOrderStore` (`STORE_BACKEND=memory`) so CI needs no live KV ([ADR-006](adrs/adr-006.md)).

### Unit Tests

- **Magic-card resolver**: each of the six card numbers/tokens maps to the correct `Outcome`; unknown
  card defaults to `approved_captured`.
- **Response builders**: for each outcome, the assembled body contains every ⭐ field with the right
  values (`status`, `last_transaction.status`, `success`, `card.id`, `acquirer_*`, `metadata.site`,
  echoed `code`).
- **Order store**: run the same suite against `InMemoryOrderStore` exercising `create`/`get`/`update`/
  `clear`; `update` is a no-op for unknown `charge_id`. `KvOrderStore` key/TTL/prefix logic unit-tested
  against a mocked `@vercel/kv` client.
- **ID util**: minted IDs carry the right prefix and are unique across calls.

### Integration Tests

- **Per-scenario route tests**: drive `POST /core/v5/orders` with each magic card and assert the HTTP
  status (200 for business outcomes, 5xx for the outage card) and the body-based approval fields.
- **Lifecycle**: `POST /orders` (pre-auth) → capture using the returned `charge_id` → assert `captured`;
  and sale → `DELETE /charges/{id}` → assert `voided`/`refunded` with `canceled_amount`.
- **Tokenization**: `POST /core/v5/tokens` returns `id` + `card.{id,first_six_digits,last_four_digits,brand}`.
- **Reset & health**: `/health` returns ok; `/__reset` clears state so a subsequent capture against a
  pre-reset `charge_id` resolves as not-found (body-level error).
- **Test data**: the magic-card numbers from `_idea.md` §5 and a minimal valid order request fixture.
- **Environment dependencies**: none; the app boots in-process with the in-memory store on an ephemeral port.

## Development Sequencing

### Build Order

1. **Project scaffold** — `package.json`, `tsconfig.json`, vitest config, `src/` layout, Express
   bootstrap in `src/server.ts` reading `PORT` (default 8088). No dependencies.
2. **Contract types** (`src/types/pagarme.ts`) — Order, Charge, Transaction, Card, Token, OrderRecord.
   Depends on step 1.
3. **ID util + store interface + in-memory impl** (`src/util/ids.ts`, `src/store/orderStore.ts`,
   `src/store/inMemoryOrderStore.ts`) — opaque ID minting and the async `OrderStore` interface with its
   `Map`-backed implementation. Depends on step 2.
4. **Magic-card resolver** (`src/magic/cards.ts`) — the six-outcome table from `_idea.md` §5. Depends on
   step 2.
5. **Response builders** (`src/responses/`) — assemble order/charge/token bodies per outcome, owning
   every ⭐ field. Depends on steps 2–4.
6. **Routes** (`src/routes/`) — wire `POST /orders`, capture, cancel, tokens, `GET /health`,
   `POST /__reset` into Express; persist on create, look up on capture/cancel. Depends on steps 3–5.
7. **Unit + integration tests** — resolver, builders, store, ids (unit); per-scenario routes +
   lifecycle + reset/health (supertest, in-memory store). Depends on steps 3–6.
8. **KV store impl** (`src/store/kvOrderStore.ts`) — `@vercel/kv`-backed `OrderStore` (key `ch:<id>`,
   TTL, prefix-scoped `clear`); `STORE_BACKEND` selector in a small store factory. Depends on step 3
   (interface) and step 7 (shared store test suite reused with a mocked KV client).
9. **Vercel function shim** (`api/index.ts`, `vercel.json`) — export the Express app; rewrite `/(.*)` →
   `/api`; default `STORE_BACKEND=kv` on Vercel. Depends on steps 6 and 8.
10. **GitHub Actions pipeline** (`.github/workflows/ci.yml`) — `test` job (npm ci, lint, vitest) then
    `deploy` job (`needs: test`, on `main`) via Vercel CLI with `VERCEL_*` secrets. Depends on steps
    7 and 9.
11. **Local Docker** (`Dockerfile`, `docker-compose.yml`) — app + Redis for local parity
    (`STORE_BACKEND=kv` against local Redis, or `memory`). Depends on steps 6 and 8.
12. **Connection guide + README** — reproduce `_idea.md` §7 against the Vercel URL; document the
    magic-card table, `/__reset`, env vars, and the deploy pipeline. Depends on steps 9–11.

### Technical Dependencies

- **Infrastructure**: a Vercel project with a provisioned Vercel KV store and the `KV_REST_API_*` env
  vars; GitHub repository secrets `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`. Build/test need
  none of these (in-memory store).
- **External services**: Vercel KV (Upstash) at runtime in production only.
- **Team deliverables**: the consuming-app team applies the connection guide in their own repo
  ([ADR-002](adrs/adr-002.md)); not required to ship or test the fake.

## Monitoring and Observability

Lightweight, matching a homologation tool:

- **Health**: `GET /health` for the homologation environment and operators to confirm liveness.
- **Logs**: structured per-request line on each `/core/v5/...` call — method, path, resolved `outcome`,
  minted/looked-up `charge_id`, and response status — visible in **Vercel function logs**. Log KV
  errors distinctly so a store outage is diagnosable.
- **Metrics/alerting**: none custom in MVP (deliberate YAGNI); rely on Vercel's built-in function
  metrics and KV dashboard. A per-outcome request counter can be added later if a need emerges.

## Technical Considerations

### Key Decisions

- **Decision**: Node.js + Express + TypeScript. **Rationale**: team preference for the JS ecosystem plus
  compile-time safety on the ⭐ contract fields. **Trade-offs**: a `tsc` build step and a Node runtime.
  **Alternatives rejected**: Go, PHP/Laravel, Python/FastAPI. See [ADR-004](adrs/adr-004.md).
- **Decision**: Deploy on Vercel serverless with Vercel KV for lifecycle state, single function wrapping
  Express. **Rationale**: a stateless platform cannot share an in-memory `Map` across requests; KV keeps
  sale→capture→cancel coherent (ADR-001's promise). **Trade-offs**: a managed KV dependency, env vars,
  and per-request store latency. **Alternatives rejected**: self-encoding stateless IDs, in-memory
  best-effort, per-route function files. See [ADR-006](adrs/adr-006.md).
- **Decision**: Pluggable `OrderStore` with opaque IDs and a test-only `/__reset`. **Rationale**: keep
  the interface stable while swapping backends; opaque IDs are robust under concurrency; `/__reset`
  isolates suites. **Trade-offs**: a small non-Pagar.me reset surface. **Alternatives rejected**:
  sequential IDs, file persistence. See [ADR-005](adrs/adr-005.md), [ADR-006](adrs/adr-006.md).
- **Decision**: GitHub Actions deploys to Vercel via the Vercel CLI (test → deploy). **Rationale**: an
  explicit, reproducible in-repo pipeline gated on tests. **Trade-offs**: managing Vercel secrets in
  GitHub. **Alternatives rejected**: Vercel Git auto-deploy with CI as gate only. See
  [ADR-007](adrs/adr-007.md).
- **Decision**: Body-based outcomes at HTTP 200, 5xx only for outages. **Rationale**: the consuming app
  parses the body, not the status (`_idea.md` §3.3). **Trade-offs**: none — this is contract fidelity.

### Known Risks

- **KV availability/latency** (low/medium): the store is now a network dependency. **Mitigation**: TTLs,
  small payloads, surface KV errors as 5xx; tests run without KV via the in-memory store.
- **Contract drift** (medium): the real Pagar.me changes its v5 contract and the fake diverges.
  **Mitigation**: types and builders pinned to `_idea.md`; periodic comparison against the real sandbox.
- **Missing ⭐ field** (low, high impact): an omitted response field breaks the consuming app.
  **Mitigation**: integration tests assert the `_idea.md` §8 checklist for each route.
- **Shared-state interference on KV** (low): concurrent suites collide. **Mitigation**: opaque per-order
  IDs, prefixed keys + TTL, and prefix-scoped `/__reset` (never `flushall`).
- **Leaked Vercel/KV credentials** (low, high impact): unauthorized deploys or data access.
  **Mitigation**: GitHub/Vercel encrypted secrets, least-privilege tokens, branch protection on `main`.

## Architecture Decision Records

- [ADR-001: Stateful, contract-faithful fake over stateless stub](adrs/adr-001.md) — Build a
  lifecycle-aware fake so sale→capture→cancel flows stay coherent.
- [ADR-002: Deliverable boundary — fake service only; consuming-app integration as a guide](adrs/adr-002.md)
  — Ship the service here; app-side wiring is documented, not committed cross-repo.
- [ADR-003: Credit-card-only scope with deterministic magic-card outcomes](adrs/adr-003.md) — Cover
  only the five credit-card routes; outcomes selected purely by card number/token.
- [ADR-004: Node.js + Express + TypeScript implementation stack](adrs/adr-004.md) — Implement the fake
  in TypeScript on Express for contract-typing and ecosystem fit, over Go/PHP/Python.
- [ADR-005: In-memory store with opaque IDs and a test-only reset route](adrs/adr-005.md) — Mint opaque
  IDs and expose `POST /__reset`; storage backend superseded by ADR-006 for Vercel.
- [ADR-006: Deploy on Vercel serverless functions with Vercel KV for lifecycle state](adrs/adr-006.md)
  — Run as one Express-wrapping function; move lifecycle state to Vercel KV so it survives stateless
  invocations.
- [ADR-007: GitHub Actions CI/CD deploying to Vercel via the Vercel CLI](adrs/adr-007.md) — A GitHub
  Actions pipeline runs tests then deploys to Vercel with the CLI.
