/**
 * Magic-card outcome resolver (ADR-003).
 *
 * The single source of scenario truth: a pure, deterministic function mapping an
 * incoming card number — or a tokenized `card_id` / `card_token` — to one of six
 * outcomes. Every test result is reproducible from the request alone; there is no
 * runtime override (ADR-003). The response builders (Task 05) and routes
 * (Task 06) key their behaviour off the resolved {@link Outcome}.
 *
 * No I/O, no store access, no clock: same input → same outcome, always.
 */

/**
 * The six deterministic test scenarios (TechSpec "Core Interfaces"). Each trailing
 * comment records how the response builders translate the outcome onto the wire.
 */
export type Outcome =
  | "approved_captured" // 200, last_transaction.status=captured, success=true
  | "approved_no_capture" // 200, status=authorized_pending_capture, success=true
  | "declined" // 200, status=not_authorized, success=false, return_code=57
  | "transaction_error" // 200, last_transaction.status=with_error, success=false
  | "order_failed" // 200, root status=failed
  | "gateway_unavailable"; // 5xx

/**
 * Outcome for any unrecognized (or absent) card, so the common happy path needs
 * no special card number (TechSpec "Core Interfaces").
 */
export const DEFAULT_OUTCOME: Outcome = "approved_captured";

/**
 * Magic card numbers → outcome (`_idea.md` §5). This table is the canonical
 * scenario list; extend it with new reserved numbers if a gap appears (ADR-003).
 */
export const MAGIC_CARD_NUMBERS: Readonly<Record<string, Outcome>> = {
  "4000000000000010": "approved_captured",
  "4000000000000028": "approved_no_capture",
  "4000000000000002": "declined",
  "4000000000000036": "transaction_error",
  "4000000000000044": "order_failed",
  "4000000000009999": "gateway_unavailable",
};

/**
 * Scenario suffixes for the tokenized flows (`_idea.md` §5 suggests "ids mágicos
 * análogos, ex.: card_approved, card_refused"). The single source the
 * {@link MAGIC_TOKEN_IDS} table is built from.
 */
const TOKENIZED_OUTCOME_SUFFIXES: Readonly<Record<string, Outcome>> = {
  approved: "approved_captured",
  no_capture: "approved_no_capture",
  refused: "declined",
  error: "transaction_error",
  failed: "order_failed",
  unavailable: "gateway_unavailable",
};

/**
 * Tokenized magic ids → outcome. Each scenario is reachable via a `card_id`
 * (`card_…`) or a `card_token` (`token_…`), so `card_refused` and `token_refused`
 * both resolve to `declined` (`_idea.md` §5).
 */
export const MAGIC_TOKEN_IDS: Readonly<Record<string, Outcome>> = Object.fromEntries(
  Object.entries(TOKENIZED_OUTCOME_SUFFIXES).flatMap(([suffix, outcome]) => [
    [`card_${suffix}`, outcome] as const,
    [`token_${suffix}`, outcome] as const,
  ]),
);

/** Look up `key` in `table` by own-property, ignoring inherited keys. */
function lookup(table: Readonly<Record<string, Outcome>>, key?: string): Outcome | undefined {
  return key !== undefined && Object.hasOwn(table, key) ? table[key] : undefined;
}

/**
 * Resolve the deterministic {@link Outcome} for an incoming payment. Precedence:
 * the raw card `number` first, then the tokenized `cardId`, then `cardToken`. An
 * unrecognized or absent card falls back to {@link DEFAULT_OUTCOME}
 * (`approved_captured`).
 *
 * Pure and deterministic — no store, network, or clock access.
 */
export function resolveOutcome(input: {
  number?: string;
  cardId?: string;
  cardToken?: string;
}): Outcome {
  const { number, cardId, cardToken } = input;
  return (
    lookup(MAGIC_CARD_NUMBERS, number) ??
    lookup(MAGIC_TOKEN_IDS, cardId) ??
    lookup(MAGIC_TOKEN_IDS, cardToken) ??
    DEFAULT_OUTCOME
  );
}
