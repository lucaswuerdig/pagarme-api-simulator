/**
 * `POST /__reset` — test-only store reset (ADR-005). Clears every record so a
 * suite can start from a known-empty state on a shared instance, then returns
 * HTTP 204.
 *
 * NOT a Pagar.me route: documented purely as a homologation helper and never
 * relied on by the consuming app. Mounted at the root, outside the `/core/v5`
 * prefix.
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
