# Task Memory: task_04.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- DONE: removed stray `console.log("teste")` from `src/routes/tokens.ts`; documented the always-on token gate in `README.md`, `docs/connection-guide.md`, `.env.example`; added a unit guard test.

## Important Decisions

- Docs must contain **no `RESET_SECRET` references** (task Success Criteria), which overrides ADR-002's "document the removal". Since `RESET_SECRET` was never in the docs, documented only the *new* token requirement and did not name the retired mechanism (also dropped a "reset secret" phrasing from `.env.example`).
- Corrected the now-false "`Authorization` accepted and ignored / never validates the key" claim in the README Endpoints note and the connection-guide "URL swap" section; kept the docs.test.ts-required strings intact ("url swap", "not a key swap", "config:clear", "PAGARME_API_URL", "UNSET IN PRODUCTION", "no code", "https://api.pagar.me", etc.).
- Reconciled "URL swap, not a key swap" with the new gate by framing it fake-side: the team adds its homologation token to the allowlist so the consuming app needs no key change.
- No eslint `no-console` rule exists, so added an explicit source-read guard test (`tests/unit/routes.test.ts` → "tokensRouter source hygiene") instead of relying on lint. Red-green verified.

## Learnings

- 401 body is exactly `{ error: "unauthorized", message: "A valid API token is required." }` (`src/auth/middleware.ts`).
- Example `Authorization` header for `test_token` = `Basic dGVzdF90b2tlbjo=` (`base64("test_token:")`).
- `docsAccuracy.test.ts` extracts only the `<!-- doctest:orders-request -->` JSON block, not the curl, so adding the `Authorization` header to curl snippets is safe — the JSON block must stay byte-intact.

## Files / Surfaces

- `src/routes/tokens.ts` (debug line removed), `README.md` (new Authentication section + Endpoints note + orders/reset curl headers + env-var note), `docs/connection-guide.md` (URL-swap section + verify section), `.env.example` (token note), `tests/unit/routes.test.ts` (guard test).

## Errors / Corrections

- First draft of README/`.env.example` named `RESET_SECRET`/"reset secret" to explain the removal; removed it to satisfy the "no RESET_SECRET references" success criterion.

## Ready for Next Run

- Final task of the PRD; feature is complete. Diff left uncommitted for manual review (`--auto-commit=false`).
