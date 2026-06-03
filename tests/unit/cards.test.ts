import { describe, expect, it } from "vitest";
import {
  DEFAULT_OUTCOME,
  MAGIC_CARD_NUMBERS,
  MAGIC_TOKEN_IDS,
  type Outcome,
  resolveOutcome,
} from "../../src/magic/cards";

// The canonical magic-card table from `_idea.md` §5. Driving the resolver from
// this list keeps the test and the spec in lock-step: every row must map to the
// outcome named here.
const MAGIC_CARD_ROWS: ReadonlyArray<{ number: string; outcome: Outcome }> = [
  { number: "4000000000000010", outcome: "approved_captured" },
  { number: "4000000000000028", outcome: "approved_no_capture" },
  { number: "4000000000000002", outcome: "declined" },
  { number: "4000000000000036", outcome: "transaction_error" },
  { number: "4000000000000044", outcome: "order_failed" },
  { number: "4000000000009999", outcome: "gateway_unavailable" },
];

describe("resolveOutcome — magic card numbers (_idea.md §5)", () => {
  for (const { number, outcome } of MAGIC_CARD_ROWS) {
    it(`maps ${number} to ${outcome}`, () => {
      expect(resolveOutcome({ number })).toBe(outcome);
    });
  }

  it("covers every row of the documented table and nothing more", () => {
    expect(MAGIC_CARD_NUMBERS).toEqual(
      Object.fromEntries(MAGIC_CARD_ROWS.map((r) => [r.number, r.outcome])),
    );
  });
});

describe("resolveOutcome — default fallback", () => {
  it("defaults an unrecognized number to approved_captured", () => {
    expect(resolveOutcome({ number: "5555444433332222" })).toBe("approved_captured");
    expect(DEFAULT_OUTCOME).toBe("approved_captured");
  });

  it("defaults when no card identifier is supplied", () => {
    expect(resolveOutcome({})).toBe("approved_captured");
  });

  it("does not treat inherited Object keys as magic cards", () => {
    // `Object.hasOwn` guards against a card number/id like "constructor" or
    // "toString" falsely matching an inherited prototype property.
    expect(resolveOutcome({ number: "constructor" })).toBe("approved_captured");
    expect(resolveOutcome({ cardId: "toString" })).toBe("approved_captured");
  });
});

describe("resolveOutcome — tokenized magic ids", () => {
  it("maps a tokenized card_id (card_refused) to declined", () => {
    expect(resolveOutcome({ cardId: "card_refused" })).toBe("declined");
  });

  it("maps a tokenized card_token (token_refused) to declined", () => {
    expect(resolveOutcome({ cardToken: "token_refused" })).toBe("declined");
  });

  it("resolves every tokenized scenario via both card_ and token_ prefixes", () => {
    const expectations: ReadonlyArray<{ suffix: string; outcome: Outcome }> = [
      { suffix: "approved", outcome: "approved_captured" },
      { suffix: "no_capture", outcome: "approved_no_capture" },
      { suffix: "refused", outcome: "declined" },
      { suffix: "error", outcome: "transaction_error" },
      { suffix: "failed", outcome: "order_failed" },
      { suffix: "unavailable", outcome: "gateway_unavailable" },
    ];
    for (const { suffix, outcome } of expectations) {
      expect(resolveOutcome({ cardId: `card_${suffix}` })).toBe(outcome);
      expect(resolveOutcome({ cardToken: `token_${suffix}` })).toBe(outcome);
    }
  });

  it("defaults an unrecognized tokenized id to approved_captured", () => {
    expect(resolveOutcome({ cardId: "card_unknown" })).toBe("approved_captured");
    expect(resolveOutcome({ cardToken: "token_unknown" })).toBe("approved_captured");
  });

  it("exposes both prefixes for the six tokenized scenarios", () => {
    expect(Object.keys(MAGIC_TOKEN_IDS).sort()).toEqual(
      [
        "card_approved",
        "card_error",
        "card_failed",
        "card_no_capture",
        "card_refused",
        "card_unavailable",
        "token_approved",
        "token_error",
        "token_failed",
        "token_no_capture",
        "token_refused",
        "token_unavailable",
      ].sort(),
    );
  });
});

describe("resolveOutcome — precedence", () => {
  it("prefers the card number over a tokenized id", () => {
    // A real number wins even if a (magic) tokenized id is also present.
    expect(resolveOutcome({ number: "4000000000000002", cardId: "card_approved" })).toBe(
      "declined",
    );
  });

  it("prefers card_id over card_token when both are tokenized magic ids", () => {
    expect(resolveOutcome({ cardId: "card_refused", cardToken: "token_approved" })).toBe(
      "declined",
    );
  });

  it("falls through to card_token when card_id is not a magic id", () => {
    expect(resolveOutcome({ cardId: "card_real_xyz", cardToken: "token_refused" })).toBe(
      "declined",
    );
  });

  it("is pure — the same input always yields the same outcome", () => {
    const input = { number: "4000000000000028" };
    expect(resolveOutcome(input)).toBe(resolveOutcome(input));
  });
});
