# Task Memory: task_09.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot
GitHub Actions CI/CD: `.github/workflows/ci.yml` — `test` job (push+PR) gating a `deploy` job (push to `main` only) that ships to Vercel via the Vercel CLI. DONE & verified. Auto-commit disabled — diff left for manual review.

## Important Decisions
- `test` job runs the FULL gate (`npm ci` → lint → typecheck → build → `npm test`), not just the spec's literal `npm ci`/lint/vitest. Superset is intentional per shared-memory "CI should run typecheck/build alongside lint/test"; doesn't violate the requirement.
- `deploy` guard is `if: github.event_name == 'push' && github.ref == 'refs/heads/main'` + `needs: test`. Org/Project IDs passed to the Vercel CLI as job-level `env:` (the CLI reads them); the token passed per-command as `--token=${{ secrets.VERCEL_TOKEN }}`. `vercel pull` uses `--yes` (non-interactive CI).
- Node pinned `node-version: "20"` (matches `engines.node>=20`) via `actions/setup-node@v4`, `cache: npm`. Added `concurrency` group to cancel superseded runs.
- Added `js-yaml@^4.1.0` + `@types/js-yaml@^4.0.9` as **devDependencies** to back the YAML-parse test (js-yaml was already transitive at 4.2.0; types were not). js-yaml v4 default schema keeps `on:` a string key (no YAML-1.1 boolean coercion) — the test reads `workflow.on`.

## Learnings
- The workflow-validation test (`tests/unit/ciWorkflow.test.ts`) resolves the file via `resolve(process.cwd(), ".github/workflows/ci.yml")` — vitest runs from repo root. Do NOT use `import.meta.url` (tsconfig `module: CommonJS` → `typecheck` errors on import.meta).
- `--token=\S+` is WRONG for matching the token flag: `${{ secrets.VERCEL_TOKEN }}` contains spaces, so `\S+` truncates at `--token=${{`. Use `/--token=.*/g` (to end of line).

## Files / Surfaces
- ADD `.github/workflows/ci.yml` (the pipeline; secrets documented in a header comment block).
- ADD `tests/unit/ciWorkflow.test.ts` (9 tests: parse, triggers, test-job steps, node pin, in-memory backend, deploy `needs`/`if`, Vercel CLI flow, no-hardcoded-secrets).
- EDIT `package.json` + `package-lock.json` (add `js-yaml` + `@types/js-yaml` devDeps).

## Errors / Corrections
- First test run failed on my own `--token=\S+` regex (not the workflow). Fixed to `/--token=.*/g`; re-ran green.

## Ready for Next Run
- VERIFIED: lint=0, typecheck=0, build=0, `npm test`=0 → 22 files / 163 tests pass, 100% coverage. `npm ci`=0 (lockfile in sync → CI's first step works).
- T4 (`vercel build` prebuilt smoke check) is **CI-only / not runnable in this hermetic env**: Vercel CLI not installed and can't be (needs `vercel@54.9.0` network download + linked project + `VERCEL_TOKEN`). Proxy validated locally: `npm run build` populates `dist/`; `api/index.ts` + `vercel.json` present and exercised by existing `vercelHandler`/`vercelEntrypoint` tests.
- For **Task 11 (README/connection guide)**: document the three GitHub secrets (`VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`) set in repo Settings → Secrets and variables → Actions; the test job needs none of them. Mirror the workflow's two-job (test→deploy) gating description.
