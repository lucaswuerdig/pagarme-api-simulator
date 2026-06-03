import { afterEach, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { app, createApp, DEFAULT_PORT, resolvePort, start } from "../../src/server";

describe("server module exports", () => {
  it("exports an Express app instance (import does not throw)", () => {
    expect(app).toBeDefined();
    // An Express application is a callable request handler with `use`/`listen`.
    expect(typeof app).toBe("function");
    expect(typeof app.use).toBe("function");
    expect(typeof app.listen).toBe("function");
  });

  it("createApp returns a fresh app instance on each call", () => {
    expect(createApp()).not.toBe(createApp());
  });
});

describe("resolvePort", () => {
  it("defaults to 8088 when PORT is unset", () => {
    expect(DEFAULT_PORT).toBe(8088);
    expect(resolvePort({} as NodeJS.ProcessEnv)).toBe(8088);
  });

  it("uses process.env.PORT when set", () => {
    expect(resolvePort({ PORT: "5050" } as NodeJS.ProcessEnv)).toBe(5050);
  });

  it("falls back to the default for a non-numeric PORT", () => {
    expect(resolvePort({ PORT: "not-a-port" } as NodeJS.ProcessEnv)).toBe(8088);
  });
});

describe("start", () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) =>
        server!.close((err) => (err ? reject(err) : resolve())),
      );
      server = undefined;
    }
  });

  it("binds an HTTP listener on the given port", async () => {
    server = start(0); // port 0 → ephemeral free port
    await new Promise<void>((resolve) => server!.once("listening", resolve));

    const address = server.address();
    expect(address).not.toBeNull();
    expect(typeof address === "object" && address?.port).toBeGreaterThan(0);
  });
});
