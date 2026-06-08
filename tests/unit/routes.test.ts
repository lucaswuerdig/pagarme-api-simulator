import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp, createPagarmeApp } from "../../src/server";
import { RESET_SECRET_HEADER, resetRouter } from "../../src/routes/reset";
import { InMemoryOrderStore } from "../../src/store/inMemoryOrderStore";
import type { OrderRecord } from "../../src/types/pagarme";

/**
 * Parse the structured per-request log lines a `console.log` spy captured,
 * keeping only the JSON objects emitted for `path` (Issue 003 / TechSpec
 * §"Monitoring and Observability").
 */
function loggedLinesFor(
  spy: ReturnType<typeof vi.spyOn>,
  path: string,
): Array<Record<string, unknown>> {
  return spy.mock.calls
    .map((call) => call[0])
    .filter((arg): arg is string => typeof arg === "string")
    .map((arg) => {
      try {
        return JSON.parse(arg) as Record<string, unknown>;
      } catch {
        return undefined;
      }
    })
    .filter((obj): obj is Record<string, unknown> => obj?.path === path);
}

/**
 * Handler-level route tests (supertest against an app with a fresh in-memory
 * store). These cover the HTTP-status policy and the not-found body-error that
 * Task 06 owns; the full lifecycle/per-scenario flows live in the integration
 * suite. Each test builds its own app so the injected store starts empty.
 */

/** Minimal valid `POST /core/v5/orders` body for the given card number. */
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

describe("POST /core/v5/orders — HTTP status policy (_idea.md §3.3)", () => {
  // Every business outcome returns 200; only the outage card returns 5xx.
  const businessCards: ReadonlyArray<[string, string]> = [
    ["4000000000000010", "approved_captured"],
    ["4000000000000028", "approved_no_capture"],
    ["4000000000000002", "declined"],
    ["4000000000000036", "transaction_error"],
    ["4000000000000044", "order_failed"],
  ];

  it.each(businessCards)("returns HTTP 200 for the %s card (%s)", async (number) => {
    const res = await request(createPagarmeApp()).post("/core/v5/orders").send(orderBody(number));
    expect(res.status).toBe(200);
  });

  it("returns HTTP 5xx (no body outcome) for the gateway_unavailable card", async () => {
    const res = await request(createPagarmeApp())
      .post("/core/v5/orders")
      .send(orderBody("4000000000009999"));
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(res.status).toBe(503);
  });

  // The persisted/returned root status drives the consuming app's success
  // predicate (`_idea.md` §3.1): approvals are non-failed, declines/errors/
  // failures are `failed`.
  const expectedRootStatus: ReadonlyArray<[string, string]> = [
    ["4000000000000010", "paid"],
    ["4000000000000028", "authorized_pending_capture"],
    ["4000000000000002", "failed"],
    ["4000000000000036", "failed"],
    ["4000000000000044", "failed"],
  ];

  it.each(expectedRootStatus)(
    "the %s card produces root status %s",
    async (number, status) => {
      const res = await request(createPagarmeApp())
        .post("/core/v5/orders")
        .send(orderBody(number));
      expect(res.body.status).toBe(status);
      expect(res.body.charges[0].status).toBe(status);
    },
  );

  it("defaults amount/code/metadata and resolves the happy path for an empty body", async () => {
    const res = await request(createPagarmeApp()).post("/core/v5/orders").send({});
    expect(res.status).toBe(200);
    // Unknown/absent card → DEFAULT_OUTCOME (approved_captured).
    expect(res.body.status).toBe("paid");
    expect(res.body.amount).toBe(0);
    expect(res.body.code).toBe("");
    expect(res.body.customer).toBeUndefined();
  });

  it("resolves the outcome from a tokenized card_id when no raw card is present", async () => {
    const res = await request(createPagarmeApp())
      .post("/core/v5/orders")
      .send({ payments: [{ amount: 500, credit_card: { card_id: "card_refused" } }], code: "X" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("failed");
    expect(res.body.charges[0].last_transaction.success).toBe(false);
  });
});

describe("capture/cancel against an unknown charge_id (_idea.md §3.3)", () => {
  it("POST capture returns HTTP 200 with a with_error / success:false body", async () => {
    const res = await request(createPagarmeApp())
      .post("/core/v5/charges/ch_fake_does_not_exist/capture")
      .send({ amount: 1990 });
    expect(res.status).toBe(200);
    expect(res.body.id).toBe("ch_fake_does_not_exist");
    expect(res.body.status).toBe("failed");
    expect(res.body.last_transaction.status).toBe("with_error");
    expect(res.body.last_transaction.success).toBe(false);
  });

  it("DELETE cancel returns HTTP 200 with a with_error / success:false body", async () => {
    const res = await request(createPagarmeApp()).delete("/core/v5/charges/ch_fake_missing");
    expect(res.status).toBe(200);
    expect(res.body.last_transaction.status).toBe("with_error");
    expect(res.body.last_transaction.success).toBe(false);
  });
});

describe("capture/cancel reject invalid state transitions (Issue 004)", () => {
  /** Create an order for `number` and return its persisted charge_id. */
  async function createCharge(app: ReturnType<typeof createPagarmeApp>, number: string) {
    const res = await request(app).post("/core/v5/orders").send(orderBody(number));
    expect(res.status).toBe(200);
    return res.body.charges[0].id as string;
  }

  it("capture against a declined/failed charge returns a with_error body, not captured", async () => {
    const app = createPagarmeApp();
    // 4000000000000002 → declined → persisted status `failed` (never authorized).
    const chargeId = await createCharge(app, "4000000000000002");

    const res = await request(app).post(`/core/v5/charges/${chargeId}/capture`).send({ amount: 1990 });

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(chargeId);
    expect(res.body.last_transaction.status).toBe("with_error");
    expect(res.body.last_transaction.success).toBe(false);
    expect(res.body.status).toBe("failed");
  });

  it("capture against an already-captured (paid) sale is rejected", async () => {
    const app = createPagarmeApp();
    // 4000000000000010 → approved_captured → persisted status `paid` (no pending capture).
    const chargeId = await createCharge(app, "4000000000000010");

    const res = await request(app).post(`/core/v5/charges/${chargeId}/capture`).send({});

    expect(res.status).toBe(200);
    expect(res.body.last_transaction.status).toBe("with_error");
    expect(res.body.last_transaction.success).toBe(false);
  });

  it("a second DELETE on an already-canceled charge is rejected (no fresh voided success)", async () => {
    const app = createPagarmeApp();
    // 4000000000000028 → approved_no_capture → `authorized_pending_capture`.
    const chargeId = await createCharge(app, "4000000000000028");

    const first = await request(app).delete(`/core/v5/charges/${chargeId}`);
    expect(first.status).toBe(200);
    expect(first.body.last_transaction.status).toBe("voided");
    expect(first.body.last_transaction.success).toBe(true);

    const second = await request(app).delete(`/core/v5/charges/${chargeId}`);
    expect(second.status).toBe(200);
    expect(second.body.last_transaction.status).toBe("with_error");
    expect(second.body.last_transaction.success).toBe(false);
  });

  it("capture after a cancel is rejected (the charge is no longer capturable)", async () => {
    const app = createPagarmeApp();
    const chargeId = await createCharge(app, "4000000000000028");

    await request(app).delete(`/core/v5/charges/${chargeId}`).expect(200);

    const res = await request(app).post(`/core/v5/charges/${chargeId}/capture`).send({});
    expect(res.status).toBe(200);
    expect(res.body.last_transaction.status).toBe("with_error");
    expect(res.body.last_transaction.success).toBe(false);
  });

  it("cancel against a declined/failed charge is rejected", async () => {
    const app = createPagarmeApp();
    const chargeId = await createCharge(app, "4000000000000002");

    const res = await request(app).delete(`/core/v5/charges/${chargeId}`);
    expect(res.status).toBe(200);
    expect(res.body.last_transaction.status).toBe("with_error");
    expect(res.body.last_transaction.success).toBe(false);
  });
});

describe("health and reset routes", () => {
  it("GET /health returns 200 { status: ok }", async () => {
    const res = await request(createPagarmeApp()).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("POST /__reset clears the store and returns 204", async () => {
    const res = await request(createPagarmeApp()).post("/__reset");
    expect(res.status).toBe(204);
    expect(res.body).toEqual({});
  });
});

/**
 * The shared-instance guard on `POST /__reset` (Issue 005). The fake is designed
 * as one always-on instance the whole team points at, so an unauthenticated
 * global clear lets any caller wipe another suite's in-flight orders. When
 * `RESET_SECRET` is configured the route demands a matching `x-reset-secret`
 * header; when unset it stays open (covered by the 204 test above). `env` is
 * injected so these tests never touch the ambient process environment.
 */
describe("POST /__reset shared-secret guard (Issue 005)", () => {
  const SECRET = "s3cret-teardown";

  /** A seeded record so we can assert the store survives a rejected reset. */
  function seedRecord(): OrderRecord {
    return {
      orderId: "or_seed",
      chargeId: "ch_seed",
      cardId: "card_seed",
      code: "seed",
      amount: 1990,
      status: "paid",
      outcome: "approved_captured",
      metadata: {},
    };
  }

  /** Build a guarded reset app over a store pre-seeded with one record. */
  async function guardedApp(): Promise<{ app: ReturnType<typeof createApp>; store: InMemoryOrderStore }> {
    const store = new InMemoryOrderStore();
    await store.create(seedRecord());
    const app = createApp((a) => a.use(resetRouter(store, { RESET_SECRET: SECRET })));
    return { app, store };
  }

  it("rejects a reset with no secret header (401) and leaves the store intact", async () => {
    const { app, store } = await guardedApp();
    const res = await request(app).post("/__reset");
    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      error: "unauthorized",
      message: "POST /__reset requires a valid x-reset-secret header.",
    });
    expect(await store.get("ch_seed")).toBeDefined();
  });

  it("rejects a reset carrying the wrong secret (401) and leaves the store intact", async () => {
    const { app, store } = await guardedApp();
    const res = await request(app).post("/__reset").set(RESET_SECRET_HEADER, "wrong");
    expect(res.status).toBe(401);
    expect(await store.get("ch_seed")).toBeDefined();
  });

  it("clears the store and returns 204 when the matching secret header is supplied", async () => {
    const { app, store } = await guardedApp();
    const res = await request(app).post("/__reset").set(RESET_SECRET_HEADER, SECRET);
    expect(res.status).toBe(204);
    expect(res.body).toEqual({});
    expect(await store.get("ch_seed")).toBeUndefined();
  });
});

describe("structured per-request logging (_techspec.md §Monitoring and Observability)", () => {
  it("emits one JSON line per /core/v5/orders request with method, path, outcome, charge_id, status", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const res = await request(createPagarmeApp())
        .post("/core/v5/orders")
        .send(orderBody("4000000000000010"));
      expect(res.status).toBe(200);

      const lines = loggedLinesFor(logSpy, "/core/v5/orders");
      expect(lines).toHaveLength(1);
      const line = lines[0];
      expect(line.method).toBe("POST");
      expect(line.status).toBe(200);
      expect(line.outcome).toBe("approved_captured");
      expect(line.charge_id).toBe(res.body.charges[0].id);
      expect(line.charge_id).toMatch(/^ch_fake_/);
      // Privacy: ONLY the safe fields are logged — no card number, CVV, or PII.
      expect(Object.keys(line).sort()).toEqual([
        "charge_id",
        "method",
        "outcome",
        "path",
        "status",
      ]);
    } finally {
      logSpy.mockRestore();
    }
  });

  it("logs the resolved outcome even on the 503 gateway-outage path (no charge_id minted)", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const res = await request(createPagarmeApp())
        .post("/core/v5/orders")
        .send(orderBody("4000000000009999"));
      expect(res.status).toBe(503);

      const lines = loggedLinesFor(logSpy, "/core/v5/orders");
      expect(lines).toHaveLength(1);
      const line = lines[0];
      expect(line.status).toBe(503);
      expect(line.outcome).toBe("gateway_unavailable");
      // No record is persisted on the outage path, so no charge_id is logged.
      expect(line.charge_id).toBeUndefined();
    } finally {
      logSpy.mockRestore();
    }
  });

  it("logs the looked-up charge_id for a capture request (no order outcome)", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const res = await request(createPagarmeApp())
        .post("/core/v5/charges/ch_fake_missing/capture")
        .send({ amount: 1990 });
      expect(res.status).toBe(200);

      const lines = loggedLinesFor(logSpy, "/core/v5/charges/ch_fake_missing/capture");
      expect(lines).toHaveLength(1);
      const line = lines[0];
      expect(line.method).toBe("POST");
      expect(line.status).toBe(200);
      expect(line.charge_id).toBe("ch_fake_missing");
      // Capture/cancel resolve no magic-card outcome, so the key is absent.
      expect(line.outcome).toBeUndefined();
    } finally {
      logSpy.mockRestore();
    }
  });

  it("logs the stateless tokenization call without leaking the appId public key", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const res = await request(createPagarmeApp())
        .post("/core/v5/tokens?appId=pk_test_123")
        .send({ card: { number: "4000000000000010" }, type: "card" });
      expect([200, 201]).toContain(res.status);

      const lines = loggedLinesFor(logSpy, "/core/v5/tokens");
      expect(lines).toHaveLength(1);
      const line = lines[0];
      // The query string (the public key) is stripped from the logged path.
      expect(line.path).toBe("/core/v5/tokens");
      expect(JSON.stringify(line)).not.toContain("pk_test_123");
      // Tokenization is stateless: no outcome and no charge_id.
      expect(Object.keys(line).sort()).toEqual(["method", "path", "status"]);
    } finally {
      logSpy.mockRestore();
    }
  });
});
