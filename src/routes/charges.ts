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
import type { CancelRequest, CaptureRequest, Charge, OrderRecord } from "../types/pagarme";
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

/**
 * Body-level "invalid charge transition" error returned at HTTP 200 when capture
 * or cancel targets a charge whose persisted `status` forbids the operation —
 * capturing a charge that never authorized (`failed`) or was already captured
 * (`paid`), or canceling one that is already canceled/refunded/failed (Issue
 * 004). The real gateway rejects these transitions; mirroring the
 * {@link chargeNotFound} shape (`last_transaction.status = "with_error"`,
 * `success: false`) makes the consuming app's success predicate fail on the body
 * rather than via an infra-level 4xx (`_idea.md` §3.3). Unlike not-found, the
 * charge exists, so its real `id`/`code`/`amount`/`status` are echoed unchanged —
 * the rejected operation persists nothing.
 */
function invalidTransition(record: OrderRecord, message: string): Charge {
  return {
    id: record.chargeId,
    code: record.code,
    amount: record.amount,
    status: record.status,
    payment_method: "credit_card",
    last_transaction: {
      id: newTransactionId(),
      transaction_type: "credit_card",
      amount: record.amount,
      status: "with_error",
      success: false,
      acquirer_name: ACQUIRER_NAME,
      acquirer_return_code: "99",
      gateway_response: {
        code: "422",
        errors: [{ message }],
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
    // Expose the looked-up charge_id to the request logger (Issue 003).
    res.locals.chargeId = chargeId;
    const record = await store.get(chargeId);
    if (record === undefined) {
      res.status(200).json(chargeNotFound(chargeId));
      return;
    }
    // Capture only applies to a prior authorization still awaiting capture. The
    // real gateway rejects a capture against a charge that never authorized
    // (`failed`), was already captured (`paid`), or was canceled/refunded — so
    // return a body-level error instead of minting a bogus `captured`
    // transaction (Issue 004).
    if (record.status !== "authorized_pending_capture") {
      res
        .status(200)
        .json(
          invalidTransition(
            record,
            `charge ${chargeId} cannot be captured from status ${record.status}`,
          ),
        );
      return;
    }
    const body = req.body as CaptureRequest;
    await store.update(chargeId, { status: "paid" });
    res.status(200).json(buildCaptureResponse(record, { amount: body.amount }));
  });

  // Cancel/refund a charge. The prior state picks the kind, mirroring the real
  // gateway (`_idea.md` §4.3 — "voided (cancelamento) ou refunded (estorno)"):
  // a captured/`paid` sale is reversed as a refund → `refunded` +
  // `refunded_amount`, while any not-yet-captured charge (e.g. an
  // `authorized_pending_capture` auth) is voided → `voided` + `canceled_amount`.
  // The persisted status is updated to match so the stored record stays coherent.
  router.delete("/charges/:id", async (req: Request, res: Response) => {
    const chargeId = req.params.id;
    // Expose the looked-up charge_id to the request logger (Issue 003).
    res.locals.chargeId = chargeId;
    const record = await store.get(chargeId);
    if (record === undefined) {
      res.status(200).json(chargeNotFound(chargeId));
      return;
    }
    // Cancel/refund only applies to a charge that still holds funds: a captured
    // `paid` sale (reversed as a refund) or an uncaptured
    // `authorized_pending_capture` auth (voided). A charge that is already
    // canceled/refunded, or that never authorized (`failed`), cannot be reversed
    // — the real gateway rejects the transition, so return a body-level error
    // rather than a second bogus `voided`/`refunded` transaction (Issue 004).
    if (record.status !== "paid" && record.status !== "authorized_pending_capture") {
      res
        .status(200)
        .json(
          invalidTransition(
            record,
            `charge ${chargeId} cannot be canceled from status ${record.status}`,
          ),
        );
      return;
    }
    const body = req.body as CancelRequest;
    const kind = record.status === "paid" ? "refund" : "void";
    await store.update(chargeId, { status: kind === "refund" ? "refunded" : "canceled" });
    res.status(200).json(buildCancelResponse(record, { amount: body.amount, kind }));
  });

  return router;
}
