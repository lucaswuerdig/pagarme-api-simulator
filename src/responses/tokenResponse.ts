/**
 * `POST /core/v5/tokens` response builder (`_idea.md` §4.4, §8).
 *
 * Tokenization is stateless beyond echoing the card metadata (TechSpec "Data
 * Flow"): there is no {@link OrderRecord} to read, so the builder mints a fresh
 * `token`/`card` id pair per call and derives the ⭐ card display fields
 * (`first_six_digits`/`last_four_digits`/`brand`) from the request card.
 *
 * Pure: the wall clock is injected as `now` (no internal clock access) so the
 * `created_at`/`expires_at` timestamps are deterministic under test. The route
 * (Task 06) passes the real `new Date()`.
 */

import type { Token } from "../types/pagarme";
import { newCardId, newTokenId } from "../util/ids";
import { buildCard, type CardSource } from "./card";

/** Token lifetime: `expires_at` is one hour after `created_at` (`_idea.md` §4.4 example). */
const TOKEN_TTL_MS = 60 * 60 * 1000;

/** Inputs the token body is assembled from (`_idea.md` §4.4 request `{ card, type }`). */
export interface TokenResponseInput {
  /** `card` block from the request — the source of the derived display fields. */
  card?: CardSource;
  /** Request `type`; defaults to `card`. */
  type?: string;
  /** Injected wall clock used for `created_at`/`expires_at` (kept the builder pure). */
  now: Date;
  /** Override the minted token id (e.g. for deterministic tests). */
  tokenId?: string;
  /** Override the minted card id (e.g. for deterministic tests). */
  cardId?: string;
}

/**
 * Assemble the `POST /core/v5/tokens` response body: a token `id`, `type`,
 * `created_at`/`expires_at` timestamps, and the ⭐ `card` metadata block
 * (`id`, `first_six_digits`, `last_four_digits`, `brand`, `_idea.md` §8).
 */
export function buildTokenResponse(input: TokenResponseInput): Token {
  const createdAt = input.now;
  const expiresAt = new Date(createdAt.getTime() + TOKEN_TTL_MS);
  return {
    id: input.tokenId ?? newTokenId(),
    type: input.type ?? "card",
    created_at: createdAt.toISOString(),
    expires_at: expiresAt.toISOString(),
    card: buildCard(input.cardId ?? newCardId(), input.card),
  };
}
