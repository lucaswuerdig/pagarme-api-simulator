/**
 * `POST /core/v5/tokens` — card tokenization (`_idea.md` §4.4).
 *
 * Tokenization is stateless beyond echoing the card metadata (TechSpec "Data
 * Flow"): there is no record to persist, so the handler delegates to the pure
 * token builder, which mints a fresh `token`/`card` id pair and derives the ⭐
 * card display fields from the request card. Returns the token body at HTTP 201.
 *
 * The `appId` query string (the public key) and the `Authorization` header are
 * accepted and ignored (`_idea.md` §2). The optional tokenization error response
 * (`_idea.md` §4.4, HTTP 4xx) is out of scope for the MVP — every token request
 * succeeds.
 */

import { Router, type Request, type Response } from "express";
import { buildTokenResponse } from "../responses/tokenResponse";
import type { TokenRequest } from "../types/pagarme";

/** Build the `POST /core/v5/tokens` router. Stateless — no store dependency. */
export function tokensRouter(): Router {
  const router = Router();
  router.post("/tokens", (req: Request, res: Response) => {
    const body = req.body as TokenRequest;
    const token = buildTokenResponse({
      card: body.card,
      type: body.type,
      now: new Date(),
    });
    res.status(201).json(token);
  });
  return router;
}
