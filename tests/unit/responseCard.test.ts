import { describe, expect, it } from "vitest";
import { buildCard, DEFAULT_BRAND } from "../../src/responses/card";

describe("buildCard — display field derivation (Task 05.5)", () => {
  it("derives first_six/last_four from the card number and defaults brand to Visa", () => {
    const card = buildCard("card_fake_1", { number: "4000000000000010" });
    expect(card.id).toBe("card_fake_1");
    expect(card.first_six_digits).toBe("400000");
    expect(card.last_four_digits).toBe("0010");
    expect(card.brand).toBe(DEFAULT_BRAND);
    expect(DEFAULT_BRAND).toBe("Visa");
  });

  it("strips non-digit characters before slicing", () => {
    const card = buildCard("card_fake_1", { number: "4000 0000 0000 0028" });
    expect(card.first_six_digits).toBe("400000");
    expect(card.last_four_digits).toBe("0028");
  });

  it("echoes holder_name and expiry only when present", () => {
    const full = buildCard("card_fake_1", {
      number: "4000000000000010",
      holder_name: "FULANO DE TAL",
      exp_month: 12,
      exp_year: 30,
    });
    expect(full.holder_name).toBe("FULANO DE TAL");
    expect(full.exp_month).toBe(12);
    expect(full.exp_year).toBe(30);

    const bare = buildCard("card_fake_2");
    expect(bare).not.toHaveProperty("holder_name");
    expect(bare).not.toHaveProperty("exp_month");
    expect(bare).not.toHaveProperty("exp_year");
  });

  it("yields empty digit strings for tokenized flows with no raw number", () => {
    const card = buildCard("card_fake_3");
    expect(card.id).toBe("card_fake_3");
    expect(card.first_six_digits).toBe("");
    expect(card.last_four_digits).toBe("");
    expect(card.brand).toBe("Visa");
  });
});
