---
provider: manual
pr:
round: 1
round_created_at: 2026-06-09T12:54:54Z
status: resolved
file: tests/integration/docsAccuracy.test.ts
line: 56
severity: low
author: claude-code
provider_ref:
---

# Issue 002: docsAccuracy does not verify the documented Authorization header

## Review Comment

`docsAccuracy.test.ts` exists to prove the README is *accurate* (doc ↔ behavior
parity). The README now documents a concrete credential —
`authorization: Basic dGVzdF90b2tlbjo=` (`base64("test_token:")`) — in the orders,
`/__reset`, and Authentication examples. But the parity test authenticates via the
shared `authedRequest` helper, which builds its **own** header from
`VALID_TOKENS`:

```ts
const res = await authedRequest(buildDocumentedApp())
  .post("/core/v5/orders")
  .send(body as Record<string, unknown>);
```

So the base64 string shown in the README is never parsed or exercised by the test
that is supposed to guarantee the docs work. The value is correct today
(`printf 'test_token:' | base64` == `dGVzdF90b2tlbjo=`), but a future edit to the
documented token/base64 could drift from reality and the suite would stay green — a
reader copy-pasting the README curl would then get a `401`.

Suggested fix: in `docsAccuracy.test.ts`, extract the documented `authorization`
header from the README (same `extractMarkedJson`-style marker approach already used
for the request body) and drive the request with that exact header instead of the
helper, asserting the documented credential authenticates. This closes the parity
gap for the auth example specifically.

## Triage

- Decision: `VALID`
- Root cause: `docsAccuracy.test.ts` is the doc ↔ behavior parity suite, but the
  sample `POST /core/v5/orders` test authenticated through the shared
  `authedRequest` helper, which builds its `Authorization` header from
  `VALID_TOKENS` (`src/auth/tokens.ts`) — *not* from the README. So the README's
  literal credential `authorization: Basic dGVzdF90b2tlbjo=` was never parsed or
  exercised by the parity suite. It happens to be correct today
  (`base64("test_token:") == dGVzdF90b2tlbjo=`, and the gate in
  `src/auth/middleware.ts` accepts it), but a future drift in the documented
  base64 would leave the suite green while a reader copy-pasting the README curl
  would get a `401`. Real parity gap for the auth example.
- Fix (scoped to `tests/integration/docsAccuracy.test.ts` only):
  - Added `extractDocumentedAuthHeader(markdown, marker)`, mirroring the existing
    `extractMarkedJson` marker approach: it pulls the literal
    `-H 'authorization: Basic …'` value out of the README curl block following the
    `<!-- doctest:orders-request -->` marker.
  - The orders parity test now drives the request with that exact documented
    header via `.set("Authorization", …)` instead of `authedRequest`, so the
    existing `200`/`paid`/`captured` assertions now also prove the documented
    credential authenticates against the running app. Removed the now-unused
    `authedRequest` import.
  - Added a dedicated parity test asserting the documented credential is accepted
    on a protected route (`POST /__reset` → `204`) **and** that the same request
    without it is rejected (`401`), so the documented-header assertion can never be
    vacuous (a wrong base64 → `401` → suite fails, exactly as a reader would hit).
  - No production source touched; the change is confined to the in-scope test
    file. README was not modified (the documented header is read, not changed).
- Verification (cy-final-verify, fresh run after the change):
  - `npm run lint` → exit 0, 0 errors (confirms the removed `authedRequest` import
    left no unused-symbol violation).
  - `npm run typecheck` (`tsc --noEmit -p tsconfig.test.json`) → exit 0.
  - `npm test` (`vitest run --coverage`) → 231 passed, 2 skipped; coverage 100%
    stmts/branch/funcs/lines (80% thresholds met).
  - `npm run build` (`tsc`) → exit 0.
  - Focused: `vitest run tests/integration/docsAccuracy.test.ts` → 3 tests passed
    (was 2). The orders parity test returning `200` while driven by the *extracted*
    documented header proves the README's `Basic dGVzdF90b2tlbjo=` authenticates;
    a drifted base64 would yield `401` and fail the suite — the gap is now closed.
