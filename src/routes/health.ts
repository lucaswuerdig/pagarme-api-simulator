/**
 * `GET /health` — liveness route (TechSpec "API Endpoints",
 * "Monitoring and Observability"). Returns `{ "status": "ok" }` at HTTP 200.
 *
 * NOT a Pagar.me route: it is the homologation/operator liveness check, mounted
 * at the root rather than under the `/core/v5` prefix.
 */

import { Router, type Request, type Response } from "express";

/** Build the `GET /health` router. Stateless — no store dependency. */
export function healthRouter(): Router {
  const router = Router();
  router.get("/health", (_req: Request, res: Response) => {
    res.status(200).json({ status: "ok" });
  });
  return router;
}
