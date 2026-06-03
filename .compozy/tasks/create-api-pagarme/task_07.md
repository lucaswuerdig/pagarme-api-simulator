---
status: completed
title: Vercel KV store implementation & store factory
type: backend
complexity: medium
dependencies:
  - task_03
---

# Task 7: Vercel KV store implementation & store factory

## Overview
Provide the production `KvOrderStore` backed by Vercel KV (Upstash Redis) implementing the same
`OrderStore` interface, plus a store factory that selects the backend from the `STORE_BACKEND` env var.
This lets lifecycle state survive across stateless Vercel invocations while keeping the in-memory store
for local dev and CI (TechSpec "Data Models" / "System Architecture"; ADR-006).

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST implement `OrderStore` (from Task 03) using `@vercel/kv`, storing each `OrderRecord` under key `ch:<chargeId>` with a TTL (default 24h), per ADR-006.
- MUST implement `clear()` as a PREFIX-scoped delete of `ch:*` keys (scan + delete), NEVER `flushall`, per ADR-006.
- MUST provide a store factory selecting `KvOrderStore` when `STORE_BACKEND=kv` and `InMemoryOrderStore` otherwise (default `memory`).
- MUST read `KV_REST_API_URL` and `KV_REST_API_TOKEN` from the environment for the KV client.
- MUST surface KV failures so the route layer can return 5xx (do not swallow errors).
- MUST pass the same store contract test suite from Task 03 against a mocked `@vercel/kv` client.
</requirements>

## Subtasks
- [x] 7.1 Implement `KvOrderStore` create/get/update with `ch:<chargeId>` keys and TTL.
- [x] 7.2 Implement prefix-scoped `clear()` (scan + delete `ch:*`), never `flushall`.
- [x] 7.3 Implement the store factory selecting backend by `STORE_BACKEND`.
- [x] 7.4 Run the Task 03 store contract suite against the KV impl with a mocked client.

## Implementation Details
Create `src/store/kvOrderStore.ts` and a factory (e.g., `src/store/index.ts`). The `OrderStore` interface
and the shared contract test suite come from Task 03 — reuse, do not redefine. Key/TTL/prefix rules and
the `flushall` prohibition are in ADR-006. The factory is consumed by `api/index.ts` (Task 08, `kv`) and
by routes/tests (`memory`).

### Relevant Files
- `src/store/kvOrderStore.ts` — create: `@vercel/kv`-backed implementation.
- `src/store/index.ts` — create: factory selecting backend via `STORE_BACKEND`.

### Dependent Files
- `api/index.ts` (Task 08) — uses the factory with `STORE_BACKEND=kv`.
- `src/routes/*` (Task 06) — receive the store from the factory.
- `Dockerfile`/`docker-compose.yml` (Task 10) — local KV/Redis wiring via the factory.

### Related ADRs
- [ADR-006: Deploy on Vercel serverless functions with Vercel KV for lifecycle state](adrs/adr-006.md) — Defines the KV backend, key scheme, TTL, and prefix-scoped reset.
- [ADR-005: In-memory store with opaque IDs and a test-only reset route](adrs/adr-005.md) — The interface and contract this impl must honor.

## Deliverables
- `KvOrderStore` implementing `OrderStore` against Vercel KV + a `STORE_BACKEND` factory.
- The Task 03 contract suite passing against the KV impl (mocked client).
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration tests for backend selection and KV key/TTL behavior **(REQUIRED)**

## Tests
- Unit tests:
  - [x] `create` writes key `ch:<chargeId>` with the configured TTL (assert against mocked `kv.set` args).
  - [x] `get("ch_x")` reads `ch:ch_x` and deserializes the record (mocked `kv.get`).
  - [x] `update` on a missing key returns `undefined`.
  - [x] `clear()` deletes only `ch:*` keys (scan + del), and never calls `flushall`.
  - [x] Factory returns `KvOrderStore` for `STORE_BACKEND=kv` and `InMemoryOrderStore` otherwise.
- Integration tests:
  - [x] The shared store contract suite from Task 03 passes against `KvOrderStore` with a mocked `@vercel/kv` client.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- `KvOrderStore` satisfies the `OrderStore` contract identically to the in-memory impl
- `clear()` is prefix-scoped and `flushall` is never invoked
