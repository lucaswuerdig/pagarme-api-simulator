import { describe, expect, it } from "vitest";
import request from "supertest";
import { createPagarmeApp } from "../../src/server";

/**
 * Handler-level route tests (supertest against an app with a fresh in-memory
 * store). These cover the HTTP-status policy and the not-found body-error that
 * Task 06 owns; the full lifecycle/per-scenario flows live in the integration
 * suite. Each test builds its own app so the injected store starts empty.
 */

/** Minimal valid `POST /core/v5/orders` body for the given card number. */
function orderBody(number: string): Record<string, unknown> {
  return {
    payments: [
      {
        amount: 1990,
        payment_method: "credit_card",
        credit_card: {
          card: { number, holder_name: "FULANO DE TAL", exp_month: 12, exp_year: 30, cvv: "123" },
          operation_type: "auth_and_capture",
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

describe("POST /core/v5/orders — HTTP status policy (_idea.md §3.3)", () => {
  // Every business outcome returns 200; only the outage card returns 5xx.
  const businessCards: ReadonlyArray<[string, string]> = [
    ["4000000000000010", "approved_captured"],
    ["4000000000000028", "approved_no_capture"],
    ["4000000000000002", "declined"],
    ["4000000000000036", "transaction_error"],
    ["4000000000000044", "order_failed"],
  ];

  it.each(businessCards)("returns HTTP 200 for the %s card (%s)", async (number) => {
    const res = await request(createPagarmeApp()).post("/core/v5/orders").send(orderBody(number));
    expect(res.status).toBe(200);
  });

  it("returns HTTP 5xx (no body outcome) for the gateway_unavailable card", async () => {
    const res = await request(createPagarmeApp())
      .post("/core/v5/orders")
      .send(orderBody("4000000000009999"));
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(res.status).toBe(503);
  });

  // The persisted/returned root status drives the consuming app's success
  // predicate (`_idea.md` §3.1): approvals are non-failed, declines/errors/
  // failures are `failed`.
  const expectedRootStatus: ReadonlyArray<[string, string]> = [
    ["4000000000000010", "paid"],
    ["4000000000000028", "authorized_pending_capture"],
    ["4000000000000002", "failed"],
    ["4000000000000036", "failed"],
    ["4000000000000044", "failed"],
  ];

  it.each(expectedRootStatus)(
    "the %s card produces root status %s",
    async (number, status) => {
      const res = await request(createPagarmeApp())
        .post("/core/v5/orders")
        .send(orderBody(number));
      expect(res.body.status).toBe(status);
      expect(res.body.charges[0].status).toBe(status);
    },
  );

  it("defaults amount/code/metadata and resolves the happy path for an empty body", async () => {
    const res = await request(createPagarmeApp()).post("/core/v5/orders").send({});
    expect(res.status).toBe(200);
    // Unknown/absent card → DEFAULT_OUTCOME (approved_captured).
    expect(res.body.status).toBe("paid");
    expect(res.body.amount).toBe(0);
    expect(res.body.code).toBe("");
    expect(res.body.customer).toBeUndefined();
  });

  it("resolves the outcome from a tokenized card_id when no raw card is present", async () => {
    const res = await request(createPagarmeApp())
      .post("/core/v5/orders")
      .send({ payments: [{ amount: 500, credit_card: { card_id: "card_refused" } }], code: "X" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("failed");
    expect(res.body.charges[0].last_transaction.success).toBe(false);
  });
});

describe("capture/cancel against an unknown charge_id (_idea.md §3.3)", () => {
  it("POST capture returns HTTP 200 with a with_error / success:false body", async () => {
    const res = await request(createPagarmeApp())
      .post("/core/v5/charges/ch_fake_does_not_exist/capture")
      .send({ amount: 1990 });
    expect(res.status).toBe(200);
    expect(res.body.id).toBe("ch_fake_does_not_exist");
    expect(res.body.status).toBe("failed");
    expect(res.body.last_transaction.status).toBe("with_error");
    expect(res.body.last_transaction.success).toBe(false);
  });

  it("DELETE cancel returns HTTP 200 with a with_error / success:false body", async () => {
    const res = await request(createPagarmeApp()).delete("/core/v5/charges/ch_fake_missing");
    expect(res.status).toBe(200);
    expect(res.body.last_transaction.status).toBe("with_error");
    expect(res.body.last_transaction.success).toBe(false);
  });
});

describe("health and reset routes", () => {
  it("GET /health returns 200 { status: ok }", async () => {
    const res = await request(createPagarmeApp()).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("POST /__reset clears the store and returns 204", async () => {
    const res = await request(createPagarmeApp()).post("/__reset");
    expect(res.status).toBe(204);
    expect(res.body).toEqual({});
  });
});
