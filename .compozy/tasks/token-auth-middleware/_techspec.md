# TechSpec — Token Validation for the Fake Pagar.me API

## Executive Summary

Add an always-on Basic-auth gate in front of the protected routes, backed by a
static, committed token allowlist that mirrors the magic-cards pattern
(`src/magic/cards.ts`). A new `src/auth/` module holds the pure allowlist +
parsing/validation logic (`tokens.ts`) and a thin Express middleware
(`middleware.ts`). The middleware mounts once in `registerRoutes`, after
`healthRouter` and before `resetRouter`, so it guards `POST /__reset` and every
`/core/v5` route while `GET /health` stays open. Requests with a missing, malformed,
or unlisted token get `401 { error, message }`; valid requests are unchanged. The
`RESET_SECRET` / `x-reset-secret` mechanism is removed (ADR-002).

**Primary trade-off:** always-on enforcement means every existing test and local-dev
call must now authenticate. We absorb that cost with a single committed homologation
token (`test_token`) plus a shared test helper, gaining one uniform credential model
and a stronger access guarantee instead of an optional/configurable gate.

## System Architecture

### Component Overview

- **`src/auth/tokens.ts` (new, pure):** `VALID_TOKENS` allowlist (readonly),
  `isValidToken(token)`, and `parseBasicToken(header)`. No Express, no I/O —
  unit-testable in isolation, like `cards.ts`.
- **`src/auth/middleware.ts` (new, Express):** `requireToken(req, res, next)` —
  extracts the token via `parseBasicToken`, validates via `isValidToken`, calls
  `next()` or sends 401.
- **`src/routes/index.ts` (modified):** mounts `requireToken` between `healthRouter`
  and `resetRouter`.
- **`src/routes/reset.ts` (modified):** drop the `RESET_SECRET` guard, the `env`
  param, and the `RESET_SECRET_HEADER` export; `/__reset` is now protected by the
  shared gate.
- **`tests/helpers/authedRequest.ts` (new):** wraps supertest to set
  `Authorization: Basic base64("test_token:")`, importing the token from
  `src/auth/tokens.ts`.

**Data flow:** `request → express.json() → healthRouter (/health, open) → requireToken
(401 or next) → resetRouter / logRequests / core-v5 routers → handlers`.

## Implementation Design

### Core Interfaces

```typescript
// src/auth/tokens.ts — pure, Express-free (mirrors src/magic/cards.ts)

/** Canonical allowlist of valid API tokens. Single source of truth; edit like
 *  MAGIC_CARD_NUMBERS. `test_token` is a fake homologation value used by tests. */
export const VALID_TOKENS: ReadonlySet<string> = new Set(["test_token"]);

/** True when `token` is on the allowlist. */
export function isValidToken(token: string | undefined): boolean {
  return token !== undefined && VALID_TOKENS.has(token);
}

/** Extract the token from `Authorization: Basic base64("<token>:")`.
 *  Returns undefined when the header is absent or malformed. */
export function parseBasicToken(header: string | undefined): string | undefined {
  if (!header?.startsWith("Basic ")) return undefined;
  const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  const token = decoded.split(":", 1)[0];
  return token.length > 0 ? token : undefined;
}
```

```typescript
// src/auth/middleware.ts — thin Express adapter
import type { Request, Response, NextFunction } from "express";
import { isValidToken, parseBasicToken } from "./tokens";

export function requireToken(req: Request, res: Response, next: NextFunction): void {
  if (isValidToken(parseBasicToken(req.headers.authorization))) return next();
  res.status(401).json({ error: "unauthorized", message: "A valid API token is required." });
}
```

### Data Models

No new domain entities or stored data. `VALID_TOKENS` is an in-memory readonly set
compiled into the bundle (no store, no env). The 401 response body is
`{ error: string, message: string }`, identical to the existing 404 fallback and
former reset guard.

### API Endpoints

No new endpoints. Behavioral change to existing routes:

| Method | Path | Auth | On missing/invalid token |
|--------|------|------|--------------------------|
| POST | `/core/v5/orders` | required | 401 |
| POST | `/core/v5/charges/:id/capture` | required | 401 |
| DELETE | `/core/v5/charges/:id` | required | 401 |
| POST | `/core/v5/tokens` | required | 401 |
| POST | `/__reset` | required | 401 |
| GET | `/health` | open | — |
| (any unknown path) | — | required | 401 (before 404 fallback) |

## Integration Points

The consuming Laravel app is the external caller. It already sends
`Authorization: Basic base64("<token>:")` (token as username, empty password) on every
request — the real Pagar.me v5 format — so no consumer code change is needed once a
valid token is on the allowlist. Authentication is the membership check described
above; there is no retry strategy (a 401 is terminal and surfaces in the consumer as a
thrown HTTP-client exception).

## Impact Analysis

| Component | Impact Type | Description and Risk | Required Action |
|-----------|-------------|---------------------|-----------------|
| `src/auth/tokens.ts` | new | Pure allowlist + parsing. Low risk. | Create with `VALID_TOKENS`, `isValidToken`, `parseBasicToken`. |
| `src/auth/middleware.ts` | new | Express gate. Low risk. | Create `requireToken`. |
| `src/routes/index.ts` | modified | Mount `requireToken` after health, before reset. Wrong order = `/__reset` unguarded or `/health` blocked. | Insert one `app.use` at the correct position. |
| `src/routes/reset.ts` | modified | Remove `RESET_SECRET` guard, `env` param, `RESET_SECRET_HEADER` export. | Simplify to unconditional clear (now gated upstream). |
| `tests/helpers/authedRequest.ts` | new | Shared authenticated supertest wrapper. | Create helper. |
| `tests/unit/routes.test.ts` | modified | 23 protected calls + replace 3 `RESET_SECRET` tests. | Use helper; add 401/204 reset tests. |
| `tests/integration/httpRoutes.test.ts` | modified | 17 protected calls. | Use helper. |
| `tests/integration/vercelHandler.test.ts` | modified | 3 protected calls. | Use helper. |
| `tests/integration/docsAccuracy.test.ts` | modified | 1 protected call; may assert README curl. | Use helper; align with doc examples. |
| `src/routes/tokens.ts` | modified | Remove stray `console.log("teste")` (line 22). | Delete debug line. |
| `README.md`, `docs/connection-guide.md`, `.env.example` | modified | Document the token requirement and the `Authorization` example; note `RESET_SECRET` removal. | Update docs. |

## Testing Approach

### Unit Tests
- **`src/auth/tokens.ts`:** `isValidToken` (listed / unlisted / undefined);
  `parseBasicToken` for valid `Basic base64("token:")`, missing header, wrong scheme,
  non-base64, empty token. These are the critical edge cases and need no HTTP.
- **`requireToken`:** valid token → `next()` called; missing/invalid → 401 body
  `{error, message}` and `next` not called.

### Integration Tests
- **Positive:** every protected route returns its normal result when called through
  `authedRequest` (the existing 44 cases, now authenticated).
- **Negative:** at least one protected route per kind returns 401 with no token and
  with an unlisted token; `/__reset` returns 401 without a token and 204 with a valid
  token (replacing the old `RESET_SECRET` cases).
- **Open route:** `GET /health` returns 200 without a token.
- All app builders (`createPagarmeApp`, `createApp`, Vercel `handler`, docs builder)
  flow through the same `registerRoutes`, so the helper works uniformly.

## Development Sequencing

### Build Order
1. **`src/auth/tokens.ts`** — no dependencies. Allowlist + `isValidToken` +
   `parseBasicToken` with unit tests.
2. **`src/auth/middleware.ts`** — depends on step 1. `requireToken` with unit tests.
3. **Wire `requireToken` in `src/routes/index.ts`** — depends on step 2. Mount after
   health, before reset.
4. **Simplify `src/routes/reset.ts`** — depends on step 3 (reset is now gated
   upstream). Remove `RESET_SECRET` logic/param/export.
5. **`tests/helpers/authedRequest.ts`** — depends on step 1 (imports the token).
6. **Refactor the 44 test call sites + replace reset-secret tests** — depends on steps
   3, 4, 5.
7. **Remove `console.log("teste")` and update docs** — depends on step 3 (final
   behavior known).

### Technical Dependencies
None external. No new npm packages (base64 via Node `Buffer`). No infrastructure
changes.

## Monitoring and Observability

The existing `logRequests` middleware already logs method/path/outcome/status for
`/core/v5`. A 401 from `requireToken` (which runs before `logRequests`) will not be
captured by it; if auth-rejection visibility is wanted, `requireToken` may emit a
single `console.warn` with method + path + **masked** token — never the full token. No
new metrics; the shared instance has none by design.

## Technical Considerations

### Key Decisions
- **Always-on gate, module-level allowlist (not injected).** Rationale: mirrors
  `cards.ts`; simplest correct design. Trade-off: tests must authenticate. Rejected:
  optional/env-gated and injectable-allowlist variants (see ADR-001, ADR-004).
- **Mount once, after health / before reset.** Rationale: one gate covers reset +
  core-v5 correctly. Rejected: per-prefix or after-reset mounting (would leave
  `/__reset` open) — ADR-003.
- **401 `{error, message}`.** Rationale: repo consistency; body is irrelevant to the
  consuming Guzzle (throws on any 4xx). Rejected: Pagar.me-shaped or empty body.

### Known Risks
- **A future test forgets the helper** → spurious 401. Mitigation: helper is the
  documented default; negative tests are the only ones that bypass it.
- **Header parsing edge cases** → false 401/200. Mitigation: `parseBasicToken` unit
  tests cover scheme, base64, and colon handling.
- **Doc/test curl examples drift** (e.g. `docsAccuracy.test.ts`). Mitigation: update
  README/connection-guide examples to include the `Authorization` header in the same
  change.

## Architecture Decision Records

- [ADR-001: Static in-file token allowlist with an always-on Basic-auth gate](adrs/adr-001.md)
  — fixed committed token list, always enforced, 401 on miss.
- [ADR-002: Unify access control under the token gate, retiring RESET_SECRET](adrs/adr-002.md)
  — `/__reset` covered by the gate; reset secret removed.
- [ADR-003: Token-auth middleware design — src/auth module, mount order, and 401 shape](adrs/adr-003.md)
  — two-file `src/auth/`, mount after health/before reset, `{error, message}` 401.
- [ADR-004: Test authentication via a shared helper and a committed homologation test token](adrs/adr-004.md)
  — `test_token` in the allowlist + `authedRequest` helper across all call sites.
