# Task Memory: task_01.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

Pure, Express-free token module `src/auth/tokens.ts` exporting `VALID_TOKENS`, `isValidToken`, `parseBasicToken`. Done — verified (see shared memory for downstream-relevant state).

## Important Decisions

- Followed the TechSpec "Core Interfaces" implementation verbatim, including `Buffer` for base64 (Node global → still counts as pure: no Express/store/network/clock).
- `parseBasicToken` uses `header.slice("Basic ".length)` (= 6) for readability instead of a magic `6`.

## Learnings

- `String.prototype.split(":", 1)` limits the RETURNED array length (yields the substring before the first colon), not the number of splits — exactly what's needed to take the username part before the empty password.
- Node `Buffer.from(x, "base64")` silently drops invalid base64 chars instead of throwing, so non-base64 input yields a non-listed (garbage) token rather than an error — satisfies the "never throws" requirement.

## Files / Surfaces

- Added: `src/auth/tokens.ts`, `tests/unit/tokens.test.ts`.

## Errors / Corrections

- None.

## Ready for Next Run

- task_02 (`src/auth/middleware.ts`) imports `isValidToken` + `parseBasicToken` from `./tokens`.
- task_03 helper imports `test_token` (the only allowlisted value) from `src/auth/tokens.ts`.
