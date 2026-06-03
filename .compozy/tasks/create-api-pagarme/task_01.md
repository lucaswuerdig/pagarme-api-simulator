---
status: completed
title: Project scaffold & Express bootstrap
type: infra
complexity: medium
dependencies: []
---

# Task 1: Project scaffold & Express bootstrap

## Overview
Establish the Node.js + TypeScript + Express project skeleton that every later task builds on: package
manifest, TypeScript config, test runner, linting, and a minimal Express app that boots, parses JSON,
and is exported for both local listening and the Vercel function shim. This is the foundation step with
no dependencies (TechSpec "Development Sequencing" step 1).

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST use Node.js + Express written in TypeScript, compiled with `tsc` to `dist/` (see TechSpec "System Architecture").
- MUST expose the Express app as an importable module (`src/server.ts` exports the `app`) AND start a listener when run directly, reading `PORT` (default `8088`).
- MUST register JSON body parsing so all later routes receive parsed bodies.
- MUST configure `vitest` as the test runner and `supertest` as a dependency for HTTP assertions.
- MUST provide `package.json` scripts for `build`, `start`, `dev`, `lint`, and `test`.
- MUST NOT mount any business routes here — only the bare app and bootstrap (routes arrive in later tasks).
</requirements>

## Subtasks
- [x] 1.1 Create `package.json` with Express, TypeScript, vitest, supertest, and the build/start/dev/lint/test scripts.
- [x] 1.2 Create `tsconfig.json` targeting a modern Node runtime and emitting to `dist/`.
- [x] 1.3 Create the Express app in `src/server.ts` that parses JSON and is exported as a module, with a direct-run listener honoring `PORT`.
- [x] 1.4 Configure linting and `vitest` (config + test directory convention).
- [x] 1.5 Add a smoke test proving the app boots and returns 404 JSON for an unknown route.

## Implementation Details
Create the project root tooling and the Express bootstrap. The app must be exported (not only listened
on) so Task 08 can wrap it in a Vercel function and Tasks 06/07 can mount routes and select the store.
See TechSpec "System Architecture" (HTTP server / router) and "Development Sequencing" step 1. No store,
resolver, or routes here — keep the surface minimal.

### Relevant Files
- `package.json` — create: dependencies, scripts (build/start/dev/lint/test).
- `tsconfig.json` — create: TypeScript compiler options, output to `dist/`.
- `vitest.config.ts` — create: test runner config and coverage settings.
- `src/server.ts` — create: Express app, JSON parsing, exported app + `PORT` listener.
- `.gitignore` — create: ignore `node_modules`, `dist`, `.vercel`, env files.
- `.eslintrc` (or flat config) — create: lint rules for TypeScript.

### Dependent Files
- `src/routes/*` (Task 06) — will mount onto the app created here.
- `api/index.ts` (Task 08) — will import the exported app.
- `.github/workflows/ci.yml` (Task 09) — will run the `lint`/`test`/`build` scripts defined here.
- `Dockerfile` (Task 10) — will run `build`/`start`.

### Related ADRs
- [ADR-004: Node.js + Express + TypeScript implementation stack](adrs/adr-004.md) — Establishes the language, framework, and build pipeline this task scaffolds.

## Deliverables
- A buildable TypeScript project (`npm run build` emits `dist/server.js`).
- An Express app exported from `src/server.ts` that boots and listens on `PORT` (default 8088).
- Configured `vitest` + `supertest` and working `lint`/`test`/`build`/`start`/`dev` scripts.
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration tests for the bootstrap app **(REQUIRED)**

## Tests
- Unit tests:
  - [x] `src/server.ts` exports an Express app instance (import does not throw).
  - [x] Listener uses `process.env.PORT` when set and defaults to `8088` when unset.
- Integration tests:
  - [x] `GET /` (no routes mounted) returns HTTP 404 with a JSON content type via supertest.
  - [x] A request with a JSON body to the bare app is parsed (body middleware active) — asserted on a temporary echo handler in the test.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- `npm run build` succeeds and produces `dist/server.js`
- `npm start` boots a server on port 8088 (or `PORT`) and the exported app is importable by later tasks
