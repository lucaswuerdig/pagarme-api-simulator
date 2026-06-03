import { describe, expect, it } from "vitest";
import { resolveOutcome, type Outcome } from "../../src/magic/cards";
import { buildOrderResponse } from "../../src/responses/orderResponse";
import { newCardId, newChargeId, newOrderId } from "../../src/util/ids";
import type { ChargeStatus, Order, OrderRecord } from "../../src/types/pagarme";

// Task 05 landed: this suite now drives the REAL response builder (it previously
// used a local `buildOrderBodyFixture` stand-in). The resolver-output assertions
// are unchanged — they confirm the magic-card outcome drives the parser-relevant
// fields of the assembled order body end-to-end.

// Root status the create route persists per outcome (declines/errors/failures all
// set root `status: failed` per `_idea.md` §4.1).
const ROOT_STATUS: Record<Exclude<Outcome, "gateway_unavailable">, ChargeStatus> = {
  approved_captured: "paid",
  approved_no_capture: "authorized_pending_capture",
  declined: "failed",
  transaction_error: "failed",
  order_failed: "failed",
};

function recordFor(
  outcome: Exclude<Outcome, "gateway_unavailable">,
  req: { code: string; amount: number },
): OrderRecord {
  return {
    orderId: newOrderId(),
    chargeId: newChargeId(),
    cardId: newCardId(),
    code: req.code,
    amount: req.amount,
    status: ROOT_STATUS[outcome],
    outcome,
    metadata: { site: "Minha Loja" },
  };
}

function buildOrderBody(outcome: Outcome, req: { code: string; amount: number }): Order {
  if (outcome === "gateway_unavailable") {
    throw new Error("gateway_unavailable has no order body");
  }
  return buildOrderResponse(recordFor(outcome, req), {
    card: { number: "4000000000000002", holder_name: "FULANO DE TAL" },
  });
}

// The consuming app's success predicate over the raw body (`_idea.md` §3.1):
// root status != failed AND last_transaction.status != with_error AND success != false.
function isBusinessSuccess(order: Order): boolean {
  const tx = order.charges[0]?.last_transaction;
  return order.status !== "failed" && tx?.status !== "with_error" && tx?.success !== false;
}

describe("magic-card outcome → order body (resolver drives the real builder)", () => {
  const req = { code: "PREFIXO_12345_a1b2c", amount: 1990 };

  it("a declined card produces a body with success: false", () => {
    const outcome = resolveOutcome({ number: "4000000000000002" });
    expect(outcome).toBe("declined");

    const body = buildOrderBody(outcome, req);
    const tx = body.charges[0].last_transaction;
    expect(tx.success).toBe(false);
    expect(tx.status).toBe("not_authorized");
    expect(tx.acquirer_return_code).toBe("57");
    expect(isBusinessSuccess(body)).toBe(false);
  });

  it("a tokenized card_refused id also produces success: false", () => {
    const outcome = resolveOutcome({ cardId: "card_refused" });
    expect(outcome).toBe("declined");
    expect(buildOrderBody(outcome, req).charges[0].last_transaction.success).toBe(false);
  });

  it("the approved card produces an approved, captured body (positive control)", () => {
    const outcome = resolveOutcome({ number: "4000000000000010" });
    expect(outcome).toBe("approved_captured");

    const body = buildOrderBody(outcome, req);
    expect(body.status).not.toBe("failed");
    expect(body.charges[0].last_transaction.status).toBe("captured");
    expect(body.charges[0].last_transaction.success).toBe(true);
    expect(isBusinessSuccess(body)).toBe(true);
    expect(body.code).toBe(req.code);
    expect(body.metadata.site).toBe("Minha Loja");
  });

  it("the order-failed card produces a root status of failed", () => {
    const outcome = resolveOutcome({ number: "4000000000000044" });
    expect(outcome).toBe("order_failed");

    const body = buildOrderBody(outcome, req);
    expect(body.status).toBe("failed");
    expect(isBusinessSuccess(body)).toBe(false);
  });
});
