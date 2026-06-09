/**
 * Token-auth Express gate (ADR-003).
 *
 * A thin adapter that turns the pure helpers in `src/auth/tokens.ts` into a
 * request guard. It owns no token-matching logic of its own: it pulls the token
 * out of the `Authorization: Basic` header via {@link parseBasicToken}, asks
 * {@link isValidToken} whether it is allowlisted, and either passes the request
 * through or rejects it with HTTP 401.
 *
 * Mounting happens elsewhere (`src/routes/index.ts`, Task 03): registered once
 * after the open `healthRouter` and before `resetRouter`, this single gate guards
 * `POST /__reset` and every `/core/v5` route. The 401 body uses the repo-standard
 * `{ error, message }` shape, matching the 404 fallback in `src/server.ts`.
 *
 * The full token is never logged here (ADR-001/ADR-003).
 */

import type { NextFunction, Request, Response } from "express";
import { isValidToken, parseBasicToken } from "./tokens";

/**
 * Express middleware that requires a valid API token on the request.
 *
 * Calls `next()` and returns without touching the response when the
 * `Authorization: Basic base64("<token>:")` header carries an allowlisted token.
 * Otherwise — header missing, malformed, or carrying an unlisted token — it sends
 * a single `401 { error: "unauthorized", message }` and does not call `next()`.
 */
export function requireToken(req: Request, res: Response, next: NextFunction): void {
  if (isValidToken(parseBasicToken(req.headers.authorization))) {
    next();
    return;
  }
  res.status(401).json({
    error: "unauthorized",
    message: "A valid API token is required.",
  });
}
