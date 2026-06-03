import { KvOrderStore } from "../../src/store/kvOrderStore";
import { createFakeKv } from "../helpers/fakeKv";
import { runOrderStoreContract } from "../contract/orderStoreContract";

// The same backend-agnostic contract suite Task 03 runs against the in-memory
// store, here run against KvOrderStore over a mocked @vercel/kv client. A fresh
// fake (empty Map) per store keeps each case isolated, proving both backends
// honour the OrderStore contract identically (ADR-005 / ADR-006).
runOrderStoreContract(
  "KvOrderStore",
  () => new KvOrderStore({ client: createFakeKv() }),
);
