# Task Memory: task_10.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot
Local-dev-only Docker parity: multi-stage `Dockerfile` (build TS → runtime `node dist/server.js`),
`docker-compose.yml` (app + Redis), `.dockerignore`. Port 8088 (via `PORT`); backend choosable locally
per the Task 07 factory. NOT the deploy path (Vercel is). DONE & verified; auto-commit disabled.

## Important Decisions
- **server.ts bootstrap now honors `STORE_BACKEND`.** The direct-run path (`node dist/server.js`, the
  Docker entrypoint) previously hard-wired `InMemoryOrderStore` — only `api/index.ts` used the factory.
  Requirement #4 (backend choosable locally *per the Task 07 factory*) forced wiring the factory into the
  run path. Minimal/additive: `start(port, application=app)` gained an optional app param; the
  `require.main===module` guard (already `/* c8 ignore */`) now calls `start(undefined, createPagarmeApp(createStore()))`.
  Used a **static** `import { createStore } from "./store"` (a lazy `require()` tripped
  `@typescript-eslint/no-require-imports`); `createStore` has no import-time side effects (only builds a KV
  client when `STORE_BACKEND=kv`), so tests stay hermetic and coverage stays 100%.
- **`@vercel/kv` speaks the Upstash HTTP REST protocol, NOT raw Redis TCP** — a plain `redis:7-alpine`
  container cannot back `STORE_BACKEND=kv` directly. To make local KV parity real, compose adds a
  `redis-rest` proxy (`hiendinhngoc/serverless-redis-http`) fronting Redis, behind a `kv` compose profile.
  Default `STORE_BACKEND=memory` so plain `docker compose up` needs no proxy/Redis to function.
- **Redis is NOT published to the host** (no `ports:`). Verification hit a real `0.0.0.0:6379 already
  allocated` conflict (host Redis). App+proxy reach Redis over the compose network as `redis:6379`; host
  publish was unnecessary and conflict-prone. Left commented-out for opt-in host access.
- **Docker tests split by weight**: fast YAML/text parse tests run in `npm test`; the heavyweight
  build+boot test is opt-in via `DOCKER_E2E` (`describe.skipIf`) so `npm test`/CI stay hermetic & fast
  (ADR-006 — CI needs no Docker). Ran it locally under `DOCKER_E2E=1` for evidence.

## Learnings
- Coverage scope is `src/**`+`api/**`; the new Docker files and the two test files add NO src code, and
  the server.ts change sits in the c8-ignored guard / is covered by the existing `start(0)` test → stayed 100%.
- `docker compose config --quiet` is a cheap pre-flight validity check.

## Files / Surfaces
- Created: `Dockerfile`, `docker-compose.yml`, `.dockerignore`, `tests/unit/dockerConfig.test.ts`,
  `tests/integration/dockerImage.test.ts`.
- Edited: `src/server.ts` (optional `start` app param + factory-driven direct-run bootstrap).
- Untouched (by design): `vercel.json`, `.github/workflows/ci.yml` — Docker is not in the deploy path;
  `dockerConfig.test.ts` asserts neither references Docker.

## Errors / Corrections
- Lint failed first pass: lazy `require("./store")` → `@typescript-eslint/no-require-imports`. Fixed with a
  static top-level import (safe — no import-time side effects).
- Live `docker compose up` first pass: `redis` failed to bind host `6379` (already in use). Fixed by not
  publishing Redis to the host.

## Ready for Next Run
- **Task 11 (README/connection guide) MUST document local Docker usage**:
  - Default run: `docker compose up --build` → in-memory store, serves `http://localhost:8088` (`/health`,
    `/core/v5/...`). No external deps.
  - KV/Redis parity: `STORE_BACKEND=kv docker compose --profile kv up --build` (starts `redis` + the
    `redis-rest` Upstash-REST proxy; `@vercel/kv` cannot talk to plain Redis).
  - Env knobs: `PORT` (default 8088), `STORE_BACKEND` (`memory`|`kv`), `KV_REST_API_URL`/`KV_REST_API_TOKEN`.
  - State clearly: **Docker is local-dev-only; Vercel is the deploy target** (ADR-006).
</content>
