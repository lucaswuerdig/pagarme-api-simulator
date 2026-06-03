/**
 * Charge response builders for capture (`POST /core/v5/charges/{id}/capture`,
 * `_idea.md` §4.2) and cancel/refund (`DELETE /core/v5/charges/{id}`, §4.3).
 *
 * Both routes return a **charge object** with `last_transaction` at the ROOT —
 * NOT nested inside a `charges[]` array as the order body does (`_idea.md`
 * §4.2–4.3). These builders read the persisted {@link OrderRecord} so the
 * returned `id`/`code`/`amount` match the original sale (ADR-001), keeping the
 * sale → capture → cancel lifecycle coherent.
 *
 * Pure: no store, network, HTTP, or clock — only a fresh per-operation
 * `last_transaction.id` is minted (each capture/cancel is its own transaction,
 * `_idea.md` §4.2–4.3).
 */

import type { Charge, OrderRecord, Transaction } from "../types/pagarme";
import { newTransactionId } from "../util/ids";
import { ACQUIRER_NAME, ACQUIRER_NSU, ACQUIRER_TID, buildCard } from "./card";

/** Request fields read by the capture route (`_idea.md` §4.2 body `{ amount }`). */
export interface CaptureResponseInput {
  /** Capture amount; defaults to the original charge amount from the record. */
  amount?: number;
}

/**
 * Build the capture success response: a charge with root-level `last_transaction`
 * at `status: captured`, `success: true` (`_idea.md` §4.2, §8). The charge keeps
 * the original `id`/`code`/`amount` from the record so the consuming app's
 * follow-up reads line up.
 */
export function buildCaptureResponse(
  record: OrderRecord,
  input: CaptureResponseInput = {},
): Charge {
  const transaction: Transaction = {
    id: newTransactionId(),
    transaction_type: "credit_card",
    amount: input.amount ?? record.amount,
    status: "captured",
    success: true,
    operation_type: "capture",
    acquirer_name: ACQUIRER_NAME,
    acquirer_return_code: "00",
    acquirer_tid: ACQUIRER_TID,
    acquirer_nsu: ACQUIRER_NSU,
    card: buildCard(record.cardId),
  };
  return {
    id: record.chargeId,
    code: record.code,
    amount: record.amount,
    status: "paid",
    payment_method: "credit_card",
    last_transaction: transaction,
  };
}

/** Whether a cancellation voids an uncaptured auth or refunds a captured charge (`_idea.md` §4.3). */
export type CancelKind = "void" | "refund";

/** Request fields read by the cancel/refund route (`_idea.md` §4.3 — empty body or `{ amount }`). */
export interface CancelResponseInput {
  /** Canceled/refunded amount; defaults to the full original charge amount. */
  amount?: number;
  /** `void` (cancel an auth) or `refund` (reverse a captured charge). Defaults to `void`. */
  kind?: CancelKind;
}

/**
 * Build the cancel/refund success response: a charge with root-level
 * `last_transaction` at `status: voided` (cancel) or `refunded` (refund),
 * `success: true`, plus the matching `canceled_amount`/`refunded_amount`
 * (`_idea.md` §4.3, §8). Following §4.3, the cancel transaction carries no `card`.
 */
export function buildCancelResponse(
  record: OrderRecord,
  input: CancelResponseInput = {},
): Charge {
  const isRefund = input.kind === "refund";
  const amount = input.amount ?? record.amount;

  const transaction: Transaction = {
    id: newTransactionId(),
    transaction_type: "credit_card",
    amount,
    status: isRefund ? "refunded" : "voided",
    success: true,
    operation_type: isRefund ? "refund" : "void",
    acquirer_name: ACQUIRER_NAME,
    acquirer_return_code: "00",
  };

  const charge: Charge = {
    id: record.chargeId,
    code: record.code,
    amount: record.amount,
    status: isRefund ? "refunded" : "canceled",
    payment_method: "credit_card",
    last_transaction: transaction,
  };
  if (isRefund) {
    charge.refunded_amount = amount;
  } else {
    charge.canceled_amount = amount;
  }
  return charge;
}
