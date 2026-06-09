# Fake Pagar.me API (Homologation Test Double)

An HTTP **test double for the Pagar.me v5 credit-card API**. It stands in for
`https://api.pagar.me` during homologation and local testing so the consuming
application's credit-card test suites run deterministically — independent of the
real Pagar.me sandbox's availability.

The fake reproduces the exact five `/core/v5/...` credit-card routes the
consuming app calls and returns response bodies whose fields match what that
app's parser reads. **Approval is decided by the response body**
(`last_transaction.status` + `success`), **not by the HTTP status**: business
outcomes return `200`, and only a simulated gateway outage returns `5xx`
(see [`_idea.md` §3](.compozy/tasks/create-api-pagarme/_idea.md)). Outcomes are
selected deterministically from the incoming card number/token via a fixed
[magic-card table](#magic-card-catalog) ([ADR-003](.compozy/tasks/create-api-pagarme/adrs/adr-003.md)).

> **This repository delivers the fake service only.** Pointing the consuming app
> at it is a documented, test-only configuration change owned by that app's team
> — see the **[Connection guide](docs/connection-guide.md)**. No code is
> committed to the consuming app's repository
> ([ADR-002](.compozy/tasks/create-api-pagarme/adrs/adr-002.md)).

## Contents

- [Endpoints](#endpoints)
- [Authentication](#authentication)
- [Magic-card catalog](#magic-card-catalog)
- [The `/__reset` test helper](#the-__reset-test-helper)
- [Local development](#local-development)
- [Environment variables](#environment-variables)
- [Deploy pipeline (GitHub → Vercel)](#deploy-pipeline-github--vercel)
- [Connecting the consuming app](#connecting-the-consuming-app)
- [Caveats — over-trust & contract drift](#caveats--over-trust--contract-drift)

## Endpoints

Routes are served under the `/core/v5/...` prefix exactly as the real Pagar.me,
because the consuming app concatenates `apiUrl + resource` and the `resource`
paths already include `/core/v5/...`.

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/core/v5/orders` | Create order — sale with capture (`auth_and_capture`) or pre-authorization (`auth_only`). Resolves the outcome from the card, persists the order, returns the order body (`200`), or `5xx` for the outage card. |
| `POST` | `/core/v5/charges/{charge_id}/capture` | Capture a prior authorization (`{ "amount": 1990 }`). Returns a **charge** object with a root-level `last_transaction` (`200`). |
| `DELETE` | `/core/v5/charges/{charge_id}` | Cancel / refund (full = no body, partial = `{ "amount": 1990 }`). Returns a charge object with `status: canceled` and `canceled_amount` (`200`). |
| `POST` | `/core/v5/tokens?appId={public_key}` | Tokenize a card. Returns the token + card metadata (`201`). |
| `GET` | `/health` | Liveness check. Returns `{ "status": "ok" }` (`200`). |
| `POST` | `/__reset` | **Test-only**, not a Pagar.me route. Clears stored lifecycle state. Returns `204`. |

**HTTP status conventions** (`_idea.md` §3.3): business outcomes — approved,
declined, transaction error, order failed — always return **`200`** with the
result in the body; a simulated gateway outage returns **`5xx`**; tokenization
returns **`201`**; `/__reset` returns **`204`**. Capture/cancel against an
unknown `charge_id` returns a body-level error (`last_transaction.status:
with_error`, `success: false`) at HTTP `200`. Every route except `GET /health`
requires a valid token in the `Authorization` header — see
[Authentication](#authentication); a missing or unlisted token returns `401`
(`_idea.md` §2, [ADR-001](.compozy/tasks/token-auth-middleware/adrs/adr-001.md)).

## Authentication

The fake validates an **API token** on every protected request. All
`/core/v5/...` routes **and** `POST /__reset` require a valid token; only
`GET /health` is open (a liveness probe needs no credential).

Tokens travel in the real Pagar.me v5 form — `Authorization: Basic
base64("<token>:")`, the token as the username with an **empty** password:

```bash
# `test_token` -> base64("test_token:") == dGVzdF90b2tlbjo=
curl -s http://localhost:8088/health \
  -H 'authorization: Basic dGVzdF90b2tlbjo='   # /health is open; token optional here
```

A request with a missing, malformed, or unlisted token is rejected **before** any
business logic with `HTTP 401` and the body `{ "error": "unauthorized", "message":
"A valid API token is required." }`. This lets the consuming app exercise its real
"invalid key → 401" path by sending an unlisted token
([ADR-001](.compozy/tasks/token-auth-middleware/adrs/adr-001.md)).

Valid tokens are a **fixed, committed allowlist** in
[`src/auth/tokens.ts`](src/auth/tokens.ts) — they are **not** environment-configured.
Add or revoke a token by editing that file and redeploying, exactly like the
[magic-card catalog](#magic-card-catalog). The committed `test_token` is the
clearly-fake homologation value the test suite uses; the `/__reset` and `/core/v5`
examples below carry its `Authorization` header.

The destructive `POST /__reset` helper is covered by this same gate — one credential
model across the whole protected surface, with no separate per-endpoint secret
([ADR-002](.compozy/tasks/token-auth-middleware/adrs/adr-002.md)).

## Magic-card catalog

The outcome is chosen by the **card number** sent in the request (or, for
tokenized flows, by `card_id` / `card_token`). This is the single, canonical
catalog of scenarios ([ADR-003](.compozy/tasks/create-api-pagarme/adrs/adr-003.md);
sourced from [`_idea.md` §5](.compozy/tasks/create-api-pagarme/_idea.md)). An
unrecognized or absent card defaults to **approved + captured**, so the happy
path needs no special number.

| Card number | Scenario | HTTP | Body outcome |
|-------------|----------|------|--------------|
| `4000000000000010` | Approved + captured | `200` | `status: paid`, `last_transaction.status: captured`, `success: true` |
| `4000000000000028` | Approved without capture (pre-authorization) | `200` | `status: authorized_pending_capture`, `last_transaction.status: authorized_pending_capture`, `success: true` |
| `4000000000000002` | Declined by the issuer | `200` | `status: failed`, `last_transaction.status: not_authorized`, `success: false`, `acquirer_return_code: 57` |
| `4000000000000036` | Transaction error | `200` | `last_transaction.status: with_error`, `success: false` |
| `4000000000000044` | Order failed (root) | `200` | root `status: failed` |
| `4000000000009999` | Gateway unavailable (simulated outage) | `5xx` | no contract body (HTTP `500`/`503`) |

**Tokenized flows.** Every scenario above is also reachable without a raw card
number, via a magic `card_id` (`card_<suffix>`) or `card_token`
(`token_<suffix>`) — e.g. `card_refused` and `token_refused` both resolve to
**declined**. Suffixes: `approved`, `no_capture`, `refused`, `error`, `failed`,
`unavailable`.

### Sample request and outcome

Drive the **approved + captured** happy path with the `4000000000000010` card:

<!-- doctest:orders-request -->
```json
{
  "payments": [
    {
      "amount": 1990,
      "payment_method": "credit_card",
      "credit_card": {
        "card": {
          "number": "4000000000000010",
          "holder_name": "FULANO DE TAL",
          "exp_month": 12,
          "exp_year": 30,
          "cvv": "123"
        },
        "operation_type": "auth_and_capture",
        "installments": 1,
        "statement_descriptor": "APPMAX*LOJA"
      }
    }
  ],
  "code": "PREFIXO_12345_a1b2c",
  "customer": { "name": "Fulano De Tal", "email": "fulano@example.com" },
  "metadata": { "site": "Minha Loja" },
  "closed": true
}
```

```bash
curl -s -X POST http://localhost:8088/core/v5/orders \
  -H 'content-type: application/json' \
  -H 'authorization: Basic dGVzdF90b2tlbjo=' \
  --data-binary @order.json
```

> The `authorization` header carries `base64("test_token:")` — the homologation
> token from [`src/auth/tokens.ts`](src/auth/tokens.ts) (see
> [Authentication](#authentication)). Drop it, or send an unlisted token, and the
> request returns `401` instead of the order body.

The fake responds **`HTTP 200`** with `status: "paid"` and
`charges[0].last_transaction` carrying `status: "captured"` and `success: true`
(plus the `⭐` fields the consuming app reads downstream — `id`, `code`,
`charges[0].id`, `charges[0].amount`, `last_transaction.card.id`, the
`acquirer_*` codes, and `metadata.site`; see `_idea.md` §8). Swap the card
number for any other [catalog](#magic-card-catalog) row to force that scenario.

## The `/__reset` test helper

`POST /__reset` is a **test-only** affordance (not a Pagar.me route). It clears
the stored order/charge lifecycle state so a test suite starts from a clean slate
and a `charge_id` created before the reset resolves as not-found afterwards. It
returns `204 No Content`.

`/__reset` is protected by the token gate (see [Authentication](#authentication)),
so the request must carry a valid `Authorization` header:

```bash
curl -s -X POST http://localhost:8088/__reset \
  -H 'authorization: Basic dGVzdF90b2tlbjo=' \
  -o /dev/null -w '%{http_code}\n'   # -> 204 (omit the header -> 401)
```

On Vercel KV it deletes only keys under the `ch:` prefix (scan + delete, never
`flushall`) so it stays safe on a shared store
([ADR-005](.compozy/tasks/create-api-pagarme/adrs/adr-005.md),
[ADR-006](.compozy/tasks/create-api-pagarme/adrs/adr-006.md)).

## Local development

Requirements: **Node.js >= 20** (and Docker, optionally, for the compose stack).

### Run with Node directly

```bash
npm ci
npm run dev          # tsx watch on src/server.ts — http://localhost:8088
# or, against the compiled output:
npm run build && npm start   # node dist/server.js
```

With no `STORE_BACKEND` set the service uses the **in-memory store**, so it boots
with zero external dependencies. Confirm it is up:

```bash
curl -s http://localhost:8088/health   # -> {"status":"ok"}
```

### Run with Docker (local dev only)

Docker is provided for local parity only — **Vercel is the deploy target**
([ADR-006](.compozy/tasks/create-api-pagarme/adrs/adr-006.md)); the deploy
pipeline does not use these files.

```bash
# Default: in-memory store, no external deps — recommended for most local work.
docker compose up --build
#  -> http://localhost:8088/health  and the /core/v5/... routes

# KV/Redis parity: exercise the @vercel/kv code path against a local Redis.
STORE_BACKEND=kv docker compose --profile kv up --build
```

The `kv` profile starts a `redis` container **plus** a `redis-rest` proxy:
`@vercel/kv` speaks the Upstash HTTP REST protocol, **not** raw Redis TCP, so a
plain Redis cannot back it directly — the proxy bridges the two.

### Test, lint, type-check, build

```bash
npm test         # vitest run --coverage  (80% thresholds; runs against the in-memory store)
npm run lint     # eslint
npm run typecheck   # tsc --noEmit -p tsconfig.test.json
npm run build    # tsc -> dist/
```

The test suite runs entirely against the in-memory store, so **no live Vercel KV
is required** for local development or CI. The heavyweight Docker build+boot
smoke test is opt-in via the `DOCKER_E2E=1` environment variable.

## Environment variables

Build and the test suite need **none** of these — they default to the in-memory
store. Set them in the Vercel project settings for the deployed function, or in a
local `.env` (see [`.env.example`](.env.example)).

| Variable | Required when | Purpose |
|----------|---------------|---------|
| `STORE_BACKEND` | On Vercel: set to `kv` | Store selector. `kv` selects Vercel KV (Upstash Redis); any other value — including unset — uses the in-memory store. |
| `KV_REST_API_URL` | `STORE_BACKEND=kv` | Vercel KV (Upstash) REST URL. `createStore` throws at startup if missing when `kv` is selected. |
| `KV_REST_API_TOKEN` | `STORE_BACKEND=kv` | Vercel KV (Upstash) REST token. Also required when `STORE_BACKEND=kv`. |
| `PORT` | Local only | HTTP listen port for `npm run dev` / `npm start` (default `8088`). Platform-managed on Vercel. |

`KV_REST_API_URL` and `KV_REST_API_TOKEN` are provisioned by the Vercel KV
integration in the Vercel project.

The **API tokens** that authenticate requests (see
[Authentication](#authentication)) are **not** environment variables. They live in
the committed allowlist [`src/auth/tokens.ts`](src/auth/tokens.ts) and are changed by
editing that file and redeploying — there is nothing to set in `.env` or the Vercel
project for them.

## Deploy pipeline (GitHub → Vercel)

The service ships to **Vercel serverless functions** via a **GitHub Actions**
pipeline ([ADR-006](.compozy/tasks/create-api-pagarme/adrs/adr-006.md),
[ADR-007](.compozy/tasks/create-api-pagarme/adrs/adr-007.md)). The workflow
([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) has two jobs:

1. **`test`** — runs on every push and pull request: `npm ci` → lint →
   type-check → build → `npm test` (against the in-memory store, so CI needs no
   live KV).
2. **`deploy`** — `needs: test`, and runs **only on a push to `main`**, so only
   test-passing default-branch commits ship to production. It deploys with the
   Vercel CLI: `vercel pull --environment=production` → `vercel build --prod` →
   `vercel deploy --prebuilt --prod`.

On Vercel, [`api/index.ts`](api/index.ts) exports the Express app as the single
function handler and [`vercel.json`](vercel.json) rewrites `/(.*)` → `/api`, so
every `/core/v5/...` path (including the dynamic `charge_id`) reaches the app
unchanged. The **deployed URL** is the project's Vercel domain — e.g.
`https://<your-fake>.vercel.app` (from the `vercel deploy` output or the Vercel
dashboard); that is the URL the consuming app points at (see the
[Connection guide](docs/connection-guide.md)).

### Required GitHub secrets

The `deploy` job needs the three secrets below; the `test` job needs none. Add
them in the repository **Settings → Secrets and variables → Actions**:

| Secret | Purpose |
|--------|---------|
| `VERCEL_TOKEN` | Vercel access token (least-privilege) used by the CLI. |
| `VERCEL_ORG_ID` | Vercel organization/team ID for the project. |
| `VERCEL_PROJECT_ID` | Vercel project ID to deploy to. |

A Vercel project with a provisioned **Vercel KV** store (supplying
`KV_REST_API_URL` / `KV_REST_API_TOKEN`) and these three secrets must exist
before the first production deploy.

## Connecting the consuming app

To point the consuming Laravel app at the fake during homologation/testing, see
the **[Connection guide](docs/connection-guide.md)**. In short: it is a **URL
swap, not a key swap** — set `PAGARME_API_URL` to the fake's URL, run
`php artisan config:clear`, and **leave `PAGARME_API_URL` unset in production**
(the default falls back to the real `https://api.pagar.me`). No code from this
repo is committed to the consuming app
([ADR-002](.compozy/tasks/create-api-pagarme/adrs/adr-002.md)).

## Caveats — over-trust & contract drift

This fake is a **test double for app-side behavior**, not a substitute for the
real gateway (PRD "Risks and Mitigations"):

- **Over-trust / false confidence.** Passing against the fake is **not** full
  assurance. Keep **periodic real-sandbox smoke checks** in the release process;
  do not treat green-against-the-fake as a replacement for validating against the
  real Pagar.me homologation environment.
- **Contract drift.** The fake is pinned to the documented v5 contract
  (`_idea.md`). If the real Pagar.me changes its contract, the fake can silently
  diverge and green tests would no longer reflect reality. **Periodically compare
  the fake against the real sandbox** when it is available, and update the types,
  builders, and this catalog if the contract moves.
- **Production safety.** The fake must never be reachable in production. The
  default consuming-app configuration (with `PAGARME_API_URL` unset) always falls
  back to the real Pagar.me — see the
  [Connection guide](docs/connection-guide.md).
