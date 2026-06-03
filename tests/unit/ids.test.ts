import { describe, expect, it } from "vitest";
import {
  ID_PREFIXES,
  mintId,
  newCardId,
  newChargeId,
  newOrderId,
  newTokenId,
  newTransactionId,
} from "../../src/util/ids";

describe("opaque ID minting", () => {
  const cases: ReadonlyArray<{ name: string; mint: () => string; pattern: RegExp }> = [
    { name: "order", mint: newOrderId, pattern: /^or_fake_[0-9a-f]{32}$/ },
    { name: "charge", mint: newChargeId, pattern: /^ch_fake_[0-9a-f]{32}$/ },
    { name: "card", mint: newCardId, pattern: /^card_fake_[0-9a-f]{32}$/ },
    { name: "transaction", mint: newTransactionId, pattern: /^tran_fake_[0-9a-f]{32}$/ },
    { name: "token", mint: newTokenId, pattern: /^token_fake_[0-9a-f]{32}$/ },
  ];

  for (const { name, mint, pattern } of cases) {
    it(`mints a ${name} id with the correct prefix and a random hex suffix`, () => {
      expect(mint()).toMatch(pattern);
    });

    it(`mints 1000 unique ${name} ids (collision check)`, () => {
      const ids = new Set<string>();
      for (let i = 0; i < 1000; i++) {
        ids.add(mint());
      }
      expect(ids.size).toBe(1000);
    });
  }

  it("exposes the five canonical prefixes", () => {
    expect(ID_PREFIXES).toEqual({
      order: "or_fake_",
      charge: "ch_fake_",
      card: "card_fake_",
      transaction: "tran_fake_",
      token: "token_fake_",
    });
  });

  it("mintId honours an explicit prefix", () => {
    expect(mintId(ID_PREFIXES.charge)).toMatch(/^ch_fake_[0-9a-f]{32}$/);
  });

  it("produces opaque, non-sequential suffixes (two mints differ)", () => {
    expect(newOrderId()).not.toBe(newOrderId());
  });
});
