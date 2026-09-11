import { describe, expect, it } from "vitest";
import { isValidToken, parseBasicToken, VALID_TOKENS } from "../../src/auth/tokens";

/** Build an `Authorization: Basic` header for `token` with an empty password, the
 *  real Pagar.me v5 shape (`base64("<token>:")`). */
const basic = (token: string): string => `Basic ${Buffer.from(`${token}:`).toString("base64")}`;

describe("VALID_TOKENS allowlist (ADR-004)", () => {
  it("includes the committed homologation test token", () => {
    expect(VALID_TOKENS.has("fk_hflT1IsDGNu5q8nUStlkUwuOm0t4xgrL")).toBe(true);
  });
});

describe("isValidToken", () => {
  it("returns true for an allowlisted token", () => {
    expect(isValidToken("fk_hflT1IsDGNu5q8nUStlkUwuOm0t4xgrL")).toBe(true);
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
    expect(parseBasicToken(basic("fk_hflT1IsDGNu5q8nUStlkUwuOm0t4xgrL"))).toBe("fk_hflT1IsDGNu5q8nUStlkUwuOm0t4xgrL");
  });

  it("returns undefined when the header is absent", () => {
    expect(parseBasicToken(undefined)).toBeUndefined();
  });

  it("returns undefined for a non-Basic scheme", () => {
    expect(parseBasicToken("Bearer abc")).toBeUndefined();
  });

  it("matches the scheme case-insensitively (RFC 7617 §2): lowercase 'basic '", () => {
    expect(parseBasicToken(basic("fk_hflT1IsDGNu5q8nUStlkUwuOm0t4xgrL").replace("Basic ", "basic "))).toBe("fk_hflT1IsDGNu5q8nUStlkUwuOm0t4xgrL");
  });

  it("matches the scheme case-insensitively (RFC 7617 §2): uppercase 'BASIC '", () => {
    expect(parseBasicToken(basic("fk_hflT1IsDGNu5q8nUStlkUwuOm0t4xgrL").replace("Basic ", "BASIC "))).toBe("fk_hflT1IsDGNu5q8nUStlkUwuOm0t4xgrL");
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
    expect(parseBasicToken(`Basic ${Buffer.from("fk_hflT1IsDGNu5q8nUStlkUwuOm0t4xgrL:secret").toString("base64")}`)).toBe(
      "fk_hflT1IsDGNu5q8nUStlkUwuOm0t4xgrL",
    );
  });
});
