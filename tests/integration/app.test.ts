import { describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { app, createApp } from "../../src/server";
import { authedRequest } from "../helpers/authedRequest";

describe("bare app HTTP behaviour", () => {
  it("returns HTTP 404 with a JSON content type for an unknown route", async () => {
    // The always-on token gate (ADR-003) runs before the 404 fallback, so an
    // unknown path needs a valid token to fall through to the not-found handler;
    // unauthenticated it would (correctly) return 401 instead.
    const res = await authedRequest(app).get("/");

    expect(res.status).toBe(404);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    expect(res.body).toMatchObject({ error: "not_found" });
  });

  it("parses JSON request bodies (body middleware active)", async () => {
    // Mount a temporary echo handler before the 404 fallback to observe the
    // parsed body produced by the app's JSON middleware.
    const echoApp: Express = createApp((a) => {
      a.post("/__echo", (req, res) => {
        res.status(200).json({ received: req.body });
      });
    });

    const payload = { hello: "world", amount: 1000 };
    const res = await request(echoApp).post("/__echo").send(payload);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: payload });
  });
});
