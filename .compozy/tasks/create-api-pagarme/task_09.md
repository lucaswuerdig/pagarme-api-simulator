---
status: pending
title: GitHub Actions CI/CD pipeline
type: infra
complexity: medium
dependencies:
  - task_08
---

# Task 9: GitHub Actions CI/CD pipeline

## Overview
Add the GitHub Actions workflow that runs lint + tests on every push/PR and, on pushes to `main`,
deploys the service to Vercel via the Vercel CLI. The deploy job is gated on the test job so production
only ships passing builds (TechSpec "Development Sequencing"; ADR-007).

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST define `.github/workflows/ci.yml` with a `test` job (`npm ci`, lint, `vitest`) running on pushes and pull requests.
- MUST define a `deploy` job with `needs: test` that runs ONLY on push to `main`.
- MUST deploy via the Vercel CLI (`vercel pull --environment=production`, `vercel build --prod`, `vercel deploy --prebuilt --prod`), per ADR-007.
- MUST authenticate using GitHub secrets `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` (never hardcode).
- MUST run tests against the in-memory store (no live KV required in CI), per ADR-006.
- SHOULD pin the Node version via `actions/setup-node`.
</requirements>

## Subtasks
- [ ] 9.1 Create the `test` job: checkout, setup-node, `npm ci`, lint, `vitest`.
- [ ] 9.2 Create the `deploy` job gated by `needs: test` and `if` push-to-`main`.
- [ ] 9.3 Wire the Vercel CLI deploy steps using the `VERCEL_*` secrets.
- [ ] 9.4 Document the required GitHub secrets in the workflow and for Task 11.

## Implementation Details
Create `.github/workflows/ci.yml`. The two-job structure, CLI commands, and secret names are specified in
ADR-007 — reference, do not duplicate the script verbatim beyond what the workflow file needs. The `test`
job runs the scripts defined in Task 01; the `deploy` job uploads the prebuilt Vercel output from Task 08.

### Relevant Files
- `.github/workflows/ci.yml` — create: `test` + `deploy` jobs.

### Dependent Files
- `package.json` (Task 01) — provides the `lint`/`test`/`build` scripts the workflow runs.
- `vercel.json` / `api/index.ts` (Task 08) — the deployable artifact.
- `README.md` / connection guide (Task 11) — documents the secrets and pipeline.

### Related ADRs
- [ADR-007: GitHub Actions CI/CD deploying to Vercel via the Vercel CLI](adrs/adr-007.md) — Defines the exact jobs, gating, CLI steps, and secrets.
- [ADR-006: Deploy on Vercel serverless functions with Vercel KV for lifecycle state](adrs/adr-006.md) — CI tests run against the in-memory store; KV is production-only.

## Deliverables
- A working `.github/workflows/ci.yml` with gated test → deploy jobs using the Vercel CLI.
- Documented GitHub secrets (`VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`).
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration tests / workflow validation **(REQUIRED)**

## Tests
- Unit tests:
  - [ ] The workflow YAML parses and the `deploy` job declares `needs: test` (asserted via a YAML-lint/parse test or `act --dryrun`/`actionlint` in CI).
  - [ ] The `deploy` job is guarded by an `if` condition restricting it to push events on `main`.
- Integration tests:
  - [ ] The `test` job command sequence (`npm ci`, lint, `vitest`) runs green locally against the in-memory store (proxy for the CI test job).
  - [ ] `vercel build` produces a prebuilt output directory locally using the Task 08 config (deploy artifact smoke check; no live deploy).
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- Pushing to a branch runs lint + tests; merging to `main` deploys to Vercel only after tests pass
- No secrets are hardcoded; deploy uses `VERCEL_*` GitHub secrets
