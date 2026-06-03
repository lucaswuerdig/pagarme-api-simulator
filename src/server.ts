import express, { type Express, type Request, type Response } from "express";
import type { Server } from "node:http";
import { registerRoutes } from "./routes";
import { createStore } from "./store";
import { InMemoryOrderStore } from "./store/inMemoryOrderStore";
import type { OrderStore } from "./store/orderStore";

/** Default port used when `PORT` is not provided by the environment. */
export const DEFAULT_PORT = 8088;

/**
 * Resolve the listen port from the environment, falling back to
 * {@link DEFAULT_PORT} when `PORT` is unset or not a positive integer.
 */
export function resolvePort(env: NodeJS.ProcessEnv = process.env): number {
  const parsed = Number.parseInt(env.PORT ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_PORT;
}

/**
 * Build the bare Express application: JSON body parsing plus a JSON 404
 * fallback. No business routes are mounted here — later tasks register the
 * Pagar.me routes via the `mountRoutes` callback (or by extending this
 * factory) so they take precedence over the 404 fallback.
 */
export function createApp(mountRoutes?: (app: Express) => void): Express {
  const app = express();

  // Parse JSON request bodies so every later route receives a parsed body.
  app.use(express.json());

  mountRoutes?.(app);

  // JSON 404 fallback for any unmatched route. Registered last so mounted
  // routes always win.
  app.use((req: Request, res: Response) => {
    res.status(404).json({
      error: "not_found",
      message: `Cannot ${req.method} ${req.path}`,
    });
  });

  return app;
}

/**
 * Build the fully-wired fake Pagar.me app: the bare {@link createApp} scaffold
 * with every route mounted (via the `mountRoutes` callback, so they register
 * before the 404 fallback) and the {@link OrderStore} injected into the stateful
 * handlers.
 *
 * The store is a parameter so tests can supply their own in-memory store and a
 * later task can drop in a different backend (e.g. Vercel KV) without touching
 * any route — it defaults to a fresh {@link InMemoryOrderStore} for local dev.
 */
export function createPagarmeApp(store: OrderStore = new InMemoryOrderStore()): Express {
  return createApp((app) => registerRoutes(app, store));
}

/** Shared application instance imported by tests and the Vercel function shim. */
export const app = createPagarmeApp();

/**
 * Start an HTTP listener on the resolved port (defaults to {@link DEFAULT_PORT}).
 * The application defaults to the shared {@link app} singleton; callers can pass
 * a differently-wired app (e.g. one built from a non-default store backend).
 */
export function start(port: number = resolvePort(), application: Express = app): Server {
  return application.listen(port, () => {
    console.log(`fake pagar.me test double listening on port ${port}`);
  });
}

/* c8 ignore start -- bootstrap guard only runs when the module is executed directly */
if (require.main === module) {
  // Direct run (`node dist/server.js`, e.g. the local Docker image): select the
  // store backend from `STORE_BACKEND` via the Task 07 factory so local runs can
  // use KV/Redis, not just the in-memory default (TechSpec step 11, ADR-006).
  start(undefined, createPagarmeApp(createStore()));
}
/* c8 ignore stop */
