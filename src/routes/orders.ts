/**
 * `POST /core/v5/orders` — create order (sale or pre-authorization, `_idea.md`
 * §4.1).
 *
 * The handler is thin: it resolves the deterministic outcome from the incoming
 * card (ADR-003, the magic-card resolver), and for the simulated outage card
 * returns a 5xx with no body — the ONLY non-200 path (`_idea.md` §3.3). For every
 * business outcome it mints the lifecycle ids, persists an {@link OrderRecord}
 * keyed by `chargeId` so a later capture/cancel resolves the same charge
 * (ADR-001), and returns the contract-faithful order body at HTTP 200. Approval,
 * decline, transaction error, and order failure are all conveyed in the body
 * (`last_transaction.status` + `success`, `_idea.md` §3.1), never the HTTP status.
 */

import { Router, type Request, type Response } from "express";
import { resolveOutcome, type Outcome } from "../magic/cards";
import { buildOrderResponse } from "../responses/orderResponse";
import type { OrderStore } from "../store/orderStore";
import type {
  ChargeStatus,
  Customer,
  OrderRecord,
  OrderRequest,
} from "../types/pagarme";
import { newCardId, newChargeId, newOrderId } from "../util/ids";

/**
 * Root/charge `status` persisted on the record per resolved outcome. Declines,
 * transaction errors, and order failures all persist `failed` (the decline
 * example in `_idea.md` §4.1) so the consuming app's success predicate fails on
 * the body (`_idea.md` §3.1). `gateway_unavailable` is intentionally absent: it
 * is handled before persistence (a 5xx with no body, `_idea.md` §3.3).
 */
const PERSISTED_STATUS: Readonly<
  Record<Exclude<Outcome, "gateway_unavailable">, ChargeStatus>
> = {
  approved_captured: "paid",
  approved_no_capture: "authorized_pending_capture",
  declined: "failed",
  transaction_error: "failed",
  order_failed: "failed",
};

/** Build the `POST /core/v5/orders` router backed by the injected {@link OrderStore}. */
export function ordersRouter(store: OrderStore): Router {
  const router = Router();
  router.post("/orders", async (req: Request, res: Response) => {
    const body = req.body as OrderRequest;
    const payment = body.payments?.[0] ?? {};
    const creditCard = payment.credit_card ?? {};
    const card = creditCard.card;

    const outcome = resolveOutcome({
      number: card?.number,
      cardId: creditCard.card_id,
      cardToken: creditCard.card_token,
    });

    // Simulated gateway outage: the only 5xx path. No record is persisted and no
    // order body is built (`_idea.md` §3.3, §4.1).
    if (outcome === "gateway_unavailable") {
      res.status(503).json({ message: "service unavailable" });
      return;
    }

    const record: OrderRecord = {
      orderId: newOrderId(),
      chargeId: newChargeId(),
      cardId: newCardId(),
      code: body.code ?? "",
      amount: payment.amount ?? 0,
      status: PERSISTED_STATUS[outcome],
      outcome,
      metadata: body.metadata ?? {},
    };
    await store.create(record);

    const order = buildOrderResponse(record, {
      card,
      operationType: creditCard.operation_type,
      installments: creditCard.installments,
      statementDescriptor: creditCard.statement_descriptor,
      customer: body.customer as Customer | undefined,
    });
    res.status(200).json(order);
  });
  return router;
}
