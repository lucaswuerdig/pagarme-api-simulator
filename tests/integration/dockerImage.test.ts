import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Heavyweight build + boot smoke test for the LOCAL-DEV Docker image (Task 10).
 *
 * It builds the multi-stage image, runs the container with the in-memory store
 * (no external dependency), and asserts the containerized service answers the
 * same way the in-process supertest suite does: `GET /health` -> 200 and
 * `POST /core/v5/orders` with the approved magic card -> a captured order. This
 * proves the image actually runs `node dist/server.js` and serves the contract.
 *
 * OPT-IN: this suite only runs when DOCKER_E2E is set (it needs a Docker daemon
 * and takes minutes to build). It is skipped in the default `npm test` and in
 * CI, which stay hermetic against the in-memory store (ADR-006). Run locally with:
 *   DOCKER_E2E=1 npx vitest run tests/integration/dockerImage.test.ts
 */

const RUN = !!process.env.DOCKER_E2E;

const IMAGE = "fake-pagarme:e2e-test";
const CONTAINER = "fake-pagarme-e2e-test";
const HOST_PORT = 18088; // avoid clashing with a dev server on 8088
const BASE = `http://127.0.0.1:${HOST_PORT}`;

/** Run a docker command, returning stdout; throws (with stderr) on failure. */
function docker(args: string[], timeoutMs = 600_000): string {
  return execFileSync("docker", args, { encoding: "utf8", timeout: timeoutMs, stdio: ["ignore", "pipe", "pipe"] });
}

/** Best-effort cleanup; never throws (the container may not exist). */
function removeContainer(): void {
  try {
    docker(["rm", "-f", CONTAINER], 60_000);
  } catch {
    /* not running — nothing to remove */
  }
}

/** Poll until /health answers 200, or fail after the deadline. */
async function waitForHealth(deadlineMs = 60_000): Promise<void> {
  const start = Date.now();
  let lastErr = "no attempt made";
  while (Date.now() - start < deadlineMs) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.status === 200) return;
      lastErr = `status ${res.status}`;
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`container /health never became ready: ${lastErr}`);
}

/** Minimal valid order request for the given card number (auth_and_capture). */
function orderBody(number: string): Record<string, unknown> {
  return {
    payments: [
      {
        amount: 1990,
        payment_method: "credit_card",
        credit_card: {
          card: { number, holder_name: "FULANO DE TAL", exp_month: 12, exp_year: 30, cvv: "123" },
          operation_type: "auth_and_capture",
          installments: 1,
          statement_descriptor: "APPMAX*LOJA",
        },
      },
    ],
    code: "PREFIXO_12345_a1b2c",
    customer: { name: "Fulano De Tal", email: "fulano@example.com" },
    metadata: { site: "Minha Loja" },
    closed: true,
  };
}

describe.skipIf(!RUN)("Docker image — build + boot smoke test", () => {
  beforeAll(async () => {
    removeContainer();
    // Build the multi-stage image from the repo root.
    docker(["build", "-t", IMAGE, "."]);
    // Run with the in-memory store so the container needs no Redis/KV.
    docker([
      "run",
      "-d",
      "--name",
      CONTAINER,
      "-e",
      "STORE_BACKEND=memory",
      "-e",
      "PORT=8088",
      "-p",
      `${HOST_PORT}:8088`,
      IMAGE,
    ]);
    await waitForHealth();
  }, 700_000);

  afterAll(() => {
    removeContainer();
  });

  it("the image runs node dist/server.js and serves GET /health -> 200", async () => {
    const res = await fetch(`${BASE}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("POST /core/v5/orders (4000000000000010) returns a captured order", async () => {
    const res = await fetch(`${BASE}/core/v5/orders`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(orderBody("4000000000000010")),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      id: string;
      status: string;
      code: string;
      charges: Array<{ id: string; amount: number; last_transaction: { status: string; success: boolean } }>;
    };
    expect(body.id).toMatch(/^or_fake_/);
    expect(body.status).toBe("paid");
    expect(body.code).toBe("PREFIXO_12345_a1b2c");
    const charge = body.charges[0];
    expect(charge.id).toMatch(/^ch_fake_/);
    expect(charge.amount).toBe(1990);
    expect(charge.last_transaction.status).toBe("captured");
    expect(charge.last_transaction.success).toBe(true);
  });
});
