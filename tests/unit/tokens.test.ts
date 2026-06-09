import { describe, expect, it } from "vitest";
import { isValidToken, parseBasicToken, VALID_TOKENS } from "../../src/auth/tokens";

/** Build an `Authorization: Basic` header for `token` with an empty password, the
 *  real Pagar.me v5 shape (`base64("<token>:")`). */
const basic = (token: string): string => `Basic ${Buffer.from(`${token}:`).toString("base64")}`;

describe("VALID_TOKENS allowlist (ADR-004)", () => {
  it("includes the committed homologation test token", () => {
    expect(VALID_TOKENS.has("test_token")).toBe(true);
  });
});

describe("isValidToken", () => {
  it("returns true for an allowlisted token", () => {
    expect(isValidToken("test_token")).toBe(true);
  });

  it("returns false for a token that is not on the allowlist", () => {
    expect(isValidToken("not_listed")).toBe(false);
  });

  it("returns false for an absent token", () => {
    expect(isValidToken(undefined)).toBe(false);
  });

  it("returns false for an empty string", () => {
    expect(isValidToken("")).toBe(false);
  });
});

describe("parseBasicToken", () => {
  it("decodes the token from a well-formed Basic header", () => {
    expect(parseBasicToken(basic("test_token"))).toBe("test_token");
  });

  it("returns undefined when the header is absent", () => {
    expect(parseBasicToken(undefined)).toBeUndefined();
  });

  it("returns undefined for a non-Basic scheme", () => {
    expect(parseBasicToken("Bearer abc")).toBeUndefined();
  });

  it("matches the scheme case-insensitively (RFC 7617 §2): lowercase 'basic '", () => {
    expect(parseBasicToken(basic("test_token").replace("Basic ", "basic "))).toBe("test_token");
  });

  it("matches the scheme case-insensitively (RFC 7617 §2): uppercase 'BASIC '", () => {
    expect(parseBasicToken(basic("test_token").replace("Basic ", "BASIC "))).toBe("test_token");
  });

  it("does not throw and never yields a listed value for non-base64 input", () => {
    let result: string | undefined;
    expect(() => {
      result = parseBasicToken("Basic !!!not-base64");
    }).not.toThrow();
    expect(isValidToken(result)).toBe(false);
  });

  it("returns undefined for an empty token (only a colon)", () => {
    expect(parseBasicToken(basic(""))).toBeUndefined();
  });

  it("keeps only the part before the first colon (ignores the password)", () => {
    expect(parseBasicToken(`Basic ${Buffer.from("test_token:secret").toString("base64")}`)).toBe(
      "test_token",
    );
  });
});
