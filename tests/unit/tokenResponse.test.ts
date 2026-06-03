import { describe, expect, it } from "vitest";
import { buildTokenResponse } from "../../src/responses/tokenResponse";

const cardInput = {
  number: "4000000000000010",
  holder_name: "FULANO DE TAL",
  exp_month: 12,
  exp_year: 30,
};

// A fixed clock so created_at/expires_at are deterministic (the builder is pure).
const NOW = new Date("2026-05-29T12:00:00.000Z");

describe("buildTokenResponse — token success (_idea.md §4.4, §8)", () => {
  it("carries the token id and the ⭐ card metadata fields", () => {
    const token = buildTokenResponse({ card: cardInput, now: NOW });

    expect(token.id).toMatch(/^token_fake_[0-9a-f]{32}$/);
    expect(token.type).toBe("card");
    expect(token.card.id).toMatch(/^card_fake_[0-9a-f]{32}$/);
    expect(token.card.first_six_digits).toBe("400000");
    expect(token.card.last_four_digits).toBe("0010");
    expect(token.card.brand).toBe("Visa");
    expect(token.card.holder_name).toBe("FULANO DE TAL");
  });

  it("sets created_at to now and expires_at one hour later", () => {
    const token = buildTokenResponse({ card: cardInput, now: NOW });
    expect(token.created_at).toBe("2026-05-29T12:00:00.000Z");
    expect(token.expires_at).toBe("2026-05-29T13:00:00.000Z");
  });

  it("honours an explicit request type", () => {
    expect(buildTokenResponse({ card: cardInput, now: NOW, type: "bank_account" }).type).toBe(
      "bank_account",
    );
  });

  it("accepts overridden token/card ids for deterministic callers", () => {
    const token = buildTokenResponse({
      card: cardInput,
      now: NOW,
      tokenId: "token_fake_fixed",
      cardId: "card_fake_fixed",
    });
    expect(token.id).toBe("token_fake_fixed");
    expect(token.card.id).toBe("card_fake_fixed");
  });
});
