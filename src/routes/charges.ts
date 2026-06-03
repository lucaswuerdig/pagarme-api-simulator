/**
 * Charge lifecycle routes: capture (`POST /core/v5/charges/:id/capture`,
 * `_idea.md` §4.2) and cancel/refund (`DELETE /core/v5/charges/:id`, §4.3).
 *
 * Both resolve the prior charge from the store by `charge_id` (ADR-001) so the
 * returned `id`/`code`/`amount` echo the original sale, then return a charge
 * object with root-level `last_transaction` at HTTP 200. An unknown `charge_id`
 * yields a body-level error at HTTP 200 (never a 4xx, which would short-circuit
 * the consuming app's body parser — `_idea.md` §3.3).
 */

import { Router, type Request, type Response } from "express";
import { ACQUIRER_NAME } from "../responses/card";
import { buildCancelResponse, buildCaptureResponse } from "../responses/chargeResponse";
import type { OrderStore } from "../store/orderStore";
import type { CancelRequest, CaptureRequest, Charge } from "../types/pagarme";
import { newTransactionId } from "../util/ids";

/**
 * Body-level "charge not found" error returned at HTTP 200 when capture or cancel
 * targets an unknown `charge_id` (`_idea.md` §3.3; TechSpec "Error handling
 * conventions"). `last_transaction.status = "with_error"` and `success: false`,
 * with root `status: failed`, so the consuming app's success predicate fails on
 * the body rather than via an infra-level 4xx.
 */
function chargeNotFound(chargeId: string): Charge {
  return {
    id: chargeId,
    amount: 0,
    status: "failed",
    payment_method: "credit_card",
    last_transaction: {
      id: newTransactionId(),
      transaction_type: "credit_card",
      amount: 0,
      status: "with_error",
      success: false,
      acquirer_name: ACQUIRER_NAME,
      acquirer_return_code: "99",
      gateway_response: {
        code: "404",
        errors: [{ message: `charge ${chargeId} not found` }],
      },
    },
  };
}

/** Build the capture + cancel router backed by the injected {@link OrderStore}. */
export function chargesRouter(store: OrderStore): Router {
  const router = Router();

  // Capture a prior authorization: mark the stored charge captured and return a
  // charge with a captured/success `last_transaction` (`_idea.md` §4.2).
  router.post("/charges/:id/capture", async (req: Request, res: Response) => {
    const chargeId = req.params.id;
    const record = await store.get(chargeId);
    if (record === undefined) {
      res.status(200).json(chargeNotFound(chargeId));
      return;
    }
    const body = req.body as CaptureRequest;
    await store.update(chargeId, { status: "paid" });
    res.status(200).json(buildCaptureResponse(record, { amount: body.amount }));
  });

  // Cancel/refund a charge. The default is a void → `voided` + `canceled_amount`
  // (the §4.3 default example and the sale→cancel lifecycle); the builder's
  // refund path stays available for callers that need an explicit estorno.
  router.delete("/charges/:id", async (req: Request, res: Response) => {
    const chargeId = req.params.id;
    const record = await store.get(chargeId);
    if (record === undefined) {
      res.status(200).json(chargeNotFound(chargeId));
      return;
    }
    const body = req.body as CancelRequest;
    await store.update(chargeId, { status: "canceled" });
    res.status(200).json(buildCancelResponse(record, { amount: body.amount }));
  });

  return router;
}
