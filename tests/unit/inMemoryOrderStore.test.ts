import { describe, expect, it } from "vitest";
import { InMemoryOrderStore } from "../../src/store/inMemoryOrderStore";
import { makeSampleRecord, runOrderStoreContract } from "../contract/orderStoreContract";

// The shared backend-agnostic contract (reused verbatim by Task 07 for KV).
runOrderStoreContract("InMemoryOrderStore", () => new InMemoryOrderStore());

// In-memory-specific guarantees: stored records are isolated snapshots, so the
// Map never shares a mutable reference with a caller (mirrors KV's JSON
// round-trip and keeps the contract suite valid for both backends).
describe("InMemoryOrderStore isolation", () => {
  it("does not leak the input reference into the store", async () => {
    const store = new InMemoryOrderStore();
    const record = makeSampleRecord();
    await store.create(record);

    // Mutating the original input after create must not affect stored state.
    record.status = "failed";
    record.metadata.site = "tampered";

    const fetched = await store.get(record.chargeId);
    expect(fetched?.status).toBe("paid");
    expect(fetched?.metadata.site).toBe("Minha Loja");
  });

  it("returns copies, so mutating a result does not affect the store", async () => {
    const store = new InMemoryOrderStore();
    const record = makeSampleRecord();
    const created = await store.create(record);

    created.status = "failed";
    (created.metadata as Record<string, unknown>).site = "tampered";

    const fetched = await store.get(record.chargeId);
    expect(fetched?.status).toBe("paid");
    expect(fetched?.metadata.site).toBe("Minha Loja");
  });

  it("keeps distinct charge_ids independent", async () => {
    const store = new InMemoryOrderStore();
    await store.create(makeSampleRecord({ chargeId: "ch_fake_a", amount: 100 }));
    await store.create(makeSampleRecord({ chargeId: "ch_fake_b", amount: 200 }));

    await store.update("ch_fake_a", { status: "canceled" });

    expect((await store.get("ch_fake_a"))?.status).toBe("canceled");
    expect((await store.get("ch_fake_b"))?.status).toBe("paid");
    expect((await store.get("ch_fake_b"))?.amount).toBe(200);
  });
});
