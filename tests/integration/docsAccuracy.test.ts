import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import request from "supertest";
import { createPagarmeApp } from "../../src/server";
import { createStore } from "../../src/store";

/**
 * Doc ↔ behavior parity for Task 11. These tests prove the README is *accurate*,
 * not just internally consistent, by exercising the documented steps against the
 * running app:
 *   - the documented local-run default boots the in-memory service and
 *     `GET /health` returns 200 (doc-accuracy smoke test);
 *   - the README's documented sample `POST /core/v5/orders` request — extracted
 *     verbatim from the doc — produces the documented approved+captured outcome.
 *
 * Static content/link assertions live in `tests/unit/docs.test.ts`.
 */

const ROOT = process.cwd();
const readme = readFileSync(resolve(ROOT, "README.md"), "utf8");

/**
 * Build the app exactly as the documented local-run path does: `createStore`
 * with no `STORE_BACKEND` (empty env) falls back to the in-memory store — the
 * dependency-free default the README promises for `npm run dev` / `docker
 * compose up`.
 */
const buildDocumentedApp = () => createPagarmeApp(createStore({}));

/**
 * Extract the JSON fenced block the README marks as the sample order request, so
 * the test runs the *documented* request rather than a hand-rolled copy.
 */
function extractMarkedJson(markdown: string, marker: string): unknown {
  const afterMarker = markdown.split(marker)[1];
  expect(afterMarker, `README is missing the "${marker}" doctest marker`).toBeDefined();
  const fenced = /```json\s*\n([\s\S]*?)\n```/.exec(afterMarker);
  expect(fenced, `no \`\`\`json block follows "${marker}"`).not.toBeNull();
  return JSON.parse(fenced![1]);
}

describe("README local-run steps boot the service (doc-accuracy smoke test)", () => {
  it("GET /health returns 200 { status: ok } on the documented in-memory default", async () => {
    const res = await request(buildDocumentedApp()).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });
});

describe("documented sample order request matches behavior (doc ↔ behavior parity)", () => {
  it("the README sample POST /core/v5/orders returns the documented approved+captured outcome", async () => {
    const body = extractMarkedJson(readme, "<!-- doctest:orders-request -->");

    const res = await request(buildDocumentedApp())
      .post("/core/v5/orders")
      .send(body as Record<string, unknown>);

    // Documented in the catalog row for 4000000000000010: 200, paid, captured,
    // success:true (the body-based approval the consuming app's parser reads).
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("paid");
    const tx = res.body.charges[0].last_transaction;
    expect(tx.status).toBe("captured");
    expect(tx.success).toBe(true);
    // ⭐ fields the README promises the response carries (`_idea.md` §8).
    expect(res.body.code).toBe("PREFIXO_12345_a1b2c");
    expect(res.body.charges[0].id).toMatch(/^ch_fake_/);
    expect(tx.card.id).toMatch(/^card_fake_/);
    expect(res.body.metadata.site).toBe("Minha Loja");
  });
});
