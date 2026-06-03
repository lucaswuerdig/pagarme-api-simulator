/**
 * In-memory {@link OrderStore} backed by a single `Map` keyed by `chargeId`
 * (ADR-005). Used for local dev and hermetic CI tests; state is lost on process
 * restart, which is acceptable per ADR-001.
 *
 * Records are deep-cloned on the way in and out so a stored record is an
 * isolated snapshot — callers cannot mutate the store by holding a returned
 * reference. This mirrors the JSON round-trip semantics of the Task 07 KV
 * backend, keeping the shared store contract truly backend-agnostic.
 */

import type { OrderRecord } from "../types/pagarme";
import type { OrderStore } from "./orderStore";

/** Deep copy so stored records never share mutable references with callers. */
function clone(record: OrderRecord): OrderRecord {
  return structuredClone(record);
}

export class InMemoryOrderStore implements OrderStore {
  private readonly records = new Map<string, OrderRecord>();

  async create(record: OrderRecord): Promise<OrderRecord> {
    const stored = clone(record);
    this.records.set(stored.chargeId, stored);
    return clone(stored);
  }

  async get(chargeId: string): Promise<OrderRecord | undefined> {
    const found = this.records.get(chargeId);
    return found === undefined ? undefined : clone(found);
  }

  async update(
    chargeId: string,
    patch: Partial<OrderRecord>,
  ): Promise<OrderRecord | undefined> {
    const existing = this.records.get(chargeId);
    if (existing === undefined) {
      return undefined;
    }
    const updated = clone({ ...existing, ...patch });
    this.records.set(chargeId, updated);
    return clone(updated);
  }

  async clear(): Promise<void> {
    this.records.clear();
  }
}
