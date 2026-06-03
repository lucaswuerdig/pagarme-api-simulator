/**
 * Backend-agnostic {@link OrderStore} contract test suite.
 *
 * This is NOT a `*.test.ts` file, so vitest's `tests/**\/*.test.ts` glob never
 * runs it standalone. Instead, each backend imports {@link runOrderStoreContract}
 * and runs it against a factory that yields a fresh, empty store. Task 03 runs
 * it against {@link InMemoryOrderStore}; Task 07 reuses it unchanged against a
 * KV-backed store with a mocked `@vercel/kv` client — guaranteeing both
 * implementations honour the same contract.
 */

import { beforeEach, describe, expect, it } from "vitest";
import type { OrderRecord } from "../../src/types/pagarme";
import type { OrderStore } from "../../src/store/orderStore";

/** A fully populated sample record; override any field for a specific case. */
export function makeSampleRecord(overrides: Partial<OrderRecord> = {}): OrderRecord {
  return {
    orderId: "or_fake_sample",
    chargeId: "ch_fake_sample",
    cardId: "card_fake_sample",
    code: "PREFIXO_12345_a1b2c",
    amount: 1990,
    status: "paid",
    outcome: "approved_captured",
    metadata: { site: "Minha Loja" },
    ...overrides,
  };
}

/**
 * Register the shared contract against `makeStore`. `makeStore()` must return a
 * fresh, empty store on each call.
 */
export function runOrderStoreContract(name: string, makeStore: () => OrderStore): void {
  describe(`OrderStore contract: ${name}`, () => {
    let store: OrderStore;

    beforeEach(() => {
      store = makeStore();
    });

    it("create then get(chargeId) returns the same record", async () => {
      const record = makeSampleRecord();
      const created = await store.create(record);
      expect(created).toEqual(record);

      const fetched = await store.get(record.chargeId);
      expect(fetched).toEqual(record);
    });

    it("get returns undefined for an unknown charge_id", async () => {
      expect(await store.get("ch_fake_missing")).toBeUndefined();
    });

    it("update(chargeId, { status: 'canceled' }) mutates and returns the patched record", async () => {
      const record = makeSampleRecord();
      await store.create(record);

      const patched = await store.update(record.chargeId, { status: "canceled" });
      expect(patched).toBeDefined();
      expect(patched?.status).toBe("canceled");
      // Unpatched fields are preserved.
      expect(patched?.amount).toBe(record.amount);
      expect(patched?.orderId).toBe(record.orderId);

      // The change is durable across a subsequent read.
      const refetched = await store.get(record.chargeId);
      expect(refetched?.status).toBe("canceled");
    });

    it("update('missing_id', ...) returns undefined and does not throw", async () => {
      await expect(
        store.update("missing_id", { status: "canceled" }),
      ).resolves.toBeUndefined();
    });

    it("clear() empties the store so a subsequent get returns undefined", async () => {
      const record = makeSampleRecord();
      await store.create(record);
      expect(await store.get(record.chargeId)).toBeDefined();

      await store.clear();
      expect(await store.get(record.chargeId)).toBeUndefined();
    });
  });
}
