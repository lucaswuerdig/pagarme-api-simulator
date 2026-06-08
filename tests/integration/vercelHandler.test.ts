import { describe, expect, it } from "vitest";
import request from "supertest";
import handler from "../../api/index";

/**
 * Integration tests driving the exported Vercel handler (the Express app) with
 * supertest. On Vercel, `vercel.json` rewrites `/(.*)` → `/api` and the original
 * request URL reaches this handler unchanged, so sending the real `/core/v5/...`
 * paths here proves rewrite path equivalence: every Pagar.me route — including
 * the dynamic `charge_id` — resolves through the catch-all to this function
 * (ADR-006, TechSpec "API Endpoints").
 */
const CARD = {
  number: "4000000000000010",
  holder_name: "FULANO DE TAL",
  exp_month: 12,
  exp_year: 30,
  cvv: "123",
};

/** Minimal valid order request for the given card number (auth_and_capture). */
function orderBody(number: string): Record<string, unknown> {
  return {
    payments: [
      {
        amount: 1990,
        payment_method: "credit_card",
        credit_card: {
          card: { ...CARD, number },
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

describe("Vercel handler — routes resolve through the catch-all rewrite", () => {
  it("POST /core/v5/orders resolves and returns a contract body", async () => {
    const res = await request(handler).post("/core/v5/orders").send(orderBody("4000000000000010"));

    expect(res.status).toBe(200);
    // ⭐ contract fields the consuming app reads downstream (`_idea.md` §8).
    expect(res.body.id).toMatch(/^or_fake_/);
    expect(res.body.status).toBe("paid");
    expect(res.body.code).toBe("PREFIXO_12345_a1b2c");
    const charge = res.body.charges[0];
    expect(charge.id).toMatch(/^ch_fake_/);
    expect(charge.amount).toBe(1990);
    expect(charge.last_transaction.status).toBe("captured");
    expect(charge.last_transaction.success).toBe(true);
  });

  it("DELETE /core/v5/charges/:id reaches the cancel handler (dynamic param preserved)", async () => {
    // Create then cancel against the returned dynamic `charge_id`, proving the
    // `/core/v5/charges/{charge_id}` path resolves through the same handler with
    // the dynamic segment intact (not collapsed by the rewrite).
    const created = await request(handler)
      .post("/core/v5/orders")
      .send(orderBody("4000000000000010"));
    const chargeId: string = created.body.charges[0].id;

    const canceled = await request(handler).delete(`/core/v5/charges/${chargeId}`);

    expect(canceled.status).toBe(200);
    expect(canceled.body.id).toBe(chargeId);
    // The order was a captured/`paid` sale, so cancelling it reverses as a
    // refund (_idea.md §4.3); the point of this test is that the dynamic
    // `charge_id` reaches the cancel handler at all.
    expect(canceled.body.last_transaction.status).toBe("refunded");
    expect(canceled.body.last_transaction.success).toBe(true);
  });
});
