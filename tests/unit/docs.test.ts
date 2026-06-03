import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MAGIC_CARD_NUMBERS } from "../../src/magic/cards";

/**
 * Docs-lint / content tests for Task 11 (ADR-002). They assert the README and
 * connection guide stay accurate against the code and the spec WITHOUT a live
 * service:
 *   - the magic-card catalog lists every scenario the resolver implements
 *     (drift guard against `src/magic/cards.ts`);
 *   - the connection guide enforces the production-safety rules from `_idea.md`
 *     §7 (URL swap, `config:clear`, `PAGARME_API_URL` UNSET in production);
 *   - the README documents the required env vars and the `VERCEL_*` secrets;
 *   - the over-trust / contract-drift caveats from the PRD risks are present;
 *   - documented local-run commands are real npm scripts.
 *
 * Doc ↔ behavior parity (booting the service, running the sample request) lives
 * in `tests/integration/docsAccuracy.test.ts`.
 */

const ROOT = process.cwd();
const read = (rel: string): string => readFileSync(resolve(ROOT, rel), "utf8");

const readme = read("README.md");
const guide = read("docs/connection-guide.md");
const pkg = JSON.parse(read("package.json")) as { scripts?: Record<string, string> };

/** Extract relative (non-http, non-anchor-only) markdown link targets. */
function relativeLinks(markdown: string): string[] {
  return [...markdown.matchAll(/\]\(([^)]+)\)/g)]
    .map((m) => m[1].split("#")[0])
    .filter((target) => target.length > 0 && !/^https?:\/\//.test(target));
}

describe("README.md — magic-card catalog", () => {
  it("lists all six scenarios from `_idea.md` §5 (every resolver card number)", () => {
    const numbers = Object.keys(MAGIC_CARD_NUMBERS);
    // The catalog is the canonical scenario list — guard against drift between
    // the docs and the resolver (ADR-003).
    expect(numbers).toHaveLength(6);
    for (const number of numbers) {
      expect(readme, `README must document magic card ${number}`).toContain(number);
    }
  });

  it("labels each of the six scenario branches", () => {
    for (const label of [
      /approved \+ captured/i,
      /without capture|pre-?authorization/i,
      /declined/i,
      /transaction error/i,
      /order failed/i,
      /gateway unavailable|outage/i,
    ]) {
      expect(readme).toMatch(label);
    }
  });

  it("documents the tokenized `card_`/`token_` magic-id convention", () => {
    expect(readme).toMatch(/card_refused/);
    expect(readme).toMatch(/token_refused/);
  });
});

describe("README.md — the /__reset test helper", () => {
  it("documents POST /__reset as a test-only helper returning 204", () => {
    expect(readme).toContain("/__reset");
    expect(readme.toLowerCase()).toMatch(/test-only/);
    expect(readme).toMatch(/204/);
  });
});

describe("README.md — environment variables & deploy secrets", () => {
  it("documents the required Vercel KV / store env vars", () => {
    for (const envVar of ["STORE_BACKEND", "KV_REST_API_URL", "KV_REST_API_TOKEN"]) {
      expect(readme, `README must document ${envVar}`).toContain(envVar);
    }
  });

  it("documents the three VERCEL_* GitHub secrets", () => {
    for (const secret of ["VERCEL_TOKEN", "VERCEL_ORG_ID", "VERCEL_PROJECT_ID"]) {
      expect(readme, `README must document ${secret}`).toContain(secret);
    }
  });

  it("documents local Docker usage and the GitHub→Vercel pipeline", () => {
    expect(readme).toMatch(/docker compose up/);
    expect(readme).toMatch(/vercel/i);
    expect(readme).toMatch(/\.github\/workflows\/ci\.yml/);
  });

  it("only references local-run commands that are real npm scripts", () => {
    const scripts = pkg.scripts ?? {};
    // Every `npm run <x>` / `npm <x>` mentioned in the README must exist.
    const referenced = [...readme.matchAll(/npm (?:run )?([a-z][\w:-]*)/g)].map((m) => m[1]);
    const known = new Set([...Object.keys(scripts), "ci", "test", "start", "install"]);
    for (const script of referenced) {
      expect(known.has(script), `README references unknown npm script "${script}"`).toBe(true);
    }
    // The documented happy-path commands must actually be defined.
    for (const script of ["dev", "build", "start", "test", "lint", "typecheck"]) {
      expect(scripts[script], `package.json must define "${script}"`).toBeDefined();
    }
  });
});

describe("README.md — over-trust / contract-drift caveats (PRD risks)", () => {
  it("warns against over-trust and recommends periodic real-sandbox checks", () => {
    expect(readme.toLowerCase()).toMatch(/over-trust|false confidence/);
    expect(readme.toLowerCase()).toMatch(/real[- ]sandbox/);
  });

  it("warns about contract drift", () => {
    expect(readme.toLowerCase()).toMatch(/contract drift/);
  });
});

describe("docs — every relative link resolves (link-check)", () => {
  it.each([
    ["README.md", readme],
    ["docs/connection-guide.md", guide],
  ])("%s links point at existing files", (relPath, content) => {
    const docDir = dirname(resolve(ROOT, relPath));
    for (const link of relativeLinks(content)) {
      const target = resolve(docDir, link);
      expect(existsSync(target), `${relPath}: broken link "${link}"`).toBe(true);
    }
  });
});

describe("docs/connection-guide.md — production safety (`_idea.md` §7, ADR-002)", () => {
  it("states PAGARME_API_URL must be UNSET in production", () => {
    expect(guide).toContain("PAGARME_API_URL");
    // The explicit production-safety rule asserted by content.
    expect(guide.toUpperCase()).toMatch(/UNSET IN PRODUCTION/);
  });

  it("documents the default fallback to the real https://api.pagar.me", () => {
    expect(guide).toContain("https://api.pagar.me");
  });

  it("frames the change as a URL swap, not a key swap, and requires config:clear", () => {
    expect(guide.toLowerCase()).toMatch(/url swap/);
    expect(guide.toLowerCase()).toMatch(/not a key swap|not.*key swap/);
    expect(guide).toContain("php artisan config:clear");
  });

  it("states no code is committed to the consuming app's repository (ADR-002)", () => {
    expect(guide.toLowerCase()).toMatch(/no code/);
    expect(guide.toLowerCase()).toMatch(/consuming app/);
  });

  it("reproduces the three `_idea.md` §7 integration edits", () => {
    expect(guide).toContain("config/pagarme.php");
    expect(guide).toContain("setApiUrl()");
    expect(guide).toMatch(/PAGARME_API_URL=/);
  });

  it("documents the deployed Vercel URL usage", () => {
    expect(guide).toMatch(/vercel\.app/);
    expect(guide).toContain("http://localhost:8088");
  });
});
