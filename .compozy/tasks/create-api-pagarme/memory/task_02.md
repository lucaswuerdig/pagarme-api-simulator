# Task Memory: task_02.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot
- Create `src/types/pagarme.ts`: snake_case wire models (Order, Charge, Transaction, Card, Token), internal `OrderRecord`, `ChargeStatus` union, and loose request types. Types + one const enum only, no runtime logic. Source of truth: `_idea.md` §4/§8 (authoritative field list) + TechSpec "Data Models"/"Core Interfaces".

## Important Decisions
- **Optionality rule**: a field is required only if present in EVERY response variant that uses its interface; absent-in-some-variant ⇒ optional. So `Transaction.card?` (cancel §4.3 has none), `Charge.code?` (decline §4.1 has none), `Transaction.installments?/operation_type?/...?`. `Transaction.{id,transaction_type,amount,status,success,acquirer_name,acquirer_return_code}` required (in all variants + ⭐).
- **`ChargeStatus` derived from a `const` tuple** `CHARGE_STATUSES` (the one allowed "minimal const enum") so the file has runtime content to cover/test and the union has a single source of truth.
- **`OrderRecord.outcome: string`** (loose). The `Outcome` union is owned by Task 04 (`src/magic/cards.ts`); keeping `string` avoids importing a not-yet-existing module and any type-only import cycle. `Outcome` ⊂ `string`, so Task 04 can narrow later without breaking anything.
- **Transaction `status` typed as `string`** (not a union) — only `ChargeStatus` is mandated; loose avoids over-constraining Task 05 builders.
- Order/Charge root `status` typed as `ChargeStatus` (gives the ⭐ compile-time protection the task asks for; all §4 fixtures use values in the union).

## Learnings
- **vitest uses esbuild — it strips types WITHOUT type-checking.** So `// @ts-expect-error` and typed fixtures are inert under `vitest run`. Added a `typecheck` script (`tsc --noEmit -p tsconfig.test.json`) + `tsconfig.test.json` (rootDir `.`, includes src+tests, noEmit) so the compile-time assertion tests are actually enforced.
- `@typescript-eslint/ban-ts-comment` (recommended) requires a description after `@ts-expect-error` — always write `// @ts-expect-error <reason>`.

## Files / Surfaces
- create `src/types/pagarme.ts`
- create `tests/unit/pagarme.test.ts`, `tests/integration/pagarme.contract.test.ts`
- create `tsconfig.test.json`; edit `package.json` (add `typecheck` script)

## Errors / Corrections
- None. Build + typecheck + lint + test all green on first full run; coverage 100% (`src/types/pagarme.ts`).

## Ready for Next Run
- Task 02 complete & verified (19 tests pass; types compile clean). Auto-commit disabled — diff left for manual review (no commit made).
- Followups for downstream tasks (also promoted to shared MEMORY): Task 04 may narrow `OrderRecord.outcome` `string` → `Outcome`; Task 05 builders own ⭐-field population since most response fields are optional; CI (Task 09) should run `npm run typecheck`.
