# Task Memory: task_08.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot
Expose the Express app as a single Vercel serverless function and route all traffic to it: `api/index.ts` (handler) + `vercel.json` (catch-all rewrite) so `/core/v5/...` (incl. dynamic `charge_id`) resolve unchanged on Vercel with the KV store selected. DONE & verified (auto-commit disabled — diff left for manual review).

## Important Decisions
- **`api/index.ts` design**: `export function buildApp(env = process.env): Express` returns `createPagarmeApp(createStore(env))`; module-level `const app = buildApp(); export default app;`. An Express app IS a `(req,res)` handler, so `@vercel/node` invokes the default export directly — NO `serverless-http` dependency added (ADR-006 allowed either; native export is simpler/zero-dep). `buildApp(env)` is exported purely for testability (lets tests pass kv env without booting the singleton or a real KV conn).
- **`vercel.json`**: just `{rewrites:[{source:"/(.*)",destination:"/api"}]}` (+ `$schema`). Did NOT add a `functions`/`runtime` block — Node version is pinned by `engines.node>=20` in package.json and `@vercel/node` auto-detects `api/*.ts`. A bogus runtime string would break deploys, so kept minimal.
- **Env vars documented in `.env.example`** (`.gitignore` already whitelists `!.env.example`) + the `api/index.ts` header: `STORE_BACKEND=kv`, `KV_REST_API_URL`, `KV_REST_API_TOKEN`, plus `PORT`.
- **Config edits (scope-justified)**: added `"api"` to `tsconfig.test.json` include (so `npm run typecheck` checks the shim) and `"api/**/*.ts"` to `vitest.config.ts` coverage include (so the shim's coverage is counted — it lands at 100%). `tsconfig.json` (build) was left untouched: `include:["src"]` means `tsc`/`dist` never compile `api/` — correct, Vercel compiles `api/` itself; `dist/` confirmed src-only after build.

## Learnings
- The rewrite-to-`/api` single-function pattern relies on Vercel passing the ORIGINAL request URL to the function, so Express still routes on `/core/v5/...`. Can't unit-test the Vercel rewrite itself; driving the exported handler with the real path via supertest proves "rewrite path equivalence" (what the task's integration tests ask for) — `request(handler).post("/core/v5/orders")` / `.delete("/core/v5/charges/:id")`.
- `createStore(kvEnv)` with dummy url/token returns a `KvOrderStore` without any network call (`@vercel/kv createClient` only constructs). So `buildApp(kvEnv)` is safe to call in a unit test; `buildApp({STORE_BACKEND:'kv'})` (no creds) throws via the factory guard — used to prove the entrypoint routes through the kv branch.
- Default import `import handler from "../../api/index"` works for `export default app` under vitest/esbuild + esModuleInterop.

## Files / Surfaces
- create: `api/index.ts`, `vercel.json`, `.env.example`
- create: `tests/unit/vercelEntrypoint.test.ts` (4 tests), `tests/integration/vercelHandler.test.ts` (2 tests)
- edit: `tsconfig.test.json` (include +"api"), `vitest.config.ts` (coverage include +"api/**/*.ts")

## Errors / Corrections
- None. All gates green first pass: build=0, typecheck=0, lint=0, test=0; 154 tests pass; coverage 100% incl. `api/index.ts`.

## Ready for Next Run
- **Deliberately OUT OF SCOPE (follow-up):** the route-level store-error→5xx mapping flagged in shared-memory Open Risks is NOT in task_08's requirements/subtasks/deliverables, so it was NOT added here (kept scope tight). Still unhandled — a rejected KV call would currently hang an Express 4 async handler rather than return 5xx. Belongs in a route-layer task, not the infra shim.
- Task 09 (CI) deploys this config via Vercel CLI; Task 11 docs the deployed URL + the three env vars (already in `.env.example`).
