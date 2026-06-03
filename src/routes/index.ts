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

import type { Express } from "express";
import type { OrderStore } from "../store/orderStore";
import { chargesRouter } from "./charges";
import { healthRouter } from "./health";
import { ordersRouter } from "./orders";
import { resetRouter } from "./reset";
import { tokensRouter } from "./tokens";

/** Register the health, reset, and `/core/v5` Pagar.me routes on `app`. */
export function registerRoutes(app: Express, store: OrderStore): void {
  app.use(healthRouter());
  app.use(resetRouter(store));
  app.use("/core/v5", ordersRouter(store));
  app.use("/core/v5", chargesRouter(store));
  app.use("/core/v5", tokensRouter());
}
