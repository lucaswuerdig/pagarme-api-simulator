/**
 * Vercel KV (Upstash Redis) {@link OrderStore} for production. Lifecycle state
 * must survive across stateless Vercel invocations, so each {@link OrderRecord}
 * is stored under a prefixed key `ch:<chargeId>` with a TTL (default 24h), and
 * the test-only reset deletes only `ch:*` keys — never `flushall` on a shared
 * store (ADR-006).
 *
 * The class depends only on the minimal {@link KvClient} seam below — not on
 * `@vercel/kv` directly — so it is unit-testable with a plain fake and the same
 * backend-agnostic contract suite as {@link InMemoryOrderStore} passes against
 * it. The real `@vercel/kv` client is wired in by the store factory
 * ({@link ../store/index}).
 */

import type { OrderRecord } from "../types/pagarme";
import type { OrderStore } from "./orderStore";

/** Key prefix for every persisted record; also the `clear()` scan pattern root. */
export const KV_KEY_PREFIX = "ch:";

/** Default record TTL in seconds (24h) — abandoned lifecycle state self-expires. */
export const DEFAULT_TTL_SECONDS = 24 * 60 * 60;

/** Page size for the `clear()` scan loop. */
const SCAN_COUNT = 100;

/**
 * The narrow subset of the `@vercel/kv` client this store uses. Structurally
 * satisfied by a real `VercelKV` instance and trivially by a test fake. Note the
 * deliberate absence of `flushall`: the store can only ever scan + delete its
 * own prefix.
 */
export interface KvClient {
  /** Store `value` (auto-serialized) under `key`, optionally with a TTL (`ex` seconds). */
  set(key: string, value: unknown, opts?: { ex?: number }): Promise<unknown>;
  /** Read and auto-deserialize the value at `key`; resolves `null` when absent. */
  get<T = unknown>(key: string): Promise<T | null>;
  /** Cursor-paginated key scan. Returns `[nextCursor, keys]`; cursor `"0"` ends iteration. */
  scan(
    cursor: string | number,
    opts: { match?: string; count?: number },
  ): Promise<[string | number, string[]]>;
  /** Delete the given keys; resolves the number of keys removed. */
  del(...keys: string[]): Promise<number>;
}

/** Options for {@link KvOrderStore}; `ttlSeconds` overridable mainly for tests. */
export interface KvOrderStoreOptions {
  client: KvClient;
  ttlSeconds?: number;
}

export class KvOrderStore implements OrderStore {
  private readonly client: KvClient;
  private readonly ttlSeconds: number;

  constructor({ client, ttlSeconds = DEFAULT_TTL_SECONDS }: KvOrderStoreOptions) {
    this.client = client;
    this.ttlSeconds = ttlSeconds;
  }

  /** The `ch:<chargeId>` key a record is stored under. */
  private key(chargeId: string): string {
    return `${KV_KEY_PREFIX}${chargeId}`;
  }

  async create(record: OrderRecord): Promise<OrderRecord> {
    await this.client.set(this.key(record.chargeId), record, { ex: this.ttlSeconds });
    // Return an isolated snapshot, mirroring the in-memory store's clone-out
    // semantics (and KV's own JSON round-trip on read).
    return structuredClone(record);
  }

  async get(chargeId: string): Promise<OrderRecord | undefined> {
    const found = await this.client.get<OrderRecord>(this.key(chargeId));
    // KV resolves `null` for a missing key; the contract speaks `undefined`.
    return found ?? undefined;
  }

  async update(
    chargeId: string,
    patch: Partial<OrderRecord>,
  ): Promise<OrderRecord | undefined> {
    const existing = await this.client.get<OrderRecord>(this.key(chargeId));
    if (existing === null || existing === undefined) {
      // No-op for an unknown charge (never throws) so capture/cancel can surface
      // a body-level error — same contract as the in-memory store.
      return undefined;
    }
    const updated: OrderRecord = { ...existing, ...patch };
    await this.client.set(this.key(chargeId), updated, { ex: this.ttlSeconds });
    return structuredClone(updated);
  }

  async clear(): Promise<void> {
    // Prefix-scoped reset: scan + delete only `ch:*` keys, never `flushall`, so a
    // shared KV namespace stays safe (ADR-006). Iterate until the cursor wraps.
    const pattern = `${KV_KEY_PREFIX}*`;
    let cursor: string | number = "0";
    do {
      const [next, keys] = await this.client.scan(cursor, {
        match: pattern,
        count: SCAN_COUNT,
      });
      cursor = next;
      if (keys.length > 0) {
        await this.client.del(...keys);
      }
    } while (String(cursor) !== "0");
  }
}
