import { describe, expect, it } from "vitest";
import {
  CHARGE_STATUSES,
  type ChargeStatus,
  type Order,
  type OrderRecord,
  type OrderRequest,
  type Token,
} from "../../src/types/pagarme";

// A hand-written success order from `_idea.md` §4.1. Typing it as `Order` makes
// the assignment a compile-time conformance assertion (enforced by `npm run
// typecheck`); the runtime asserts below confirm the ⭐ fields are reachable.
const successOrder: Order = {
  id: "or_fake_0001",
  code: "PREFIXO_12345_a1b2c",
  status: "paid",
  amount: 1990,
  currency: "BRL",
  closed: true,
  customer: { id: "cus_fake_0001", name: "Fulano De Tal", email: "fulano@example.com" },
  charges: [
    {
      id: "ch_fake_0001",
      code: "PREFIXO_12345_a1b2c",
      amount: 1990,
      status: "paid",
      payment_method: "credit_card",
      last_transaction: {
        id: "tran_fake_0001",
        transaction_type: "credit_card",
        amount: 1990,
        status: "captured",
        success: true,
        installments: 1,
        operation_type: "auth_and_capture",
        statement_descriptor: "APPMAX*LOJA",
        acquirer_name: "cielo",
        acquirer_tid: "1234567890",
        acquirer_nsu: "123456",
        acquirer_auth_code: "123456",
        acquirer_return_code: "00",
        gateway_id: "gw_0001",
        card: {
          id: "card_fake_0001",
          first_six_digits: "400000",
          last_four_digits: "0010",
          brand: "Visa",
          holder_name: "FULANO DE TAL",
          exp_month: 12,
          exp_year: 30,
        },
      },
    },
  ],
  metadata: { site: "Minha Loja" },
};

describe("ChargeStatus / CHARGE_STATUSES", () => {
  it("enumerates exactly the five lifecycle statuses from the TechSpec", () => {
    expect(CHARGE_STATUSES).toEqual([
      "paid",
      "authorized_pending_capture",
      "canceled",
      "refunded",
      "failed",
    ]);
  });

  it("admits each union member as a ChargeStatus value", () => {
    for (const status of CHARGE_STATUSES) {
      const value: ChargeStatus = status;
      expect(CHARGE_STATUSES).toContain(value);
    }
  });

  it("rejects a value outside the ChargeStatus union at compile time", () => {
    // @ts-expect-error "bogus" is not a member of the ChargeStatus union.
    const bad: ChargeStatus = "bogus";
    expect(bad).toBe("bogus"); // harmless at runtime; the type error is the assertion
  });
});

describe("Order response shape (_idea.md §4.1 success)", () => {
  it("exposes every ⭐ field the consuming app reads downstream", () => {
    expect(successOrder.id).toBe("or_fake_0001");
    expect(successOrder.code).toBe("PREFIXO_12345_a1b2c");
    expect(successOrder.status).not.toBe("failed");

    const charge = successOrder.charges[0];
    expect(charge.id).toBe("ch_fake_0001");
    expect(charge.amount).toBe(1990);

    const tx = charge.last_transaction;
    expect(tx.status).toBe("captured");
    expect(tx.success).toBe(true);
    expect(tx.card?.id).toBe("card_fake_0001");
    expect(tx.acquirer_name).toBe("cielo");
    expect(tx.acquirer_return_code).toBe("00");

    expect(successOrder.metadata.site).toBe("Minha Loja");
  });
});

describe("OrderRecord internal shape", () => {
  it("accepts a fully populated record", () => {
    const record: OrderRecord = {
      orderId: "or_fake_0001",
      chargeId: "ch_fake_0001",
      cardId: "card_fake_0001",
      code: "PREFIXO_12345_a1b2c",
      amount: 1990,
      status: "paid",
      outcome: "approved_captured",
      metadata: { site: "Minha Loja" },
    };
    expect(record.chargeId).toBe("ch_fake_0001");
    expect(record.outcome).toBe("approved_captured");
  });

  it("requires the outcome field (omitting it is a type error)", () => {
    // @ts-expect-error `outcome` is required on OrderRecord.
    const incomplete: OrderRecord = {
      orderId: "or_fake_0002",
      chargeId: "ch_fake_0002",
      cardId: "card_fake_0002",
      code: "PREFIXO_12345_x9y8z",
      amount: 1990,
      status: "failed",
      metadata: {},
    };
    expect(incomplete.orderId).toBe("or_fake_0002");
  });
});

describe("Loose request types", () => {
  it("reads only the fields the service consumes from an order request", () => {
    const req: OrderRequest = {
      payments: [
        {
          amount: 1990,
          payment_method: "credit_card",
          credit_card: {
            card: { number: "4000000000000010", holder_name: "FULANO DE TAL" },
            operation_type: "auth_and_capture",
            installments: 1,
          },
        },
      ],
      code: "PREFIXO_12345_a1b2c",
      metadata: { site: "Minha Loja" },
      // Extra fields the app sends are tolerated via the index signature.
      customer: { name: "Fulano De Tal" },
    };

    const payment = req.payments?.[0];
    expect(payment?.amount).toBe(1990);
    expect(payment?.credit_card?.card?.number).toBe("4000000000000010");
    expect(payment?.credit_card?.operation_type).toBe("auth_and_capture");
    expect(payment?.credit_card?.installments).toBe(1);
    expect(req.code).toBe("PREFIXO_12345_a1b2c");
    expect(req.metadata?.site).toBe("Minha Loja");
  });

  it("accepts the tokenized card_id / card_token variants", () => {
    const byId: OrderRequest = {
      payments: [{ credit_card: { card_id: "card_fake_0001" } }],
    };
    const byToken: OrderRequest = {
      payments: [{ credit_card: { card_token: "token_fake_0001" } }],
    };
    expect(byId.payments?.[0]?.credit_card?.card_id).toBe("card_fake_0001");
    expect(byToken.payments?.[0]?.credit_card?.card_token).toBe("token_fake_0001");
  });
});

describe("Token response shape (_idea.md §4.4)", () => {
  it("carries the token id and the ⭐ card metadata fields", () => {
    const token: Token = {
      id: "token_fake_0001",
      type: "card",
      created_at: "2026-05-29T12:00:00Z",
      expires_at: "2026-05-29T13:00:00Z",
      card: {
        id: "card_fake_0001",
        first_six_digits: "400000",
        last_four_digits: "0010",
        brand: "Visa",
      },
    };
    expect(token.id).toBe("token_fake_0001");
    expect(token.card.id).toBe("card_fake_0001");
    expect(token.card.first_six_digits).toBe("400000");
    expect(token.card.last_four_digits).toBe("0010");
    expect(token.card.brand).toBe("Visa");
  });
});
