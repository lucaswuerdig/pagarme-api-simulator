---
provider: manual
pr:
round: 1
round_created_at: "2026-06-07T14:03:46Z"
status: resolved
file: src/routes/charges.ts
line: 54
severity: low
author: claude-code
provider_ref:
---

# Issue 004: Capture/cancel ignore the charge's persisted state

## Review Comment

The capture and cancel handlers branch only on record presence
(`record === undefined` → not-found error); they never inspect the record's
`outcome` or current `status` (`src/routes/charges.ts:54-79`). As a result:

- A capture against a charge whose order resolved to `declined` / `transaction_error`
  / `order_failed` (persisted `status: failed`, `src/routes/orders.ts:34-42`)
  returns a successful `captured` transaction — capturing a charge that was never
  authorized.
- A second `DELETE` on an already-canceled charge again returns `voided`/`success`.
- A capture after a cancel succeeds.

The real gateway rejects these transitions. For the MVP's happy-path lifecycle
(auth → capture, sale → cancel) the consuming app would not drive these
sequences, so impact is limited — hence low severity — but the responses are not
contract-faithful and could mask consuming-app bugs that issue an out-of-order
operation.

Suggested fix: gate the transition on the persisted state and return the
body-level error shape (the existing `chargeNotFound`-style `with_error` /
`success: false` charge) when the transition is invalid — e.g. only allow capture
when `record.status === "authorized_pending_capture"`, and only allow
cancel/refund when the charge is not already canceled/refunded/failed.

## Triage

- Decision: `VALID`
- Severity: `low`

### Root cause

Confirmed against the code. Both lifecycle handlers in `src/routes/charges.ts`
branch *only* on record presence and never inspect the persisted `status`:

- Capture (`charges.ts:54-66`): on `record !== undefined` it unconditionally
  `store.update(..., { status: "paid" })` and returns `buildCaptureResponse`
  (`status: captured`, `success: true`). A charge persisted as `failed`
  (declined / transaction_error / order_failed — `orders.ts:34-42`,
  `PERSISTED_STATUS`) is therefore "captured" despite never having been
  authorized; an already-`paid` sale or a `canceled`/`refunded` charge is also
  re-captured.
- Cancel (`charges.ts:74-87`): on `record !== undefined` it derives
  `kind = status === "paid" ? "refund" : "void"` and always succeeds. A second
  `DELETE` on an already-`canceled`/`refunded` charge returns a fresh
  `voided`/`refunded` `success` transaction, and a `failed` charge can be
  "voided".

The real gateway rejects these out-of-order transitions; the fake's responses
are not contract-faithful and could mask consuming-app bugs that issue an
out-of-order operation.

### Fix approach

Gate each transition on the persisted `status` and, when invalid, return a
body-level error at HTTP 200 (never a 4xx — `_idea.md` §3.3), mirroring the
existing `chargeNotFound` `with_error` / `success: false` shape via a new
`invalidTransition(record, message)` helper that echoes the charge's real
`id`/`code`/`amount`/`status` (the rejected op persists nothing):

- Capture is allowed only when `record.status === "authorized_pending_capture"`.
- Cancel/refund is allowed only when `record.status` is `paid` (→ refund) or
  `authorized_pending_capture` (→ void); `canceled`/`refunded`/`failed` are
  rejected.

### Test impact (in scope per skill: test edits that validate a fix)

The pre-existing `POST /__reset isolates state` test in
`tests/integration/httpRoutes.test.ts` performed its pre-reset capture against a
`4000000000000010` (`approved_captured` → persisted `paid`) charge and expected
`captured`. That relied on the buggy "capture any present charge" behavior, so
it is updated to drive an `auth_only` pre-auth (`4000000000000028` →
`authorized_pending_capture`), which is genuinely capturable — the reset
isolation assertion it actually tests is unchanged. New unit tests in
`tests/unit/routes.test.ts` cover the rejected transitions.

### Verification

Full pipeline run after all changes (no single `verify` script — these are the
project's real gates from `package.json`):

- `npm run lint` (eslint) — exit 0, no errors.
- `npm run typecheck` (`tsc --noEmit -p tsconfig.test.json`) — exit 0.
- `npm test` (`vitest run --coverage`) — 206 passed, 2 skipped (Docker image
  suite); `src/routes/charges.ts` at 100% stmt/branch/func/line coverage.
- `npm run build` (`tsc`) — exit 0.
