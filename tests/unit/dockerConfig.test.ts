import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { load } from "js-yaml";
import { describe, expect, it } from "vitest";

/**
 * Static (config-lint) tests for the LOCAL-DEV Docker stack (Task 10, ADR-006).
 * They parse `docker-compose.yml` and read the `Dockerfile` / `.dockerignore`
 * as text, asserting the contract the task depends on without a Docker daemon:
 *   - compose defines an `app` and a `redis` service;
 *   - the `app` service sets `PORT` and `STORE_BACKEND` and exposes 8088;
 *   - the Dockerfile is multi-stage and runs `node dist/server.js`;
 *   - `.dockerignore` keeps the build context lean;
 *   - Docker is LOCAL-DEV-ONLY — nothing in the Vercel deploy pipeline
 *     (`vercel.json`, `.github/workflows/ci.yml`) references it.
 *
 * The heavyweight build+boot smoke test lives in
 * `tests/integration/dockerImage.test.ts` (opt-in via DOCKER_E2E) so this suite
 * stays fast and hermetic — CI needs no Docker daemon.
 */

const ROOT = process.cwd();
const read = (rel: string): string => readFileSync(resolve(ROOT, rel), "utf8");

/** Minimal shape of the parsed compose file we assert against. */
interface ComposeService {
  build?: unknown;
  image?: string;
  environment?: Record<string, unknown> | string[];
  ports?: Array<string | number>;
  profiles?: string[];
}
interface Compose {
  services?: Record<string, ComposeService>;
}

const rawCompose = read("docker-compose.yml");
const compose = load(rawCompose) as Compose;

/**
 * Normalize a compose `environment` block (either a `KEY: value` map or a
 * `["KEY=value"]` list) to a plain map so assertions are form-agnostic.
 */
function envMap(service: ComposeService | undefined): Record<string, string> {
  const env = service?.environment;
  if (!env) return {};
  if (Array.isArray(env)) {
    return Object.fromEntries(
      env.map((entry) => {
        const [key, ...rest] = String(entry).split("=");
        return [key, rest.join("=")];
      }),
    );
  }
  return Object.fromEntries(Object.entries(env).map(([k, v]) => [k, String(v)]));
}

describe("docker-compose.yml — local dev stack", () => {
  it("is valid YAML defining both an app and a redis service", () => {
    expect(compose).toBeTypeOf("object");
    expect(compose.services).toBeTypeOf("object");
    expect(Object.keys(compose.services ?? {})).toEqual(
      expect.arrayContaining(["app", "redis"]),
    );
  });

  it("builds the app service from the local Dockerfile", () => {
    expect(compose.services?.app?.build).toBeDefined();
    // image is for redis/proxies; the app must be built, not pulled.
    expect(compose.services?.app?.image).toBeUndefined();
  });

  it("sets PORT and STORE_BACKEND env vars on the app service", () => {
    const env = envMap(compose.services?.app);
    expect(Object.keys(env)).toEqual(expect.arrayContaining(["PORT", "STORE_BACKEND"]));
    // Default to the in-memory store so a plain `docker compose up` needs no
    // external dependency (requirement: STORE_BACKEND=memory for no-dep runs).
    expect(env.STORE_BACKEND).toMatch(/memory/);
  });

  it("exposes the service on port 8088 (default, configurable via PORT)", () => {
    const ports = (compose.services?.app?.ports ?? []).map(String);
    expect(ports.some((p) => p.includes("8088"))).toBe(true);
    expect(envMap(compose.services?.app).PORT).toMatch(/8088/);
  });

  it("uses a real Redis image for the redis service", () => {
    expect(compose.services?.redis?.image).toMatch(/redis/);
  });
});

describe("Dockerfile — multi-stage build", () => {
  const dockerfile = read("Dockerfile");

  it("is multi-stage (a build stage feeding a runtime stage)", () => {
    const fromStages = dockerfile.match(/^FROM\s+\S+\s+AS\s+\S+/gim) ?? [];
    expect(fromStages.length).toBeGreaterThanOrEqual(2);
    expect(dockerfile).toMatch(/AS\s+build/i);
    expect(dockerfile).toMatch(/AS\s+runtime/i);
  });

  it("compiles TypeScript in the build stage and copies dist/ into runtime", () => {
    expect(dockerfile).toMatch(/npm run build/);
    expect(dockerfile).toMatch(/COPY\s+--from=build\s+\/app\/dist\s+\.\/dist/);
  });

  it("runs `node dist/server.js` as the entrypoint", () => {
    expect(dockerfile).toMatch(/CMD\s+\[\s*"node"\s*,\s*"dist\/server\.js"\s*\]/);
  });

  it("installs production-only dependencies in the runtime stage", () => {
    expect(dockerfile).toMatch(/npm ci --omit=dev/);
  });
});

describe(".dockerignore — lean build context", () => {
  const dockerignore = read(".dockerignore");

  it("excludes node_modules, dist, .git, and env files", () => {
    for (const pattern of ["node_modules", "dist", ".git", ".env"]) {
      expect(dockerignore).toContain(pattern);
    }
  });
});

describe("Docker is LOCAL-DEV-ONLY — not part of the Vercel deploy pipeline", () => {
  it("vercel.json does not reference Docker", () => {
    const vercelJson = read("vercel.json");
    expect(vercelJson.toLowerCase()).not.toMatch(/docker/);
  });

  it("the GitHub Actions workflow does not reference Docker", () => {
    const ci = read(".github/workflows/ci.yml");
    // The deploy pipeline ships to Vercel via the CLI; it must never build or
    // run the local Docker image (ADR-006: Vercel is the deploy target).
    expect(ci.toLowerCase()).not.toMatch(/docker(file|-compose|\s+compose|\s+build|\s+run)/);
  });
});
