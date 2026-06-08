---
provider: manual
pr:
round: 1
round_created_at: "2026-06-07T14:03:46Z"
status: resolved
file: src/routes/orders.ts
line: 76
severity: high
author: claude-code
provider_ref:
---

# Issue 001: Async route store errors are unhandled — KV failure hangs the request

## Review Comment

The stateful routes are `async` handlers that `await` the store directly with no
`try/catch`, and `createApp` registers **no Express error-handling middleware**
(`src/server.ts:26-44` mounts only `express.json()` and a 404 fallback). Express 4
(the pinned version, `express@^4.21.2`) does **not** forward a rejected promise
from a route handler to any error handler — a rejection becomes an unhandled
promise rejection and the response is never sent.

Affected handlers, all of which await a store call that can reject under the KV
backend:
- `src/routes/orders.ts:76` — `await store.create(record)`
- `src/routes/charges.ts:56,62` — `await store.get(...)`, `await store.update(...)`
- `src/routes/charges.ts:71,77` — same on the cancel route
- `src/routes/reset.ts:18` — `await store.clear()`

With `InMemoryOrderStore` these never reject, so the whole suite is green and the
bug is invisible in CI. But the TechSpec's error-handling conventions explicitly
require "a KV failure surfaces as a 5xx" (`_techspec.md` §"Error handling
conventions", §"Known Risks: KV availability/latency"). Instead, a Vercel KV
outage — a documented risk — makes the request hang until the Vercel function
times out (504 `FUNCTION_INVOCATION_TIMEOUT`), with no log line to diagnose it.
There is also **no test** that exercises a failing store (confirmed: no
`mockReject`/failing-store fixture in `tests/`), so this path is unverified.

Suggested fix: add an async wrapper (or a 4-arg Express error middleware) so store
rejections become a clean 5xx, and add a test with a store stub that rejects.

```ts
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
// ...register routes with asyncHandler(...), then in createApp:
app.use((err, _req, res, _next) => {
  console.error("store/handler error", err);
  res.status(503).json({ message: "service unavailable" });
});
```

## Triage

- Decision: `VALID`
- Notes:

**Confirmed.** The claim is technically accurate. `express@^4.21.2` is pinned and
`4.22.2` is installed (`node_modules/express/package.json`). Express 4 does **not**
forward a rejected promise returned by an `async` route handler to any error
middleware — the rejection becomes an unhandled promise rejection and the response
is never sent. (`src/server.ts:26-44` confirms `createApp` mounts only
`express.json()` plus a terminal 404 fallback; there is no 4-arg error handler.)

**Root cause.** `src/routes/orders.ts:76` does `await store.create(record)` with no
`try/catch`. Under the in-memory store this never rejects, so the suite is green
and the gap is invisible. Under the Vercel KV backend (`src/store/kvOrderStore.ts`)
a documented outage (`_techspec.md` §"Known Risks: KV availability/latency") makes
`create` reject; the request then hangs until the Vercel function times out
(504 `FUNCTION_INVOCATION_TIMEOUT`) with no log line. This violates the TechSpec
contract: §"Error handling conventions" (line 106) and §"Known Risks" (line 290)
both require that "a KV failure surfaces as a 5xx".

**Fix approach (scope-respecting).** Wrap the store interaction in `ordersRouter`
in a `try/catch` that turns a rejection into a clean `503 { message: "service
unavailable" }` — the same shape already returned for the `gateway_unavailable`
outage card (`src/routes/orders.ts:62`) — plus a `console.error` diagnostic so a
real KV outage is visible in logs. Add an integration test that injects an
`OrderStore` stub whose `create()` rejects and asserts a 5xx response (proving the
request no longer hangs) and the diagnostic log.

**Scope note.** The review comment also lists `src/routes/charges.ts:56,62,71,77`
and `src/routes/reset.ts:18`, and suggests a shared async wrapper / error
middleware in `src/server.ts`. Those files are **not** in this batch's
`<batch_scope>` code files (only `src/routes/orders.ts`). Per the `cy-fix-reviews`
scope rule, the change here is limited to `src/routes/orders.ts` and its test;
the remaining handlers belong to their own scoped issues and are intentionally
left untouched in this batch.
