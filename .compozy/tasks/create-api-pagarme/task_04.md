---
status: pending
title: Magic-card outcome resolver
type: backend
complexity: low
dependencies:
  - task_02
---

# Task 4: Magic-card outcome resolver

## Overview
Implement the pure function that maps an incoming card number (or `card_id`/`card_token`) to one of the
six deterministic outcomes, and own the `Outcome` union type. This is the single source of scenario
truth that makes every test result reproducible from the request alone (TechSpec "Core Interfaces";
ADR-003).

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST define the `Outcome` union (six values) exactly as in TechSpec "Core Interfaces".
- MUST map the magic-card table from `_idea.md` §5 to outcomes: `4000000000000010`→approved_captured, `4000000000000028`→approved_no_capture, `4000000000000002`→declined, `4000000000000036`→transaction_error, `4000000000000044`→order_failed, `4000000000009999`→gateway_unavailable.
- MUST resolve from `credit_card.card.number` OR `card_id`/`card_token`, supporting analogous magic ids for tokenized flows.
- MUST default an unrecognized card to `approved_captured` (per TechSpec "Core Interfaces" comment).
- MUST be a pure function with no I/O or store access.
</requirements>

## Subtasks
- [ ] 4.1 Define the `Outcome` union type and the magic-card → outcome lookup table.
- [ ] 4.2 Implement `resolveOutcome(input)` reading number, `card_id`, or `card_token`.
- [ ] 4.3 Map tokenized magic ids (e.g., `card_approved`, `card_refused`) to the same outcomes.
- [ ] 4.4 Default unknown cards to `approved_captured`.

## Implementation Details
Create `src/magic/cards.ts` exporting `Outcome` and `resolveOutcome`. The signature is in TechSpec
"Core Interfaces"; the card-number table is in `_idea.md` §5 — reference, do not duplicate prose.
The resolver is consumed by the response builders (Task 05) and routes (Task 06).

### Relevant Files
- `src/magic/cards.ts` — create: `Outcome` union + `resolveOutcome` + magic-card table.

### Dependent Files
- `src/responses/*` (Task 05) — build bodies keyed off the resolved `Outcome`.
- `src/routes/*` (Task 06) — call `resolveOutcome` on incoming order/token requests.
- `src/types/pagarme.ts` (Task 02) — `OrderRecord.outcome` references this `Outcome` type.

### Related ADRs
- [ADR-003: Credit-card-only scope with deterministic magic-card outcomes](adrs/adr-003.md) — This task IS the deterministic magic-card mechanism; no runtime overrides.

## Deliverables
- `src/magic/cards.ts` with the `Outcome` union and a pure `resolveOutcome` covering all six scenarios plus tokenized ids.
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration tests exercising resolver output through a builder or route fixture **(REQUIRED)**

## Tests
- Unit tests:
  - [ ] `4000000000000010` resolves to `approved_captured`.
  - [ ] `4000000000000028` resolves to `approved_no_capture`.
  - [ ] `4000000000000002` resolves to `declined`.
  - [ ] `4000000000000036` resolves to `transaction_error`.
  - [ ] `4000000000000044` resolves to `order_failed`.
  - [ ] `4000000000009999` resolves to `gateway_unavailable`.
  - [ ] An unrecognized number (e.g., `5555444433332222`) defaults to `approved_captured`.
  - [ ] A tokenized magic `card_id` (e.g., `card_refused`) resolves to `declined`.
- Integration tests:
  - [ ] Resolver output drives a builder (Task 05) so `declined` produces a body with `success: false` (verified once builders exist).
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- Every magic-card row in `_idea.md` §5 maps to the correct `Outcome`
- `resolveOutcome` is pure (no store/network access) and deterministic
