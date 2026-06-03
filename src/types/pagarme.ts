/**
 * Pagar.me v5 wire-contract types and the fake's internal storage shape.
 *
 * Response models mirror `_idea.md` §4 exactly — snake_case on the wire — and
 * cover every ⭐ field the consuming app reads downstream (`_idea.md` §8). This
 * module contains types only, plus the single `CHARGE_STATUSES` const enum that
 * the {@link ChargeStatus} union is derived from; it holds no business logic.
 *
 * Optionality follows the wire variants: a field is required only when it
 * appears in every response that uses its interface. Fields absent from at
 * least one valid variant (e.g. `last_transaction.card` is omitted by the
 * cancel response in §4.3) are optional so each fixture type-checks.
 */

import type { Outcome } from "../magic/cards";

/**
 * Charge/order lifecycle statuses the store tracks and the fake returns at the
 * root `status` of an order or charge. Single source of truth for the
 * {@link ChargeStatus} union (TechSpec "Core Interfaces").
 */
export const CHARGE_STATUSES = [
  "paid",
  "authorized_pending_capture",
  "canceled",
  "refunded",
  "failed",
] as const;

/** Allowed root `status` values for an order/charge. */
export type ChargeStatus = (typeof CHARGE_STATUSES)[number];

// ---------------------------------------------------------------------------
// Response models (snake_case on the wire — `_idea.md` §4)
// ---------------------------------------------------------------------------

/**
 * Card metadata echoed in transaction and token responses. `id`,
 * `first_six_digits`, `last_four_digits`, and `brand` are always present (⭐,
 * `_idea.md` §8); holder/expiry details only accompany the richer order-success
 * and token responses.
 */
export interface Card {
  id: string;
  first_six_digits: string;
  last_four_digits: string;
  brand: string;
  holder_name?: string;
  exp_month?: number;
  exp_year?: number;
}

/** A single acquirer error entry inside {@link Transaction.gateway_response}. */
export interface GatewayResponseError {
  message: string;
}

/** Acquirer/gateway payload attached to declined or errored transactions. */
export interface GatewayResponse {
  code?: string;
  errors?: GatewayResponseError[];
}

/**
 * The `last_transaction` object the parser reads to decide approval
 * (`status` + `success`, `_idea.md` §3.1). `card` is optional because the
 * cancel response (§4.3) omits it; the acquirer fields are present across all
 * order/capture/cancel variants and carry the ⭐ NSU/TID/return-code data.
 */
export interface Transaction {
  id: string;
  transaction_type: string;
  amount: number;
  /** e.g. `captured`, `authorized_pending_capture`, `not_authorized`, `with_error`, `voided`, `refunded`. */
  status: string;
  success: boolean;
  acquirer_name: string;
  acquirer_return_code: string;
  operation_type?: string;
  installments?: number;
  statement_descriptor?: string;
  acquirer_tid?: string;
  acquirer_nsu?: string;
  acquirer_auth_code?: string;
  gateway_id?: string;
  gateway_response?: GatewayResponse;
  card?: Card;
}

/**
 * A charge within an order, and the shape returned directly by the capture
 * (§4.2) and cancel (§4.3) routes. `code` is optional (omitted by the decline
 * response in §4.1); `canceled_amount`/`refunded_amount` accompany cancellations.
 */
export interface Charge {
  id: string;
  amount: number;
  status: ChargeStatus;
  payment_method: string;
  last_transaction: Transaction;
  code?: string;
  canceled_amount?: number;
  refunded_amount?: number;
}

/** Customer block echoed in the order response (`_idea.md` §4.1). */
export interface Customer {
  id?: string;
  name?: string;
  email?: string;
  [key: string]: unknown;
}

/**
 * Order-level metadata. `site` is the ⭐ field the consuming app uses to resolve
 * the store key (`_idea.md` §8); arbitrary extra keys are echoed from the request.
 */
export interface OrderMetadata {
  site?: string;
  [key: string]: unknown;
}

/**
 * The `POST /core/v5/orders` response body (`_idea.md` §4.1). `currency`,
 * `closed`, and `customer` only appear on the success variant.
 */
export interface Order {
  id: string;
  code: string;
  status: ChargeStatus;
  amount: number;
  charges: Charge[];
  metadata: OrderMetadata;
  currency?: string;
  closed?: boolean;
  customer?: Customer;
}

/** The `POST /core/v5/tokens` response body (`_idea.md` §4.4). */
export interface Token {
  id: string;
  type: string;
  created_at: string;
  expires_at: string;
  card: Card;
}

// ---------------------------------------------------------------------------
// Internal storage (TechSpec "Core Interfaces")
// ---------------------------------------------------------------------------

/**
 * Lifecycle record persisted by the store, keyed by `chargeId`. `outcome` is the
 * resolved magic-card scenario — the {@link Outcome} union owned by the resolver
 * (`src/magic/cards.ts`, Task 04). The earlier `string` typing was a placeholder
 * until that module existed; it is now narrowed to the union.
 */
export interface OrderRecord {
  orderId: string;
  chargeId: string;
  cardId: string;
  code: string;
  amount: number;
  status: ChargeStatus;
  outcome: Outcome;
  metadata: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Request models — loose by design
// ---------------------------------------------------------------------------
//
// The consuming app pre-validates every request (`_idea.md` §4.1), so these
// types capture only the fields the fake actually reads and leave an index
// signature open for everything else it forwards untouched.

/** New-card details inside an order or token request. */
export interface CardInput {
  number?: string;
  holder_name?: string;
  exp_month?: number;
  exp_year?: number;
  cvv?: string;
  [key: string]: unknown;
}

/**
 * The `credit_card` block of an order payment. Outcome resolution reads
 * `card.number`, `card_id`, or `card_token`; the builders read
 * `operation_type` and `installments`.
 */
export interface CreditCardInput {
  card?: CardInput;
  card_id?: string;
  card_token?: string;
  operation_type?: string;
  installments?: number;
  statement_descriptor?: string;
  [key: string]: unknown;
}

/** A single entry of the order request's `payments` array. */
export interface PaymentInput {
  amount?: number;
  payment_method?: string;
  credit_card?: CreditCardInput;
  [key: string]: unknown;
}

/** `POST /core/v5/orders` request — only the read fields are typed. */
export interface OrderRequest {
  payments?: PaymentInput[];
  code?: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

/** `POST /core/v5/charges/{id}/capture` request body (`_idea.md` §4.2). */
export interface CaptureRequest {
  amount?: number;
  [key: string]: unknown;
}

/** `DELETE /core/v5/charges/{id}` request body — empty (full) or `{ amount }` (partial). */
export interface CancelRequest {
  amount?: number;
  [key: string]: unknown;
}

/** `POST /core/v5/tokens` request body (`_idea.md` §4.4). */
export interface TokenRequest {
  card?: CardInput;
  type?: string;
  [key: string]: unknown;
}
