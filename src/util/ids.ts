/**
 * Opaque identifier minting (ADR-005). Each ID is a fixed per-entity prefix
 * plus a cryptographically-random hex suffix. IDs are intentionally opaque and
 * NOT sequential so concurrent runs on the shared homologation instance never
 * collide; the consuming app reads the id back from the create response rather
 * than hardcoding it.
 */

import { randomBytes } from "node:crypto";

/** Per-entity ID prefixes — the single source of truth for the five shapes. */
export const ID_PREFIXES = {
  order: "or_fake_",
  charge: "ch_fake_",
  card: "card_fake_",
  transaction: "tran_fake_",
  token: "token_fake_",
} as const;

/** Any one of the four opaque-ID prefixes. */
export type IdPrefix = (typeof ID_PREFIXES)[keyof typeof ID_PREFIXES];

/** Random suffix length in bytes (16 bytes → 32 hex chars → 128 bits). */
const SUFFIX_BYTES = 16;

/**
 * Mint an opaque, collision-resistant identifier: the given prefix followed by
 * a random hex suffix.
 */
export function mintId(prefix: IdPrefix): string {
  return `${prefix}${randomBytes(SUFFIX_BYTES).toString("hex")}`;
}

/** Mint an `or_fake_…` order id. */
export const newOrderId = (): string => mintId(ID_PREFIXES.order);
/** Mint a `ch_fake_…` charge id (the store key). */
export const newChargeId = (): string => mintId(ID_PREFIXES.charge);
/** Mint a `card_fake_…` card id. */
export const newCardId = (): string => mintId(ID_PREFIXES.card);
/** Mint a `tran_fake_…` transaction id. */
export const newTransactionId = (): string => mintId(ID_PREFIXES.transaction);
/** Mint a `token_fake_…` card token id (`POST /core/v5/tokens`, `_idea.md` §4.4). */
export const newTokenId = (): string => mintId(ID_PREFIXES.token);
