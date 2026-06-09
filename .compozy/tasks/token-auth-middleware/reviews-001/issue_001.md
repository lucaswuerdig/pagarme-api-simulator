---
provider: manual
pr:
round: 1
round_created_at: 2026-06-09T12:54:54Z
status: resolved
file: src/auth/tokens.ts
line: 36
severity: low
author: claude-code
provider_ref:
---

# Issue 001: parseBasicToken matches the auth scheme case-sensitively

## Review Comment

`parseBasicToken` rejects any header that does not start with the exact string
`"Basic "`:

```ts
if (!header?.startsWith("Basic ")) return undefined;
```

Per RFC 7617 §2, the HTTP authentication scheme token is **case-insensitive**, so a
spec-compliant client may send `authorization: basic <b64>` (lowercase) or `BASIC`.
The real Pagar.me gateway accepts the credential regardless of scheme case, so a
strict match is a small fidelity gap: a request that the real API would authenticate
gets a `401` from the fake. In practice the known consuming app always sends
`Basic ` (capital B, per the PHP `makeRequest`), so impact today is minimal — hence
low severity.

Suggested fix: compare the scheme case-insensitively while keeping the credential
bytes intact, e.g. split once on the first space and lowercase only the scheme:

```ts
const [scheme, encoded] = header?.split(" ", 2) ?? [];
if (scheme?.toLowerCase() !== "basic" || !encoded) return undefined;
const decoded = Buffer.from(encoded, "base64").toString("utf8");
```

Add a `parseBasicToken("basic " + b64)` unit case alongside the existing scheme test.

## Triage

- Decision: `VALID`
- Root cause: `parseBasicToken` gates on `header?.startsWith("Basic ")`, an
  exact, case-sensitive string match. RFC 7617 §2 defines the HTTP auth-scheme
  token as case-insensitive, so a spec-compliant client sending `basic <b64>` or
  `BASIC <b64>` is rejected with `undefined` (→ `401`) even though the real
  Pagar.me v5 gateway would authenticate the identical credential bytes. This is
  a fidelity gap between the fake and the real API.
- Severity confirmed `low`: the known consuming app (PHP `makeRequest`) always
  sends `Basic ` with a capital `B`, so no current caller is affected.
- Fix approach: split the header once on the first space into `scheme` and
  `encoded`, compare the scheme case-insensitively (`scheme?.toLowerCase() !==
  "basic"`), and require a non-empty `encoded` segment before decoding. The
  credential bytes are left untouched (only the scheme is lowercased), so
  base64 decoding and the existing `<token>:<password>` splitting are unchanged.
  Behavior for every prior input (absent header, wrong scheme, non-base64,
  empty token, password-after-colon) is preserved.
- Tests: add `parseBasicToken` cases asserting that lowercase `basic ` and
  uppercase `BASIC ` schemes decode the same token as the canonical `Basic `
  header, alongside the existing scheme test.
