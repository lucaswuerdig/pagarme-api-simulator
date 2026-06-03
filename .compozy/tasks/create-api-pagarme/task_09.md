---
status: completed
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
- [x] 9.1 Create the `test` job: checkout, setup-node, `npm ci`, lint, `vitest`.
- [x] 9.2 Create the `deploy` job gated by `needs: test` and `if` push-to-`main`.
- [x] 9.3 Wire the Vercel CLI deploy steps using the `VERCEL_*` secrets.
- [x] 9.4 Document the required GitHub secrets in the workflow and for Task 11.

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
  - [x] The workflow YAML parses and the `deploy` job declares `needs: test` (`tests/unit/ciWorkflow.test.ts` parses `ci.yml` with `js-yaml` and asserts `needs: test`).
  - [x] The `deploy` job is guarded by an `if` condition restricting it to push events on `main` (asserted in `tests/unit/ciWorkflow.test.ts`).
- Integration tests:
  - [x] The `test` job command sequence (`npm ci`, lint, `vitest`) runs green locally against the in-memory store (ran `npm ci`→lint→typecheck→build→`npm test`, all exit 0; 163 tests pass, in-memory store).
  - [ ] `vercel build` produces a prebuilt output directory locally using the Task 08 config (deploy artifact smoke check; no live deploy). **CI-only:** the Vercel CLI is not installable in this hermetic env (needs `vercel@54.9.0` download + a linked project + `VERCEL_TOKEN`); it runs in the `deploy` job. Local proxy validated: `npm run build` populates `dist/`; `api/index.ts` + `vercel.json` present and exercised end-to-end by `tests/integration/vercelHandler.test.ts`.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- Pushing to a branch runs lint + tests; merging to `main` deploys to Vercel only after tests pass
- No secrets are hardcoded; deploy uses `VERCEL_*` GitHub secrets
