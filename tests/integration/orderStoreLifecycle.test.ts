import { describe, expect, it } from "vitest";
import { InMemoryOrderStore } from "../../src/store/inMemoryOrderStore";
import { newCardId, newChargeId, newOrderId } from "../../src/util/ids";
import type { OrderRecord } from "../../src/types/pagarme";

// Full sale → capture → cancel lifecycle on the in-memory store, reading the
// record at every step. `OrderRecord.status` is a `ChargeStatus`, so the
// transaction-level words from the task ("captured"/"voided") map onto the
// valid root statuses: a pre-auth (`authorized_pending_capture`) is captured to
// `paid`, then canceled to `canceled`.
describe("InMemoryOrderStore lifecycle (pre-auth → capture → cancel)", () => {
  it("creates, captures, and cancels a charge with the IDs minted at creation", async () => {
    const store = new InMemoryOrderStore();

    const orderId = newOrderId();
    const chargeId = newChargeId();
    const cardId = newCardId();

    const initial: OrderRecord = {
      orderId,
      chargeId,
      cardId,
      code: "PREFIXO_12345_a1b2c",
      amount: 1990,
      status: "authorized_pending_capture",
      outcome: "approved_no_capture",
      metadata: { site: "Minha Loja" },
    };

    // 1. Create the pre-authorized charge and read it back.
    const created = await store.create(initial);
    expect(created.chargeId).toBe(chargeId);
    expect(created.status).toBe("authorized_pending_capture");
    expect((await store.get(chargeId))?.status).toBe("authorized_pending_capture");

    // 2. Capture: the charge becomes `paid`. The same chargeId resolves.
    const captured = await store.update(chargeId, { status: "paid" });
    expect(captured?.status).toBe("paid");
    expect(captured?.orderId).toBe(orderId);
    expect(captured?.cardId).toBe(cardId);
    expect((await store.get(chargeId))?.status).toBe("paid");

    // 3. Cancel: the charge becomes `canceled`, recording the canceled amount.
    const canceled = await store.update(chargeId, { status: "canceled" });
    expect(canceled?.status).toBe("canceled");
    expect(canceled?.amount).toBe(1990);

    const final = await store.get(chargeId);
    expect(final?.status).toBe("canceled");
    expect(final?.orderId).toBe(orderId);
    expect(final?.cardId).toBe(cardId);
  });
});
