import { describe, expect, it } from "vitest";
import { createPagarmeApp } from "../../src/server";
import { authedRequest } from "../helpers/authedRequest";

/**
 * End-to-end tokenize-then-pay: the flow every real integration uses, and the one
 * that silently approved everything before the minted-marker fix.
 *
 * The consuming app never sends the card number twice — it tokenizes once
 * (`POST /core/v5/tokens`), stores the opaque id, and pays with it. Since the
 * order payload then carries only `card_token`/`card_id`, the scenario has to
 * travel inside the minted id (`magic/cards.ts`, `outcomeMarker`). These tests
 * pin that: the tokenized payment must land on the SAME outcome as sending the
 * raw number, for every magic card.
 */

const HOLDER = { holder_name: "FULANO DE TAL", exp_month: 12, exp_year: 30, cvv: "123" };

/** Root/charge status the create route persists per magic card (`routes/orders.ts`). */
const SCENARIOS = [
  { number: "4000000000000010", status: "paid", success: true },
  { number: "4000000000000028", status: "authorized_pending_capture", success: true },
  { number: "4000000000000002", status: "failed", success: false },
  { number: "4000000000000036", status: "failed", success: false },
  { number: "4000000000000044", status: "failed", success: false },
] as const;

/** Tokenize `number` and return the minted `{ token, cardId }` pair. */
async function tokenize(app: ReturnType<typeof createPagarmeApp>, number: string) {
  const res = await authedRequest(app)
    .post("/core/v5/tokens?appId=pk_test_123")
    .send({ card: { number, ...HOLDER }, type: "card" });
  expect(res.status).toBe(201);
  return { token: res.body.id as string, cardId: res.body.card.id as string };
}

/** Pay with a tokenized identifier only — no raw card in the payload. */
function payWith(app: ReturnType<typeof createPagarmeApp>, creditCard: Record<string, unknown>) {
  return authedRequest(app)
    .post("/core/v5/orders")
    .send({
      payments: [{ amount: 1990, payment_method: "credit_card", credit_card: creditCard }],
      code: "PREFIXO_12345_a1b2c",
    });
}

describe("tokenize → pay reproduces the magic-card scenario", () => {
  for (const { number, status, success } of SCENARIOS) {
    it(`card_token minted from ${number} resolves to ${status}`, async () => {
      const app = createPagarmeApp();
      const { token } = await tokenize(app, number);

      const res = await payWith(app, { card_token: token, operation_type: "auth_and_capture" });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe(status);
      expect(res.body.charges[0].last_transaction.success).toBe(success);
    });

    it(`card_id minted from ${number} resolves to ${status}`, async () => {
      const app = createPagarmeApp();
      const { cardId } = await tokenize(app, number);

      const res = await payWith(app, { card_id: cardId, operation_type: "auth_and_capture" });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe(status);
      expect(res.body.charges[0].last_transaction.success).toBe(success);
    });
  }

  it("the outage card still fails at authorization, not at tokenization", async () => {
    const app = createPagarmeApp();
    // Tokenization always succeeds (`routes/tokens.ts`); the outage belongs to the
    // authorization, so the 5xx surfaces on the order.
    const { token } = await tokenize(app, "4000000000009999");

    const res = await payWith(app, { card_token: token });
    expect(res.status).toBe(503);
  });

  it("a card outside the catalog is declined, not approved", async () => {
    const app = createPagarmeApp();
    const { token } = await tokenize(app, "5555444433332222");

    const res = await payWith(app, { card_token: token });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("failed");
    expect(res.body.charges[0].last_transaction.success).toBe(false);
  });

  /**
   * The upsell/one-click flow: the consuming app charges once, stores the
   * `card.id` the order response returned, and replays it on the next charge.
   * The id it replays is minted by `POST /core/v5/orders`, not by tokenization,
   * so that id has to carry the scenario marker too — minting it bare sent every
   * upsell to DEFAULT_OUTCOME (`declined`) no matter which card paid the first
   * order.
   */
  for (const { number, status, success } of SCENARIOS) {
    it(`card.id returned by an order paid with ${number} replays to ${status}`, async () => {
      const app = createPagarmeApp();
      const { token } = await tokenize(app, number);

      const first = await payWith(app, { card_token: token, operation_type: "auth_and_capture" });
      expect(first.status).toBe(200);
      const cardId = first.body.charges[0].last_transaction.card.id as string;

      const upsell = await payWith(app, { card_id: cardId, operation_type: "auth_and_capture" });
      expect(upsell.status).toBe(200);
      expect(upsell.body.status).toBe(status);
      expect(upsell.body.charges[0].last_transaction.success).toBe(success);
    });
  }

  it("the card.id from a raw-number order replays as approved, not declined", async () => {
    const app = createPagarmeApp();

    const first = await payWith(app, {
      card: { number: "4000000000000010", ...HOLDER },
      operation_type: "auth_and_capture",
    });
    expect(first.body.status).toBe("paid");
    const cardId = first.body.charges[0].last_transaction.card.id as string;
    expect(cardId).toMatch(/^card_fake_approved_[0-9a-f]{32}$/);

    const upsell = await payWith(app, { card_id: cardId, operation_type: "auth_and_capture" });
    expect(upsell.body.status).toBe("paid");
    expect(upsell.body.charges[0].last_transaction.success).toBe(true);
  });

  it("keeps the minted ids opaque — no card number leaks into them", async () => {
    const app = createPagarmeApp();
    const { token, cardId } = await tokenize(app, "4000000000000002");

    expect(token).toMatch(/^token_fake_refused_[0-9a-f]{32}$/);
    expect(cardId).toMatch(/^card_fake_refused_[0-9a-f]{32}$/);
    for (const id of [token, cardId]) {
      expect(id).not.toContain("4000000000000002");
      expect(id).not.toContain("0002");
    }
  });
});
