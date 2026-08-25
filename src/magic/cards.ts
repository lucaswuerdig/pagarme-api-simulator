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
 * Outcome for any unrecognized (or absent) card.
 *
 * Deliberately `declined`: a simulator that approves what it cannot identify
 * turns "scenario not implemented" into "test passed", which is how the
 * tokenized flow silently approved every magic card before the minted-marker
 * fix below. Approval must be asked for by name — one of the six numbers in
 * {@link MAGIC_CARD_NUMBERS}, or a minted/magic id that resolves to one.
 */
export const DEFAULT_OUTCOME: Outcome = "declined";

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

/**
 * Outcome → scenario suffix, derived from {@link TOKENIZED_OUTCOME_SUFFIXES} so
 * the two directions cannot drift. Used when minting a token/card id that has to
 * carry its scenario.
 */
const OUTCOME_TO_SUFFIX = Object.fromEntries(
  Object.entries(TOKENIZED_OUTCOME_SUFFIXES).map(([suffix, outcome]) => [outcome, suffix]),
) as Readonly<Record<Outcome, string>>;

/**
 * The scenario marker to embed in an id minted for `outcome` — the bridge
 * between tokenization and the later authorization.
 *
 * `POST /core/v5/tokens` resolves the outcome from the raw card number and mints
 * `token_fake_<marker>_<hex>`, so when the consuming app pays with that opaque
 * token the scenario is still readable. Without this, a real tokenize-then-pay
 * flow could never reach any scenario: the minted id matched nothing and every
 * payment fell through to {@link DEFAULT_OUTCOME}.
 */
export function outcomeMarker(outcome: Outcome): string {
  return OUTCOME_TO_SUFFIX[outcome];
}

/** Shape of an id minted by this service: `<card|token>_fake_<marker>_<32 hex>`. */
const MINTED_ID = /^(?:card|token)_fake_(.+)_[0-9a-f]{32}$/;

/**
 * Resolve the scenario carried by an id this service minted. Returns `undefined`
 * for a foreign id, for a minted id with no marker (the pre-fix shape), and for
 * an unknown marker — all of which then fall through to
 * {@link DEFAULT_OUTCOME}.
 */
function lookupMinted(id?: string): Outcome | undefined {
  const marker = id !== undefined ? MINTED_ID.exec(id)?.[1] : undefined;
  return marker !== undefined && Object.hasOwn(TOKENIZED_OUTCOME_SUFFIXES, marker)
    ? TOKENIZED_OUTCOME_SUFFIXES[marker]
    : undefined;
}

/** Look up `key` in `table` by own-property, ignoring inherited keys. */
function lookup(table: Readonly<Record<string, Outcome>>, key?: string): Outcome | undefined {
  return key !== undefined && Object.hasOwn(table, key) ? table[key] : undefined;
}

/**
 * Resolve the deterministic {@link Outcome} for an incoming payment. Precedence:
 * the raw card `number`, then a hand-written magic `cardId`/`cardToken`, then the
 * scenario marker of an id minted by this service. An unrecognized or absent card
 * falls back to {@link DEFAULT_OUTCOME} (`declined`).
 *
 * The minted-marker step is what makes the tokenized flow testable end to end:
 * paying with the token returned by `POST /core/v5/tokens` reproduces the same
 * outcome as paying with the card number it was minted from.
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
    lookupMinted(cardId) ??
    lookupMinted(cardToken) ??
    DEFAULT_OUTCOME
  );
}
