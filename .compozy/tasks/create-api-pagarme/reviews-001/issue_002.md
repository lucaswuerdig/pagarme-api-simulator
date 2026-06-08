---
provider: manual
pr:
round: 1
round_created_at: "2026-06-07T14:03:46Z"
status: resolved
file: src/routes/charges.ts
line: 69
severity: medium
author: claude-code
provider_ref:
---

# Issue 002: DELETE /charges always voids — refund of a captured charge unreachable

## Review Comment

The cancel route calls `buildCancelResponse(record, { amount })` without a `kind`,
so it always takes the default `void` branch: it returns
`last_transaction.status = "voided"`, `operation_type = "void"`, `status =
"canceled"`, and `canceled_amount` (`src/routes/charges.ts:69-78`,
`src/responses/chargeResponse.ts:80-107`). It never produces the `refunded` /
`refunded_amount` shape.

The real gateway distinguishes the two by prior state: cancelling an uncaptured
authorization is a **void**, while reversing a captured (paid) sale is a
**refund** (`_idea.md` §4.3 — "use `status: voided` (cancelamento) ou `refunded`
(estorno)"). The PRD calls out the "sale → refund" flow as a primary user story,
and the TechSpec's testing plan expects "sale → DELETE /charges/{id} → assert
`voided`/`refunded`". Because the route ignores `record.status`, a sale →
capture (status `paid`) → DELETE returns `voided`/`canceled_amount` instead of
`refunded`/`refunded_amount`, so any consuming-app or test assertion on refund
semantics fails.

This is also a dead-capability smell: `buildCancelResponse`'s `kind: "refund"`
branch is exercised only by builder unit tests (`responseBuilders.test.ts:125`,
`pagarme.contract.test.ts`); no HTTP-level test ever reaches it because the route
cannot emit it.

Suggested fix: derive `kind` from the persisted record in the route — a charge
whose current `status` is `paid` (captured) refunds, otherwise voids:

```ts
const kind = record.status === "paid" ? "refund" : "void";
res.status(200).json(buildCancelResponse(record, { amount: body.amount, kind }));
```

## Triage

- Decision: `VALID`
- Severity: `medium`

### Root cause

`DELETE /core/v5/charges/:id` calls `buildCancelResponse(record, { amount })`
with no `kind`, so the builder always takes its default `void` branch
(`src/responses/chargeResponse.ts:80`). The route ignores `record.status`, so a
captured sale can never produce the `refunded` / `refunded_amount` shape — the
builder's `kind: "refund"` path is reachable only from unit tests, never over
HTTP.

### Why this matters (verified against the specs)

- `_idea.md` §4.3 states a cancellation is either `voided` (cancelamento) **or**
  `refunded` (estorno); the real gateway picks by prior state.
- `_techspec.md` §line 145 / §line 205 require `DELETE /charges/{id}` to set
  `voided`/`refunded` and the testing plan expects "sale → DELETE → assert
  `voided`/`refunded`".
- `_prd.md` lists "sale → refund" as a primary multi-step user story (lines 63,
  107, 174).

Confirmed the persisted-status mapping: `src/routes/orders.ts:34` maps
`approved_captured → paid`, and `src/magic/cards.ts:36` maps card
`4000000000000010 → approved_captured`. So a sale on that card is persisted with
`status: "paid"`, yet `DELETE` returned `voided`/`canceled_amount` — wrong per
the gateway semantics above (a captured/paid charge must refund).

### Fix approach

Derive the kind from the persisted record in the route: a charge whose current
`status` is `paid` (captured) is reversed as a `refund`; any not-yet-captured
charge (notably `authorized_pending_capture`) is a `void`. Pass that `kind` into
`buildCancelResponse`, and persist the matching post-cancel status
(`refunded` vs `canceled`) so the stored record stays coherent.

### Test impact

The existing integration test `httpRoutes.test.ts` "sale (4000000000000010) →
DELETE → 200 voided" exercises a `paid` charge and asserted `voided`; under the
corrected semantics that case is a refund. Updated it to assert
`refunded`/`refunded_amount`, and added a companion test for the uncaptured
pre-auth (`4000000000000028`, `auth_only`) → `DELETE` → `voided`/`canceled_amount`
so both HTTP-level branches are now covered. Builder unit tests
(`chargeResponse.test.ts`) and the contract fixture (`pagarme.contract.test.ts`)
pass an explicit `kind`/use static fixtures and are unaffected.
