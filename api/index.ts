/**
 * Vercel serverless function entrypoint (ADR-006).
 *
 * Wraps the existing Express app as a single Vercel function. `vercel.json`
 * rewrites every path to `/api`, so the original `/core/v5/...` URL — including
 * the dynamic `charge_id` — reaches this handler unchanged and Express does the
 * routing. An Express app is itself a `(req, res)` handler, so the `@vercel/node`
 * runtime invokes the default export directly; no `serverless-http` wrapper is
 * needed.
 *
 * The store backend is chosen by `createStore` from `STORE_BACKEND`: Vercel sets
 * `STORE_BACKEND=kv` (with `KV_REST_API_URL` / `KV_REST_API_TOKEN`) so lifecycle
 * state lives in Vercel KV and survives stateless invocations and cold starts;
 * local dev and CI leave it unset and fall back to the in-memory store.
 *
 * Required Vercel environment variables (see `.env.example`):
 *   - STORE_BACKEND     = "kv"
 *   - KV_REST_API_URL   = <Vercel KV REST URL>
 *   - KV_REST_API_TOKEN = <Vercel KV REST token>
 */
import type { Express } from "express";
import { createPagarmeApp } from "../src/server";
import { createStore } from "../src/store";

/**
 * Build the fully-wired Express app for the given environment, selecting the
 * {@link OrderStore} backend via {@link createStore}. Exported so the backend
 * wiring is testable (e.g. `STORE_BACKEND=kv` → `KvOrderStore`) without booting
 * the module-level singleton or opening a real KV connection.
 */
export function buildApp(env: NodeJS.ProcessEnv = process.env): Express {
  return createPagarmeApp(createStore(env));
}

/**
 * The Vercel function handler. Built once at module load from the ambient
 * environment (`STORE_BACKEND=kv` on Vercel → Vercel KV; unset locally → memory).
 */
const app = buildApp();

export default app;
