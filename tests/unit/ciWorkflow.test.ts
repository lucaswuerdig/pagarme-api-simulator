import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { load } from "js-yaml";
import { describe, expect, it } from "vitest";

/**
 * Validation tests for the GitHub Actions pipeline (`.github/workflows/ci.yml`,
 * ADR-007). They parse the workflow YAML and assert the contract the task
 * depends on: the file is valid YAML, the `deploy` job is gated on `test` and
 * restricted to pushes to `main`, the Vercel CLI deploy steps are present, and
 * credentials flow exclusively through GitHub secrets (never hardcoded). The
 * `test` job is also asserted to leave the store backend in-memory so CI needs
 * no live Vercel KV (ADR-006).
 */

/** Minimal shape of the parsed workflow we assert against. */
interface Step {
  name?: string;
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
  env?: Record<string, unknown>;
}
interface Job {
  "runs-on"?: string;
  needs?: string | string[];
  if?: string;
  env?: Record<string, unknown>;
  steps?: Step[];
}
interface Workflow {
  name?: string;
  on?: Record<string, unknown>;
  jobs?: Record<string, Job>;
}

const WORKFLOW_PATH = resolve(process.cwd(), ".github/workflows/ci.yml");
const rawWorkflow = readFileSync(WORKFLOW_PATH, "utf8");
const workflow = load(rawWorkflow) as Workflow;

/** The `run:` scripts of a job's steps, in order. */
function runScripts(job: Job | undefined): string[] {
  return (job?.steps ?? [])
    .map((step) => step.run)
    .filter((run): run is string => typeof run === "string");
}

/** Normalize `needs` (a string for one dep, an array for many) to a string[]. */
function needsList(job: Job | undefined): string[] {
  const needs = job?.needs;
  if (!needs) return [];
  return Array.isArray(needs) ? needs : [needs];
}

describe(".github/workflows/ci.yml — CI/CD pipeline", () => {
  it("is valid YAML defining the test and deploy jobs", () => {
    // js-yaml's default (YAML 1.2 core) schema keeps `on` a string key rather
    // than coercing it to a boolean, so the trigger block survives the round-trip.
    expect(workflow).toBeTypeOf("object");
    expect(workflow.jobs).toBeTypeOf("object");
    expect(Object.keys(workflow.jobs ?? {})).toEqual(
      expect.arrayContaining(["test", "deploy"]),
    );
  });

  it("runs the test job on both pushes and pull requests", () => {
    const triggers = workflow.on ?? {};
    expect(Object.keys(triggers)).toEqual(expect.arrayContaining(["push", "pull_request"]));
  });

  describe("test job", () => {
    it("installs, lints, and runs the vitest suite", () => {
      const scripts = runScripts(workflow.jobs?.test);
      expect(scripts).toContain("npm ci");
      // Lint and the test runner are required; the commands resolve to the
      // package.json scripts from Task 01 (`lint` → eslint, `test` → vitest).
      expect(scripts.some((s) => /\bnpm run lint\b/.test(s))).toBe(true);
      expect(scripts.some((s) => /\bnpm (run )?test\b/.test(s))).toBe(true);
    });

    it("pins the Node.js version via actions/setup-node", () => {
      const steps = workflow.jobs?.test?.steps ?? [];
      const setupNode = steps.find((s) => (s.uses ?? "").startsWith("actions/setup-node"));
      expect(setupNode, "test job must set up Node via actions/setup-node").toBeTruthy();
      expect(setupNode?.with?.["node-version"]).toBeDefined();
    });

    it("does not force the KV backend, so CI runs against the in-memory store", () => {
      // No live Vercel KV in CI (ADR-006): neither the job nor any step may set
      // STORE_BACKEND=kv. Anything else (incl. unset) falls back to in-memory.
      const job = workflow.jobs?.test;
      const envs = [job?.env, ...(job?.steps ?? []).map((s) => s.env)];
      for (const env of envs) {
        expect(env?.STORE_BACKEND).not.toBe("kv");
      }
    });
  });

  describe("deploy job", () => {
    it("is gated on the test job (needs: test)", () => {
      expect(needsList(workflow.jobs?.deploy)).toContain("test");
    });

    it("is guarded by an if condition restricting it to pushes on main", () => {
      const guard = workflow.jobs?.deploy?.if ?? "";
      expect(guard).toContain("github.event_name == 'push'");
      expect(guard).toContain("refs/heads/main");
    });

    it("deploys via the Vercel CLI prebuilt flow", () => {
      const scripts = runScripts(workflow.jobs?.deploy).join("\n");
      expect(scripts).toMatch(/vercel pull\b.*--environment=production/);
      expect(scripts).toMatch(/vercel build\b.*--prod/);
      expect(scripts).toMatch(/vercel deploy\b.*--prebuilt.*--prod/);
    });

    it("authenticates exclusively through GitHub secrets, never hardcoded", () => {
      // All three credentials must be referenced; the project ID/org ID come in
      // as env vars and the token as a CLI flag — all via `${{ secrets.* }}`.
      expect(rawWorkflow).toContain("${{ secrets.VERCEL_TOKEN }}");
      expect(rawWorkflow).toContain("${{ secrets.VERCEL_ORG_ID }}");
      expect(rawWorkflow).toContain("${{ secrets.VERCEL_PROJECT_ID }}");
      // Every `--token=` usage must resolve from the secret, never a literal.
      // Match to end of line so the whole `${{ secrets.VERCEL_TOKEN }}`
      // expression (which contains spaces) is captured, not just the prefix.
      const tokenFlags = rawWorkflow.match(/--token=.*/g) ?? [];
      expect(tokenFlags.length).toBeGreaterThan(0);
      for (const flag of tokenFlags) {
        expect(flag).toContain("${{ secrets.VERCEL_TOKEN }}");
      }
    });
  });
});
