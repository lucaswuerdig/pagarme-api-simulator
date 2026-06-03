/**
 * The persistence seam every later layer depends on (TechSpec "Core
 * Interfaces", ADR-005). The fake is stateful so a sale → capture → cancel
 * flow stays coherent (ADR-001): the same `chargeId`/`cardId` minted at order
 * creation resolve on the subsequent capture/cancel calls.
 *
 * The interface is deliberately backend-agnostic and fully async: the in-memory
 * implementation ({@link InMemoryOrderStore}) backs local dev and hermetic CI
 * tests, while Task 07 adds a Vercel-KV-backed implementation against this same
 * interface, unchanged. All methods return Promises so a networked backend is a
 * drop-in replacement.
 */

import type { OrderRecord } from "../types/pagarme";

export interface OrderStore {
  /** Persist a freshly minted record and return it. */
  create(record: OrderRecord): Promise<OrderRecord>;
  /** Look up a record by its `chargeId`; resolves `undefined` when absent. */
  get(chargeId: string): Promise<OrderRecord | undefined>;
  /**
   * Merge `patch` into the stored record and return the result. A no-op that
   * resolves `undefined` for an unknown `chargeId` (never throws), so capture/
   * cancel against a missing charge can surface a body-level error.
   */
  update(chargeId: string, patch: Partial<OrderRecord>): Promise<OrderRecord | undefined>;
  /** Drop all records — backs the test-only `POST /__reset` route (ADR-005). */
  clear(): Promise<void>;
}
