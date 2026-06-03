---
status: completed
title: Vercel serverless function shim & vercel.json
type: infra
complexity: medium
dependencies:
  - task_06
  - task_07
---

# Task 8: Vercel serverless function shim & vercel.json

## Overview
Expose the Express app as a single Vercel serverless function and route all traffic to it. `api/index.ts`
imports the app (with the store factory selecting KV) and `vercel.json` rewrites every path to `/api`, so
the `/core/v5/...` routes — including the dynamic `charge_id` — resolve unchanged on Vercel (TechSpec
"System Architecture" / "API Endpoints"; ADR-006).

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST export the Express app (from Task 06/01) as a Vercel function handler in `api/index.ts`.
- MUST configure `vercel.json` to rewrite `/(.*)` → `/api` so all `/core/v5/...` paths reach the function.
- MUST select the KV store backend on Vercel (`STORE_BACKEND=kv`) via the factory from Task 07.
- MUST document the required Vercel env vars (`KV_REST_API_URL`, `KV_REST_API_TOKEN`, `STORE_BACKEND`).
- MUST preserve the exact route paths and HTTP-status behavior verified in Task 06 (no path rewriting that alters `/core/v5/...`).
</requirements>

## Subtasks
- [x] 8.1 Create `api/index.ts` exporting the Express app as the Vercel handler with KV backend selected.
- [x] 8.2 Create `vercel.json` with the catch-all rewrite to `/api`.
- [x] 8.3 Wire the store factory so Vercel uses `STORE_BACKEND=kv`.
- [x] 8.4 Verify the `/core/v5/...` and dynamic `charge_id` paths resolve through the rewrite.

## Implementation Details
Create `api/index.ts` and `vercel.json`. The shim imports the app from `src/server.ts` (Task 01/06) and
the store factory from Task 07. The single-function-wrapping-Express approach and rewrite are defined in
ADR-006 and TechSpec "System Architecture" — reference, do not duplicate. Use `serverless-http` or the
Express handler export as appropriate for the Vercel Node runtime.

### Relevant Files
- `api/index.ts` — create: Vercel function exporting the Express app.
- `vercel.json` — create: rewrite `/(.*)` → `/api`; Node runtime config.

### Dependent Files
- `.github/workflows/ci.yml` (Task 09) — deploys this configuration via the Vercel CLI.
- `README.md` / connection guide (Task 11) — documents the deployed URL and env vars.

### Related ADRs
- [ADR-006: Deploy on Vercel serverless functions with Vercel KV for lifecycle state](adrs/adr-006.md) — Single-function shim, rewrite, and KV backend on Vercel.
- [ADR-004: Node.js + Express + TypeScript implementation stack](adrs/adr-004.md) — The app being wrapped.

## Deliverables
- `api/index.ts` + `vercel.json` deploying the app as one function with KV selected.
- Documented Vercel env vars.
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration tests proving routes resolve through the rewrite **(REQUIRED)**

## Tests
- Unit tests:
  - [x] `api/index.ts` imports and exports the Express app without throwing.
  - [x] With `STORE_BACKEND=kv`, the factory yields `KvOrderStore` in the function entrypoint.
- Integration tests:
  - [x] Driving the exported handler (supertest), `POST /core/v5/orders` resolves and returns a contract body (rewrite path equivalence).
  - [x] A `DELETE /core/v5/charges/:id` request reaches the cancel handler through the catch-all rewrite (dynamic param preserved).
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- All `/core/v5/...` routes (incl. dynamic `charge_id`) resolve via the Vercel rewrite
- The function selects the KV backend in the Vercel environment
