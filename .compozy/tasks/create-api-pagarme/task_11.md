---
status: pending
title: Connection guide, README & magic-card docs
type: docs
complexity: low
dependencies:
  - task_08
  - task_09
  - task_10
---

# Task 11: Connection guide, README & magic-card docs

## Overview
Write the documentation that makes the fake adoptable: a connection guide telling the consuming-app team
how to repoint to the fake (URL swap, test-only, unset in production), a README covering local run/deploy
and required env/secrets, and the canonical magic-card scenario table. Documentation is the delivery
boundary for app-side integration (PRD "Connection guide"; ADR-002).

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST reproduce the consuming-app integration steps from `_idea.md` §7: set `PAGARME_API_URL` to the fake (URL swap, NOT key swap), `php artisan config:clear`, and leave `PAGARME_API_URL` unset in production (default falls back to `https://api.pagar.me`), per ADR-002.
- MUST document the deployed Vercel URL usage and the required env vars (`KV_REST_API_URL`, `KV_REST_API_TOKEN`, `STORE_BACKEND`) and GitHub secrets (`VERCEL_*`).
- MUST publish the magic-card table from `_idea.md` §5 as the single scenario catalog, including the test-only `POST /__reset` helper.
- MUST document local Docker usage (Task 10) and the GitHub→Vercel pipeline (Task 09).
- MUST state that NO code is committed to the consuming app's repository (ADR-002).
- SHOULD warn against over-trust: passing the fake is not a substitute for periodic real-sandbox checks (PRD "Risks").
</requirements>

## Subtasks
- [ ] 11.1 Write `docs/connection-guide.md` reproducing `_idea.md` §7 with production-safety warnings.
- [ ] 11.2 Write `README.md` covering local dev (Docker + memory), env vars, deploy pipeline, and secrets.
- [ ] 11.3 Document the magic-card scenario table and the `/__reset` helper.
- [ ] 11.4 Add the over-trust / contract-drift caveats from the PRD risks.

## Implementation Details
Create `README.md` and `docs/connection-guide.md`. Content is sourced from `_idea.md` §5/§7, the PRD
(connection guide, risks), and the deploy/env decisions in ADR-006/ADR-007. Reference TechSpec sections by
name rather than duplicating tables where practical, but the magic-card catalog and connection steps must
be self-contained for adopters.

### Relevant Files
- `README.md` — create: project overview, local dev, deploy, env/secrets, magic-card table.
- `docs/connection-guide.md` — create: consuming-app repoint steps + production-safety warnings.

### Dependent Files
- `vercel.json` / `api/index.ts` (Task 08) — deployed URL and env vars documented here.
- `.github/workflows/ci.yml` (Task 09) — pipeline and secrets documented here.
- `Dockerfile` / `docker-compose.yml` (Task 10) — local usage documented here.

### Related ADRs
- [ADR-002: Deliverable boundary — fake service only; consuming-app integration as a guide](adrs/adr-002.md) — This task IS the connection-guide deliverable; no cross-repo code.
- [ADR-003: Credit-card-only scope with deterministic magic-card outcomes](adrs/adr-003.md) — The magic-card catalog documented here.
- [ADR-006: Deploy on Vercel serverless functions with Vercel KV for lifecycle state](adrs/adr-006.md) — Env vars and deploy model documented here.
- [ADR-007: GitHub Actions CI/CD deploying to Vercel via the Vercel CLI](adrs/adr-007.md) — Pipeline and secrets documented here.

## Deliverables
- `README.md` and `docs/connection-guide.md` covering setup, deploy, env/secrets, and the magic-card catalog.
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration tests validating documented commands/links **(REQUIRED)**

## Tests
- Unit tests:
  - [ ] A docs-lint/link-check test confirms the magic-card table lists all six scenarios from `_idea.md` §5.
  - [ ] The connection guide explicitly states `PAGARME_API_URL` must be UNSET in production (asserted by a content/grep test).
  - [ ] The README lists the required env vars and `VERCEL_*` secrets (content assertion).
- Integration tests:
  - [ ] Following the README local-run steps boots the service and `GET /health` returns 200 (doc-accuracy smoke test).
  - [ ] The documented sample `POST /core/v5/orders` request with a magic card returns the documented outcome (doc ↔ behavior parity).
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- An engineer can repoint the consuming app and confirm the health check using only the connection guide
- The magic-card catalog and production-safety warnings are complete and accurate
