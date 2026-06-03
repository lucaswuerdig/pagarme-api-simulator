# Task Memory: task_06.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot
- Wire the Express route layer: 5 Pagar.me `/core/v5/...` routes + `GET /health` + test-only `POST /__reset`, with an injected `OrderStore`. DONE & verified (lint/typecheck/build/test all green, 100% coverage).

## Important Decisions
- **App factory**: kept `createApp(mountRoutes?)` unchanged; added `createPagarmeApp(store = new InMemoryOrderStore())` in `server.ts` that calls `createApp((app) => registerRoutes(app, store))`. `export const app = createPagarmeApp()` now ships with routes (was bare). Task 07/08 swap the backend by passing a different store to `createPagarmeApp` — no route changes.
- **HTTP statuses chosen** (sources allowed ranges): outage → **503**; tokens → **201**; `/__reset` → **204** (per TechSpec). All business outcomes → 200.
- **Cancel defaults to void** (`voided` + `canceled_amount`), matching the `_idea.md` §4.3 default example and the sale→cancel lifecycle test. The request carries no void-vs-refund signal, so the route never emits `refunded`; `buildCancelResponse`'s refund path stays available for future callers.
- **Not-found body-error** built in `routes/charges.ts` (`chargeNotFound`): charge `status:failed`, `last_transaction.status:with_error`, `success:false`, return_code `99`, `gateway_response.code:"404"`. Returned at HTTP 200 (never 4xx).
- **Capture/cancel persist lifecycle status** via `store.update` (`paid`/`canceled`) for store coherence, but the response is built from the original `record` (the charge builders set their own status, so the update return value is intentionally unused → no dead `?? record` branch).
- Handlers read `req.body` directly (cast, no `?? {}`) since `express.json()` always yields at least `{}`; nested access uses optional chaining + `??` defaults — keeps branch coverage at 100%.

## Learnings
- Mounting routers: health/reset mounted at root (router defines absolute `/health`, `/__reset`); orders/charges/tokens routers mounted at `/core/v5` (router paths relative). Multiple `app.use("/core/v5", …)` for separate routers is fine.
- Express error-handling middleware needs 4 args; the trailing unused `_next` trips typescript-eslint `no-unused-vars` (after-used). Avoided by NOT adding a global error handler — see Ready for Next Run.

## Files / Surfaces
- New: `src/routes/{orders,charges,tokens,health,reset,index}.ts`. `index.ts` exports `registerRoutes(app, store)`.
- Modified: `src/server.ts` (+`createPagarmeApp`, routes imports; `app` now wired).
- New tests: `tests/unit/routes.test.ts`, `tests/integration/httpRoutes.test.ts`.

## Errors / Corrections
- None. Implementation passed verification on first full run.

## Ready for Next Run
- **Store-failure → 5xx is NOT implemented** (deferred). In-memory store + pure builders never reject on wired paths (gateway_unavailable handled before building), so Task 06 has no failure path. When Task 07's networked KV store lands, add a central error path (async-handler catch → 5xx) per TechSpec "Error handling conventions"; mind the 4-arg error-middleware lint caveat above.
- **Tokenization optional 4xx error** (`_idea.md` §4.4) is out of scope; the route always returns 201. Add only if a token-error scenario is needed.
