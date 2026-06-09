import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createPagarmeApp } from "../../src/server";
import type { OrderStore } from "../../src/store/orderStore";
import { authedRequest } from "../helpers/authedRequest";

/**
 * End-to-end HTTP tests (supertest against the in-process app with the in-memory
 * store). They drive each magic-card scenario, the full sale→capture and
 * sale→cancel lifecycles against the stored `charge_id`, tokenization, health,
 * and the `/__reset` isolation helper — the acceptance contract for Task 06.
 *
 * Protected routes now sit behind the always-on token gate (ADR-001), so every
 * `/core/v5` and `/__reset` call goes through {@link authedRequest}, which presets
 * the `Authorization` header with the homologation `test_token`. `GET /health`
 * stays open and is called with a bare `request(...)`. The dedicated gate suite
 * below exercises the unauthenticated and unlisted-token rejections directly.
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
    const res = await authedRequest(createPagarmeApp())
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
    const res = await authedRequest(createPagarmeApp())
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
    const res = await authedRequest(createPagarmeApp())
      .post("/core/v5/orders")
      .send(orderBody("4000000000009999"));

    expect([500, 503]).toContain(res.status);
  });

  it("surfaces a store failure as a 5xx instead of hanging the request", async () => {
    // A store whose create() rejects, mirroring a Vercel KV outage. Without the
    // handler's try/catch this rejection would be an unhandled promise rejection
    // under Express 4 (no error middleware), and the request would hang until the
    // function times out (`_techspec.md` §"Error handling conventions": a KV
    // failure surfaces as a 5xx).
    const failingStore: OrderStore = {
      create: () => Promise.reject(new Error("KV unavailable")),
      get: () => Promise.resolve(undefined),
      update: () => Promise.resolve(undefined),
      clear: () => Promise.resolve(),
    };
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const res = await authedRequest(createPagarmeApp(failingStore))
        .post("/core/v5/orders")
        .send(orderBody("4000000000000010"));

      expect([500, 503]).toContain(res.status);
      expect(res.body.message).toBe("service unavailable");
      // The outage is logged so a real KV failure is diagnosable.
      expect(errorSpy).toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });
});

describe("charge lifecycle — capture resolves the stored charge_id", () => {
  it("pre-auth order (4000000000000028) → capture the returned id → 200 captured", async () => {
    const app: Express = createPagarmeApp();

    const created = await authedRequest(app)
      .post("/core/v5/orders")
      .send(orderBody("4000000000000028", "auth_only"));
    expect(created.status).toBe(200);
    expect(created.body.status).toBe("authorized_pending_capture");
    const chargeId: string = created.body.charges[0].id;

    const captured = await authedRequest(app)
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
  it("captured sale (4000000000000010) → DELETE → 200 refunded with refunded_amount", async () => {
    const app: Express = createPagarmeApp();

    const created = await authedRequest(app)
      .post("/core/v5/orders")
      .send(orderBody("4000000000000010"));
    expect(created.body.status).toBe("paid");
    const chargeId: string = created.body.charges[0].id;
    const amount: number = created.body.charges[0].amount;

    const canceled = await authedRequest(app).delete(`/core/v5/charges/${chargeId}`);

    expect(canceled.status).toBe(200);
    expect(canceled.body.id).toBe(chargeId);
    // A captured/`paid` sale is reversed as a refund, not a void (_idea.md §4.3).
    expect(canceled.body.status).toBe("refunded");
    expect(canceled.body.last_transaction.status).toBe("refunded");
    expect(canceled.body.last_transaction.operation_type).toBe("refund");
    expect(canceled.body.last_transaction.success).toBe(true);
    // Echoes the original amount saved at sale time (ADR-001).
    expect(canceled.body.amount).toBe(amount);
    expect(canceled.body.refunded_amount).toBe(amount);
  });

  it("uncaptured pre-auth (4000000000000028) → DELETE → 200 voided with canceled_amount", async () => {
    const app: Express = createPagarmeApp();

    const created = await authedRequest(app)
      .post("/core/v5/orders")
      .send(orderBody("4000000000000028", "auth_only"));
    expect(created.body.status).toBe("authorized_pending_capture");
    const chargeId: string = created.body.charges[0].id;
    const amount: number = created.body.charges[0].amount;

    const canceled = await authedRequest(app).delete(`/core/v5/charges/${chargeId}`);

    expect(canceled.status).toBe(200);
    expect(canceled.body.id).toBe(chargeId);
    // An authorization that was never captured is voided, not refunded.
    expect(canceled.body.status).toBe("canceled");
    expect(canceled.body.last_transaction.status).toBe("voided");
    expect(canceled.body.last_transaction.operation_type).toBe("void");
    expect(canceled.body.last_transaction.success).toBe(true);
    expect(canceled.body.amount).toBe(amount);
    expect(canceled.body.canceled_amount).toBe(amount);
  });
});

describe("POST /core/v5/tokens", () => {
  it("returns 200/201 with a token id and a card id (_idea.md §8)", async () => {
    const res = await authedRequest(createPagarmeApp())
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
  it("returns 200 { status: ok } without a token (open liveness probe)", async () => {
    const res = await request(createPagarmeApp()).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });
});

describe("POST /__reset isolates state", () => {
  it("capture against a pre-reset charge_id resolves as a not-found body error", async () => {
    const app: Express = createPagarmeApp();

    // Use an auth_only pre-auth so the charge is `authorized_pending_capture` and
    // therefore genuinely capturable — capture now gates on the persisted state
    // (Issue 004), so a captured-already `paid` sale would (correctly) be
    // rejected. This test only exercises reset isolation, not capture semantics.
    const created = await authedRequest(app)
      .post("/core/v5/orders")
      .send(orderBody("4000000000000028", "auth_only"));
    const chargeId: string = created.body.charges[0].id;

    // Capture succeeds before the reset (the charge exists and is capturable).
    const before = await authedRequest(app).post(`/core/v5/charges/${chargeId}/capture`).send({});
    expect(before.status).toBe(200);
    expect(before.body.last_transaction.status).toBe("captured");

    await authedRequest(app).post("/__reset").expect(204);

    // After the reset the charge is gone → body-level not-found error at 200.
    const after = await authedRequest(app).post(`/core/v5/charges/${chargeId}/capture`).send({});
    expect(after.status).toBe(200);
    expect(after.body.last_transaction.status).toBe("with_error");
    expect(after.body.last_transaction.success).toBe(false);
  });
});

describe("token gate enforcement on the protected surface (ADR-001/002/003)", () => {
  it("rejects POST /core/v5/orders with no Authorization header → 401 { error, message }", async () => {
    const res = await request(createPagarmeApp())
      .post("/core/v5/orders")
      .send(orderBody("4000000000000010"));

    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      error: "unauthorized",
      message: "A valid API token is required.",
    });
  });

  it("rejects POST /core/v5/orders carrying an unlisted token → 401", async () => {
    const bogus = `Basic ${Buffer.from("not_a_real_token:").toString("base64")}`;
    const res = await request(createPagarmeApp())
      .post("/core/v5/orders")
      .set("Authorization", bogus)
      .send(orderBody("4000000000000010"));

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("unauthorized");
  });

  it("accepts POST /core/v5/orders with the homologation test_token (happy path preserved)", async () => {
    const res = await authedRequest(createPagarmeApp())
      .post("/core/v5/orders")
      .send(orderBody("4000000000000010"));

    expect(res.status).toBe(200);
    expect(res.body.charges[0].last_transaction.success).toBe(true);
  });
});
