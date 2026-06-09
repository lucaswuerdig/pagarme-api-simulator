import { describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { requireToken } from "../../src/auth/middleware";

/** `Authorization: Basic` header for `token` with an empty password — the real
 *  Pagar.me v5 shape (`base64("<token>:")`), matching `tokens.test.ts`. */
const basic = (token: string): string => `Basic ${Buffer.from(`${token}:`).toString("base64")}`;

/** Stub Express `req` carrying the given `Authorization` header, or none when omitted. */
function stubReq(authorization?: string): Request {
  return { headers: authorization === undefined ? {} : { authorization } } as Request;
}

/** Stub Express `res` whose `status`/`json` are spies that return the same `res`,
 *  so the `res.status(401).json(...)` chain works and tests can assert the body. */
function stubRes(): Response & { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> } {
  const res = {
    status: vi.fn(() => res),
    json: vi.fn(() => res),
  };
  return res as unknown as Response & {
    status: ReturnType<typeof vi.fn>;
    json: ReturnType<typeof vi.fn>;
  };
}

/**
 * Unit tests for the `requireToken` Express gate (Task 02). They drive the
 * middleware directly with stub `req`/`res`/`next` — no HTTP — covering the
 * pass-through branch and the three rejection branches (missing, unlisted,
 * malformed). Mounted-app behavior is verified downstream in Task 03.
 */
describe("requireToken", () => {
  it("calls next() once and sends no response for a valid allowlisted token", () => {
    const res = stubRes();
    const next = vi.fn();

    requireToken(stubReq(basic("test_token")), res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  it("responds 401 with { error, message } and does not call next when the header is missing", () => {
    const res = stubRes();
    const next = vi.fn();

    requireToken(stubReq(), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith({
      error: "unauthorized",
      message: expect.any(String),
    });
  });

  it("responds 401 and does not call next for an unlisted token", () => {
    const res = stubRes();
    const next = vi.fn();

    requireToken(stubReq(basic("nope")), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: "unauthorized",
      message: expect.any(String),
    });
  });

  it("responds 401 and does not call next for a malformed header", () => {
    const res = stubRes();
    const next = vi.fn();

    requireToken(stubReq("Basic %%%"), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: "unauthorized",
      message: expect.any(String),
    });
  });
});
