import { describe, expect, it } from "vitest";
import { buildCancelResponse, buildCaptureResponse } from "../../src/responses/chargeResponse";
import { makeSampleRecord } from "../contract/orderStoreContract";

describe("buildCaptureResponse — capture success (_idea.md §4.2, §8)", () => {
  it("returns a charge with root-level last_transaction captured/success", () => {
    const record = makeSampleRecord({ chargeId: "ch_fake_cap", code: "PREFIXO_1", amount: 1990 });
    const charge = buildCaptureResponse(record);

    // last_transaction is at the ROOT — not inside a charges[] array (§4.2).
    expect(charge).not.toHaveProperty("charges");
    expect(charge.id).toBe("ch_fake_cap");
    expect(charge.code).toBe("PREFIXO_1");
    expect(charge.status).not.toBe("failed");
    expect(charge.status).toBe("paid");

    const tx = charge.last_transaction;
    expect(tx.status).toBe("captured");
    expect(tx.success).toBe(true);
    expect(tx.operation_type).toBe("capture");
    expect(tx.acquirer_return_code).toBe("00");
  });

  it("defaults the captured amount to the original charge amount", () => {
    const charge = buildCaptureResponse(makeSampleRecord({ amount: 2500 }));
    expect(charge.amount).toBe(2500);
    expect(charge.last_transaction.amount).toBe(2500);
  });

  it("honours a partial capture amount on the transaction", () => {
    const charge = buildCaptureResponse(makeSampleRecord({ amount: 2500 }), { amount: 1000 });
    expect(charge.amount).toBe(2500); // original charge amount preserved
    expect(charge.last_transaction.amount).toBe(1000);
  });
});

describe("buildCancelResponse — cancel/refund success (_idea.md §4.3, §8)", () => {
  it("void (default): voided/success with canceled_amount set", () => {
    const record = makeSampleRecord({ chargeId: "ch_fake_void", amount: 1990 });
    const charge = buildCancelResponse(record);

    expect(charge).not.toHaveProperty("charges");
    expect(charge.id).toBe("ch_fake_void");
    expect(charge.status).toBe("canceled");
    const tx = charge.last_transaction;
    expect(tx.status).toBe("voided");
    expect(tx.success).toBe(true);
    expect(tx.operation_type).toBe("void");
    expect(charge.canceled_amount).toBe(1990);
    expect(charge.refunded_amount).toBeUndefined();
    // §4.3 cancel transaction carries no card.
    expect(tx.card).toBeUndefined();
  });

  it("refund: refunded/success with refunded_amount set", () => {
    const charge = buildCancelResponse(makeSampleRecord({ amount: 1990 }), {
      kind: "refund",
      amount: 990,
    });
    expect(charge.status).toBe("refunded");
    const tx = charge.last_transaction;
    expect(tx.status).toBe("refunded");
    expect(tx.success).toBe(true);
    expect(tx.operation_type).toBe("refund");
    expect(charge.refunded_amount).toBe(990);
    expect(charge.canceled_amount).toBeUndefined();
  });

  it("defaults the canceled amount to the full original charge amount", () => {
    const charge = buildCancelResponse(makeSampleRecord({ amount: 4321 }));
    expect(charge.canceled_amount).toBe(4321);
    expect(charge.last_transaction.amount).toBe(4321);
  });
});
