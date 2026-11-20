# CLAUDE.md — Working rules for the geoaissr repository

## Language

- All documentation (`*.md`, including this file, `PLAN.md`, `docs/`), commit messages, pull request titles and descriptions, and code comments are written in **English**.
- The game's user-facing UI strings and server messages shown to players stay in Russian; that is product content, not documentation.

## Repository layout

A single root `package.json` (no workspaces):

- `shared/` — protocol, zod schemas, regions, colors, scoring, bot tool schemas. Imports nothing from other folders.
- `server/` — game server on Bun (`engine/`, `net/`, `proc/`, `storage/`, `bots/`, `images/`, `tunnel/`, `cli/`, `dev/`, `http/`). Does not import `web/` or `bot-tools/`.
- `web/` — frontend on Svelte 5 + Vite. Imports only from `shared/` and packages.
- `bot-tools/` — MCP stdio bridge to `127.0.0.1:BOT_PORT`. Imports only from `shared/` and packages.
- `scripts/` — check, region build, hook and eval scripts.
- `spikes/` — throwaway M0 spike code (subject to the same limits and checks; deleted after M1).
- `test/` — integration tests and the fake MCP harness.

## Quality gates and limits

`.githooks/pre-commit` and `.githooks/pre-push` (`bun run check`) run before every commit and push:

1. `.env` is not tracked by git.
2. `shellcheck` for shell scripts (`.githooks/*`, `scripts/*.sh`).
3. `eslint . --max-warnings 0` (`typescript-eslint` strictTypeChecked, `eslint-plugin-svelte`, import boundaries).
4. `prettier --check .`.
5. `tsc --noEmit -p tsconfig.server.json` and `tsconfig.web.json`, plus `svelte-check`.
6. **Size limits (`scripts/check-size.ts`):**
   - source file (`.ts`, `.js`, `.mjs`, `.svelte`) <= **500** lines;
   - test file (`*.test.ts`, `*.spec.ts`) <= **1000** lines;
   - function <= **80** lines (`max-lines-per-function: 80`). **Note for tests:** the rule applies to tests too — don't wrap a whole test file in one big `describe(...)`; write top-level `test(...)` calls or split into small blocks.
7. **Colors (`scripts/check-colors.ts`):** `#rrggbb`, `#rgb`, `rgb(...)` and `rgba(...)` literals are forbidden in `web/src/**/*.svelte`. All colors live only in `web/src/styles/tokens.css` (see [DESIGN.md](./DESIGN.md)).

## Commands

- `bun run setup:dev` — prepare the developer environment (dependencies, hooks, Playwright Chromium, `shellcheck` check).
- `bun run hooks:install` — install `.githooks/pre-commit` and `.githooks/pre-push`.
- `bun run check` — full quality-gate run (on failure prints the step and the exact command to repeat).
- `bun run test` — unit and integration tests (`bun test`, no network or keys).
- `bun run test:e2e` — end-to-end Playwright tests (in `--fake` mode, no network or keys).
- `bun run dev --fake` — local development without Google keys, tunnel or subscriptions.
- `bun run doctor` / `bun run doctor --json` — check keys, `cloudflared`, harnesses.
- `bun run start` — build the client, start the server and tunnel (`--no-tunnel`, `--public-url`, `--port`, `--no-open`).
- `bun run test:harness` / `bun run test:tunnel` — on-demand live checks (with network/CLI).
- `bun run eval:bots` — measure one bot configuration (finish rate, time, error, pin movement) on the licensed panorama dataset; flags and metrics in [docs/evals/README.md](./docs/evals/README.md).

## Data storage and errors

- Config and data paths are set only through `server/paths.ts` (`GEOAISSR_CONFIG_DIR`, `GEOAISSR_DATA_DIR`). In `--fake` test mode `.geoaissr-dev/` is used.
- Error code registry: `server/errors.ts` and [docs/errors.md](./docs/errors.md).
- Visual language: [DESIGN.md](./DESIGN.md).

## Releases

- This is a locally run application. There is no hosted deployment step; a release does not restart the local app.
- Use `package.json` as the version source, pinned by `.gstack/version-path`.
- Update `CHANGELOG.md` for the release, run the required checks, and commit the version and changelog together.
- After CI passes for the release commit on `main`, create and push an annotated Git tag named `v<version>` at that commit.
- Preserve published tags. Never replace or force-push an existing release tag.
