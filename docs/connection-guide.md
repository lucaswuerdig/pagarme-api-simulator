# Connection guide — repointing the consuming app at the fake

This guide tells the **consuming application's team** how to point their app at
the fake Pagar.me API for **homologation/testing only**, without any risk to
production. It reproduces [`_idea.md` §7](../.compozy/tasks/create-api-pagarme/_idea.md)
and is the delivery boundary for app-side integration
([ADR-002](../.compozy/tasks/create-api-pagarme/adrs/adr-002.md)).

> **No code from this repository is committed to the consuming app's
> repository.** The fake is a standalone service; the changes below are applied
> by the consuming-app team in *their own* repo, from this guide
> ([ADR-002](../.compozy/tasks/create-api-pagarme/adrs/adr-002.md)).

## Why a URL swap (not a key swap)

In Pagar.me v5, **homologation and production use the same URL**
(`https://api.pagar.me`); what distinguishes test from production is the **API
key** (`sk_test_*` vs `sk_*`) sent in the `Authorization` header. The consuming
app therefore has a single, fixed base URL in code.

The fake takes over the role of that single URL **in the test environment**. So
the integration is a **URL swap, not a key swap**: you change the base URL the
app talks to and keep sending the same `Authorization: Basic base64("<token>:")`
header it already sends. The one prerequisite is that the token the app presents in
homologation is on the fake's small committed allowlist
([`src/auth/tokens.ts`](../src/auth/tokens.ts)) — add the team's homologation token
there (a one-line edit + redeploy, like a magic card) so the app needs **no key
change**. The fake validates that token and answers `401` for a missing or unlisted
one ([`_idea.md` §2](../.compozy/tasks/create-api-pagarme/_idea.md)); otherwise it
serves the `/core/v5/...` routes exactly as the real Pagar.me, so the app needs **no
changes beyond the base-URL swap**.

## What URL to use

- **Local fake:** `http://localhost:8088` (see the [README](../README.md) for
  how to run it locally).
- **Shared/deployed fake:** the Vercel deployment URL, e.g.
  `https://<your-fake>.vercel.app` (from the `vercel deploy` output or the Vercel
  dashboard).

Set `PAGARME_API_URL` to the **base** URL only (no path). The app concatenates
`apiUrl + resource`, and the resource paths already include `/core/v5/...`. So a
fake at `http://localhost:8088` must answer at
`http://localhost:8088/core/v5/orders`, and so on.

## Integration steps (consuming app — separate repo)

Today the base URL is hardcoded. Make it configurable via env, then point the
**test/homologation** environment at the fake. Three changes:

### 1. `config/pagarme.php` — add a configurable base URL

```php
'api_url' => env('PAGARME_API_URL', 'https://api.pagar.me'),
```

### 2. `app/Services/Gateways/Pagarme.php` — read it in `setApiUrl()` (~line 127)

```php
protected function setApiUrl()
{
    return config('pagarme.api_url', 'https://api.pagar.me');
}
```

### 3. The test/homologation `.env` — point at the fake

```dotenv
PAGARME_API_URL=http://localhost:8088
# or the deployed fake:
# PAGARME_API_URL=https://<your-fake>.vercel.app
```

Then **clear the config cache** so the new value is picked up:

```bash
php artisan config:clear
```

## ⚠️ Production safety (read this)

- **Leave `PAGARME_API_URL` UNSET in production.** With it unset, the
  `env('PAGARME_API_URL', 'https://api.pagar.me')` default falls back to the real
  `https://api.pagar.me`, so production keeps talking to the real Pagar.me and
  **nothing changes** there.
- This is a **test/homologation-only switch.** The fake must **never** be
  reachable from production configuration
  ([ADR-002](../.compozy/tasks/create-api-pagarme/adrs/adr-002.md); PRD "Risks
  and Mitigations": *misconfiguration into production*).
- Setting `PAGARME_API_URL` to the fake in production would route **real
  payments** at a test double that processes nothing — never do this.

## Verify the connection

After repointing, confirm the fake is reachable and the app sees a healthy
gateway:

```bash
curl -s http://localhost:8088/health     # -> {"status":"ok"} (open, no token)
# deployed:
# curl -s https://<your-fake>.vercel.app/health
```

`GET /health` is open, but every `/core/v5/...` route **and** `POST /__reset` now
require a valid token in the `Authorization` header (see the README's
[Authentication](../README.md#authentication) section). Use the same Basic header
the app sends — here with the example homologation token `test_token`
(`base64("test_token:")`), which you would replace with your allowlisted token:

```bash
curl -s -X POST http://localhost:8088/__reset \
  -H 'authorization: Basic dGVzdF90b2tlbjo=' \
  -o /dev/null -w '%{http_code}\n'   # -> 204 (omit the header -> 401)
```

Then run a credit-card test that drives `POST /core/v5/orders` (carrying that same
`Authorization` header) and pick the
[magic card](../README.md#magic-card-catalog) for the scenario you want
(approved, declined, transaction error, order failed, gateway outage). The
outcome is fully determined by the card number in the request, so tests are
reproducible. Use [`POST /__reset`](../README.md#the-__reset-test-helper) to
clear lifecycle state between suites. To verify the consuming app's auth-failure
path, send a **deliberately unlisted** token and confirm it surfaces the `401`.

## Don't over-trust the fake

Passing the credit-card suite against the fake validates **app-side behavior**,
not the real gateway. Keep **periodic real-sandbox smoke checks** in the release
process — passing against the fake is *not* a substitute for verifying against
the real Pagar.me sandbox when it is available (PRD "Risks and Mitigations":
*over-trust / false confidence* and *contract drift*). See the README's
[Caveats](../README.md#caveats--over-trust--contract-drift) section.
