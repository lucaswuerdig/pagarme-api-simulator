import { describe, expect, it } from "vitest";
import { createStore } from "../../src/store";
import { InMemoryOrderStore } from "../../src/store/inMemoryOrderStore";
import { KvOrderStore } from "../../src/store/kvOrderStore";

// Backend selection by STORE_BACKEND. An explicit `env` object is passed so the
// test never depends on or mutates the ambient process environment. Dummy KV
// credentials are enough: `createClient` only constructs the client, it makes no
// network call until a command runs.
describe("createStore (store factory)", () => {
  const kvEnv = {
    STORE_BACKEND: "kv",
    KV_REST_API_URL: "https://example.kv.vercel-storage.com",
    KV_REST_API_TOKEN: "test-token",
  } as NodeJS.ProcessEnv;

  it("returns KvOrderStore when STORE_BACKEND=kv", () => {
    expect(createStore(kvEnv)).toBeInstanceOf(KvOrderStore);
  });

  it("returns InMemoryOrderStore by default (no STORE_BACKEND)", () => {
    expect(createStore({} as NodeJS.ProcessEnv)).toBeInstanceOf(InMemoryOrderStore);
  });

  it("returns InMemoryOrderStore for STORE_BACKEND=memory", () => {
    expect(
      createStore({ STORE_BACKEND: "memory" } as NodeJS.ProcessEnv),
    ).toBeInstanceOf(InMemoryOrderStore);
  });

  it("falls back to InMemoryOrderStore for an unrecognized backend", () => {
    expect(
      createStore({ STORE_BACKEND: "postgres" } as NodeJS.ProcessEnv),
    ).toBeInstanceOf(InMemoryOrderStore);
  });

  it("is case-insensitive for the backend value", () => {
    expect(createStore({ ...kvEnv, STORE_BACKEND: "KV" })).toBeInstanceOf(
      KvOrderStore,
    );
  });

  it("throws when STORE_BACKEND=kv but KV credentials are missing", () => {
    expect(() =>
      createStore({ STORE_BACKEND: "kv" } as NodeJS.ProcessEnv),
    ).toThrow(/KV_REST_API_URL and KV_REST_API_TOKEN/);
  });
});
