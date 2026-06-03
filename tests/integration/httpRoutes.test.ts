import { describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createPagarmeApp } from "../../src/server";

/**
 * End-to-end HTTP tests (supertest against the in-process app with the in-memory
 * store). They drive each magic-card scenario, the full sale→capture and
 * sale→cancel lifecycles against the stored `charge_id`, tokenization, health,
 * and the `/__reset` isolation helper — the acceptance contract for Task 06.
 *
 * Each `app` is freshly created so its injected store starts empty; lifecycle
 * tests reuse a single app so state persists across the request sequence.
 */

const CARD = {
  number: "4000000000000010",
  holder_name: "FULANO DE TAL",
  exp_month: 12,
  exp_year: 30,
  cvv: "123",
};

/** Minimal valid order request for `card` number with the given operation type. */
function orderBody(number: string, operationType = "auth_and_capture"): Record<string, unknown> {
  return {
    payments: [
      {
        amount: 1990,
        payment_method: "credit_card",
        credit_card: {
          card: { ...CARD, number },
          operation_type: operationType,
          installments: 1,
          statement_descriptor: "APPMAX*LOJA",
        },
      },
    ],
    code: "PREFIXO_12345_a1b2c",
    customer: { name: "Fulano De Tal", email: "fulano@example.com" },
    metadata: { site: "Minha Loja" },
    closed: true,
  };
}

describe("POST /core/v5/orders — per-scenario outcomes", () => {
  it("approves and captures the 4000000000000010 card (200, success:true)", async () => {
    const res = await request(createPagarmeApp())
      .post("/core/v5/orders")
      .send(orderBody("4000000000000010"));

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("paid");
    const tx = res.body.charges[0].last_transaction;
    expect(tx.status).toBe("captured");
    expect(tx.success).toBe(true);
    // ⭐ fields the consuming app reads downstream (`_idea.md` §8).
    expect(res.body.id).toMatch(/^or_fake_/);
    expect(res.body.code).toBe("PREFIXO_12345_a1b2c");
    expect(res.body.charges[0].id).toMatch(/^ch_fake_/);
    expect(res.body.charges[0].amount).toBe(1990);
    expect(tx.card.id).toMatch(/^card_fake_/);
    expect(tx.acquirer_name).toBe("cielo");
    expect(tx.acquirer_return_code).toBe("00");
    expect(res.body.metadata.site).toBe("Minha Loja");
  });

  it("declines the 4000000000000002 card (200, not_authorized/success:false)", async () => {
    const res = await request(createPagarmeApp())
      .post("/core/v5/orders")
      .send(orderBody("4000000000000002"));

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("failed");
    const tx = res.body.charges[0].last_transaction;
    expect(tx.status).toBe("not_authorized");
    expect(tx.success).toBe(false);
    expect(tx.acquirer_return_code).toBe("57");
  });

  it("returns HTTP 500/503 for the 4000000000009999 outage card", async () => {
    const res = await request(createPagarmeApp())
      .post("/core/v5/orders")
      .send(orderBody("4000000000009999"));

    expect([500, 503]).toContain(res.status);
  });
});

describe("charge lifecycle — capture resolves the stored charge_id", () => {
  it("pre-auth order (4000000000000028) → capture the returned id → 200 captured", async () => {
    const app: Express = createPagarmeApp();

    const created = await request(app)
      .post("/core/v5/orders")
      .send(orderBody("4000000000000028", "auth_only"));
    expect(created.status).toBe(200);
    expect(created.body.status).toBe("authorized_pending_capture");
    const chargeId: string = created.body.charges[0].id;

    const captured = await request(app)
      .post(`/core/v5/charges/${chargeId}/capture`)
      .send({ amount: 1990 });

    expect(captured.status).toBe(200);
    expect(captured.body.id).toBe(chargeId);
    expect(captured.body.status).not.toBe("failed");
    expect(captured.body.last_transaction.status).toBe("captured");
    expect(captured.body.last_transaction.success).toBe(true);
  });
});

describe("charge lifecycle — cancel resolves the stored charge_id and amount", () => {
  it("sale (4000000000000010) → DELETE → 200 voided with canceled_amount", async () => {
    const app: Express = createPagarmeApp();

    const created = await request(app)
      .post("/core/v5/orders")
      .send(orderBody("4000000000000010"));
    const chargeId: string = created.body.charges[0].id;
    const amount: number = created.body.charges[0].amount;

    const canceled = await request(app).delete(`/core/v5/charges/${chargeId}`);

    expect(canceled.status).toBe(200);
    expect(canceled.body.id).toBe(chargeId);
    expect(canceled.body.last_transaction.status).toBe("voided");
    expect(canceled.body.last_transaction.success).toBe(true);
    // Echoes the original amount saved at sale time (ADR-001).
    expect(canceled.body.amount).toBe(amount);
    expect(canceled.body.canceled_amount).toBe(amount);
  });
});

describe("POST /core/v5/tokens", () => {
  it("returns 200/201 with a token id and a card id (_idea.md §8)", async () => {
    const res = await request(createPagarmeApp())
      .post("/core/v5/tokens?appId=pk_test_123")
      .send({ card: CARD, type: "card" });

    expect([200, 201]).toContain(res.status);
    expect(res.body.id).toMatch(/^token_fake_/);
    expect(res.body.card.id).toMatch(/^card_fake_/);
    expect(res.body.card.first_six_digits).toBe("400000");
    expect(res.body.card.last_four_digits).toBe("0010");
    expect(res.body.card.brand).toBe("Visa");
  });
});

describe("GET /health", () => {
  it("returns 200 { status: ok }", async () => {
    const res = await request(createPagarmeApp()).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });
});

describe("POST /__reset isolates state", () => {
  it("capture against a pre-reset charge_id resolves as a not-found body error", async () => {
    const app: Express = createPagarmeApp();

    const created = await request(app)
      .post("/core/v5/orders")
      .send(orderBody("4000000000000010"));
    const chargeId: string = created.body.charges[0].id;

    // Capture succeeds before the reset (the charge exists).
    const before = await request(app).post(`/core/v5/charges/${chargeId}/capture`).send({});
    expect(before.status).toBe(200);
    expect(before.body.last_transaction.status).toBe("captured");

    await request(app).post("/__reset").expect(204);

    // After the reset the charge is gone → body-level not-found error at 200.
    const after = await request(app).post(`/core/v5/charges/${chargeId}/capture`).send({});
    expect(after.status).toBe(200);
    expect(after.body.last_transaction.status).toBe("with_error");
    expect(after.body.last_transaction.success).toBe(false);
  });
});

describe("Authorization header is ignored (_idea.md §2)", () => {
  it("an order with no/invalid Authorization header still succeeds", async () => {
    const noAuth = await request(createPagarmeApp())
      .post("/core/v5/orders")
      .send(orderBody("4000000000000010"));
    expect(noAuth.status).toBe(200);

    const badAuth = await request(createPagarmeApp())
      .post("/core/v5/orders")
      .set("Authorization", "Bearer not-a-real-key")
      .send(orderBody("4000000000000010"));
    expect(badAuth.status).toBe(200);
    expect(badAuth.body.charges[0].last_transaction.success).toBe(true);
  });
});
