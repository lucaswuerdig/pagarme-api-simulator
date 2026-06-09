/**
 * Token allowlist + Basic-auth parsing (ADR-001, ADR-003).
 *
 * The single source of authentication truth: a committed, in-file allowlist of
 * valid API tokens plus the pure helpers that validate a token and pull it out of
 * an `Authorization: Basic` header. This mirrors how `src/magic/cards.ts` holds the
 * magic-card tables — edit {@link VALID_TOKENS} exactly like `MAGIC_CARD_NUMBERS`.
 *
 * No Express, no store, no network, no clock: same input → same answer, always.
 * The Express gate (`src/auth/middleware.ts`, Task 02) is the only consumer that
 * wires these helpers into the request pipeline.
 *
 * Tokens are never logged here; any diagnostic that needs one must mask it (ADR-001).
 */

/**
 * Canonical allowlist of valid API tokens. Single source of truth; add or rotate
 * tokens by editing this set, just like `MAGIC_CARD_NUMBERS`. `test_token` is a
 * clearly-fake homologation value used by the test suite (ADR-004).
 */
export const VALID_TOKENS: ReadonlySet<string> = new Set(["fk_hflT1IsDGNu5q8nUStlkUwuOm0t4xgrL", "fk_BrxlMnJFwt5TNoqwgjfyDfqx4o35fePp"]);

/** True only when `token` is present and on the {@link VALID_TOKENS} allowlist. */
export function isValidToken(token: string | undefined): boolean {
  return token !== undefined && VALID_TOKENS.has(token);
}

/**
 * Extract the token from `Authorization: Basic base64("<token>:")` — the real
 * Pagar.me v5 format, where the token is the username and the password is empty.
 * Returns the substring before the first `:`, or `undefined` when the header is
 * absent, uses a different scheme, or otherwise yields an empty token. The scheme
 * is matched case-insensitively per RFC 7617 §2 (`Basic`/`basic`/`BASIC` all
 * accepted), mirroring the real gateway; the credential bytes are left untouched.
 * Never throws on malformed input (ADR-003): unparsable bytes simply produce a
 * non-listed value.
 */
export function parseBasicToken(header: string | undefined): string | undefined {
  const [scheme, encoded] = header?.split(" ", 2) ?? [];
  if (scheme?.toLowerCase() !== "basic" || !encoded) return undefined;
  const decoded = Buffer.from(encoded, "base64").toString("utf8");
  const token = decoded.split(":", 1)[0];
  return token.length > 0 ? token : undefined;
}
