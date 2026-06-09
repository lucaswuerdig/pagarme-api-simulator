---
status: completed
title: Token-auth Express middleware (src/auth/middleware.ts)
type: backend
complexity: low
dependencies:
  - task_01
---

# Task 2: Token-auth Express middleware (src/auth/middleware.ts)

## Overview
Create the thin Express adapter `requireToken` that turns the pure validation helpers from
task_01 into a request guard. It validates the incoming `Authorization` header and either
passes the request through or rejects it with HTTP 401. This task only creates the
middleware; mounting it into the app happens in task_03.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST create `src/auth/middleware.ts` exporting `requireToken(req, res, next)`.
- MUST validate the request by passing `req.headers.authorization` through `parseBasicToken` then `isValidToken` from `src/auth/tokens.ts`.
- MUST call `next()` and return without sending a response when the token is valid.
- MUST respond with HTTP 401 and body `{ error: "unauthorized", message: <string> }` when the token is missing, malformed, or not allowlisted, and MUST NOT call `next()` in that case.
- MUST NOT log the full token value.
</requirements>

## Subtasks
- [x] 2.1 Create `src/auth/middleware.ts` importing the task_01 helpers.
- [x] 2.2 Implement `requireToken` delegating validation to the pure helpers.
- [x] 2.3 Emit the repo-standard 401 body on rejection.
- [x] 2.4 Add unit tests for the pass-through and rejection branches.

## Implementation Details
Create `src/auth/middleware.ts`. See TechSpec "Core Interfaces" for the `requireToken`
signature and the 401 body shape, and ADR-003 for why the 401 uses the repo's
`{ error, message }` convention (consistent with the 404 fallback in `src/server.ts`).
The middleware must remain a pure adapter — all decision logic lives in `tokens.ts`.

### Relevant Files
- `src/auth/tokens.ts` — provides `isValidToken` and `parseBasicToken` (task_01).
- `src/routes/reset.ts` — example of the existing 401 JSON body shape to match.
- `src/server.ts` — the 404 fallback shows the canonical `{ error, message }` response.

### Dependent Files
- `src/routes/index.ts` — task_03 mounts `requireToken` here.

### Related ADRs
- [ADR-003: Token-auth middleware design](../adrs/adr-003.md) — middleware responsibility, 401 shape, and the tokens/middleware split.

## Deliverables
- `src/auth/middleware.ts` exporting `requireToken`.
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration tests: middleware behavior in the mounted app is verified in task_03 **(covered downstream)**

## Tests
- Unit tests (drive `requireToken` with stub `req`/`res`/`next`):
  - [x] Valid `Authorization: Basic base64("test_token:")` → `next()` called once, no response sent.
  - [x] Missing `Authorization` header → 401 with body `{ error: "unauthorized", message: <string> }`, `next` not called.
  - [x] Unlisted token (`Basic base64("nope:")`) → 401, `next` not called.
  - [x] Malformed header (`"Basic %%%"`) → 401, `next` not called.
- Integration tests:
  - [ ] Deferred to task_03 (mounted-app behavior).
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- `requireToken` contains no token-matching logic of its own (delegates to `tokens.ts`).
- On rejection, `next` is never invoked and exactly one 401 response is sent.
