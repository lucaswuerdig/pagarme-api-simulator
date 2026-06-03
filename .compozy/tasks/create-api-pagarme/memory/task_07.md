# Task Memory: task_07.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot
- Add `KvOrderStore` (`@vercel/kv`-backed) implementing the unchanged `OrderStore` interface + a `STORE_BACKEND` store factory. Key `ch:<chargeId>`, TTL 24h, prefix-scoped `clear()` (scan+del, never `flushall`). Reuse `tests/contract/orderStoreContract.ts` against a mocked KV client. No route changes (Task 08 injects the store).
- Pre-change signal: `src/store/kvOrderStore.ts` + `src/store/index.ts` do NOT exist; no KV contract test; baseline suite green at 100%.

## Important Decisions
- `@vercel/kv@^3.0.0` added to **dependencies** (deprecated upstream but functional for a homologation fake; only `src/store/index.ts` imports it).
- KvOrderStore depends only on a minimal `KvClient` seam (set/get/scan/del) defined in `kvOrderStore.ts` — NO `@vercel/kv` import in the class → unit-testable with a plain fake, package needed only by the factory.
- Factory (`createStore(env=process.env)`): `STORE_BACKEND=kv` → `KvOrderStore` via `createClient({url:KV_REST_API_URL, token:KV_REST_API_TOKEN})`; anything else (default `memory`) → `InMemoryOrderStore`. Throws a clear error if `kv` selected without the two env vars.

## Learnings
- `@vercel/kv` `scan(cursor, {match,count})` → `[string, string[]]` standard; loop until cursor==="0". `set(key,val,{ex:seconds})` for TTL; `get<T>` auto-deserializes JSON → object|null.
- `createClient(config)` returns the broad `VercelKV` type; not directly assignable to the minimal `KvClient` seam, so the factory adapts it with `as unknown as KvClient` (documented). KvClient deliberately omits `flushall`.
- `createClient({url,token})` only constructs the client — no network call until a command runs — so factory tests use dummy creds and need no live KV.
- Coverage report shows `src/store/orderStore.ts` as 0% — it is the type-only interface (zero executable statements), pre-existing; aggregate stays 100% and 80% thresholds pass (`npm test` exit 0).

## Files / Surfaces
- create: `src/store/kvOrderStore.ts` (KvClient seam + KvOrderStore), `src/store/index.ts` (`createStore` factory + barrel)
- create tests: `tests/helpers/fakeKv.ts` (Map-backed vi.fn fake), `tests/unit/kvOrderStore.test.ts`, `tests/unit/storeFactory.test.ts`, `tests/integration/kvOrderStoreContract.test.ts` (reuses `runOrderStoreContract`)
- `package.json`: added `@vercel/kv@^3.0.0` to dependencies (+ lockfile)

## Errors / Corrections
- First lint failed: typescript-eslint `no-unused-vars` does NOT honour a `_`-prefixed arg (`_opts`). Fixed by dropping the unused param from the fake's `set` (vi.fn still records all actual call args, so TTL assertions still work). Matches the shared-memory caveat about `_next`.

## Ready for Next Run
- DONE & verified. Task 08 builds the Vercel shim: `api/index.ts` imports the wired app and uses `createPagarmeApp(createStore())` with `STORE_BACKEND=kv`; `createStore` from `src/store/index.ts` is the entry point. No route changes needed.
