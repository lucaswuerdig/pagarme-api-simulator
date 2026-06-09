# Workflow Memory

Keep only durable, cross-task context here. Do not duplicate facts that are obvious from the repository, PRD documents, or git history.

## Current State

- task_01 DONE: `src/auth/tokens.ts` built and verified (100% cov). Exports `VALID_TOKENS` (`ReadonlySet<string>`, only member `test_token`), `isValidToken`, `parseBasicToken`. task_02/03 import from here.
- task_02 DONE: `src/auth/middleware.ts` built and verified (100% cov). Exports `requireToken(req, res, next)` — thin adapter over the task_01 helpers; valid → `next()`, else `401 { error: "unauthorized", message }`. Mounted in task_03.
- task_03 DONE: gate is LIVE. `requireToken` mounted in `registerRoutes` after health / before reset, so `/__reset` + all `/core/v5` are guarded and `/health` is open. `RESET_SECRET`/`x-reset-secret` fully removed from `reset.ts` (now unconditional 204 clear, no `env` param). Shared test helper `tests/helpers/authedRequest.ts` (exports `authedRequest`, `AUTH_HEADER`; token from `VALID_TOKENS`) authenticates all protected supertest calls. Full suite green, 100% cov.
- task_04 DONE: feature COMPLETE. Removed stray `console.log("teste")` from `src/routes/tokens.ts`; documented the token gate (`Authorization: Basic base64("<token>:")`, `/health` open, 401 on miss) in `README.md` (new Authentication section), `docs/connection-guide.md`, `.env.example`. Docs deliberately carry **no `RESET_SECRET` wording** (success-criterion override of ADR-002). Added source-read guard test (no eslint `no-console` rule). Suite green (228 passed), 100% cov.

## Shared Decisions

## Shared Learnings

- Verification gate: `npm test` = `vitest run --coverage` runs the FULL suite with a GLOBAL 80% threshold (lines/funcs/stmts/branches) set in `vitest.config.ts`. Any task adding `src/**` without tests fails the gate. `npm run typecheck` uses `tsconfig.test.json`; `npm run lint` = `eslint .`.
- With the gate live, unknown paths return 401 (not 404) because `requireToken` precedes the 404 fallback (ADR-003). Any test asserting a 404 on an unknown path must authenticate. The protected-route test suite (orders/charges/tokens/reset, across `routes`, `httpRoutes`, `vercelHandler`, `docsAccuracy`, `app` test files) authenticates via `authedRequest`; negative/open-route tests use bare `request(...)`.

## Open Risks

## Handoffs
