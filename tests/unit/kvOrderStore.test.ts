import { describe, expect, it } from "vitest";
import {
  DEFAULT_TTL_SECONDS,
  KvOrderStore,
} from "../../src/store/kvOrderStore";
import { createFakeKv } from "../helpers/fakeKv";
import { makeSampleRecord } from "../contract/orderStoreContract";

// KV-specific behaviour: the `ch:<chargeId>` key scheme, the TTL on writes, and
// the prefix-scoped `clear()` that must never reach `flushall`. The generic CRUD
// contract is covered separately by the shared suite in the integration tests.
describe("KvOrderStore", () => {
  describe("create", () => {
    it("writes key ch:<chargeId> with the default 24h TTL", async () => {
      const kv = createFakeKv();
      const store = new KvOrderStore({ client: kv });
      const record = makeSampleRecord({ chargeId: "ch_fake_abc" });

      const created = await store.create(record);

      expect(created).toEqual(record);
      expect(kv.set).toHaveBeenCalledTimes(1);
      expect(kv.set).toHaveBeenCalledWith("ch:ch_fake_abc", record, {
        ex: DEFAULT_TTL_SECONDS,
      });
    });

    it("honours a configured TTL override", async () => {
      const kv = createFakeKv();
      const store = new KvOrderStore({ client: kv, ttlSeconds: 60 });

      await store.create(makeSampleRecord({ chargeId: "ch_fake_ttl" }));

      expect(kv.set).toHaveBeenCalledWith("ch:ch_fake_ttl", expect.anything(), {
        ex: 60,
      });
    });

    it("returns an isolated snapshot, not the input reference", async () => {
      const kv = createFakeKv();
      const store = new KvOrderStore({ client: kv });
      const record = makeSampleRecord();

      const created = await store.create(record);
      created.status = "failed";

      const fetched = await store.get(record.chargeId);
      expect(fetched?.status).toBe("paid");
    });
  });

  describe("get", () => {
    it("reads ch:<chargeId> and deserializes the record", async () => {
      const kv = createFakeKv();
      const store = new KvOrderStore({ client: kv });
      await store.create(makeSampleRecord({ chargeId: "ch_x", amount: 4200 }));

      const fetched = await store.get("ch_x");

      expect(kv.get).toHaveBeenCalledWith("ch:ch_x");
      expect(fetched?.chargeId).toBe("ch_x");
      expect(fetched?.amount).toBe(4200);
    });

    it("resolves undefined for a missing key (KV null -> undefined)", async () => {
      const kv = createFakeKv();
      const store = new KvOrderStore({ client: kv });

      expect(await store.get("ch_missing")).toBeUndefined();
    });
  });

  describe("update", () => {
    it("merges the patch and re-writes the record with the TTL", async () => {
      const kv = createFakeKv();
      const store = new KvOrderStore({ client: kv });
      await store.create(makeSampleRecord({ chargeId: "ch_up" }));
      kv.set.mockClear();

      const patched = await store.update("ch_up", { status: "canceled" });

      expect(patched?.status).toBe("canceled");
      expect(patched?.amount).toBe(makeSampleRecord().amount);
      expect(kv.set).toHaveBeenCalledWith(
        "ch:ch_up",
        expect.objectContaining({ status: "canceled" }),
        { ex: DEFAULT_TTL_SECONDS },
      );
    });

    it("returns undefined and never writes when the charge is unknown", async () => {
      const kv = createFakeKv();
      const store = new KvOrderStore({ client: kv });

      const result = await store.update("ch_missing", { status: "canceled" });

      expect(result).toBeUndefined();
      expect(kv.set).not.toHaveBeenCalled();
    });
  });

  describe("clear", () => {
    it("deletes only ch:* keys via scan + del, never flushall", async () => {
      const kv = createFakeKv();
      const store = new KvOrderStore({ client: kv });
      await store.create(makeSampleRecord({ chargeId: "ch_a" }));
      await store.create(makeSampleRecord({ chargeId: "ch_b" }));
      // A foreign key that must survive a prefix-scoped reset.
      kv.data.set("other:keep", { untouched: true });

      await store.clear();

      expect(kv.scan).toHaveBeenCalled();
      expect(kv.del).toHaveBeenCalled();
      expect(kv.flushall).not.toHaveBeenCalled();
      expect(kv.data.has("ch:ch_a")).toBe(false);
      expect(kv.data.has("ch:ch_b")).toBe(false);
      expect(kv.data.has("other:keep")).toBe(true);
    });

    it("is a no-op (no del) on an empty store and never calls flushall", async () => {
      const kv = createFakeKv();
      const store = new KvOrderStore({ client: kv });

      await store.clear();

      expect(kv.scan).toHaveBeenCalled();
      expect(kv.del).not.toHaveBeenCalled();
      expect(kv.flushall).not.toHaveBeenCalled();
    });
  });
});
