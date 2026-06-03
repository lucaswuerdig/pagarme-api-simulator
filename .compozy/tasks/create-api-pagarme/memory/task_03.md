# Task Memory: task_03.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot
- `OrderStore` interface + `InMemoryOrderStore` (Map keyed by `chargeId`) + opaque prefixed ID util. Backend-agnostic so Task 07 KV reuses the interface + contract test unchanged.

## Important Decisions
- Reuse `OrderRecord` from `src/types/pagarme.ts` (Task 02); do NOT redefine it in `orderStore.ts`. TechSpec Core Interfaces shows it there only for reference.
- In-memory store clones on create/get/update (`structuredClone`) so it matches KV's JSON round-trip semantics — returned/stored records are isolated snapshots, never live references. Makes the contract suite truly backend-agnostic.
- Integration lifecycle uses a TYPE-CORRECT pre-auth flow: create `authorized_pending_capture` → update `paid` (capture) → update `canceled` (cancel). Task wording "create(paid)→captured→canceled" mixes in transaction-level statuses ("captured"/"voided") which are NOT in `ChargeStatus`; `OrderRecord.status` is `ChargeStatus` only.
- ID util: prefix + 16 random bytes hex (128-bit) via `node:crypto` `randomBytes`. Non-sequential. `ID_PREFIXES` const is the single source of the four prefixes; `mintId(prefix)` + named helpers `newOrderId/newChargeId/newCardId/newTransactionId`.

## Learnings
- Reusable contract suite lives at `tests/contract/orderStoreContract.ts` (NOT a `*.test.ts`, so vitest's `tests/**/*.test.ts` glob does not run it standalone; it is still typechecked since tsconfig.test.json includes `tests`). Exports `runOrderStoreContract(name, makeStore)` + `makeSampleRecord`.

## Files / Surfaces
- create: `src/store/orderStore.ts`, `src/store/inMemoryOrderStore.ts`, `src/util/ids.ts`
- tests: `tests/contract/orderStoreContract.ts`, `tests/unit/inMemoryOrderStore.test.ts`, `tests/unit/ids.test.ts`, `tests/integration/orderStoreLifecycle.test.ts`

## Errors / Corrections
- None. All gates green first pass: lint/typecheck/build exit 0; 39 tests pass; coverage 100% (orderStore.ts is interface-only → 0 executable stmts, global aggregate 100%, thresholds pass).

## Ready for Next Run
- Task 03 complete & verified. Store/ID API + reusable contract suite promoted to shared MEMORY.md. Diff left uncommitted (`--auto-commit=false`).
