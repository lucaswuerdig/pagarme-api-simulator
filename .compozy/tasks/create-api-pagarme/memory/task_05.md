# Task Memory: task_05.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot
Done & verified. Pure response builders under `src/responses/` assembling the order, capture/cancel charge, and token bodies per resolved `Outcome`. All gates green; 100% coverage; 102 tests.

## Important Decisions
- **Order body root/charge/tx status is derived from `record.outcome`** (via `ORDER_OUTCOME_SHAPES`), NOT from `record.status` — body shape is a pure function of the outcome (ADR-003). Task 06 must persist `record.status` consistently (paid / authorized_pending_capture / failed) so the stored lifecycle matches the body. `declined`/`transaction_error`/`order_failed` all set root `status:"failed"` (matches the §4.1 decline example; `ChargeStatus` has no `not_authorized`).
- **`buildOrderResponse(record, input)` throws for `gateway_unavailable`** — that outcome has no body; the route returns 5xx (`_idea.md` §3.3). Typed via `Exclude<Outcome,"gateway_unavailable">` for compile-time exhaustiveness over the 5 body outcomes.
- **`OrderOutcomeShape` is a discriminated union on `success`** so the failure variant requires `declineMessage` (no dead `?? fallback`, keeps 100% branch coverage).
- **Builders mint only the EPHEMERAL ids they need** (fresh `last_transaction.id` per call; token builder mints `token`+`card` id since tokenization is stateless). Stable lifecycle ids (order/charge/card) come from the record. "Pure" = no store/HTTP/clock; minting random suffixes is allowed.
- **Token builder takes an injected `now: Date`** (no internal clock) → `created_at`=now, `expires_at`=now+1h. Task 06 passes `new Date()`.
- **Capture includes `card` (id + empty digits)**, cancel OMITS `card` (matches §4.3). Digits are empty on capture/cancel because `OrderRecord` stores only `cardId`, not the raw number — acceptable since card is not a ⭐ field for those routes.
- **Cancel vs refund** is one fn `buildCancelResponse(record,{kind})`: `void`→`voided`/`canceled`/`canceled_amount`; `refund`→`refunded`/`refunded`/`refunded_amount`. Default `void`.

## Learnings
- Had to ADD a `token` prefix (`token_fake_`) + `newTokenId()` to `src/util/ids.ts` — Task 03's util had only order/charge/card/transaction, but §4.4 token id needs `token_fake_…`. Updated `ids.test.ts` ("five canonical prefixes").
- Replaced the `buildOrderBodyFixture` stand-in in `tests/integration/magicCardOutcome.test.ts` with the real `buildOrderResponse` (per the prior handoff note); resolver-output assertions unchanged.

## Files / Surfaces
- NEW: `src/responses/card.ts` (`buildCard`, `DEFAULT_BRAND`, acquirer constants), `src/responses/orderResponse.ts`, `src/responses/chargeResponse.ts`, `src/responses/tokenResponse.ts`.
- EDIT: `src/util/ids.ts` (+token prefix/helper), `tests/unit/ids.test.ts`, `tests/integration/magicCardOutcome.test.ts`.
- NEW tests: `tests/unit/{orderResponse,chargeResponse,tokenResponse,responseCard}.test.ts`, `tests/integration/responseBuilders.test.ts`.

## Errors / Corrections
- First pass left 2 dead branches (the `declineMessage ?? …` fallback and an unexercised `statement_descriptor` echo) → coverage 99.35%. Fixed via the discriminated-union shape + a statement_descriptor unit test → back to 100%.

## Ready for Next Run
Task 06 (routes) calls these builders. Signatures: `buildOrderResponse(record, {card?, operationType?, installments?, statementDescriptor?, customer?})`; `buildCaptureResponse(record, {amount?})`; `buildCancelResponse(record, {amount?, kind?})`; `buildTokenResponse({card?, type?, now, tokenId?, cardId?})`. Route must: persist `record.status` per outcome; return 5xx for `gateway_unavailable` (don't call the order builder); pass `new Date()` to the token builder; build the not-found body-error for capture/cancel against an unknown charge (TechSpec — NOT built here, left to Task 06).
