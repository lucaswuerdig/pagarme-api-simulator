---
provider: manual
pr:
round: 1
round_created_at: "2026-06-07T14:03:46Z"
status: resolved
file: src/routes/index.ts
line: 22
severity: medium
author: claude-code
provider_ref:
---

# Issue 003: Required per-request structured logging is missing entirely

## Review Comment

The TechSpec's "Monitoring and Observability" section specifies the observability
design for the shared, remotely-hosted instance: "structured per-request line on
each `/core/v5/...` call — method, path, resolved `outcome`, minted/looked-up
`charge_id`, and response status — visible in Vercel function logs. Log KV errors
distinctly so a store outage is diagnosable."

None of this is implemented. The only `console.*` call in `src/` is the startup
listen message (`src/server.ts:70`); no route logs the method/path/outcome/
charge_id/status, and store/KV errors are not logged at all (compounding
Issue 001). For a single shared homologation instance that the whole team points
at, this leaves operators with no way to confirm which scenario a request
resolved to or to diagnose a KV outage from the Vercel logs.

Suggested fix: emit one structured line per `/core/v5/...` request — e.g. a small
middleware or per-handler `console.log(JSON.stringify({ method, path, outcome,
chargeId, status }))` on the resolved outcome and final status, plus a distinct
`console.error` for store/KV failures. Do **not** log card numbers, CVV, or
holder PII — log only the resolved `outcome`, the minted/looked-up `charge_id`,
and the response status.

## Triage

- Decision: `VALID`
- Notes:

**Confirmed.** The claim is accurate. The TechSpec's §"Monitoring and
Observability" (`_techspec.md:253-262`) mandates a "structured per-request line on
each `/core/v5/...` call — method, path, resolved `outcome`, minted/looked-up
`charge_id`, and response status — visible in Vercel function logs. Log KV errors
distinctly so a store outage is diagnosable." A grep of `src/` confirms the only
`console.*` calls are the startup listen message (`src/server.ts:70`) and — after
Issue 001 — the orders store-error `console.error` (`src/routes/orders.ts:88`). No
route emits a per-request structured line, so operators pointed at the shared
homologation instance cannot confirm which scenario a request resolved to, nor
spot a KV outage in the Vercel logs.

**Root cause.** Per-request observability was simply never implemented. The
`/core/v5` routers are registered in `registerRoutes` (`src/routes/index.ts:22`)
with no logging middleware in the chain.

**Fix approach.** Add a structured request-logging middleware in `registerRoutes`
(`src/routes/index.ts`), mounted on the `/core/v5` prefix *before* the routers. It
captures `method` + `path` synchronously (from `req.originalUrl`, query stripped so
the tokenization `appId` public key is not logged) and, on the response `finish`
event, emits exactly one `console.log(JSON.stringify(...))` line carrying
`method`, `path`, the resolved `outcome`, the minted/looked-up `charge_id`, and the
final `status`. `outcome`/`charge_id` are read from `res.locals`, which the
stateful handlers populate. **Privacy:** only `outcome`, `charge_id`, and `status`
are logged — never card numbers, CVV, or holder PII (enforced by a test asserting
the log object's keys are exactly that safe set).

**Scope note.** The resolved `outcome` and the minted `charge_id` are computed
*inside* the order handler, and the looked-up `charge_id` inside the charge
handlers; a middleware in `src/routes/index.ts` cannot know them unless those
handlers expose them. The minimum needed is therefore one-line `res.locals`
assignments in `src/routes/orders.ts` and `src/routes/charges.ts` — files outside
this batch's `<batch_scope>` code files (which list only `src/routes/index.ts`).
Per the `cy-fix-reviews` scope rule ("if a fix absolutely requires touching a file
not listed there, limit the change to the minimum needed and document why"), this
is documented here and held to the minimum. Tokenization/health/reset are
stateless w.r.t. `outcome`/`charge_id`, so they need no handler change and log only
`method`/`path`/`status`. Distinct KV-error logging already lands via the
per-handler `console.error` (Issue 001, `orders.ts:88`); this fix adds the
per-request line the spec requires.
