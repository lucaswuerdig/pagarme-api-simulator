import { describe, expect, it } from "vitest";
import { createStore } from "../../src/store";
import { KvOrderStore } from "../../src/store/kvOrderStore";
import defaultApp, { buildApp } from "../../api/index";

/**
 * Unit tests for the Vercel function entrypoint (`api/index.ts`). They confirm
 * the module imports and exports the Express app without throwing, and that the
 * store backend it selects via `createStore` is the `KvOrderStore` when
 * `STORE_BACKEND=kv` — the configuration Vercel runs with (ADR-006).
 */
describe("api/index.ts — Vercel function entrypoint", () => {
  const kvEnv = {
    STORE_BACKEND: "kv",
    KV_REST_API_URL: "https://example.kv.vercel-storage.com",
    KV_REST_API_TOKEN: "test-token",
  } as NodeJS.ProcessEnv;

  it("imports and exports the Express app without throwing", () => {
    // Importing the module already ran `buildApp()` at load with the ambient env
    // (STORE_BACKEND unset → in-memory). An Express app is a `(req, res)`
    // handler, so a callable default export proves the entrypoint built without
    // throwing — exactly what Vercel invokes as the function handler.
    expect(defaultApp).toBeTypeOf("function");
    expect(buildApp).toBeTypeOf("function");
  });

  it("buildApp builds a working Express app for the default (in-memory) env", () => {
    expect(buildApp({} as NodeJS.ProcessEnv)).toBeTypeOf("function");
  });

  it("selects the KvOrderStore backend when STORE_BACKEND=kv", () => {
    // The entrypoint chooses its store through the same `createStore` factory it
    // imports; with the Vercel env that yields a KvOrderStore...
    expect(createStore(kvEnv)).toBeInstanceOf(KvOrderStore);
    // ...and buildApp wires that KV-backed store into the app without throwing.
    expect(buildApp(kvEnv)).toBeTypeOf("function");
  });

  it("fails fast when STORE_BACKEND=kv but KV credentials are missing", () => {
    // Only the kv branch validates credentials, so a throw here proves buildApp
    // routes store selection through the KV path (not the in-memory fallback).
    expect(() => buildApp({ STORE_BACKEND: "kv" } as NodeJS.ProcessEnv)).toThrow(
      /KV_REST_API_URL and KV_REST_API_TOKEN/,
    );
  });
});
