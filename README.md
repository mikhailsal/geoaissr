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
   The terminal prints two `#t=...` links: **Ссылка хоста** (Host link, for you) and **Приглашение гостям** (Invitation for guests, send it to your friends).

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

---

## Profiles and recent wins

Your browser remembers your name, color and a profile UUID, and automatically joins when its previous session cannot be restored. If the name or color is occupied, choose another on the prefilled join form. Use **«Изменить профиль»** in the lobby or final results to edit your profile; editing is unavailable during a match.

The trophy beside each avatar counts wins from the last six hours. Only complete matches with exactly one first-place finisher count; ties and early finishes do not. Human wins follow the profile UUID, and AI wins follow the bot slot even after a rename. The host can reset an individual bot's count in the lobby or final results. Matches and reset timestamps persist on the server; a storage error is reported in the room.

Profiles belong to one browser and origin. A new Quick Tunnel hostname, browser, or cleared site storage creates a separate profile; use a stable `--public-url` to retain it across tunnel restarts. Profile IDs identify statistics, while session secrets control seat restoration.

## Keyboard controls and accessibility

- **Enter** in an active round — submit the placed marker («Угадать», "Guess").
- **M** — expand/collapse the minimap in a round (or open the map sheet on a narrow screen `< 900px`).
- **Space** on the round results screen — instantly show all arcs and pins without waiting for the animation.
- **Esc** — close the profile editor, an open AI bot «почему?» ("why?") card, or the host dropdown menu, returning focus to its button.
- The interface supports `prefers-reduced-motion: reduce`, `Tab` navigation, `aria-live` announcements of timer/status changes, text contrast >= 4.5:1 and distinct avatar shapes (a circle for humans, a square with a processor icon for AI).

Detailed CLI error codes are described in [docs/errors.md](docs/errors.md).
Interface conventions are described in [DESIGN.md](DESIGN.md).
