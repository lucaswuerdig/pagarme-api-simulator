---
status: pending
title: Response builders (order / charge / token)
type: backend
complexity: medium
dependencies:
  - task_02
  - task_03
  - task_04
---

# Task 5: Response builders (order / charge / token)

## Overview
Implement the pure functions that assemble contract-faithful response bodies for each `Outcome`: the
order body (`POST /orders`), the charge body (capture and cancel/refund), and the token body
(`POST /tokens`). These builders own every ⭐ field the consuming app reads downstream and are the
heart of contract fidelity (TechSpec "Implementation Design"; `_idea.md` §4, §8).

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST build the order body so the body-based approval rules hold: success outcomes set root `status` ≠ `failed`, `last_transaction.status` ∈ {`captured`,`authorized_pending_capture`}, and `success: true` (`_idea.md` §3.1).
- MUST build the decline/transaction-error/order-failed bodies so the parser treats them as non-success (`success: false` and/or `status: not_authorized`/`with_error`, or root `status: failed`).
- MUST include every ⭐ field from `_idea.md` §8 for each response: order, capture-charge, cancel-charge, and token.
- MUST echo the request `code` and preserve `metadata.site` in the order body.
- MUST derive `first_six_digits`/`last_four_digits` from the card number and default `brand` to `Visa`.
- MUST produce capture/cancel charge bodies with `last_transaction` at the ROOT (not inside `charges[]`), per `_idea.md` §4.2–4.3.
</requirements>

## Subtasks
- [ ] 5.1 Build the order response for each success and failure `Outcome` (with `charges[0].last_transaction`).
- [ ] 5.2 Build the capture charge response (root-level `last_transaction`, `status: captured`).
- [ ] 5.3 Build the cancel/refund charge response (`voided`/`refunded`, `canceled_amount`/`refunded_amount`).
- [ ] 5.4 Build the token response with card metadata and timestamps.
- [ ] 5.5 Populate `acquirer_*` fields and derive card display fields from the number.

## Implementation Details
Create builders under `src/responses/` (e.g., `orderResponse.ts`, `chargeResponse.ts`,
`tokenResponse.ts`). Inputs are the resolved `Outcome` (Task 04) plus the persisted `OrderRecord`
(Task 03) and request fields. Reference TechSpec "Data Models" and the per-response checklists in
`_idea.md` §8 — do not duplicate field tables. Builders are pure; persistence and HTTP live in Task 06.

### Relevant Files
- `src/responses/orderResponse.ts` — create: order body per outcome.
- `src/responses/chargeResponse.ts` — create: capture and cancel/refund charge bodies.
- `src/responses/tokenResponse.ts` — create: token body.

### Dependent Files
- `src/routes/*` (Task 06) — call builders to produce HTTP responses.
- `src/types/pagarme.ts` (Task 02) — builders return these typed shapes.
- `src/magic/cards.ts` (Task 04) — `Outcome` selects which body to build.

### Related ADRs
- [ADR-001: Stateful, contract-faithful fake over stateless stub](adrs/adr-001.md) — Builders read the persisted record to keep amounts/ids coherent across the lifecycle.
- [ADR-003: Credit-card-only scope with deterministic magic-card outcomes](adrs/adr-003.md) — Body shape varies only by the resolved outcome.

## Deliverables
- Builders for order, capture-charge, cancel/refund-charge, and token responses covering all six outcomes.
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration tests asserting the `_idea.md` §8 ⭐ checklist per response **(REQUIRED)**

## Tests
- Unit tests:
  - [ ] `approved_captured` order body: root `status` ≠ `failed`, `charges[0].last_transaction.status = "captured"`, `success: true`, and `charges[0].last_transaction.card.id` present.
  - [ ] `approved_no_capture` order body: `last_transaction.status = "authorized_pending_capture"`, `operation_type = "auth_only"`, `success: true`.
  - [ ] `declined` order body: `last_transaction.status = "not_authorized"`, `success: false`, `acquirer_return_code = "57"`.
  - [ ] `transaction_error` order body: `last_transaction.status = "with_error"`, `success: false`.
  - [ ] `order_failed` order body: root `status = "failed"`.
  - [ ] Order body echoes the request `code` and keeps `metadata.site`.
  - [ ] Capture charge body: root-level `last_transaction.status = "captured"`, `success: true`.
  - [ ] Cancel charge body: `last_transaction.status = "voided"`, `success: true`, and `canceled_amount` set.
  - [ ] Token body: `id`, `card.id`, `card.first_six_digits`, `card.last_four_digits`, `card.brand` all present.
- Integration tests:
  - [ ] For each outcome, the assembled order body contains the full ⭐ field set from `_idea.md` §8 (checklist assertion).
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- Every ⭐ field in `_idea.md` §8 is present for order, capture, cancel, and token responses
- Body-based approval rules (`_idea.md` §3.1) hold for success vs. non-success outcomes
