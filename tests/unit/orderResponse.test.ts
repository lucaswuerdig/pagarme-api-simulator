import { describe, expect, it } from "vitest";
import { buildOrderResponse } from "../../src/responses/orderResponse";
import type { Outcome } from "../../src/magic/cards";
import type { Order, OrderRecord } from "../../src/types/pagarme";
import { makeSampleRecord } from "../contract/orderStoreContract";

// A record as the route persists it on create: the lifecycle ids/code/amount the
// order body echoes, plus the resolved magic-card `outcome` that drives the shape.
function recordFor(outcome: Outcome, overrides: Partial<OrderRecord> = {}): OrderRecord {
  return makeSampleRecord({ outcome, ...overrides });
}

// The consuming app's success predicate over the raw body (`_idea.md` §3.1):
// root status != failed AND last_transaction.status != with_error AND success != false.
function isBusinessSuccess(order: Order): boolean {
  const tx = order.charges[0]?.last_transaction;
  return order.status !== "failed" && tx?.status !== "with_error" && tx?.success !== false;
}

const newCardInput = {
  number: "4000000000000010",
  holder_name: "FULANO DE TAL",
  exp_month: 12,
  exp_year: 30,
};

describe("buildOrderResponse — success outcomes (_idea.md §3.1, §4.1)", () => {
  it("approved_captured: root status != failed, last_transaction captured/success, card.id present", () => {
    const record = recordFor("approved_captured", { status: "paid" });
    const order = buildOrderResponse(record, { card: newCardInput });

    expect(order.status).not.toBe("failed");
    expect(order.status).toBe("paid");
    const tx = order.charges[0].last_transaction;
    expect(tx.status).toBe("captured");
    expect(tx.success).toBe(true);
    expect(tx.card?.id).toBe(record.cardId);
    expect(isBusinessSuccess(order)).toBe(true);
    // Approved transactions echo the acquirer NSU/TID/auth-code (`_idea.md` §4.1).
    expect(tx.acquirer_name).toBe("cielo");
    expect(tx.acquirer_return_code).toBe("00");
    expect(tx.acquirer_tid).toBeDefined();
    expect(tx.acquirer_nsu).toBeDefined();
    expect(tx.acquirer_auth_code).toBeDefined();
  });

  it("approved_no_capture: authorized_pending_capture, operation_type auth_only, success", () => {
    const record = recordFor("approved_no_capture", { status: "authorized_pending_capture" });
    const order = buildOrderResponse(record, {
      card: newCardInput,
      operationType: "auth_only",
    });

    expect(order.status).toBe("authorized_pending_capture");
    const tx = order.charges[0].last_transaction;
    expect(tx.status).toBe("authorized_pending_capture");
    expect(tx.operation_type).toBe("auth_only");
    expect(tx.success).toBe(true);
    expect(order.charges[0].status).toBe("authorized_pending_capture");
    expect(isBusinessSuccess(order)).toBe(true);
  });
});

describe("buildOrderResponse — non-success outcomes (_idea.md §3.1, §4.1)", () => {
  it("declined: not_authorized, success false, acquirer_return_code 57", () => {
    const record = recordFor("declined", { status: "failed" });
    const order = buildOrderResponse(record, { card: newCardInput });

    const tx = order.charges[0].last_transaction;
    expect(tx.status).toBe("not_authorized");
    expect(tx.success).toBe(false);
    expect(tx.acquirer_return_code).toBe("57");
    expect(tx.gateway_response?.code).toBe("57");
    expect(tx.gateway_response?.errors?.[0]?.message).toBeTruthy();
    expect(isBusinessSuccess(order)).toBe(false);
  });

  it("transaction_error: with_error, success false", () => {
    const record = recordFor("transaction_error", { status: "failed" });
    const order = buildOrderResponse(record, { card: newCardInput });

    const tx = order.charges[0].last_transaction;
    expect(tx.status).toBe("with_error");
    expect(tx.success).toBe(false);
    expect(isBusinessSuccess(order)).toBe(false);
  });

  it("order_failed: root status failed", () => {
    const record = recordFor("order_failed", { status: "failed" });
    const order = buildOrderResponse(record, { card: newCardInput });

    expect(order.status).toBe("failed");
    expect(order.charges[0].status).toBe("failed");
    expect(isBusinessSuccess(order)).toBe(false);
  });

  it("declines still carry charges[0].last_transaction so the parser never reads through an empty charges[]", () => {
    const order = buildOrderResponse(recordFor("declined"), { card: newCardInput });
    expect(order.charges).toHaveLength(1);
    expect(order.charges[0].last_transaction).toBeDefined();
  });
});

describe("buildOrderResponse — echoes request + record fields (_idea.md §8)", () => {
  it("echoes the request code and preserves metadata.site", () => {
    const record = recordFor("approved_captured", {
      code: "PREFIXO_99999_zzz",
      metadata: { site: "Outra Loja", extra: "kept" },
    });
    const order = buildOrderResponse(record, { card: newCardInput });

    expect(order.code).toBe("PREFIXO_99999_zzz");
    expect(order.charges[0].code).toBe("PREFIXO_99999_zzz");
    expect(order.metadata.site).toBe("Outra Loja");
    // Arbitrary metadata keys ride along untouched.
    expect(order.metadata.extra).toBe("kept");
  });

  it("uses the record's lifecycle ids and amount so the body is coherent (ADR-001)", () => {
    const record = recordFor("approved_captured", {
      orderId: "or_fake_abc",
      chargeId: "ch_fake_abc",
      cardId: "card_fake_abc",
      amount: 4567,
    });
    const order = buildOrderResponse(record, { card: newCardInput });

    expect(order.id).toBe("or_fake_abc");
    expect(order.amount).toBe(4567);
    expect(order.charges[0].id).toBe("ch_fake_abc");
    expect(order.charges[0].amount).toBe(4567);
    expect(order.charges[0].last_transaction.amount).toBe(4567);
    expect(order.charges[0].last_transaction.card?.id).toBe("card_fake_abc");
  });

  it("derives card display fields from the number and defaults brand to Visa", () => {
    const order = buildOrderResponse(recordFor("approved_captured"), {
      card: { number: "4000 0000 0000 0010", holder_name: "FULANO DE TAL" },
    });
    const card = order.charges[0].last_transaction.card;
    expect(card?.first_six_digits).toBe("400000");
    expect(card?.last_four_digits).toBe("0010");
    expect(card?.brand).toBe("Visa");
    expect(card?.holder_name).toBe("FULANO DE TAL");
  });

  it("defaults installments to 1 and operation_type to auth_and_capture for a sale", () => {
    const order = buildOrderResponse(recordFor("approved_captured"), { card: newCardInput });
    const tx = order.charges[0].last_transaction;
    expect(tx.installments).toBe(1);
    expect(tx.operation_type).toBe("auth_and_capture");
  });

  it("echoes installments and statement_descriptor when supplied", () => {
    const order = buildOrderResponse(recordFor("approved_captured"), {
      card: newCardInput,
      installments: 3,
      statementDescriptor: "APPMAX*LOJA",
    });
    const tx = order.charges[0].last_transaction;
    expect(tx.installments).toBe(3);
    expect(tx.statement_descriptor).toBe("APPMAX*LOJA");
  });

  it("echoes a customer block when supplied", () => {
    const order = buildOrderResponse(recordFor("approved_captured"), {
      card: newCardInput,
      customer: { id: "cus_fake_1", name: "Fulano", email: "f@example.com" },
    });
    expect(order.customer?.name).toBe("Fulano");
  });

  it("handles tokenized flows with no raw card (card.id present, digits empty)", () => {
    const order = buildOrderResponse(recordFor("approved_captured"));
    const card = order.charges[0].last_transaction.card;
    expect(card?.id).toBeDefined();
    expect(card?.first_six_digits).toBe("");
    expect(card?.last_four_digits).toBe("");
    expect(card?.brand).toBe("Visa");
  });
});

describe("buildOrderResponse — gateway_unavailable has no body (_idea.md §3.3)", () => {
  it("throws because the route returns a 5xx instead of an order body", () => {
    expect(() => buildOrderResponse(recordFor("gateway_unavailable"))).toThrow(
      /gateway_unavailable/,
    );
  });
});
