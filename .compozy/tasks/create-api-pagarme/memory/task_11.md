# Task Memory: task_11.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot
- Docs-only task (no src changes): create `README.md` + `docs/connection-guide.md` + doc-parity tests.
- Source of truth: `_idea.md` §5 (magic cards) / §7 (connection steps), PRD risks, ADR-002/003/006/007.
- Pre-change signal: README.md, docs/connection-guide.md, and the two doc test files all ABSENT.

## Important Decisions
- Doc tests assert doc↔code/behavior parity (not just static text):
  - `tests/unit/docs.test.ts` reads `MAGIC_CARD_NUMBERS` from `src/magic/cards.ts` and asserts every one of the
    six numbers appears in the README catalog → catches drift if the table and code diverge.
  - `tests/integration/docsAccuracy.test.ts` parses the README sample request fenced JSON (located by an HTML
    marker `<!-- doctest:orders-request -->`), POSTs it via supertest to the in-process app, asserts the
    documented approved+captured outcome; plus a `GET /health` 200 boot smoke.
- Deployed Vercel URL is documented as a placeholder `https://<your-fake>.vercel.app` (project not provisioned;
  see shared-memory open follow-up). Connection guide = URL swap, not key swap.

## Learnings
- `eslint .` and `tsc -p tsconfig.test.json` cover `tests/` too, so doc tests must lint/typecheck clean
  (used `it.each` + `existsSync`/`dirname` for the link-check; non-null assertion on the regex match is fine
  since the preceding `expect(...).not.toBeNull()` guards it).
- Doc-accuracy app is built via `createPagarmeApp(createStore({}))` (empty env → in-memory) — mirrors the
  documented `npm start` default without needing a built `dist/` or a child process.

## Files / Surfaces
- CREATED: `README.md`, `docs/connection-guide.md`, `tests/unit/docs.test.ts` (18 tests),
  `tests/integration/docsAccuracy.test.ts` (2 tests). NO `src/` changes (docs-only task).

## Errors / Corrections
- A shell link-checker gave false "MISS" on `docs/connection-guide.md`'s `../.compozy/...` links because the
  `-e` test ran from repo root, not `docs/`. The links are valid (`docs/../.compozy/...`); the committed
  link-check test resolves each link relative to its own doc dir.

## Ready for Next Run
- Task 11 DONE & verified: all 12 PRD tasks complete. Gates green (lint/typecheck/build exit 0; 195 pass / 2
  skip; 100% coverage). Auto-commit disabled — diff left for manual review.
