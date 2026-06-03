/**
 * Shared building blocks for the response builders (Task 05).
 *
 * Card display fields are derived from the request card number, and the acquirer
 * identity is a fixed fake-gateway constant. Both the order, charge, and token
 * builders reuse these so the ⭐ card/acquirer fields stay consistent across
 * every response shape (`_idea.md` §4, §8). Pure: no I/O, no clock, no store.
 */

import type { Card } from "../types/pagarme";

/**
 * Default card brand. The fake performs no real BIN lookup, so every derived
 * card reports `Visa` (`_idea.md` §4.1; Task 05 requirement). Override only if a
 * future magic card needs a different brand.
 */
export const DEFAULT_BRAND = "Visa";

/** Fake acquirer identity returned on every transaction (`_idea.md` §4.1). */
export const ACQUIRER_NAME = "cielo";

/** Static acquirer TID/NSU/auth-code echoed on approved transactions (`_idea.md` §4.1). */
export const ACQUIRER_TID = "1234567890";
export const ACQUIRER_NSU = "123456";
export const ACQUIRER_AUTH_CODE = "123456";

/** The subset of request card fields the builders read to derive display metadata. */
export interface CardSource {
  number?: string;
  holder_name?: string;
  exp_month?: number;
  exp_year?: number;
}

/**
 * Assemble the {@link Card} metadata block for a transaction or token response.
 *
 * `first_six_digits`/`last_four_digits` are derived from the digits of the
 * request card number; `brand` defaults to {@link DEFAULT_BRAND}. Holder name and
 * expiry are echoed only when the request supplied them — tokenized order flows
 * carry no raw card, so those fields (and the derived digits) are simply absent
 * or empty, while the always-present `id` remains the ⭐ instant-buy key
 * (`_idea.md` §8).
 */
export function buildCard(cardId: string, source: CardSource = {}): Card {
  const digits = (source.number ?? "").replace(/\D/g, "");
  const card: Card = {
    id: cardId,
    first_six_digits: digits.slice(0, 6),
    last_four_digits: digits.slice(-4),
    brand: DEFAULT_BRAND,
  };
  if (source.holder_name !== undefined) {
    card.holder_name = source.holder_name;
  }
  if (source.exp_month !== undefined) {
    card.exp_month = source.exp_month;
  }
  if (source.exp_year !== undefined) {
    card.exp_year = source.exp_year;
  }
  return card;
}
