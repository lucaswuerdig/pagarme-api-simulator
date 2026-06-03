import { describe, expect, it } from "vitest";
import { resolveOutcome, type Outcome } from "../../src/magic/cards";
import {
  buildCancelResponse,
  buildCaptureResponse,
} from "../../src/responses/chargeResponse";
import { buildOrderResponse } from "../../src/responses/orderResponse";
import { buildTokenResponse } from "../../src/responses/tokenResponse";
import {
  newCardId,
  newChargeId,
  newOrderId,
} from "../../src/util/ids";
import type { ChargeStatus, Order, OrderRecord } from "../../src/types/pagarme";

// End-to-end across Task 04 (resolver) + Task 03 (ids) + Task 05 (builders): take an
// incoming card, resolve its outcome, mint the lifecycle ids the route would persist,
// and assert the assembled bodies carry the full ⭐ field set from `_idea.md` §8.

// The map of root status the route persists per outcome (drives record.status).
const ROOT_STATUS: Record<Exclude<Outcome, "gateway_unavailable">, ChargeStatus> = {
  approved_captured: "paid",
  approved_no_capture: "authorized_pending_capture",
  declined: "failed",
  transaction_error: "failed",
  order_failed: "failed",
};

// Build the persisted record exactly as the create route (Task 06) will, from a
// resolved outcome and freshly minted ids.
function persistRecordFor(outcome: Exclude<Outcome, "gateway_unavailable">): OrderRecord {
  return {
    orderId: newOrderId(),
    chargeId: newChargeId(),
    cardId: newCardId(),
    code: "PREFIXO_12345_a1b2c",
    amount: 1990,
    status: ROOT_STATUS[outcome],
    outcome,
    metadata: { site: "Minha Loja" },
  };
}

const cardInput = {
  number: "4000000000000010",
  holder_name: "FULANO DE TAL",
  exp_month: 12,
  exp_year: 30,
};

// The `_idea.md` §8 ⭐ checklist for the order-success body, asserted as field
// PRESENCE (a missing field breaks the consuming app downstream).
function assertOrderStarFields(order: Order): void {
  expect(order.id).toBeTruthy(); // id (raiz)
  expect(order.code).toBeTruthy(); // code (echoed)
  expect(order.status).toBeTruthy(); // status (raiz)
  const charge = order.charges[0];
  expect(charge.id).toBeTruthy(); // charges[0].id
  expect(typeof charge.amount).toBe("number"); // charges[0].amount
  const tx = charge.last_transaction;
  expect(tx.status).toBeTruthy(); // last_transaction.status
  expect(typeof tx.success).toBe("boolean"); // last_transaction.success
  expect(tx.card?.id).toBeTruthy(); // last_transaction.card.id
  expect(tx.acquirer_name).toBeTruthy(); // acquirer_name
  expect(tx.acquirer_return_code).toBeTruthy(); // acquirer_return_code
  expect(order.metadata.site).toBe("Minha Loja"); // metadata.site
}

function isBusinessSuccess(order: Order): boolean {
  const tx = order.charges[0]?.last_transaction;
  return order.status !== "failed" && tx?.status !== "with_error" && tx?.success !== false;
}

describe("§8 ⭐ checklist — order body per outcome (resolver → builder)", () => {
  const cases: ReadonlyArray<{
    number: string;
    outcome: Exclude<Outcome, "gateway_unavailable">;
    success: boolean;
  }> = [
    { number: "4000000000000010", outcome: "approved_captured", success: true },
    { number: "4000000000000028", outcome: "approved_no_capture", success: true },
    { number: "4000000000000002", outcome: "declined", success: false },
    { number: "4000000000000036", outcome: "transaction_error", success: false },
    { number: "4000000000000044", outcome: "order_failed", success: false },
  ];

  for (const { number, outcome, success } of cases) {
    it(`${outcome}: body contains the full ⭐ field set and the right success state`, () => {
      expect(resolveOutcome({ number })).toBe(outcome);

      const record = persistRecordFor(outcome);
      const order = buildOrderResponse(record, { card: cardInput });

      assertOrderStarFields(order);
      expect(isBusinessSuccess(order)).toBe(success);
    });
  }

  it("gateway_unavailable resolves but produces no order body (5xx route path)", () => {
    expect(resolveOutcome({ number: "4000000000009999" })).toBe("gateway_unavailable");
  });
});

describe("§8 ⭐ checklist — lifecycle: capture and cancel/refund", () => {
  it("pre-auth → capture: charge id, status != failed, last_transaction captured/success", () => {
    const record = persistRecordFor("approved_no_capture");
    const capture = buildCaptureResponse(record, { amount: record.amount });

    expect(capture.id).toBe(record.chargeId); // same charge id across the lifecycle (ADR-001)
    expect(capture.status).not.toBe("failed");
    expect(capture.last_transaction.status).toBe("captured");
    expect(capture.last_transaction.success).toBe(true);
  });

  it("sale → cancel: charge id, voided/success, canceled_amount recorded", () => {
    const record = persistRecordFor("approved_captured");
    const cancel = buildCancelResponse(record);

    expect(cancel.id).toBe(record.chargeId);
    expect(cancel.last_transaction.status).toBe("voided");
    expect(cancel.last_transaction.success).toBe(true);
    expect(cancel.canceled_amount).toBe(record.amount);
  });

  it("sale → refund: refunded/success, refunded_amount recorded", () => {
    const record = persistRecordFor("approved_captured");
    const refund = buildCancelResponse(record, { kind: "refund" });

    expect(refund.last_transaction.status).toBe("refunded");
    expect(refund.last_transaction.success).toBe(true);
    expect(refund.refunded_amount).toBe(record.amount);
  });
});

describe("§8 ⭐ checklist — token body", () => {
  it("carries token id and card.{id,first_six_digits,last_four_digits,brand}", () => {
    const token = buildTokenResponse({ card: cardInput, now: new Date("2026-05-29T12:00:00Z") });
    expect(token.id).toBeTruthy();
    expect(token.card.id).toBeTruthy();
    expect(token.card.first_six_digits).toBe("400000");
    expect(token.card.last_four_digits).toBe("0010");
    expect(token.card.brand).toBe("Visa");
  });
});
