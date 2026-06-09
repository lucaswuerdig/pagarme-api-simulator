---
status: completed
title: Pure token allowlist module (src/auth/tokens.ts)
type: backend
complexity: low
dependencies: []
---

# Task 1: Pure token allowlist module (src/auth/tokens.ts)

## Overview
Create the Express-free core of the token-auth feature: a committed allowlist of valid
tokens plus pure helpers to validate a token and to extract it from a Basic auth header.
This is the single source of scenario truth for authentication, mirroring how
`src/magic/cards.ts` holds the magic-card tables, and is the foundation every other task
builds on.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST create `src/auth/tokens.ts` with no Express, network, store, or clock access (pure module), mirroring the structure of `src/magic/cards.ts`.
- MUST export a `VALID_TOKENS` allowlist as an immutable collection and include the clearly-fake homologation value `test_token` used by the test suite (ADR-004).
- MUST export `isValidToken(token: string | undefined): boolean` returning true only for an allowlisted token.
- MUST export `parseBasicToken(header: string | undefined): string | undefined` that decodes `Authorization: Basic base64("<token>:")` and returns the token (the part before the first `:`), or `undefined` when the header is absent or malformed.
- MUST NOT log token values anywhere in this module.
</requirements>

## Subtasks
- [x] 1.1 Create the `src/auth/` directory and `tokens.ts` module file.
- [x] 1.2 Define the immutable `VALID_TOKENS` allowlist including `test_token`.
- [x] 1.3 Implement `isValidToken` against the allowlist.
- [x] 1.4 Implement `parseBasicToken` for the Basic scheme, including malformed-input handling.
- [x] 1.5 Add unit tests covering valid, invalid, and malformed inputs.

## Implementation Details
Create `src/auth/tokens.ts`. See TechSpec "Core Interfaces" for the exact signatures of
`VALID_TOKENS`, `isValidToken`, and `parseBasicToken`, and "System Architecture" for the
module's role. Follow the documentation and immutability style of `src/magic/cards.ts`
(JSDoc per export, `Readonly`/`Set` for the table). Base64 decoding uses Node's `Buffer`
— no new dependency.

### Relevant Files
- `src/magic/cards.ts` — precedent for an in-file allowlist with pure lookups; mirror its style.
- `src/util/ids.ts` — example of an existing small pure utility module under `src/`.

### Dependent Files
- `src/auth/middleware.ts` — created in task_02; consumes `isValidToken` and `parseBasicToken`.
- `tests/helpers/authedRequest.ts` — created in task_03; imports the test token from this module.

### Related ADRs
- [ADR-001: Static in-file token allowlist with an always-on Basic-auth gate](../adrs/adr-001.md) — defines the in-file allowlist approach.
- [ADR-003: Token-auth middleware design](../adrs/adr-003.md) — specifies the module layout and `parseBasicToken` semantics.
- [ADR-004: Test authentication via a shared helper and a committed homologation test token](../adrs/adr-004.md) — requires `test_token` in the allowlist.

## Deliverables
- `src/auth/tokens.ts` exporting `VALID_TOKENS`, `isValidToken`, and `parseBasicToken`.
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration tests: none for this pure module (covered downstream in task_03) **(N/A — documented)**

## Tests
- Unit tests:
  - [x] `isValidToken("test_token")` returns `true`.
  - [x] `isValidToken("not_listed")` returns `false`.
  - [x] `isValidToken(undefined)` returns `false`.
  - [x] `parseBasicToken('Basic ' + base64("test_token:"))` returns `"test_token"`.
  - [x] `parseBasicToken(undefined)` returns `undefined` (no header).
  - [x] `parseBasicToken("Bearer abc")` returns `undefined` (wrong scheme).
  - [x] `parseBasicToken("Basic !!!not-base64")` returns `undefined` or a non-listed value without throwing.
  - [x] `parseBasicToken('Basic ' + base64(":"))` returns `undefined` (empty token).
- Integration tests:
  - [x] N/A — pure module; HTTP behavior is verified in task_03.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- `src/auth/tokens.ts` is pure (no imports of Express, store, or I/O).
- `parseBasicToken` never throws on malformed input.
