---
status: completed
title: Pagar.me v5 contract types
type: backend
complexity: low
dependencies:
  - task_01
---

# Task 2: Pagar.me v5 contract types

## Overview
Define the TypeScript models for the Pagar.me v5 wire contract — Order, Charge, Transaction, Card, Token
— plus the internal `OrderRecord` and the `ChargeStatus` union. These types give compile-time protection
over the ⭐ fields the consuming app reads downstream and are imported by the store, resolver, builders,
and routes (TechSpec "Data Models").

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST define response models on the wire in snake_case exactly as in TechSpec "Data Models" and `_idea.md` §4: Order, Charge, Transaction (`last_transaction`), Card, Token.
- MUST include every ⭐ field the consuming app reads later: root `id`/`code`/`status`, `charges[0].id`/`amount`, `last_transaction.status`/`success`/`card.id`/`acquirer_*`, `metadata.site`.
- MUST define the internal `OrderRecord` shape and a `ChargeStatus` union (`paid` | `authorized_pending_capture` | `canceled` | `refunded` | `failed`) per TechSpec "Core Interfaces".
- MUST keep request types loose (only the fields the service reads), since the consuming app pre-validates per `_idea.md` §4.1.
- MUST NOT contain runtime logic — types and minimal const enums only.
</requirements>

## Subtasks
- [x] 2.1 Define the Order, Charge, Transaction, Card, and Token response interfaces in snake_case.
- [x] 2.2 Define the internal `OrderRecord` interface and the `ChargeStatus` union used by the store.
- [x] 2.3 Define a loose request type capturing only the fields the service reads (`amount`, card number/`card_id`/`card_token`, `operation_type`, `installments`, `code`, `metadata`).
- [x] 2.4 Export all types from a single module for reuse across store, resolver, builders, and routes.

## Implementation Details
Create `src/types/pagarme.ts` mirroring TechSpec "Data Models" precisely; do not invent fields beyond
the contract. The `Outcome` union is owned by the resolver task (Task 04), not here. See `_idea.md` §4
and §8 for the authoritative field list and the per-response required-field checklist.

### Relevant Files
- `src/types/pagarme.ts` — create: all contract and internal types.

### Dependent Files
- `src/store/orderStore.ts` (Task 03) — imports `OrderRecord`, `ChargeStatus`.
- `src/magic/cards.ts` (Task 04) — imports request-shaped input types.
- `src/responses/*` (Task 05) — imports Order/Charge/Transaction/Card/Token to build bodies.
- `src/routes/*` (Task 06) — imports request/response types.

### Related ADRs
- [ADR-004: Node.js + Express + TypeScript implementation stack](adrs/adr-004.md) — Typed contract models are the rationale for choosing TypeScript.
- [ADR-003: Credit-card-only scope with deterministic magic-card outcomes](adrs/adr-003.md) — Bounds the contract to the five credit-card routes' shapes.

## Deliverables
- `src/types/pagarme.ts` exporting Order, Charge, Transaction, Card, Token, OrderRecord, ChargeStatus, and the loose request type.
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration tests for type-shape conformance via a fixture **(REQUIRED)**

## Tests
- Unit tests:
  - [x] A hand-written success-order fixture from `_idea.md` §4.1 type-checks against the `Order` interface (compile-time assertion test).
  - [x] A `ChargeStatus` value outside the union (e.g., `"bogus"`) fails to assign in a `// @ts-expect-error` test.
  - [x] `OrderRecord` requires `orderId`, `chargeId`, `cardId`, `code`, `amount`, `status`, `outcome` (missing field is a type error).
- Integration tests:
  - [x] A representative capture-response and cancel-response fixture from `_idea.md` §4.2–4.3 satisfies the `Charge` interface (used by Task 05 builders).
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- All ⭐ fields from `_idea.md` §8 are representable by the exported types
- Types compile with no errors and are imported by at least the store and builders tasks
