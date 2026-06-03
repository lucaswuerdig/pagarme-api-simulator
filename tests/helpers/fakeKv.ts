/**
 * In-process fake of the `@vercel/kv` client implementing the {@link KvClient}
 * seam used by {@link KvOrderStore}. Backed by a `Map`, with `vi.fn()`-wrapped
 * methods so tests can both exercise real behaviour (the shared contract suite)
 * and assert call arguments (the KV unit tests).
 *
 * Values are deep-cloned on the way in and out to mirror Vercel KV's JSON
 * round-trip, keeping stored records isolated snapshots. A `flushall` spy is
 * included solely so tests can assert it is NEVER called (ADR-006).
 *
 * Not a `*.test.ts` file, so vitest never runs it as a suite.
 */

import { vi } from "vitest";
import type { KvClient } from "../../src/store/kvOrderStore";

export interface FakeKv extends KvClient {
  /** The underlying key/value store (post-serialization snapshots). */
  readonly data: Map<string, unknown>;
  /** Spy present only to prove it is never invoked by `clear()`. */
  readonly flushall: ReturnType<typeof vi.fn>;
  readonly set: ReturnType<typeof vi.fn>;
  readonly get: ReturnType<typeof vi.fn>;
  readonly scan: ReturnType<typeof vi.fn>;
  readonly del: ReturnType<typeof vi.fn>;
}

/** Translate a Redis glob (only `*` is used here) into an anchored RegExp. */
function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${escaped}$`);
}

/** A fresh, empty fake KV client. Call once per store under test. */
export function createFakeKv(): FakeKv {
  const data = new Map<string, unknown>();

  // The TTL opts arg is recorded by `vi.fn` for assertions but unused by the fake.
  const set = vi.fn(async (key: string, value: unknown) => {
    data.set(key, structuredClone(value));
    return "OK";
  });

  const get = vi.fn(async (key: string) => {
    if (!data.has(key)) {
      return null;
    }
    return structuredClone(data.get(key));
  });

  const scan = vi.fn(
    async (cursor: string | number, opts: { match?: string; count?: number }) => {
      const all = [...data.keys()].filter((key) =>
        opts.match ? globToRegExp(opts.match).test(key) : true,
      );
      const start = Number(cursor) || 0;
      const count = opts.count ?? 10;
      const page = all.slice(start, start + count);
      const nextCursor = start + count >= all.length ? "0" : String(start + count);
      return [nextCursor, page] as [string, string[]];
    },
  );

  const del = vi.fn(async (...keys: string[]) => {
    let removed = 0;
    for (const key of keys) {
      if (data.delete(key)) {
        removed += 1;
      }
    }
    return removed;
  });

  const flushall = vi.fn(async () => "OK");

  return { data, set, get, scan, del, flushall };
}
