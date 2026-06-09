---
status: completed
title: Activate the gate, retire RESET_SECRET, and migrate the test suite
type: backend
complexity: high
dependencies:
  - task_02
---

# Task 3: Activate the gate, retire RESET_SECRET, and migrate the test suite

## Overview
Turn the middleware on: mount `requireToken` so it guards `/__reset` and every `/core/v5`
route while `/health` stays open, remove the now-redundant `RESET_SECRET` mechanism, and
migrate the existing test suite to authenticate so it stays green. This is the cohesive
"make auth live" step — wiring and test migration are done together because enabling the
gate breaks all 44 existing protected-route calls at once.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST mount `requireToken` in `registerRoutes` AFTER `healthRouter()` and BEFORE `resetRouter()`, so `/__reset` and all `/core/v5` routes are guarded and `GET /health` is not.
- MUST remove the `RESET_SECRET` guard, the `env` parameter, and the `RESET_SECRET_HEADER` export from `src/routes/reset.ts`; `POST /__reset` performs an unconditional clear once past the gate.
- MUST add `tests/helpers/authedRequest.ts` that sets `Authorization: Basic base64("test_token:")`, importing the token from `src/auth/tokens.ts`.
- MUST migrate all existing protected-route supertest calls (orders, charge capture, charge cancel, tokens, and `/__reset`) across the four affected test files to authenticate via the helper.
- MUST replace the old `RESET_SECRET` tests with cases asserting `/__reset` returns 401 without a valid token and 204 with one.
- MUST add negative-auth integration tests (missing token and unlisted token → 401) for a protected route, and a test asserting `GET /health` returns 200 without a token.
- MUST keep the full suite green after the change.
</requirements>

## Subtasks
- [x] 3.1 Mount `requireToken` at the correct position in `registerRoutes`.
- [x] 3.2 Simplify `src/routes/reset.ts`, removing all `RESET_SECRET` / `x-reset-secret` code and the now-unused `env` param.
- [x] 3.3 Add the `tests/helpers/authedRequest.ts` shared helper.
- [x] 3.4 Migrate the 44 protected-route calls across the four test files to use the helper.
- [x] 3.5 Replace the reset-secret tests with 401-without-token / 204-with-token cases.
- [x] 3.6 Add negative-auth tests and a `/health`-stays-open test; run the full suite green.

## Implementation Details
Modify `src/routes/index.ts` (mount point) and `src/routes/reset.ts` (remove guard); add
`tests/helpers/authedRequest.ts`; update the four test files. See TechSpec "System
Architecture" for the data flow / mount order, "Impact Analysis" for the per-file change
list and call counts, and "Testing Approach" for the positive/negative/open-route matrix.
All app builders (`createPagarmeApp`, `createApp`, the Vercel `handler`, the docs builder)
flow through `registerRoutes`, so a single mount point covers every builder and the helper
applies uniformly.

### Relevant Files
- `src/routes/index.ts` — `registerRoutes`; insert `app.use(requireToken)` after health, before reset.
- `src/routes/reset.ts` — remove the `RESET_SECRET` guard, `env` param, and `RESET_SECRET_HEADER` export.
- `src/auth/middleware.ts` — provides `requireToken` (task_02).
- `src/auth/tokens.ts` — provides `test_token` for the helper (task_01).
- `tests/integration/httpRoutes.test.ts` — 17 protected-route calls to migrate.
- `tests/unit/routes.test.ts` — 23 protected-route calls + the `RESET_SECRET` test block to replace.
- `tests/integration/vercelHandler.test.ts` — 3 protected-route calls via the imported `handler`.
- `tests/integration/docsAccuracy.test.ts` — 1 protected-route call; keep aligned with README examples.

### Dependent Files
- `tests/helpers/fakeKv.ts` — existing helper directory neighbor; confirms `tests/helpers/` is the right home for `authedRequest.ts`.
- `README.md`, `docs/connection-guide.md`, `.env.example` — documentation reflecting the removed `RESET_SECRET` is updated in task_04.

### Related ADRs
- [ADR-002: Unify access control under the token gate, retiring RESET_SECRET](../adrs/adr-002.md) — `/__reset` joins the gate; reset secret removed.
- [ADR-003: Token-auth middleware design](../adrs/adr-003.md) — exact mount order and why misordering would leave `/__reset` open.
- [ADR-004: Test authentication via a shared helper and a committed homologation test token](../adrs/adr-004.md) — the `authedRequest` helper and test-migration approach.

## Deliverables
- `requireToken` mounted in `registerRoutes`; `/__reset` and `/core/v5` guarded; `/health` open.
- `src/routes/reset.ts` free of `RESET_SECRET` logic.
- `tests/helpers/authedRequest.ts` shared helper.
- All four test files migrated to authenticate; reset-secret tests replaced.
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration tests for the protected surface (positive, negative, open-route) **(REQUIRED)**

## Tests
- Unit tests:
  - [x] `src/routes/reset.ts` no longer references `RESET_SECRET`/`x-reset-secret` (guard removed; unconditional clear).
  - [x] Migrated `tests/unit/routes.test.ts` cases pass when calling through `authedRequest`.
- Integration tests:
  - [x] `POST /core/v5/orders` without an `Authorization` header → 401 `{ error, message }`.
  - [x] `POST /core/v5/orders` with an unlisted token → 401.
  - [x] `POST /core/v5/orders` with `test_token` → normal order response (existing happy path preserved).
  - [x] `POST /__reset` without a valid token → 401; with `test_token` → 204 and the store is cleared.
  - [x] `GET /health` without a token → 200.
  - [x] The Vercel `handler` route (`tests/integration/vercelHandler.test.ts`) enforces the gate identically.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- `/__reset` and all `/core/v5` routes reject unauthenticated requests with 401; `/health` returns 200 without a token.
- No remaining references to `RESET_SECRET` or `x-reset-secret` in `src/`.
- The full vitest suite is green with no skipped protected-route tests.
