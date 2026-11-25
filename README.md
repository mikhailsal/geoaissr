# geoaissr

A multiplayer geography guessing game for 1–8 people and up to 3 AI opponents (`claude`, `codex`, `agy`). The server runs on the host's computer and shares a common room with friends through a one-time link, using a Cloudflare Quick Tunnel or your own `--public-url`.

## Quick start (4 steps)

1. **Install dependencies (Bun >= 1.4.2, cloudflared, shellcheck):**
   ```bash
   bun install
   bun run setup:dev
   ```
2. **Configure the Google Maps keys in `.env`:**
   Copy `.env.example` to `.env` and fill in `GOOGLE_MAPS_BROWSER_KEY` and `GOOGLE_MAPS_SERVER_KEY` (details below).
   _To try the game offline without keys or a tunnel, use the test mode:_
   ```bash
   bun run dev -- --fake
   ```
3. **Check the environment and quotas:**
   ```bash
   bun run doctor
   ```
4. **Start the game:**
   ```bash
   bun run start
   ```
   Use **Ссылка хоста** on the server computer. When the tunnel is ready, the terminal also prints **Удалённый вход хоста** for the owner to open on another device. Send friends the separate **Приглашение гостям** link. A returning owner can enter their permanent host profile code.

---

## How to get Google Maps Platform keys

1. Create a project in Google Cloud Console and attach a billing account (a free monthly threshold applies: 10,000 Maps JS calls / 5,000 Dynamic Street View / 10,000 Street View Static API; the app caps usage at 80% by default: `8000 / 4000 / 8000`).
2. Under **APIs & Services → Library**, enable:
   - **Maps JavaScript API**
   - **Street View Static API**
3. Create two separate API keys:
   - `GOOGLE_MAPS_BROWSER_KEY` — sent to the players' browsers to show maps and panoramas. In the key settings, set **Application restrictions → HTTP referrers** and add:
     - `http://localhost:*/*`
     - `http://127.0.0.1:*/*`
     - `https://*.trycloudflare.com/*` (or your own domain for `--public-url`)
       And restrict **API restrictions** to **Maps JavaScript API** only.
   - `GOOGLE_MAPS_SERVER_KEY` — used **only by the host's server** (Street View Static API and Metadata API calls). Restrict it by API only (**Street View Static API**) and never share it with anyone.
     The app tracks quota use by UTC day. You can override its monthly ceilings in `settings.json` using the optional `quotaCeilings` object, with positive integer values for `staticRequests`, `panoLoads`, and `mapLoads`; omitted values keep the defaults above. Changes take effect after restarting the server. API usage events are also appended on a best-effort basis to `api-usage.jsonl` in the data directory. The lobby quota widget shows usage percentages and forecasts against the configured ceilings.

4. **Daily limits in Cloud Console (recommended safeguards):**
   So that a client bug cannot exhaust the monthly limit in a single evening, set daily limits in the Cloud Console quotas:
   - Maps JS API: **500 / day**
   - Dynamic Street View Panorama Loads: **250 / day**
   - Street View Static API: **500 / day**

Never commit `.env` to git (the `bun run check` check and the pre-commit hook block an accidental commit).

---

## AI subscriptions and privacy

The AI opponents use CLI tools that are already installed and signed in on the host's machine (`claude`, `codex`, `agy`):

- Before playing with friends, it is recommended to turn off model training on your prompts in the account settings of Claude, OpenAI Codex / ChatGPT and Antigravity (`agy`).
- **Important about `agy`:** `agy` can technically read the user's files when it runs on the system (unlike `claude`/`codex`, where snapshots are passed only in the memory of the MCP process). Do not keep plaintext secrets or private keys in your home directory; `.env` is passed only to the game process.
- The lobby has a **«Проверить зрение»** ("Check vision") button for each AI slot — use it after choosing a new model or snapshot size.

Each AI slot has a play style (**«Стиль игры»** in the slot settings). **«Интуит»** is one process that sees the frames and guesses. **«Детектив»** is two processes: the «глаза» see the frames and describe them without naming a place, the «мозг» reads the descriptions, asks for more and places the pin. It runs on `claude`, `codex` and `agy`. By default both processes use the slot's harness and model; under «Глаза детектива» the eyes can run on another harness and model, for example a cheap vision model for the eyes and a strong one for the brain. The brain and the eyes have their own effort («Усилия мозга», «Усилия глаз»); the eyes default to low, which is usually enough to describe frames and keeps their answers fast. A Detective needs a round of at least 90 seconds; otherwise the slot plays Intuit for that match and the lobby says why. It spends tokens for both processes. On `agy` the brain's file guard denies every file read, so the brain cannot open the eyes' frames; if the guard leaves no record, the result card says that isolation was not confirmed.

The bots' start prompts are plain text files in `server/bots/prompts/`. Edit a file and the change applies from the next round, with no restart ([syntax and rules](server/bots/prompts/README.md)).

After a round, open an AI's **«почему?»** card to inspect its step journal: the reason before each action, the finding after it, which region versions were excluded or weakened, and a first-person summary. A **«Черновик»** badge means the latest saved checkpoint (`current_guess`) was scored because the bot ended without a final submission.

The token badge shows CLI-reported usage when available. Its tooltip separates input, output and cached input and identifies the matched OpenRouter model. The dollar value shows three decimal places with **«API-цена для справки»**, using OpenRouter reference prices rather than the host's subscription bill; approximate model matches are labelled. Missing usage, prices or a suitable match appear as **«н/д»**. The model-price list is cached for 24 hours in `openrouter-models-cache.json` in the data directory; failed refreshes use the last readable cache.

For a Detective the card shows the eyes' report, every exchange between the brain and the eyes, and the token split by process.

The [bot tool and accounting reference](docs/bot-tools.md) describes the step journal fields, checkpoints and final submissions, camera parameters, the Detective play style and token normalization. The dry evaluation exercises the runtime and scoring pipeline with fake bots; a live `bun run eval:bots` run measures one real bot configuration on the licensed photo set ([details](docs/evals/README.md)), and neither guarantees how well a model follows the prompt.

---

## Maps and regions

The host picks two things in **Настройки партии**: the **Карта** (map), which is the pool of places a round can start in, and the **Регион** (region), which narrows any map to the whole world, a continent or one country. A line under the map select says what the map holds; the AI opponents are told the same.

| Map              | Where a round starts                                                                     |
| ---------------- | ---------------------------------------------------------------------------------------- |
| «Стандартная»    | Half of the rounds in a town or village, half at a random point of a country             |
| «Глушь»          | Random points by country area: mostly roads far from any town                            |
| «Города»         | The dense built-up area of a city of 500 thousand people or more                         |
| «Мегаполисы»     | The same, for cities of 5 million people or more                                         |
| «Столицы»        | National capitals, every country equally likely                                          |
| «Аэропорты мира» | Within 5 km of an airport with scheduled flights                                         |
| «Высокогорье»    | Cities of 100 thousand people or more above 2,000 m                                      |
| «Север»          | North of 60° N                                                                           |
| «Ретро»          | Panoramas shot before 2012, in the 28 countries where Google still serves enough of them |

Not every map has places everywhere: there are no cities above 2,000 m in Europe, and «Север» reaches eight countries. The lobby greys out a map that is empty in the chosen region and a region the chosen map does not reach. Scores are scaled to the region, so a guess 100 km off costs far more in a one-country match than in a world match.

The same settings can be given at start, for example `bun run start -- --map capitals --region europe` or `--region country:FRA` (a country is named by its three-letter code, as in the lobby's list).

The place lists are built from open data and committed to the repository; no Street View image is stored. Sources: country outlines from [Natural Earth](https://www.naturalearthdata.com/) (public domain); towns, capitals and elevations from [GeoNames](https://www.geonames.org/) (CC BY 4.0); city outlines from the [GHSL Urban Centre Database R2024A](https://human-settlement.emergency.copernicus.eu/) of the European Commission's Joint Research Centre (CC BY 4.0); airports from [OurAirports](https://ourairports.com/data/) (public domain).

---

## Commands

| Command                                                  | Purpose                                                                                                  |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `bun run doctor`                                         | Checks `.env`, the Google API, `cloudflared`, the AI bot CLIs and the build (`--json` for a JSON report) |
| `bun run start`                                          | Production start: builds the client, starts the server and a Quick Tunnel (`trycloudflare.com`)          |
| `bun run start -- --public-url https://game.example.com` | Start behind your own reverse proxy / domain (with DNS and `/healthz` checks)                            |
| `bun run start -- --no-tunnel`                           | Local start on the host's machine only, without a tunnel                                                 |
| `bun run start -- --fake --no-tunnel`                    | Local test mode with simulated maps, panoramas and AI bots                                               |
| `bun run dev`                                            | Development mode (Vite HMR on `:5173` + backend API/WS; auto-`--fake` when there is no key)              |
| `bun run check`                                          | Full set of checks (`eslint`, `prettier`, `tsc`, `svelte-check`, file size, color tokens, `shellcheck`)  |
| `bun run test`                                           | Unit + integration tests                                                                                 |
| `bun run test:e2e`                                       | Browser E2E and WCAG accessibility tests in Playwright (`axe-core`)                                      |
| `bun run test:harness -- --only claude`                  | Live smoke test of a specific AI harness through MCP                                                     |
| `bun run test:tunnel -- --hold-sec 5`                    | Live check of the `cloudflared` Quick Tunnel and DNS readiness                                           |
| `bun run eval:bots -- --dry --repeats 1`                 | Offline dry run of the bot evaluation ([details](docs/evals/README.md))                                  |
| `bun run maps:sample -- --map cities --region europe`    | Rolls live rounds of a map and region and prints the mix (free metadata lookups; `--help` for flags)     |

---

## Profiles and recent wins

Your browser remembers your profile and permanent code and automatically signs you in on later visits. Names and colors may coincide with other participants. Use **«Профиль»** in the lobby or final results to edit your name and color; editing is unavailable during a match.

The lobby opens on the shared stage once the visible characters have rendered. Select a nameplate to open that character. Your own window combines the wardrobe with your name, participant color, and permanent profile code. The host can dress robots and change their AI settings in the same window. Other players can inspect the outfit and turn the preview. Saved appearance changes appear for everyone and persist with the profile.

Use **Участники** to manage the roster and **Настройки партии** to adjust the game. Close a window with its close button, Escape, or a click outside. Players send gestures as their own characters. The host can also select a robot and send a gesture as that robot. Emotions and turns on the stage reach everyone in the lobby. Repeated clicks add momentum to the ongoing turn. Turning a wardrobe preview stays local.

In **Настройки партии**, the host can enable **Пуш: сократить время после ответа** and enter 1–60 seconds in **Оставить после пуша (с)**. The default is 15 seconds. A confirmed guess caps the remaining time for everyone. Placing a pin or confirming when less time remains keeps the existing deadline. Players still guessing hear the usual warning in the final 15 seconds. Clear **Разрешить ИИ пушить** to let only humans trigger the shorter clock. Push is off by default.

After each round, open **Рейтинг за игру** to see the cumulative standings. The host can turn off **Показывать рейтинг между раундами** under **Настройки партии** to reveal the standings only at the end.

The trophy beside each avatar counts wins from the last six hours. Only complete matches with exactly one first-place finisher count; ties and early finishes do not. Human wins follow the profile UUID, and AI wins follow the bot slot even after a rename. The host can reset an individual bot's count in the lobby or final results. Matches and reset timestamps persist on the server; a storage error is reported in the room.

Browser storage remains origin-specific. On a new hostname, browser, or cleared site storage, enter your permanent profile code on the homepage to restore the same identity, music and effects volumes, and mute choices from the server profile. See [Permanent profile codes](#permanent-profile-codes) for login, logout, and recovery details.

## Keyboard controls and accessibility

- The header's **Звуковые эффекты** and **Фоновая музыка** buttons open independent volume controls with sliders, minus/plus buttons and mute. **Сбросить** in either panel restores both channels to their defaults. Choices are saved in the user profile and restored by permanent code across tunnel hostnames. Music defaults to 60% and effects to 100%. The lobby repeats the original Suspense track, with its drone, heartbeat and quiet ticks at a reduced volume. During matches, seven tracks play in sequence, each finishing before the next begins; round changes, answers and results preserve the queue. The loading phrase finishes before the countdown, and a timer that reaches zero keeps its recorded ending. Audio starts after an interaction; hiding the tab, disconnecting or muting saves the music's position for resuming. See the [audio reference](docs/audio.md) for every file's role, timing and license.
- **Enter** in an active round — submit the placed marker («Угадать», "Guess").
- **M** — expand/collapse the minimap in a round (or open the map sheet on a narrow screen `< 900px`).
- **Space** on the round results screen — instantly show all arcs and pins without waiting for the animation.
- **Esc** — close the profile editor, an open AI bot «почему?» ("why?") card, or the host dropdown menu, returning focus to its button.
- The interface supports `prefers-reduced-motion: reduce`, `Tab` navigation, `aria-live` announcements of timer/status changes, text contrast >= 4.5:1 and distinct avatar shapes (a circle for humans, a square with a processor icon for AI).

Detailed CLI error codes are described in [docs/errors.md](docs/errors.md).
Interface conventions are described in [DESIGN.md](DESIGN.md).

### Permanent profile codes

New players register through a current guest or host invitation. Registration issues one permanent personal code, available under **Профиль → Скопировать код** in every game phase. Returning players open the server homepage and choose **Войти по коду**; no invitation, name entry, or color choice is needed. The same code works after a hostname change, in another browser, and after a normal server restart on the same installation. A host profile retains host authority. Codes accept either 32 hexadecimal characters or eight hyphen-separated groups of four, including uppercase and pasted whitespace (up to 64 raw characters).

A profile can occupy one room seat. Signing in on another device resumes that seat and closes its previous connection. Names and colors may coincide with other humans or bots; identities and the existing six-hour win counts remain separate. Profile edits are available in the Lobby and Final screens. Viewing the code and **Выйти** remain available throughout a match. Logout clears this origin's saved credentials and notifies its other tabs; it retains the server profile, permanent code, results, and wins. In the lobby, a disconnected guest has ten minutes to reclaim their seat. The host can free it sooner with **Участники → Освободить место**. During a match the seat stays available for reconnecting through the final results. After a seat is freed, the same profile code can claim a new place when one is available. Log out before signing in to another profile.

The private `${GEOAISSR_DATA_DIR}/profiles.json` registry (default `~/.local/share/geoaissr/profiles.json`) stores recoverable codes with owner-only file permissions. Back it up privately alongside the server data. Codes never expire or rotate. If a player loses every copy, the server owner can retrieve that profile's existing code directly from this private file; there is no recovery UI or code reissue. Never publish or send the registry to other players. Malformed, unreadable, duplicate-identity, or newer-version registries make profile operations unavailable while preserving their original bytes. Restore or repair the registry before restarting; connected gameplay can continue during a write failure.
