---
status: completed
title: Local Docker dev environment (app + Redis)
type: infra
complexity: medium
dependencies:
  - task_06
  - task_07
---

# Task 10: Local Docker dev environment (app + Redis)

## Overview
Provide a Dockerfile and docker-compose for local development parity: the fake service plus a local Redis
so developers can exercise the KV-backed lifecycle without Vercel. Docker is local-dev-only; Vercel is the
deployment target (TechSpec "Development Sequencing" step 11; ADR-004 refined by ADR-006).

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST provide a multi-stage `Dockerfile` that builds the TypeScript and runs `node dist/server.js`.
- MUST provide a `docker-compose.yml` running the app plus a Redis service for local KV-style state.
- MUST expose the service on port 8088 (configurable via `PORT`).
- MUST allow the store backend to be chosen locally (`STORE_BACKEND=memory` for no-dependency runs, or KV/Redis wiring), per the Task 07 factory.
- MUST be documented as LOCAL-DEV-ONLY (not the deployment path) per ADR-006.
- MUST NOT be referenced by the Vercel deploy pipeline (Task 09).
</requirements>

## Subtasks
- [x] 10.1 Write a multi-stage `Dockerfile` (build stage → runtime stage running `dist/server.js`).
- [x] 10.2 Write `docker-compose.yml` with the app service and a Redis service.
- [x] 10.3 Wire env vars (`PORT`, `STORE_BACKEND`, KV/Redis connection) for local runs.
- [x] 10.4 Verify `docker compose up` serves the health check and a sample order locally.

## Implementation Details
Create `Dockerfile` and `docker-compose.yml` at the repo root. The runtime entrypoint is `dist/server.js`
from Task 01's build; the store backend comes from Task 07's factory. Keep this strictly local — ADR-006
designates Vercel as the deploy target and Docker as local parity only. Reference TechSpec "Development
Sequencing" step 11.

### Relevant Files
- `Dockerfile` — create: multi-stage build + runtime.
- `docker-compose.yml` — create: app + Redis services.
- `.dockerignore` — create: exclude `node_modules`, `dist`, `.git`, env files.

### Dependent Files
- `package.json` (Task 01) — `build`/`start` scripts used by the image.
- `src/store/index.ts` (Task 07) — backend selection used by the local run.
- `README.md` (Task 11) — documents local Docker usage.

### Related ADRs
- [ADR-006: Deploy on Vercel serverless functions with Vercel KV for lifecycle state](adrs/adr-006.md) — Docker is local-dev-only; Vercel is the deploy target.
- [ADR-004: Node.js + Express + TypeScript implementation stack](adrs/adr-004.md) — Build/runtime the image reproduces.

## Deliverables
- A multi-stage `Dockerfile`, `docker-compose.yml` (app + Redis), and `.dockerignore`.
- Local run instructions surfaced for Task 11 docs.
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration tests validating the containerized service responds **(REQUIRED)**

## Tests
- Unit tests:
  - [x] `docker-compose.yml` parses and defines both an `app` and a `redis` service (config-lint/parse test).
  - [x] The compose `app` service sets `PORT` and `STORE_BACKEND` env vars.
- Integration tests:
  - [x] `docker build` succeeds and the resulting image runs `node dist/server.js` (build + boot smoke test).
  - [x] Against the running container, `GET /health` returns 200 and `POST /core/v5/orders` with `4000000000000010` returns a captured order (lifecycle parity with the in-process tests).
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- `docker compose up` serves the fake on port 8088 with a working health check and order flow
- Docker is documented as local-only and is not used by the Vercel deploy pipeline
