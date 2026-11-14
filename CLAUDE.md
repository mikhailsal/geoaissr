# CLAUDE.md — Правила работы с репозиторием geoaissr

## Устройство репозитория

Единый корневой `package.json` (без workspaces):

- `shared/` — протокол, zod-схемы, регионы, цвета, очки, схемы инструментов бота. Не импортирует ничего из других папок.
- `server/` — игровой сервер на Bun (`engine/`, `net/`, `proc/`, `storage/`, `bots/`, `images/`, `tunnel/`, `cli/`, `dev/`, `http/`). Не импортирует `web/` и `bot-tools/`.
- `web/` — фронтенд на Svelte 5 + Vite. Импортирует только из `shared/` и пакетов.
- `bot-tools/` — stdio-мост MCP к `127.0.0.1:BOT_PORT`. Импортирует только из `shared/` и пакетов.
- `scripts/` — служебные скрипты проверок, сборки регионов, хуков и eval.
- `spikes/` — одноразовый код спайков M0 (подчиняется тем же лимитам и проверкам; удаляется после M1).
- `test/` — интеграционные тесты и поддельный MCP-харнесс.

## Ворота качества и лимиты

Перед коммитом и пушем запускаются `.githooks/pre-commit` и `.githooks/pre-push` (`bun run check`):

1. `.env` не отслеживается git.
2. `shellcheck` для shell-скриптов (`.githooks/*`, `scripts/*.sh`).
3. `eslint . --max-warnings 0` (`typescript-eslint` strictTypeChecked, `eslint-plugin-svelte`, границы импортов).
4. `prettier --check .`.
5. `tsc --noEmit -p tsconfig.server.json` и `tsconfig.web.json`, а также `svelte-check`.
6. **Лимиты размера (`scripts/check-size.ts`):**
   - исходный файл (`.ts`, `.js`, `.mjs`, `.svelte`) <= **500** строк;
   - тестовый файл (`*.test.ts`, `*.spec.ts`) <= **1000** строк;
   - функция <= **80** строк (`max-lines-per-function: 80`). **Важно для тестов:** правило действует и в тестах — не оборачивайте весь файл теста в один большой `describe(...)`, пишите `test(...)` на верхнем уровне или разбивайте на небольшие блоки.
7. **Цвета (`scripts/check-colors.ts`):** в `web/src/**/*.svelte` запрещены литералы `#rrggbb`, `#rgb`, `rgb(...)`, `rgba(...)`. Все цвета живут только в `web/src/styles/tokens.css` (см. [DESIGN.md](./DESIGN.md)).

## Команды

- `bun run setup:dev` — подготовка окружения разработчика (зависимости, хуки, Playwright Chromium, проверка `shellcheck`).
- `bun run hooks:install` — установка `.githooks/pre-commit` и `.githooks/pre-push`.
- `bun run check` — полный прогон ворот качества (при падении печатает шаг и точную команду повтора).
- `bun run test` — модульные и интеграционные тесты (`bun test`, без сети и ключей).
- `bun run test:e2e` — сквозные Playwright-тесты (в режиме `--fake`, без сети и ключей).
- `bun run dev --fake` — локальная разработка без ключей Google, туннеля и подписок.
- `bun run doctor` / `bun run doctor --json` — проверка ключей, `cloudflared`, харнессов.
- `bun run start` — сборка клиента, запуск сервера и туннеля (`--no-tunnel`, `--public-url`, `--port`, `--no-open`).
- `bun run test:harness` / `bun run test:tunnel` — живые проверки по требованию (с сетью/CLI).
- `bun run eval:bots` — оценка промптов и схем ботов на локальных снимках.

## Хранение данных и ошибки

- Пути к конфигам и данным задаются только через `server/paths.ts` (`GEOAISSR_CONFIG_DIR`, `GEOAISSR_DATA_DIR`). В тестовом режиме `--fake` используется `.geoaissr-dev/`.
- Реестр кодов ошибок: `server/errors.ts` и [docs/errors.md](./docs/errors.md).
- Визуальный язык: [DESIGN.md](./DESIGN.md).
