/**
 * `POST /core/v5/orders` response builder (`_idea.md` §4.1, §8).
 *
 * Pure function: given the persisted {@link OrderRecord} (whose `outcome` is the
 * resolved magic-card scenario) plus the request fields the body echoes, it
 * assembles the contract-faithful order body. The body shape varies ONLY by the
 * resolved outcome (ADR-003); the record supplies the lifecycle ids/amount/code
 * minted at creation so the body stays coherent with later capture/cancel calls
 * (ADR-001).
 *
 * It owns every ⭐ field the consuming app reads downstream (`_idea.md` §8) and
 * keeps the body-based approval rules of `_idea.md` §3.1: success outcomes set
 * root `status` ≠ `failed`, `last_transaction.status` ∈
 * {`captured`,`authorized_pending_capture`}, and `success: true`; non-success
 * outcomes set `success: false` and/or a failing status, or root `status: failed`.
 *
 * No store, network, HTTP, or clock access — only a fresh per-response
 * `last_transaction.id` is minted (transaction ids are ephemeral per operation).
 */

import type { Outcome } from "../magic/cards";
import type {
  ChargeStatus,
  Customer,
  Order,
  OrderMetadata,
  OrderRecord,
  Transaction,
} from "../types/pagarme";
import { newTransactionId } from "../util/ids";
import {
  ACQUIRER_AUTH_CODE,
  ACQUIRER_NAME,
  ACQUIRER_NSU,
  ACQUIRER_TID,
  buildCard,
  type CardSource,
} from "./card";

/** Currency the fake always reports (BRL homologation). */
const CURRENCY = "BRL";

/** Outcomes that produce an order body. `gateway_unavailable` returns a 5xx with no body. */
type BodyOutcome = Exclude<Outcome, "gateway_unavailable">;

/** Fields shared by every body outcome (`_idea.md` §3.1, §4.1). */
interface BaseOutcomeShape {
  /** Root order + `charges[0]` status. */
  rootStatus: ChargeStatus;
  /** `last_transaction.status`. */
  txStatus: string;
  /** `acquirer_return_code` (`"00"` on approval, `"57"` on decline, `_idea.md` §4.1). */
  returnCode: string;
  /** Forces the transaction `operation_type` (auth-only pre-auth); otherwise echoed from the request. */
  operationType?: string;
}

/**
 * How each body outcome maps onto the wire fields the parser reads. The
 * `success` discriminant ties the failure variant to a required `declineMessage`
 * (the acquirer message attached to `gateway_response`), so a failure shape can
 * never omit it.
 */
type OrderOutcomeShape =
  | (BaseOutcomeShape & { success: true })
  | (BaseOutcomeShape & { success: false; declineMessage: string });

/**
 * The single source of body-shape truth per outcome (`_idea.md` §3.2, §4.1).
 * `declined`/`transaction_error`/`order_failed` all set root `status: failed`
 * (the decline example in §4.1) so the parser's first success condition fails;
 * each still carries a `charges[0].last_transaction` so the parser never reads
 * through an empty `charges[]`.
 */
const ORDER_OUTCOME_SHAPES: Readonly<Record<BodyOutcome, OrderOutcomeShape>> = {
  approved_captured: {
    rootStatus: "paid",
    txStatus: "captured",
    success: true,
    returnCode: "00",
  },
  approved_no_capture: {
    rootStatus: "authorized_pending_capture",
    txStatus: "authorized_pending_capture",
    success: true,
    returnCode: "00",
    operationType: "auth_only",
  },
  declined: {
    rootStatus: "failed",
    txStatus: "not_authorized",
    success: false,
    returnCode: "57",
    declineMessage: "Transação não autorizada",
  },
  transaction_error: {
    rootStatus: "failed",
    txStatus: "with_error",
    success: false,
    returnCode: "99",
    declineMessage: "Erro ao processar a transação",
  },
  order_failed: {
    rootStatus: "failed",
    txStatus: "not_authorized",
    success: false,
    returnCode: "99",
    declineMessage: "Pedido não processado",
  },
};

/** Request-derived fields the order body echoes (the record holds the rest). */
export interface OrderResponseInput {
  /** `payments[0].credit_card.card` — absent for tokenized flows. */
  card?: CardSource;
  /** `payments[0].credit_card.operation_type` (e.g. `auth_and_capture`, `auth_only`). */
  operationType?: string;
  /** `payments[0].credit_card.installments` (defaults to 1). */
  installments?: number;
  /** `payments[0].credit_card.statement_descriptor`. */
  statementDescriptor?: string;
  /** Customer block to echo back in the order body. */
  customer?: Customer;
}

/** Build the `last_transaction` for the order body from the resolved outcome. */
function buildOrderTransaction(
  shape: OrderOutcomeShape,
  record: OrderRecord,
  input: OrderResponseInput,
): Transaction {
  const tx: Transaction = {
    id: newTransactionId(),
    transaction_type: "credit_card",
    amount: record.amount,
    status: shape.txStatus,
    success: shape.success,
    acquirer_name: ACQUIRER_NAME,
    acquirer_return_code: shape.returnCode,
    operation_type: shape.operationType ?? input.operationType ?? "auth_and_capture",
    installments: input.installments ?? 1,
    card: buildCard(record.cardId, input.card),
  };
  if (input.statementDescriptor !== undefined) {
    tx.statement_descriptor = input.statementDescriptor;
  }
  if (shape.success) {
    // Approved: echo the acquirer NSU/TID/auth-code the consuming app records (`_idea.md` §4.1).
    tx.acquirer_tid = ACQUIRER_TID;
    tx.acquirer_nsu = ACQUIRER_NSU;
    tx.acquirer_auth_code = ACQUIRER_AUTH_CODE;
  } else {
    // Decline/error: the acquirer message the consuming app surfaces to the buyer (`_idea.md` §4.1).
    tx.gateway_response = {
      code: shape.returnCode,
      errors: [{ message: shape.declineMessage }],
    };
  }
  return tx;
}

/**
 * Assemble the `POST /core/v5/orders` response body for the record's resolved
 * outcome. Throws for `gateway_unavailable`, which has no order body — the route
 * returns a 5xx for that scenario (`_idea.md` §3.3, §4.1).
 */
export function buildOrderResponse(record: OrderRecord, input: OrderResponseInput = {}): Order {
  if (record.outcome === "gateway_unavailable") {
    throw new Error(
      "buildOrderResponse: 'gateway_unavailable' has no order body — the route returns a 5xx (_idea.md §3.3, §4.1).",
    );
  }
  const shape = ORDER_OUTCOME_SHAPES[record.outcome];
  const transaction = buildOrderTransaction(shape, record, input);

  const order: Order = {
    id: record.orderId,
    code: record.code,
    status: shape.rootStatus,
    amount: record.amount,
    currency: CURRENCY,
    closed: true,
    charges: [
      {
        id: record.chargeId,
        code: record.code,
        amount: record.amount,
        status: shape.rootStatus,
        payment_method: "credit_card",
        last_transaction: transaction,
      },
    ],
    metadata: record.metadata as OrderMetadata,
  };
  if (input.customer !== undefined) {
    order.customer = input.customer;
  }
  return order;
}
