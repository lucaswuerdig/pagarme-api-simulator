---
provider: manual
pr:
round: 1
round_created_at: "2026-06-07T14:03:46Z"
status: resolved
file: src/routes/reset.ts
line: 17
severity: low
author: claude-code
provider_ref:
---

# Issue 005: Unauthenticated POST /__reset wipes all state on the shared instance

## Review Comment

`POST /__reset` calls `store.clear()`, which drops **every** record — the
in-memory `Map.clear()` or all `ch:*` keys in KV (`src/routes/reset.ts:17-20`,
`src/store/kvOrderStore.ts:95-110`). It is mounted at the root with no auth guard
and is reachable on the deployed Vercel URL like any other route.

The PRD/TechSpec design the fake as a **single always-on shared instance** the
whole team points at, and explicitly list "shared-instance state interference" as
a risk whose mitigation is per-request opaque ids and a *Phase 2*, prefix-scoped
reset. A global, unauthenticated clear works against that: any client that can
reach the homologation URL (or one suite's teardown) can erase another suite's
in-flight orders mid-run, so a concurrent `auth → capture` flow loses its charge
and resolves as not-found. Impact is bounded to disposable test state (no real
card data is stored), hence low severity, but it directly undermines the
shared-instance coherence the product depends on.

Suggested fix: guard `/__reset` behind a shared secret/header check (404 or 401
otherwise) so it is opt-in for a controlled teardown, and/or document that it must
not be invoked while other suites are running against the shared instance.

## Triage

- Decision: `VALID`
- Root cause: `resetRouter` (`src/routes/reset.ts`) mounts `POST /__reset` at the
  root via `registerRoutes` (`src/routes/index.ts:56`) with no auth guard, and the
  handler unconditionally `await store.clear()` — dropping every record. On the
  always-on shared homologation instance the PRD/TechSpec design, any caller that
  can reach the Vercel URL (or a stray suite teardown) can wipe another suite's
  in-flight orders mid-run, so a concurrent `auth → capture` flow loses its charge
  and resolves not-found. Confirmed `OrderStore.clear()` is a global wipe (in-memory
  `Map.clear()`; KV deletes all `ch:*` keys) with no scoping. Severity correctly
  low: only disposable test state is affected (no card data persisted), but it
  undermines the shared-instance coherence the product depends on.
- Fix: guarded `POST /__reset` behind an optional shared secret, following the
  repo's env-var convention (defaulted `env` param, mirroring `resolvePort` /
  `createStore`). When `RESET_SECRET` is set, the request must carry a matching
  `x-reset-secret` header (exported as `RESET_SECRET_HEADER`) or it is rejected
  401 with a `{ error, message }` body matching the existing 404-fallback shape,
  and `store.clear()` is never reached. When `RESET_SECRET` is unset (local dev,
  hermetic CI, current tests) the route stays open, so existing behavior — and the
  `204` reset contract — is preserved. The operator opts in to the guard by setting
  `RESET_SECRET` on the deployed shared instance. Chose 401 over 404 because the
  endpoint's existence is already documented in the README, so a debuggable
  unauthorized signal beats conflating a wrong secret with a missing route.
- Tests: added a `POST /__reset shared-secret guard (Issue 005)` block in
  `tests/unit/routes.test.ts` injecting `RESET_SECRET` via the `env` param (no
  ambient env mutation) and asserting (a) missing header → 401 + store intact,
  (b) wrong header → 401 + store intact, (c) matching header → 204 + store cleared.
  The unset-secret open path stays covered by the existing 204 reset test.
- Scope note: change confined to the in-scope `src/routes/reset.ts` plus its test
  file. README documentation of `RESET_SECRET` (the issue's "and/or document"
  suggestion) is out of this batch's code scope; the auth guard is the substantive
  mitigation and lands here.
- Verification: `npm run lint`, `npm run typecheck`, `npm run build`, and
  `npm test` (full vitest + coverage) all green — 209 passed / 2 skipped, 100%
  coverage including `src/routes/reset.ts` at 100% branch coverage.
