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
 * Mint an opaque, collision-resistant identifier: the given prefix, an optional
 * scenario marker, then a random hex suffix.
 *
 * The marker is how a minted card/token id carries its magic-card scenario, so a
 * tokenize-then-pay flow reproduces the same outcome as sending the raw number
 * (`magic/cards.ts`). `mintId("token_fake_", "refused")` yields
 * `token_fake_refused_<32 hex>`; without a marker the id keeps its original
 * `<prefix><32 hex>` shape.
 */
export function mintId(prefix: IdPrefix, marker?: string): string {
  const suffix = randomBytes(SUFFIX_BYTES).toString("hex");
  return marker ? `${prefix}${marker}_${suffix}` : `${prefix}${suffix}`;
}

/** Mint an `or_fake_…` order id. */
export const newOrderId = (): string => mintId(ID_PREFIXES.order);
/** Mint a `ch_fake_…` charge id (the store key). */
export const newChargeId = (): string => mintId(ID_PREFIXES.charge);
/** Mint a `card_fake_…` card id, optionally carrying a scenario marker. */
export const newCardId = (marker?: string): string => mintId(ID_PREFIXES.card, marker);
/** Mint a `tran_fake_…` transaction id. */
export const newTransactionId = (): string => mintId(ID_PREFIXES.transaction);
/** Mint a `token_fake_…` card token id, optionally carrying a scenario marker
 *  (`POST /core/v5/tokens`, `_idea.md` §4.4). */
export const newTokenId = (marker?: string): string => mintId(ID_PREFIXES.token, marker);
