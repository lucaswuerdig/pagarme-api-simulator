/**
 * Shared authenticated supertest wrapper (ADR-004).
 *
 * With the always-on token gate live (ADR-001), every call to a protected route
 * (`POST /__reset` and all `/core/v5` routes) must carry
 * `Authorization: Basic base64("<token>:")` — the real Pagar.me v5 form, token as
 * username with an empty password. This helper presets that header so an
 * authenticated request is the default and a call site reads exactly like the
 * pre-gate `request(app)`; no test can silently forget the credential.
 *
 * The token is sourced from {@link VALID_TOKENS} in `src/auth/tokens.ts` — the
 * single source of truth — so the committed homologation `test_token` can never
 * drift from the allowlist. Negative-auth tests deliberately bypass this helper
 * and call `request(app)` directly (no header, or a deliberately bogus one).
 *
 * Works uniformly across every app builder (`createPagarmeApp`, `createApp`, the
 * Vercel `handler`, the docs builder) because they all flow through the same
 * `registerRoutes` mount point.
 *
 * Not a `*.test.ts` file, so vitest never runs it as a suite.
 */

import request from "supertest";
import { VALID_TOKENS } from "../../src/auth/tokens";

/** Supertest target — an Express app or HTTP server, as accepted by `request()`. */
type App = Parameters<typeof request>[0];

/** The committed homologation test token: the sole allowlisted value (ADR-004). */
const TEST_TOKEN = [...VALID_TOKENS][0];

/** `Authorization` header value carrying {@link TEST_TOKEN} in Pagar.me Basic form. */
export const AUTH_HEADER = `Basic ${Buffer.from(`${TEST_TOKEN}:`).toString("base64")}`;

/**
 * Wrap a supertest target so `.get/.post/.put/.delete` preset the `Authorization`
 * header. Each method returns a supertest `Test`, so the usual `.send(...)`,
 * `.set(...)`, `.expect(...)` and `await` chaining keep working unchanged.
 */
export function authedRequest(app: App) {
  return {
    get: (url: string) => request(app).get(url).set("Authorization", AUTH_HEADER),
    post: (url: string) => request(app).post(url).set("Authorization", AUTH_HEADER),
    put: (url: string) => request(app).put(url).set("Authorization", AUTH_HEADER),
    delete: (url: string) => request(app).delete(url).set("Authorization", AUTH_HEADER),
  };
}
