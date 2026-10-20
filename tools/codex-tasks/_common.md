## Rules for every task (read first)

- Repo: a TypeScript pnpm monorepo for a browser RTS/MOBA game. Read `CLAUDE.md` (code rules, simple English, kebab-case files) and `docs/design/AI_ARCHITECTURE.md` (Phase 8 plan) before you start.
- Write **only** the files your task names. Do **not** edit any other file (not `shared/src/index.ts`, not other modules, not docs, not package files). Import from other modules with relative paths (e.g. `../nav/nav-grid`). In tests, import from `../src/...` paths, not from the package index.
- Plain logic only: no DOM, no Babylon, no Node APIs inside `shared/src` (tests may use `node:fs` to read map data).
- Hot paths: no new objects per call in inner loops; reuse typed arrays. Keep it fast.
- Comments only where the "why" is not obvious. Simple English.
- When done, run and make pass, from the repo root:
  - `pnpm --filter @game/shared exec vitest run <your test files>`
  - `pnpm --filter @game/shared typecheck`
  - `pnpm exec eslint <your files>`
  - `pnpm exec prettier --write <your files>`
- Do **not** run git commands that change history (no commit, no branch, no reset). Leave your files in the working tree; they will be reviewed and committed by the lead engineer.
- At the end, print a short report: files written, the API, what the tests check, measured timings, and anything you were unsure about.
