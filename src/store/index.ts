/**
 * Store factory and barrel. Selects the {@link OrderStore} backend from the
 * `STORE_BACKEND` env var: `kv` wires the production {@link KvOrderStore} over a
 * real `@vercel/kv` client (Vercel), and anything else — including the default —
 * uses the {@link InMemoryOrderStore} for local dev and hermetic CI (ADR-006).
 *
 * This is the single module that imports `@vercel/kv`; the store classes
 * themselves stay package-free and unit-testable. Task 08's Vercel shim builds
 * the wired app with `createPagarmeApp(createStore())`.
 */

import { createClient } from "@vercel/kv";
import { InMemoryOrderStore } from "./inMemoryOrderStore";
import { KvOrderStore, type KvClient } from "./kvOrderStore";
import type { OrderStore } from "./orderStore";

export type { OrderStore } from "./orderStore";
export type { OrderRecord } from "../types/pagarme";
export { InMemoryOrderStore } from "./inMemoryOrderStore";
export { KvOrderStore, KV_KEY_PREFIX, DEFAULT_TTL_SECONDS } from "./kvOrderStore";

/** Backend selected when `STORE_BACKEND` is unset or unrecognized. */
export const DEFAULT_STORE_BACKEND = "memory";

/**
 * Build the {@link OrderStore} for the current environment. `STORE_BACKEND=kv`
 * yields a {@link KvOrderStore} backed by a `@vercel/kv` client built from
 * `KV_REST_API_URL` / `KV_REST_API_TOKEN`; any other value yields an
 * {@link InMemoryOrderStore}. Throws if `kv` is selected without the required
 * credentials so a misconfiguration fails fast rather than at first request.
 */
export function createStore(env: NodeJS.ProcessEnv = process.env): OrderStore {
  const backend = (env.STORE_BACKEND ?? DEFAULT_STORE_BACKEND).toLowerCase();
  if (backend === "kv") {
    const url = env.KV_REST_API_URL;
    const token = env.KV_REST_API_TOKEN;
    if (!url || !token) {
      throw new Error(
        "STORE_BACKEND=kv requires KV_REST_API_URL and KV_REST_API_TOKEN to be set.",
      );
    }
    // `createClient` returns the broad `VercelKV` type; adapt it to the narrow
    // seam the store depends on.
    const client = createClient({ url, token }) as unknown as KvClient;
    return new KvOrderStore({ client });
  }
  return new InMemoryOrderStore();
}
