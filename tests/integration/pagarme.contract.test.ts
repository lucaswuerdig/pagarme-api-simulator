import { describe, expect, it } from "vitest";
import type { Charge } from "../../src/types/pagarme";

/**
 * Type-shape conformance fixtures: the capture (`_idea.md` §4.2) and cancel
 * (`_idea.md` §4.3) responses are bare charge objects (not wrapped in
 * `charges[]`). Typing them as `Charge` proves the interface the Task 05
 * builders will emit against type-checks for both lifecycle responses — the
 * compile-time guarantee is enforced by `npm run typecheck`.
 */

// `_idea.md` §4.2 — successful capture of a prior authorization.
const captureResponse: Charge = {
  id: "ch_fake_0001",
  code: "PREFIXO_12345_a1b2c",
  amount: 1990,
  status: "paid",
  payment_method: "credit_card",
  last_transaction: {
    id: "tran_capture_0001",
    transaction_type: "credit_card",
    amount: 1990,
    status: "captured",
    success: true,
    operation_type: "capture",
    acquirer_name: "cielo",
    acquirer_return_code: "00",
    acquirer_tid: "1234567890",
    acquirer_nsu: "123456",
    card: {
      id: "card_fake_0001",
      first_six_digits: "400000",
      last_four_digits: "0010",
      brand: "Visa",
    },
  },
};

// `_idea.md` §4.3 — full cancellation; note `last_transaction` carries no `card`.
const cancelResponse: Charge = {
  id: "ch_fake_0001",
  code: "PREFIXO_12345_a1b2c",
  amount: 1990,
  status: "canceled",
  payment_method: "credit_card",
  canceled_amount: 1990,
  last_transaction: {
    id: "tran_cancel_0001",
    transaction_type: "credit_card",
    amount: 1990,
    status: "voided",
    success: true,
    operation_type: "void",
    acquirer_name: "cielo",
    acquirer_return_code: "00",
  },
};

describe("capture response conforms to Charge (_idea.md §4.2)", () => {
  it("keeps the charge id, a non-failed status, and a captured success transaction", () => {
    expect(captureResponse.id).toBe("ch_fake_0001");
    expect(captureResponse.status).not.toBe("failed");
    expect(captureResponse.last_transaction.status).toBe("captured");
    expect(captureResponse.last_transaction.success).toBe(true);
  });
});

describe("cancel response conforms to Charge (_idea.md §4.3)", () => {
  it("keeps the charge id, a voided success transaction, and the canceled amount", () => {
    expect(cancelResponse.id).toBe("ch_fake_0001");
    expect(cancelResponse.last_transaction.status).toBe("voided");
    expect(cancelResponse.last_transaction.success).toBe(true);
    expect(cancelResponse.canceled_amount).toBe(1990);
    // The cancel transaction legitimately omits `card` (optional on Transaction).
    expect(cancelResponse.last_transaction.card).toBeUndefined();
  });
});
