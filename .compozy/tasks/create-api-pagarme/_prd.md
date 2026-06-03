# PRD: Fake Pagar.me API (Homologation Test Double)

## Overview

The consuming application's credit-card payment tests depend on Pagar.me's v5 homologation
environment. That environment is intermittently unavailable, which blocks and flakes the test
suites that exercise sales, captures, cancellations, refunds, and card tokenization. This product is
a **fake Pagar.me API** — a self-contained service that stands in for `https://api.pagar.me` during
homologation and local testing, reproducing the exact request/response contract the consuming app
relies on.

- **Problem it solves:** removes the dependency on an unreliable upstream sandbox so credit-card
  tests run deterministically, on demand, regardless of Pagar.me availability.
- **Who it is for:** backend engineers and QA on the team that owns the consuming application's
  payment flows.
- **Why it is valuable:** payment tests become fast, reproducible, and self-hosted; flaky-sandbox
  failures stop blocking development and CI; specific approval/decline/error/outage scenarios become
  trivially reproducible.

The fake is delivered as a standalone service in this repository. Pointing the consuming app at it
is a documented, test-only configuration change owned by that app's team ([ADR-002](adrs/adr-002.md)).

## Goals

- Reproduce the five credit-card operations the consuming app calls against Pagar.me so its full
  credit-card test flow passes against the fake with no behavioral compromises.
- Make every outcome deterministic and selectable from the request alone, so tests are reproducible.
- Run as a single shared, always-on homologation instance the team points to in place of the
  Pagar.me sandbox.
- Keep production untouched: the fake is never reachable in production, and the default configuration
  always falls back to the real Pagar.me.
- Target outcome: the credit-card homologation suite no longer fails or blocks due to Pagar.me
  sandbox unavailability.

## User Stories

**Primary persona — Backend engineer / QA on the payments team**

- As a payments engineer, I want my credit-card tests to hit a local/hosted fake instead of the
  Pagar.me sandbox, so an outage upstream never blocks my work.
- As a payments engineer, I want to force an approved-and-captured sale by choosing a specific test
  card, so I can assert the happy path deterministically.
- As a payments engineer, I want to force a decline, a transaction error, an order failure, and a
  gateway-outage response, so I can verify the app handles every branch.
- As a payments engineer, I want to run a pre-authorization and then capture or cancel it later and
  have the fake remember the original charge, so multi-step and refund flows behave coherently.
- As a QA engineer, I want to tokenize a card and reuse the returned card identifier, so I can test
  saved-card / one-click flows.

**Secondary persona — Engineer adopting the fake**

- As an engineer setting up homologation, I want a clear connection guide, so I can repoint the app
  to the fake without risking production.

## Core Features

**1. Credit-card operation contract (the five operations).**
The fake answers the exact routes the consuming app calls and returns response bodies whose fields
match what the app reads downstream. The operations:

- Create order — sale with capture, and pre-authorization without capture.
- Capture a previously authorized charge.
- Cancel / refund a charge (full or partial).
- Tokenize a card.

Approval is decided by the **response body** (transaction status + success flag), not the HTTP
status, exactly as the consuming app's parser expects. Business outcomes (approved, declined,
transaction error, order failed) are returned with a success HTTP status; only simulated gateway
outages use an error HTTP status. The authoritative field-level contract is the project
specification (`_idea.md`); this PRD does not restate it.

**2. Deterministic scenario selection via magic cards ([ADR-003](adrs/adr-003.md)).**
The outcome is chosen by the card number (or card token/id) in the request, following a fixed
magic-card table:

- Approved + captured
- Approved without capture (pre-authorization)
- Declined by the issuer (with a decline reason code)
- Transaction error
- Order failed
- Gateway unavailable (simulated outage)

No runtime overrides, no admin-defined scenarios — the request fully determines the result.

**3. Coherent order/charge lifecycle ([ADR-001](adrs/adr-001.md)).**
The fake remembers each order and charge it creates so that a later capture or cancellation resolves
the same charge and card identifiers and the original amount. This makes sale → capture →
cancel/refund flows behave like the real gateway across multiple calls.

**4. Health check.**
A simple liveness endpoint so the homologation environment and operators can confirm the shared
instance is up.

**5. Connection guide ([ADR-002](adrs/adr-002.md)).**
Documentation that tells the consuming-app team exactly how to repoint to the fake for tests —
emphasizing that it is a URL swap (not a key swap), test/homologation-only, and must remain unset in
production.

## User Experience

**Adoption journey (one-time):** An engineer reads the connection guide, sets the
test/homologation configuration to the fake's URL, clears config cache, and confirms the health
check responds. Production configuration is left untouched.

**Everyday journey:** An engineer writes or runs a payment test, chooses the magic card matching the
scenario they want, and runs the suite against the shared fake. The fake returns a deterministic,
contract-faithful response; multi-step flows (auth → capture, sale → refund) resolve against
remembered charges. No upstream sandbox, no network flakiness, no waiting on Pagar.me.

**Discoverability:** The magic-card table is the single documented catalog of scenarios; the
connection guide is the single entry point for setup. Both ship with the service.

## High-Level Technical Constraints

- **Contract fidelity:** request and response shapes must match Pagar.me v5 so the consuming app
  needs no changes beyond the base-URL swap. Outcome is conveyed in the body, per the app's parser
  rules.
- **Production safety:** the fake must never be reachable in production; the default behavior when
  unconfigured is to use the real Pagar.me. This is a test/homologation-only switch.
- **Shared-instance behavior:** as a single always-on instance serving the team, the fake must keep
  concurrent test flows coherent via the deterministic identifiers in each request; durable
  persistence is optional and state may be discarded on restart.
- **No real processing or secrets:** the fake performs no real card processing, stores no real card
  data, and does not validate the API key (it may accept and ignore it).

## Non-Goals (Out of Scope)

- PIX and boleto payment methods — explicitly excluded, with no planned future support
  ([ADR-003](adrs/adr-003.md)).
- Any code changes committed to the consuming application's repository — delivered only as a
  connection guide ([ADR-002](adrs/adr-002.md)).
- Runtime outcome overrides, admin/scenario-configuration UIs, or request-inspection dashboards
  ([ADR-001](adrs/adr-001.md)).
- Webhooks/event callbacks, recipients/marketplace split, and any Pagar.me resource outside the five
  credit-card routes.
- Authentication/authorization enforcement of the API key.
- Reproducing real acquirer behavior, fraud scoring, or 3-D Secure.

## Phased Rollout Plan

### MVP (Phase 1)

- The five credit-card operations with contract-faithful responses.
- Deterministic magic-card scenarios: approved+captured, approved-no-capture, declined, transaction
  error, order failed, gateway unavailable.
- Coherent order/charge lifecycle so capture and cancel/refund resolve prior charges.
- Health check.
- Connection guide for the consuming app.
- **Success criteria to proceed:** the consuming app's credit-card homologation suite passes
  end-to-end against the fake with zero dependency on the Pagar.me sandbox.

### Phase 2 (optional hardening, only if a need emerges)

- Optional state persistence across restarts and/or a state-reset affordance for the shared
  instance.
- Additional magic-card scenarios for edge cases surfaced by real test runs (e.g., specific decline
  codes, installment variations).
- **Success criteria:** the shared instance runs unattended through normal team usage without
  manual intervention.

### Phase 3

- No planned expansion. Credit-card-only scope is intentional and final per
  [ADR-003](adrs/adr-003.md); PIX/boleto would be a separate future initiative, not a continuation
  of this one.

## Success Metrics

- **Sandbox-dependency failures:** credit-card test failures caused by Pagar.me sandbox
  unavailability drop to zero after adoption.
- **Determinism:** repeated runs of the same test against the fake produce identical outcomes.
- **Coverage:** every magic-card scenario (approved, declined, error, order-failed, outage) is
  reachable and exercised by the suite.
- **Lifecycle coherence:** auth→capture and sale→refund flows succeed against remembered charges in
  the same run.
- **Production safety:** zero incidents of the fake being reachable from production configuration.

## Risks and Mitigations

- **Misconfiguration into production.** *Risk:* the app is pointed at the fake in production.
  *Mitigation:* the connection guide mandates leaving the base URL unset in production (default
  falls back to real Pagar.me) and frames it strictly as a test switch ([ADR-002](adrs/adr-002.md)).
- **Contract drift.** *Risk:* Pagar.me changes its real contract and the fake silently diverges, so
  green tests no longer reflect reality. *Mitigation:* the fake is pinned to the documented v5
  contract in `_idea.md`; periodic comparison against the real sandbox is recommended when it is
  available.
- **Shared-instance state interference.** *Risk:* concurrent test runs on one instance interfere.
  *Mitigation:* deterministic per-request identifiers and lifecycle keyed by charge id; optional
  reset in Phase 2.
- **Over-trust / false confidence.** *Risk:* teams treat passing against the fake as full assurance
  and skip real-sandbox validation entirely. *Mitigation:* position the fake as a test double for
  app-side behavior, with periodic real-sandbox smoke checks remaining part of the release process.

## Architecture Decision Records

- [ADR-001: Stateful, contract-faithful fake over stateless stub](adrs/adr-001.md) — Build a
  lifecycle-aware fake (Approach A) so sale→capture→cancel flows stay coherent.
- [ADR-002: Deliverable boundary — fake service only; consuming-app integration as a guide](adrs/adr-002.md)
  — Ship the service here; the app-side wiring is documented, not committed cross-repo.
- [ADR-003: Credit-card-only scope with deterministic magic-card outcomes](adrs/adr-003.md) — Cover
  only the five credit-card routes; outcomes selected purely by card number/token.

## Open Questions

- **Hosting target & ownership:** where is the shared homologation instance hosted, and which team
  owns its uptime and deployment?
- **Concurrency expectations:** what level of concurrent test traffic must the shared instance
  comfortably handle?
- **Restart behavior:** is in-memory state (lost on restart) acceptable for the shared instance, or
  is durable persistence needed from MVP rather than Phase 2?
- **ID determinism for assertions:** do tests need fully deterministic/sequential identifiers (e.g.,
  `or_fake_0001`) to assert on, or are opaque unique ids sufficient?
- **Scenario completeness:** does the initial magic-card set cover every branch the suite exercises
  today (e.g., specific decline codes, installment or partial-capture cases), or should more be
  reserved up front?
