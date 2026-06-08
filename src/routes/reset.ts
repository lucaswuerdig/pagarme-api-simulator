/**
 * `POST /__reset` — test-only store reset (ADR-005). Clears every record so a
 * suite can start from a known-empty state on a shared instance, then returns
 * HTTP 204.
 *
 * NOT a Pagar.me route: documented purely as a homologation helper and never
 * relied on by the consuming app. Mounted at the root, outside the `/core/v5`
 * prefix.
 *
 * Because the fake is designed as a single always-on shared instance (the whole
 * team points at one homologation URL), an unauthenticated global clear lets any
 * caller — or one suite's teardown — wipe another suite's in-flight orders
 * mid-run (Issue 005). The route is therefore guarded by an optional shared
 * secret: when `RESET_SECRET` is set, a request must carry a matching
 * `x-reset-secret` header or it is rejected with 401, making teardown opt-in for
 * a controlled caller. When the secret is unset (local dev, hermetic CI) the
 * route stays open, preserving the original behavior. The env var is read once
 * at build time, mirroring `resolvePort`/`createStore`.
 */

import { Router, type Request, type Response } from "express";
import type { OrderStore } from "../store/orderStore";

/** Request header carrying the shared reset secret on a guarded `POST /__reset`. */
export const RESET_SECRET_HEADER = "x-reset-secret";

/**
 * Build the `POST /__reset` router backed by the injected {@link OrderStore},
 * optionally guarded by `RESET_SECRET` (see module docs). `env` is a parameter so
 * tests can inject the secret without mutating the ambient process environment.
 */
export function resetRouter(store: OrderStore, env: NodeJS.ProcessEnv = process.env): Router {
  const router = Router();
  const secret = env.RESET_SECRET;
  router.post("/__reset", async (req: Request, res: Response) => {
    // Guard only when a secret is configured; an open instance is unchanged.
    if (secret && req.get(RESET_SECRET_HEADER) !== secret) {
      res.status(401).json({
        error: "unauthorized",
        message: "POST /__reset requires a valid x-reset-secret header.",
      });
      return;
    }
    await store.clear();
    res.status(204).end();
  });
  return router;
}
