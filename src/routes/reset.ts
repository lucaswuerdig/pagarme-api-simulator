/**
 * `POST /__reset` — test-only store reset (ADR-005). Clears every record so a
 * suite can start from a known-empty state on a shared instance, then returns
 * HTTP 204.
 *
 * NOT a Pagar.me route: documented purely as a homologation helper and never
 * relied on by the consuming app. Mounted at the root, outside the `/core/v5`
 * prefix.
 *
 * Because the fake is a single always-on shared instance, an unauthenticated
 * global clear would let any caller — or one suite's teardown — wipe another
 * suite's in-flight orders (Issue 005). That risk is now closed by the shared
 * token-auth gate (`requireToken`), which `registerRoutes` mounts immediately
 * before this router (ADR-002, ADR-003): a caller proves authorization the same
 * way as for every `/core/v5` route — a valid token via `Authorization: Basic`.
 * The earlier per-route shared-secret header guard is retired, so once a request
 * is past the gate the clear is unconditional.
 */

import { Router, type Request, type Response } from "express";
import type { OrderStore } from "../store/orderStore";

/** Build the `POST /__reset` router backed by the injected {@link OrderStore}. */
export function resetRouter(store: OrderStore): Router {
  const router = Router();
  router.post("/__reset", async (_req: Request, res: Response) => {
    await store.clear();
    res.status(204).end();
  });
  return router;
}
