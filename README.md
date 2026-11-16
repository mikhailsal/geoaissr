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

After a round, open an AI's **«почему?»** card to inspect its visual clues, rejected alternatives and final deduction. The step timeline groups initial views and shows each camera view or move, its zoom and the hypothesis being checked. A **«Черновик»** badge means the latest saved checkpoint was scored because the bot ended without a final submission.

The token badge shows CLI-reported usage when available. Its tooltip separates input, output and cached input and identifies the matched OpenRouter model. The dollar value shows three decimal places with **«API-цена для справки»**, using OpenRouter reference prices rather than the host's subscription bill; approximate model matches are labelled. Missing usage, prices or a suitable match appear as **«н/д»**. The model-price list is cached for 24 hours in `openrouter-models-cache.json` in the data directory; failed refreshes use the last readable cache.

The [bot tool and accounting reference](docs/bot-tools.md) describes draft/final submissions, camera parameters and token normalization. The offline evaluation exercises the runtime and scoring pipeline; it does not measure how well a live model follows the prompt.

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

Your browser remembers your profile and permanent code and automatically signs you in on later visits. Names and colors may coincide with other participants. Use **«Профиль»** in the lobby or final results to edit your name and color; editing is unavailable during a match.

The trophy beside each avatar counts wins from the last six hours. Only complete matches with exactly one first-place finisher count; ties and early finishes do not. Human wins follow the profile UUID, and AI wins follow the bot slot even after a rename. The host can reset an individual bot's count in the lobby or final results. Matches and reset timestamps persist on the server; a storage error is reported in the room.

Browser storage remains origin-specific. On a new hostname, browser, or cleared site storage, enter your permanent profile code on the homepage to restore the same identity. See [Permanent profile codes](#permanent-profile-codes) for login, logout, and recovery details.

## Keyboard controls and accessibility

- **Enter** in an active round — submit the placed marker («Угадать», "Guess").
- **M** — expand/collapse the minimap in a round (or open the map sheet on a narrow screen `< 900px`).
- **Space** on the round results screen — instantly show all arcs and pins without waiting for the animation.
- **Esc** — close the profile editor, an open AI bot «почему?» ("why?") card, or the host dropdown menu, returning focus to its button.
- The interface supports `prefers-reduced-motion: reduce`, `Tab` navigation, `aria-live` announcements of timer/status changes, text contrast >= 4.5:1 and distinct avatar shapes (a circle for humans, a square with a processor icon for AI).

Detailed CLI error codes are described in [docs/errors.md](docs/errors.md).
Interface conventions are described in [DESIGN.md](DESIGN.md).

### Permanent profile codes

New players register through a current guest or host invitation. Registration issues one permanent personal code, available under **Профиль → Скопировать код** in every game phase. Returning players open the server homepage and choose **Войти по коду**; no invitation, name entry, or color choice is needed. The same code works after a hostname change, in another browser, and after a normal server restart on the same installation. A host profile retains host authority. Codes accept either 32 hexadecimal characters or eight hyphen-separated groups of four, including uppercase and pasted whitespace (up to 64 raw characters).

A profile can occupy one room seat. Signing in on another device resumes that seat and closes its previous connection. Names and colors may coincide with other humans or bots; identities and the existing six-hour win counts remain separate. Profile edits are available in the Lobby and Final screens. Viewing the code and **Выйти** remain available throughout a match. Logout clears this origin's saved credentials and notifies its other tabs; it retains the server profile, permanent code, current seat, results, and wins. Log out before signing in to another profile.

The private `${GEOAISSR_DATA_DIR}/profiles.json` registry (default `~/.local/share/geoaissr/profiles.json`) stores recoverable codes with owner-only file permissions. Back it up privately alongside the server data. Codes never expire or rotate. If a player loses every copy, the server owner can retrieve that profile's existing code directly from this private file; there is no recovery UI or code reissue. Never publish or send the registry to other players. Malformed, unreadable, duplicate-identity, or newer-version registries make profile operations unavailable while preserving their original bytes. Restore or repair the registry before restarting; connected gameplay can continue during a write failure.
