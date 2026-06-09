# PRD — Token Validation for the Fake Pagar.me API

## Overview

The fake Pagar.me API runs as a single, always-on shared instance the whole team
points at during homologation. Every request from the consuming app already carries
the Pagar.me credential as `Authorization: Basic base64("<token>:")`, but the fake
currently **accepts and ignores it** — the business routes are open to anyone who
knows the URL.

This feature adds a **token-validation layer**. A committed file holds an array of
valid tokens (mirroring the existing "magic cards" allowlist), and a middleware
rejects any request whose token is missing or not on the list with **HTTP 401**.

- **Problem it solves:** the shared instance is unauthenticated, and the consuming
  app has no way to exercise its own auth-failure path against the fake.
- **Who it is for:** the engineering/QA team using the shared homologation instance,
  and the consuming Laravel app as the automated caller.
- **Why it is valuable:** it blocks unauthorized access to the shared instance **and**
  makes the fake faithfully reproduce Pagar.me's "invalid key → 401" behavior, so the
  consuming app's error handling can be tested end to end.

## Goals

- Reject any request to a protected route that lacks a valid token, returning HTTP 401.
- Accept requests bearing a token from the committed allowlist with no change to
  existing business behavior.
- Maintain a single, in-repo, auditable source of truth for valid tokens, edited like
  the magic cards.
- Unify access control under one credential model, retiring the separate
  `RESET_SECRET` guard.
- Preserve the `_idea.md` §3.3 contract: business outcomes still return HTTP 200; 401
  is used **only** for authentication failure.

## User Stories

- **As a platform owner**, I want only callers with a known token to reach the shared
  fake, so an unknown party with the URL cannot drive or pollute our homologation
  instance.
- **As a QA engineer**, I want to send a deliberately wrong token and get a 401, so I
  can verify the consuming app handles Pagar.me auth failures correctly.
- **As a developer on the consuming app**, I want my normal valid token to pass
  through unchanged, so all existing sale/capture/cancel/tokenize flows keep working
  against the fake.
- **As a maintainer**, I want to add or revoke a valid token by editing one file (like
  adding a magic card), so token management is simple and reviewable in version
  control.

## Core Features

**1. Token allowlist file (highest priority)**
A committed module exports the array of valid tokens, structured like
`src/magic/cards.ts`. It is the single source of truth; adding/revoking a token is a
one-line edit plus redeploy.

**2. Validation middleware on protected routes**
Runs ahead of the protected routers. Reads `Authorization: Basic`, decodes it,
extracts the token, and checks allowlist membership. Valid → request proceeds
unchanged. Missing/malformed/unlisted → HTTP 401, request never reaches business
logic.

**3. Unified protected surface**
The gate covers the `/core/v5` business routes (orders, charge capture, charge cancel,
tokenize) **and** `POST /__reset`. `GET /health` stays open as a liveness probe. The
old `RESET_SECRET` / `x-reset-secret` mechanism is removed.

## User Experience

- **Authorized flow:** the consuming app sends its usual `Authorization: Basic`
  header → requests behave exactly as today; the feature is invisible.
- **Unauthorized flow:** a request with no token, a malformed header, or an unlisted
  token receives **401** before any business processing; the response signals an
  authentication failure.
- **Testing the 401 path:** a tester simply sends an unlisted token to observe the
  consuming app's auth-error handling — no special "magic" token required.
- **Managing tokens:** a maintainer edits the allowlist file, opens a PR, and
  redeploys — the same mental model as the magic cards.

## High-Level Technical Constraints

- **Auth contract:** tokens arrive as `Authorization: Basic base64("<token>:")` (token
  as username, empty password) — the real Pagar.me v5 format. Validation must read
  tokens in this shape.
- **Response contract (`_idea.md` §3.3):** success, refusal, and business errors MUST
  stay HTTP 200 (a 4xx makes the consuming app's HTTP client throw and skip business
  parsing). 401 is reserved exclusively for authentication failure.
- **Privacy:** tokens are secrets and must never be logged in full (mask, as the
  consuming app already does).
- **Always-on:** validation is active in every environment, so the test suite and
  local dev must present a valid token.

## Non-Goals (Out of Scope)

- Per-token identity, scopes, roles, or rate limiting — membership is binary
  (valid / not valid).
- Token rotation via dashboard or env var without a code change (explicitly rejected —
  see ADR-001).
- Dynamic/remote token stores or a database of tokens.
- Authenticating `GET /health`.
- Reproducing Pagar.me's exact 401 error envelope byte-for-byte (the consuming client
  treats any 4xx as a thrown exception).
- Encrypting or hashing tokens at rest in the file (they are fixed homologation
  values, like the magic cards).

## Phased Rollout Plan

### MVP (Phase 1)
- Allowlist file + validation middleware over `/core/v5` and `/__reset`; `/health`
  open.
- `RESET_SECRET` removed.
- Existing tests and local dev updated to send a valid token.
- **Success criteria:** unlisted/absent token → 401 on every protected route; valid
  token → all existing flows pass; full suite green.

### Phase 2 (only if a real need emerges)
- Optional env-var extension of the allowlist for redeploy-free rotation (the rejected
  ADR-001 Alternative 1).
- **Success criteria:** would be revisited only if token rotation becomes frequent.

### Phase 3
- None planned. The feature is intentionally minimal.

## Success Metrics

- **Access control:** 100% of requests without a valid token to protected routes are
  rejected with 401.
- **No regression:** 100% of existing business flows pass when a valid token is
  supplied; the test suite stays green.
- **Fidelity:** the consuming app's auth-failure path can be triggered against the
  fake by sending an unlisted token.
- **Maintainability:** adding or revoking a token is a single-file edit reviewable in
  one PR.

## Risks and Mitigations

- **Existing callers/scripts break (no token, or relied on `RESET_SECRET`).**
  Mitigation: document the change in the README and connection guide; update the reset
  tests and any helper scripts to authenticate.
- **Adoption friction — someone forgets the token in a new test/script.** Mitigation:
  a shared known test token in the allowlist and a documented example in the
  connection guide.
- **Token leakage.** Mitigation: never log full tokens; mask in any diagnostic output.
- **Operational lockout from a bad allowlist edit.** Mitigation: the allowlist is
  test-covered and CI authenticates before any production deploy, so a broken list
  fails CI rather than production.

## Architecture Decision Records

- [ADR-001: Static in-file token allowlist with an always-on Basic-auth gate](adrs/adr-001.md)
  — fixed committed token list (like magic cards), always enforced, 401 on miss.
- [ADR-002: Unify access control under the token gate, retiring RESET_SECRET](adrs/adr-002.md)
  — `/__reset` is covered by the token gate; the separate reset secret is removed.

## Open Questions

- Exact **401 response body** shape (repo `{error, message}` convention vs. an
  approximate Pagar.me envelope) — to be settled in the TechSpec.
- Whether the shared **test token** lives in the same allowlist file or a test-only
  fixture, to avoid implying a "real" credential is committed — to be settled in the
  TechSpec.
