# Task Memory: task_04.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot
- Magic-card outcome resolver: own the `Outcome` union (6 values) + pure `resolveOutcome` mapping card number / `card_id` / `card_token` → outcome. Done & verified.

## Important Decisions
- Narrowed `OrderRecord.outcome` from `string` → `Outcome` (type-only import `../magic/cards`). Realizes the documented design intent; one-directional (cards.ts imports nothing) so no cycle. All existing fixtures used valid Outcome values, so no breakage.
- Lookup precedence: `number` → `cardId` → `cardToken` → `DEFAULT_OUTCOME`, via a `??` chain over an `Object.hasOwn`-guarded `lookup()` (guards against inherited keys like `constructor`/`toString`).

## Learnings
- `Object.hasOwn` is fine under the ES2022 lib / Node>=20 target (no extra config).

## Files / Surfaces
- create `src/magic/cards.ts` — `Outcome`, `DEFAULT_OUTCOME`, `MAGIC_CARD_NUMBERS`, `MAGIC_TOKEN_IDS`, `resolveOutcome`.
- edit `src/types/pagarme.ts` — `OrderRecord.outcome: Outcome` + type-only import.
- create `tests/unit/cards.test.ts`, `tests/integration/magicCardOutcome.test.ts`.

## Errors / Corrections
- None.

## Ready for Next Run
- cards.ts at 100% coverage; build/typecheck/lint/test all green. No follow-up debt. Task 05 builders + Task 06 routes can import `resolveOutcome`/`Outcome` now.
