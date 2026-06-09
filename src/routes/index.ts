/**
 * Route registration: mount every router on the app, injecting the
 * {@link OrderStore} into the stateful handlers (ADR-005).
 *
 * The five Pagar.me routes are served under the `/core/v5` prefix exactly as the
 * real API, because the consuming app concatenates `apiUrl + resource` and those
 * resources already include `/core/v5/...` (`_idea.md` §7). `GET /health` and the
 * test-only `POST /__reset` are mounted at the root. This is invoked through the
 * `createApp` callback (see `server.ts`) so the routes register BEFORE the
 * terminal JSON 404 fallback and therefore take precedence over it.
 */

import type { Express, NextFunction, Request, Response } from "express";
import { requireToken } from "../auth/middleware";
import type { OrderStore } from "../store/orderStore";
import { chargesRouter } from "./charges";
import { healthRouter } from "./health";
import { ordersRouter } from "./orders";
import { resetRouter } from "./reset";
import { tokensRouter } from "./tokens";

/**
 * Structured per-request logger for the `/core/v5/...` routes (TechSpec
 * §"Monitoring and Observability"). The shared homologation instance has no
 * custom metrics by design, so this single line is the operator's only way —
 * from the Vercel function logs — to confirm which scenario a request resolved
 * to and to spot a store outage.
 *
 * It captures `method`/`path` synchronously (from `req.originalUrl` with the
 * query string stripped, so the tokenization `appId` public key never lands in
 * the log) and, once the response is flushed (`finish`), emits exactly one
 * `console.log(JSON.stringify(...))` line carrying the method, path, the resolved
 * business `outcome` and minted/looked-up `charge_id` (read from `res.locals`,
 * populated by the stateful handlers), and the final HTTP status.
 *
 * Privacy: ONLY the resolved `outcome`, `charge_id`, and `status` are logged —
 * never card numbers, CVV, or holder PII (`_idea.md` §2). Store/KV failures are
 * logged distinctly via the handlers' `console.error` (Issue 001), so an outage
 * stays diagnosable alongside this per-request line.
 */
function logRequests(req: Request, res: Response, next: NextFunction): void {
  const method = req.method;
  const path = req.originalUrl.split("?")[0];
  res.on("finish", () => {
    const line: Record<string, unknown> = { method, path };
    if (res.locals.outcome !== undefined) line.outcome = res.locals.outcome;
    if (res.locals.chargeId !== undefined) line.charge_id = res.locals.chargeId;
    line.status = res.statusCode;
    console.log(JSON.stringify(line));
  });
  next();
}

/** Register the health, reset, and `/core/v5` Pagar.me routes on `app`. */
export function registerRoutes(app: Express, store: OrderStore): void {
  app.use(healthRouter());
  // Always-on token gate (ADR-001/002/003): mounted AFTER the open
  // `healthRouter` and BEFORE everything below, so `GET /health` stays public
  // while `POST /__reset` and every `/core/v5` route require a valid token.
  // Misordering would either expose `/__reset` or block the liveness probe.
  app.use(requireToken);
  app.use(resetRouter(store));
  // Structured per-request logging runs before the `/core/v5` routers so it
  // wraps every Pagar.me call (TechSpec §"Monitoring and Observability").
  app.use("/core/v5", logRequests);
  app.use("/core/v5", ordersRouter(store));
  app.use("/core/v5", chargesRouter(store));
  app.use("/core/v5", tokensRouter());
}
