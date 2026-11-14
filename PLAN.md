<!-- /autoplan restore point: "/home/tass/myprojects/geoaissr/.gstack/tmp/autoplan/HEAD-autoplan-restore-20261113-002039.md" -->
## Implementation plan
# geoaissr: a multiplayer geo-guessing game with AI opponents

Status: approved by the owner on 2026-11-13 after the `/autoplan` review (CEO, design, DX, engineering). Plan author: Claude, from the owner's description of 2026-11-13.

## 1. Task

Three friends play GeoGuessr in the "whoever scores more points wins" mode. With just three of them it gets boring, and there are no new players. They need their own game of the same genre in which up to three AI opponents join the three humans. The AIs make their guesses through the owner's local harnesses and their subscriptions: `codex`, `claude`, `agy` (Antigravity). `gemini-cli` is not used (outdated, owner's decision).

The owner launches the game on their own machine. Friends join via a link with a token through a public tunnel. There is no registration.

## 2. Owner's requirements (verbatim in meaning)

1. Multiplayer without registration; entry via a link with a token.
2. A public tunnel to the outside from the owner's local machine.
3. Match settings: number of rounds and round duration.
4. The winner is whoever scores the most points over all rounds.
5. Up to 3 AI opponents, each configurable: harness and any vision-capable model available in it.
6. The AI receives screenshots of the panorama from different directions with compass-direction captions.
7. The AI has a configurable move limit.
8. The AI must explain its guess at the end of the round; a click on the AI icon shows a short explanation.
9. Pleasant animation, fast performance.
10. Real Google panoramas. The map for answering may be free, OSM-like.

## 3. Verified facts (2026-11-13, live checks on the owner's machine)

| Fact | How verified | Conclusion for the plan |
|---|---|---|
| Installed: `codex` 0.167.0, `claude` 2.1.322, `agy` 1.5.7, `cloudflared` 2025.11.1, `bun` 1.4.2, `node` 22.16 | `command -v`, `--version` | The stack and the tunnel are taken from what is already installed |
| `codex` is logged in via ChatGPT, `claude` is logged in via claude.ai | `codex login status`, `claude auth status` | Ready to work |
| `agy models` answers `Error: Please sign in to view available models` | live run | Signing in to `agy` is needed before the game; `doctor` must catch this |
| `codex exec` accepts images via the `-i` flag, MCP servers are set via `-c mcp_servers.*` | `codex exec --help`, `codex mcp --help` | There is a path for delivering images |
| `claude -p` and `agy -p` have `--output-format json`, `--json-schema` (agy), `--model`, `--effort`; both have MCP | `--help` | A single approach: tools via MCP |
| `GOOGLE_API_KEY` is present in the environment, but Street View is disabled on it: `REQUEST_DENIED: This API is not activated on your API project` | free request to `streetview/metadata` | Maps JavaScript API and Street View Static API must be enabled in a project with billing |
| Google free monthly volume: Dynamic Street View 5,000 loads, Static Street View 10,000 images, metadata unlimited and free | Google's official price table (via search, page date not confirmed) | The game fits within the free volume; a counter and a hard ceiling are needed |
| `cloudflared` Quick Tunnel: up to 200 concurrent requests, SSE not supported; the owner has no `~/.cloudflared/config.yaml` | Cloudflare documentation, `ls ~/.cloudflared` | WebSocket-only transport. Verified live on 2026-11-13: HTTPS 200 and `101 Switching Protocols` pass through a quick tunnel; the tunnel name appears in public DNS with a delay |

Not verified and moved to the M0 spikes: whether images from MCP tool results reach the model in each of the three harnesses; the time of one turn for each harness. The Google terms were read on 2026-11-13 (Google Maps Platform Terms of Service, edition of 26 August 2026). Clause 3.2.3(e) forbids showing Street View and a non-Google map on the same screen. Clause 3.2.3(a) forbids taking Google Maps Content outside Google services (storing, passing on). Clause 3.2.3(c)(vii) forbids using it to improve AI models (training, testing, validation, fine-tuning). The original design, as far as the map and the AI opponents are concerned, conflicts with these clauses; the decision is the owner's (section 14, "Owner decisions before code").

## 4. Gameplay

### 4.1 Roles and entry

- Host: the owner. Runs `bun run start`, sees two links in the terminal: their own (with host rights) and the invitation link.
- Player: opens the invitation link, enters a nickname, picks a color. That is all.
- The token lives in the URL fragment (`/#t=<token>`), so it does not end up in the tunnel logs. The client sends it as the first WebSocket message.
- Player identity: `playerId` + a secret in `localStorage`. Refreshing the page or a dropped connection returns the player to their seat.
- Someone who joins mid-match watches the current round as a spectator and plays from the next one.
- Limit: 8 humans and 3 AIs.

### 4.2 Lobby (the host configures, the others see it live)

- Number of rounds: 1–20, default 5.
- Round duration: 30–600 s, default 120. If the match has an AI, the minimum is 60 s.
- Movement in the panorama: on/off. The setting is shared by humans and bots: when movement is off, the `move` tool is unavailable to bots.
- Region: world or a preset (Europe, Asia, North America, South America, Africa, Oceania).
- AI opponents, 0–3 slots. Each has: name, color, harness (`codex` / `claude` / `agy`), model, reasoning level (effort), move limit 0–20 (default 4, as in the "Любитель" ("Amateur") preset), image size, time budget, personality, difficulty preset.
- Model list: for `agy` from `agy models`; for `codex` and `claude` from an editable file `harnesses.json` plus a "custom model" field.
- A «Проверить» ("Check") button on each slot: a quick vision test (the model is shown an image with a number and must name it). Shows the response time.
- Bot settings and presets are saved in `~/.config/geoaissr/settings.json`.

### 4.3 Round

1. The server, in advance (during the lobby and the results screen), picks a location and prepares the starting images for the AIs.
2. Countdown 3-2-1, once the panorama has loaded for everyone (we wait no longer than 5 s).
3. A human sees the Google panorama full screen, a timer, a mini-map. They place a marker and press «Угадать» ("Guess"). Before pressing, the marker can be moved.
4. A participant list on the side: who has already answered; for an AI it shows «ход 3 из 4» ("move 3 of 4").
5. The round ends when the timer runs out, or when all humans have answered and all bots have finished. If the humans answered before the bots, the bots keep working for another 20 s (configurable), but not less than until the 60th second of the round, and are then cut off.
6. Anyone who did not place a marker gets 0 points; a marker that was placed but not confirmed by the end of the timer counts as an answer. For an AI the last recorded guess always counts, however its work ended (deadline, time budget, harness failure, subscription limit); a bot gets 0 points only if no guess was recorded at all.

### 4.4 Scoring

- The GeoGuessr formula: `score = round(5000 * exp(-10 * d / D))`, where `d` is the distance in km, `D` is the region diagonal (world: 14 916.862 km). For each region preset, `D` is the great-circle distance between opposite corners of the bounding rectangle of its polygons (taking the 180th meridian into account); the values are computed by `scripts/build-regions.ts` when preparing the GeoJSON, are recorded as constants in `shared/` and pinned by a unit test. For `d < 25 m` it is always 5000.
- Total: the sum over rounds. On a points tie, the higher place goes to whoever has more rounds with an answer, then to whoever has the smaller total distance over rounds with an answer; on a complete tie the place is shared.

### 4.5 Round results screen

- The map zooms out to the correct point, participants' markers appear one by one, an arc is drawn from each to the answer, the distance and points count up.
- A leaderboard with smooth row reordering.
- A click on an AI icon opens a card: a short explanation of the guess, the list of moves made with thumbnails of what the AI looked at, time spent on the round.
- The host presses «Дальше» ("Next"). There is no automatic advance: results stay on screen as long as the host wants, so the AI explanations can be read without a timer; other players see «Хост запустит следующий раунд».

### 4.6 Final

- A podium, confetti for the winner, a full per-round table, an «Ещё раз» ("Again") button (into the lobby with the same settings).
- The match result is appended to `~/.local/share/geoaissr/matches.jsonl`.

## 5. AI opponents

### 5.1 What a "move" is

The AI plays as an agent with tools. At the start of the round it gets 4 images for free: a view to the north, east, south, west. After that every action costs one move from the limit:

- `look(heading, pitch, fov)`: one image in the given direction; a small `fov` gives a zoom-in so that a sign can be read.
- `move(heading)`: a step along the road toward `heading` to a neighboring panorama; returns 4 new N/E/S/W images.

Free actions:

- `observe()`: get the 4 starting images again.
- `submit_guess(lat, lng, explanation, quip?)`: record a guess. It can be called several times, the last one counts. A hint in the prompt: give a preliminary guess right after the first look, then refine it.

The limit is counted by the server. When it is exhausted, `look` and `move` return an error «ходы кончились, вызови submit_guess» ("moves are over, call submit_guess"). `explanation` is mandatory: non-empty, up to 600 characters, in the interface language.

### 5.2 Images

- Source: Street View Static API, the request is always 640x640, by default `fov=90`, `pitch=0`. A smaller size for a slot is obtained by downscaling on the server.
- On every image the server imprints a compass-direction caption and azimuth («С 0°», «В 90°», «ЮЗ 225°»; N 0°, E 90°, SW 225°) via `sharp`. The same caption is duplicated as text in the tool response.
- The AI never receives coordinates or `pano_id`.
- `move` on the server: take a point 25 m along the azimuth, ask the free metadata endpoint about the nearest panorama; if the same one comes back, try 50 m and 100 m; if none, the move is not charged and the AI gets «в эту сторону дороги нет» ("there is no road in this direction").
- The 4 starting images are shared by all bots (one set per round).

### 5.3 Harness launch

For each round and each bot, the server launches the harness CLI once in an empty temporary directory. The whole multi-turn loop runs inside one harness session: this is faster than launching the CLI for every move.

The bot receives its tools through the MCP server `geo` (a stdio shim `bot-tools/`), which talks to the game server over a separate port.

| Harness | Command (refined by a spike) | Restrictions |
|---|---|---|
| `codex` | `codex exec -m <model> -s read-only -c mcp_servers.geo.command=... --json` | read-only sandbox without network |
| `claude` | `claude -p --model <model> --mcp-config <file> --strict-mcp-config --allowedTools "mcp__geo__*" --output-format json` | only `geo` tools |
| `agy` | `agy -p --model <model> --settings <json with MCP> --output-format json` | only `geo` tools; we do not touch the global `agy mcp` config |

Each harness adapter: one file with one function "build the command and environment". Image delivery has two modes, chosen per harness based on the spike outcome:

- `mcp`: the image is returned directly in the MCP tool result.
- `file`: the tool writes the image to the bot's temporary directory and returns the path; the harness reads it with its standard means.

### 5.4 Isolation and fairness

- The API for bots listens on a separate port, on `127.0.0.1` only; the tunnel does not point to that port. The bot token is single-use, for one round.
- The round's answer is kept only in the game server's memory.
- Web search and other harness tools are turned off for the bot by adapter flags; what is actually turned off for each harness is verified by spike S1 (section 14, "Bot process isolation").
- Player nicknames do not get into the bot prompt.
- The bot's explanation is shown to everyone only after the round ends and is rendered as plain text.
- At the deadline the server kills the harness process (SIGTERM, SIGKILL after 2 s) and cleans the temporary directory.

## 6. Panoramas and map

- Humans: Maps JavaScript API, `StreetViewPanorama`. The address, road labels and the "open in Google Maps" link are hidden. Movement is disabled by a setting (`linksControl`, `clickToGo`).
- Location selection: a random point inside the polygons of the region's countries (Natural Earth, embedded GeoJSON) with per-country weights, then a free metadata request with a radius. Only official panoramas are taken (`copyright` contains "Google", `source=outdoor`). Up to 30 attempts per point. Countries do not repeat within one match while that is possible.
- Map for answering: MapLibre GL JS with free OpenFreeMap vector tiles (OSM data, no key).
- Two Google keys: the browser key (Maps JavaScript API only, referrer restriction `*.trycloudflare.com/*`, `localhost` and the address from `--public-url` if given) is issued to the client after the token check; the server key (Street View Static API) is never given to clients.
- Usage counter: the server counts panorama loads and Static images per month in `~/.local/share/geoaissr/quota.json`. The application ceiling is by default 80% of the free volume; the counting rules, the pre-match check and the behavior when the ceiling is reached are described in section 14 ("Quota accounting"). The counter is an estimate, not a billing guarantee: the real limit is set by the daily quotas in Cloud Console.

Usage estimate per match (5 rounds, 3 humans, 3 bots, move limit 6): 15 panoramas without page reloads (the pre-match check reserves 30); Static images in the worst case 5 × (12 + 3 × (6 + 3) × 4) = 600, where 12 is up to three sets of starting images and "+ 3" are the bot's free failed calls per round. With the 80% ceiling (8,000 Static images) that is 13 such matches per month in the worst case; without the ceiling 16. With a 4-move limit the worst case is 480 images, 16 matches at the ceiling. Typical usage is several times smaller: `look` requests one image, not four.

## 7. Architecture

```
браузеры игроков ──HTTPS/WSS──> cloudflared quick tunnel ──> игровой сервер :PORT (Bun)
                                                              ├─ статика web/dist
                                                              ├─ WebSocket /ws  (комната, одна на процесс)
                                                              ├─ GameEngine (конечный автомат)
                                                              ├─ LocationService ──> Google metadata
                                                              ├─ BotImageService ──> Google Static + sharp
                                                              └─ BotRunner ──spawn──> codex | claude | agy
                                                                                       └─ MCP stdio: bot-tools
127.0.0.1:BOT_PORT (не в туннеле) <──HTTP + токен бота────────────────────────────────────┘
```

- Language: TypeScript everywhere. The server is on Bun (`Bun.serve`, built-in WebSocket). Client: Svelte 5 + Vite.
- Directories: `shared/` (protocol and zod schemas, the scoring formula), `server/`, `web/`, `bot-tools/`, `scripts/`.
- The server is authoritative: game state, timers, scores. The client sends only intents.
- State machine: `LOBBY → ROUND_LOADING → ROUND_ACTIVE → ROUND_RESULTS → (next round | FINAL) → LOBBY`.
- All incoming messages pass a zod schema; message size limit 16 KB; nickname up to 20 characters.
- Rate limiting of failed logins by client address and an overall ceiling on failed logins (thresholds and address source in section 14, "Own public address and login thresholds"); ceiling of 32 connections. `GET /healthz` responds without a token.
- Room state is in memory. A server crash aborts the match (deliberately).

Client screens: `web/src/screens/Join.svelte`, `Lobby.svelte`, `Round.svelte`, `RoundResults.svelte`, `Final.svelte`. Components: `PanoView.svelte`, `GuessMap.svelte`, `ResultsMap.svelte`, `Leaderboard.svelte`, `PlayerList.svelte`, `BotCard.svelte`, `BotSlotEditor.svelte`, `TimerRing.svelte`.

## 8. Animation and speed

- Transitions between screens, score counters, table reordering: Svelte built-ins (`transition`, `animate:flip`, `Tween`).
- Results map: `flyTo`, markers appearing one by one, arcs drawn over time.
- The timer ring pulses in the last 10 s.
- `prefers-reduced-motion` disables motion, leaving only the state changes.
- The next round is prepared in advance, so there is no network wait between «Дальше» ("Next") and the countdown.
- The Maps JavaScript API is loaded once in the lobby; the panorama object is reused between rounds.
- The interface is in Russian; strings live in one module `web/src/i18n/ru.ts`.

## 9. Commands

- `bun run start`: server + tunnel, prints the host and invitation links.
- `bun run start --no-tunnel`: local only.
- `bun run start --public-url <https://address>`: without `cloudflared`, the invitation link is built from your own address.
- `bun run doctor`: checks the Google keys (a metadata request), the presence and login of each harness (`codex login status`, `claude auth status`, `agy models`), the presence of `cloudflared`. For each problem it prints the cause and the exact fix command.
- `bun run dev`: server and Vite with reload.

Setup: `.env` with `GOOGLE_MAPS_BROWSER_KEY` and `GOOGLE_MAPS_SERVER_KEY`; `.env.example` and a README section "Как получить ключи" ("How to get the keys") in the repository.

## 10. Milestones

### M0. Foundation and spikes (before feature code)

Quality gates (the owner's rule, first milestone):

1. ESLint (`typescript-eslint` strict-type-checked, `eslint-plugin-svelte`) with `--max-warnings 0`, Prettier, `tsc --strict`, `svelte-check`; `shellcheck` for shell scripts.
2. Size limits: source file ≤ 500 lines, test file ≤ 1000, function ≤ 80. Check: `scripts/check-size.ts` (files, with an exception list `size-allowlist.json` that records the current size; an exception may only shrink) and the ESLint rule `max-lines-per-function: 80`.
3. Enforcement in two places: a CI job (`.github/workflows/ci.yml`) and a pre-push hook in the repository (`.githooks/pre-push`, installed with one command `bun run hooks:install`), both run `bun run check`. While the repository has no remote, CI and pre-push do not fire, so `bun run hooks:install` also installs `.githooks/pre-commit` with the same `bun run check`; creating a private remote is part of the owner's decisions before code.
4. The project `CLAUDE.md` with the limits and the check commands.

Owner decisions before code (section 14): the map for answering, AI on Google imagery, a private remote for CI.

The spikes go right after the quality gates, S1 first (each leaves a short report in `docs/spikes/` and a decision):

- S1. For `codex`, `claude`, `agy`: does the model see an image from an MCP tool result; if not, does the `file` mode work; cold start time and the time of one turn; how to pass an MCP config for a single run without changing global settings; which flags close off the harness's reading of files outside the temporary directory, web search and command execution; how to disable the harness's user settings (global instructions, hooks, plugins, memory). Then, on throwaway code: one full bot round (starting images, moves, guess with explanation) and three bots simultaneously; composition and criterion in section 14.
- S2. WebSocket through a `cloudflared` quick tunnel: the connection itself is already verified (section 3); what remains is a ping every 20 s, holding the connection for 15 minutes and recovery after a drop.
- S3. Google keys: both APIs enabled; the share of successful hits of the metadata selection by region; the exact error texts for `doctor`; reconciling the free monthly volume and the billing unit of panoramas and maps with the current price table; which daily quotas to set in Cloud Console.
- S4. One hour to survey open-source clones with a license check: is there a ready base for the M1 screens. The decision is recorded; the default is our own build.

### M1. First game (end-to-end slice)

Everything needed for one game evening: protocol and schemas, state machine, token login, lobby (rounds, duration, AI slots on one harness that passed S1), a round with a real panorama and map, `bot-tools` (MCP), `BotImageService`, `BotRunner`, one adapter, move limit, deadline, the Static quota counter and ceiling with a pre-match check, scoring, results with an AI card and explanation, final, reconnection, launching `cloudflared` from `start` with a link readiness check, a basic `doctor`, recording the match to `matches.jsonl`, simple transitions between screens, a README with launch steps. Region: world only.

The "First game" gate closes the milestone: a match with friends and the measurements from section 14. Based on its results, the owner confirms or changes the contents of M2–M4.

### M2. All harnesses and AI configuration

Adapters for the remaining harnesses that passed S1, the model list, the vision check in the lobby, bot difficulty, personality and quip, the "Humans versus AI" score, region presets.

### M3. Protection and own address

Failed-login thresholds, panorama accounting in the quota counter, the full `doctor`, the `--public-url` flag.

### M4. Polish

Animations of results and final, loading and error states on every screen, the full README.

## 11. Tests

- Unit: the scoring formula, the state machine (all transitions and forbidden transitions), protocol schemas, location selection with a mocked metadata, accounting of bot moves and deadline, the quota counter.
- Integration: a full match scenario over a real WebSocket with several clients, a fake panorama provider and a fake harness (an executable script speaking MCP).
- E2E (Playwright): two browsers play a two-round match with a panorama stub; a reconnection check.
- Contract tests of harnesses on real CLIs: a separate command `bun run test:harness`, on demand, not in CI.
- Tunnel check: `bun run test:tunnel`, on demand.

## 12. Risks

| Risk | What we do |
|---|---|
| Images from MCP do not reach the model in some harness | Spike S1 before code; fallback `file` mode |
| A harness answers too slowly for a round | A preliminary guess after the first look; measurement in «Проверить» ("Check"); a lobby warning if the time from «Проверить» is more than half of the bot's time budget |
| Google terms: showing Street View next to a non-Google map, passing images to third-party models | Verified against the text (section 3): the original design conflicts with clauses 3.2.3(a), 3.2.3(c)(vii) and 3.2.3(e). The owner decides before code starts (section 14, "Owner decisions before code"); a map option without the conflict: Google Maps JS (the key is needed anyway) |
| Usage beyond the free volume | A counter and a hard ceiling; advice to set quotas in Cloud Console |
| Harness subscription limits with 3 bots in a row | Move limit, low default effort; the limit error is shown in the bot card; the last recorded guess counts, without one 0 |
| The quick tunnel is unstable or WebSocket does not pass | Spike S2; the client reconnects by itself; the link is printed again when the URL changes |
| A player peeks at the coordinates via developer tools | Accepted: a game for friends |

## 13. Out of scope for the first version

- Accounts, ratings across matches, a match history screen.
- Multiple rooms on one server.
- Custom location lists and a map editor.
- Duel and "battle royale" modes.
- A mobile layout as a separate goal.
- Voice and chat.

## 14. Additions accepted during review

The items below are mandatory. Where they diverge from the text of sections 3–12, the text of this section governs. Each item names the milestone and the sections it refines.

- **Owner decisions at the final approval (2026-11-13).** They apply on top of all the items below.
  - Map for answering (UC-1): Google Maps JavaScript API for the mini-map and the results map, the same browser key. MapLibre and OpenFreeMap from section 6 are not used. Hence the item "Map fake for `--fake` mode" applies (task T51 is mandatory), and the map uses the standard light Google scheme from the item "Visual language and `DESIGN.md`".
  - AI on Google imagery (UC-2): the owner's design is kept, with the measures from the item "Owner decisions before code" (images are not written to disk outside `file` mode; the README asks to turn off training on data in the harness accounts). The owner accepts the risk of Google disabling the key or project.
  - The taste questions of the design, DX and engineering phases (D-1…D-6, X-1, X-2, E-1…E-3) and the interpretation of a move (C-MOVE) are accepted in the recommended variants as recorded below.
  - The owner action C-REMOTE remains open: create a private remote for CI; until then the checks are run by `pre-commit`.
- **Google map loads.** Milestones M1 (reuse and quota in Cloud Console) and M3 (counter); follows from decision UC-1; refines the items "Quota accounting" and "Google keys: step-by-step instructions and check".
  - Google charges for every creation of a map object (Dynamic Maps: 10,000 free loads per month, then $7 per 1,000 per the price list of 2026-11-13; reconciled by spike S3). Therefore the mini-map and the results map are created once per page load and reused between rounds: a change of round changes markers, center and zoom, rather than recreating the map. The panorama object is reused likewise (section 8).
  - The client sends the server `map_loaded` on every creation of a map object, like `pano_loaded` for a panorama; the counter in `quota.json` grows on every such message, the application ceiling is 80% of the free volume.
  - The pre-match check adds to the worst case maps = rounds × number of humans × 2 (the same reload assumptions as for panoramas). For a match of 5 rounds and 3 humans that is 30 loads out of 10,000.
  - The README "Как получить ключи" and `doctor` name the daily quota for the Maps JavaScript API too, not only for the Street View Static API; values from the S3 report.
  - Tests: E2E that over a two-round match each client sends exactly two `map_loaded` (mini-map and results map); unit tests on the worst case with maps and on the counter growth from `map_loaded`.

<!-- autoplan-accepted:ceo -->
- **Owner decisions before code.** Milestone M0; refines sections 6, 10 and 12.
  - Map for answering. Clause 3.2.3(e) of the Google terms forbids Street View and a non-Google map on the same screen. Options: Google Maps JS for the mini-map and the results map (no conflict, the same browser key, the map usage is reconciled by spike S3) or MapLibre GL JS with OpenFreeMap, as in section 6 (the conflict remains, the owner accepts the risk). Until the owner decides, the plan uses their original variant.
  - AI on Google imagery. Clauses 3.2.3(a) and 3.2.3(c)(vii) forbid taking imagery outside Google services and using it to improve AI models. Options: keep the owner's design with the measures below (risk: Google may disable the key or project); give the bots imagery from another source near the same point; play without AI. Until the owner decides, the plan uses their original design.
  - Measures if the design is kept: images are not written to disk outside `file` mode; the README asks the owner to turn off, in the harness accounts, the use of their data for model training, where such a setting exists.
  - A private remote for CI: create one or work with `pre-commit`.
  - `GuessMap` and `ResultsMap` are written right away for the chosen map, without a substitution layer. The map and bot tasks in M1 wait for the first two decisions; if AI is dropped, milestone M1 is built without bots, and the "First game" gate is held without them.
  - The interpretation of a move is fixed in section 5.1 and needs no separate decision.
- **Spike S1: a full bot round before feature code.** Milestone M0; refines sections 5 and 10.
  - S1 goes first after the quality gates and is written as throwaway code in `spikes/` (not part of the build, deleted after M1; the quality gates and size limits apply to it too).
  - Composition: a vision check on an image with a number; one full bot round via MCP (four starting images with captions, `look`, `move`, `submit_guess` with an explanation); three bots simultaneously on one subscription; five rounds in a row.
  - Images: until the Google keys are ready (spike S3), our own street photographs are used; after the Street View Static API is enabled, the round is repeated on real imagery.
  - A harness is admitted to the game if all of the following hold: the model correctly names the number from the image in at least one delivery mode (`mcp` or `file`); the MCP config is passed for a single run without changing global settings; cold start plus the first guess fit within 60 s (640 px image, low effort); with three bots simultaneously, a guess is recorded in at least 4 of 5 rounds for each.
  - A harness that fails the criterion is hidden from selection in the first version, `doctor` names the reason, no adapter is written for it.
  - A saved slot with an unavailable harness (hidden by S1, not installed or not logged in to the subscription) is loaded disabled with a visible reason and does not take part in the match until the host picks another harness. Test: a unit test on loading such a slot.
  - If no harness passes the criterion, work on bots stops until the owner decides.
- **"First game" gate.** Milestone M1; refines section 10.
  - After M1 the owner plays a match with friends: 5 rounds of 120 s, three bots simultaneously on a harness that passed S1 (two with a 4-move limit, the third with 0, to see whether moves help).
  - The server writes to `matches.jsonl` for each bot and round: whether a guess existed before the cutoff, time to the first and to the last guess, number of moves, points, the reason for finishing; for each round: how many seconds the humans waited for the bots after their last answer.
  - The "playable" criterion: each bot has a guess recorded in at least 4 of 5 rounds; the average human wait after the last answer is no more than 30 s. If the criterion is not met, the defaults are adjusted (round duration, move limit, effort, wait window) and the match is repeated.
  - The owner writes into `docs/playtest-1.md` the answers to three questions: do they want to play more; what was the most interesting (the score, the AI's mistakes, the explanations); how many rounds were boring because of the location.
  - Based on these data the owner confirms or changes the contents of M2–M4. If there are more than 2 of 5 boring locations, M2 gets a task "vetted location list" (currently deferred in `TODOS.md`).
- **Equal movement rules.** Milestone M1; refines sections 4.2 and 5.1.
  - The "Movement in the panorama" setting is shared: if it is off, `move` returns to the bot «движение выключено в этой партии» ("movement is off in this match") without charging a move, and the bot prompt warns about this.
  - Test: a unit test on `move` with movement off.
- **Bot time and round duration.** Milestone M1; refines sections 4.2 and 4.3.
  - If the match has at least one AI, the minimum round duration is 60 s: when the first bot is added, a shorter round is raised to 60 s with a visible message, and the duration field does not allow setting less while a bot is in the match.
  - The harness process is launched in `ROUND_LOADING`, during the countdown, so that the cold start does not eat round time. The server delays the first `observe()` response until the start of `ROUND_ACTIVE`: the bot does not see the images earlier than the humans.
  - The bot time budget in M1 equals the round duration; a separate field appears in M2. The budget clock runs from the start of `ROUND_ACTIVE`.
  - The bot is cut off at the earliest of three moments: the end of the round timer; the end of its time budget; the end of the wait window after all humans have answered. In all three cases its last recorded guess counts.
  - Wait window: if all humans have answered and the bots are still working, the round lasts another 20 s (the lobby field «Ожидание ИИ после ответов людей» ("AI wait after humans' answers"), 0–120 s, default 20, stored in `settings.json`), but not less than until the 60th second of the round and not longer than the round timer. During this time the humans are shown «ИИ думают» ("The AIs are thinking") with a countdown.
  - The round ends early when all humans have confirmed their answer with the «Угадать» button and all bot processes have finished. A marker without confirmation does not trigger an early end, but counts as an answer by the end of the timer.
  - Tests: unit tests on the state machine (humans answered early, bot finished early, bot did not finish, 60 s round, adding a bot with a 30 s round, a marker without confirmation at the end of the timer, `observe()` before the start of `ROUND_ACTIVE`).
- **AI slot in M1 and bot difficulty in M2.** Milestones M1 and M2; refines sections 4.2 and 5.2.
  - In M1 a slot has a name, color, model, effort and move limit (default 4). Image 640 px, time budget equal to the round duration. Settings are shown as numbers, without level names.
  - M2 adds image size (640, 400 or 256 pixels per side), the bot's time budget per round (from 60 s to the round duration; by default equal to it; if the host makes the round shorter than the budget, the round duration applies) and three presets that fill in image size, move limit and effort at once.
  - Preliminary preset numbers: «Новичок» ("Beginner") (256 px, 2 moves, effort low), «Любитель» ("Amateur") (400 px, 4 moves, effort low), «Мастер» ("Master") (640 px, 6 moves, effort medium). Before implementation they are reconciled with the first-game data: a preset gets a level name only if its result in the recorded matches differs from its neighbor's.
  - After a manual edit of image size, move limit or effort, the preset label changes to «Свои настройки» ("Custom settings"); name, color, personality and time budget do not change the label. The effort levels "low / medium / high" are translated by each adapter into the values of its harness.
  - The image is always requested from Google at 640x640; a smaller size is obtained by downscaling on the server (`sharp`), the compass caption is imprinted after downscaling with a font no smaller than 14 px. Quota usage does not depend on size.
  - The lobby shows a warning at the slot if the time from «Проверить» (cold start plus an answer on the slot's current settings) is more than half of the bot's time budget.
  - Tests: unit tests on applying a preset and the «Свои настройки» label, on downscaling the image to the slot size, on a cutoff by time budget.
- **"Humans versus AI" score.** Milestone M2; refines sections 4.5 and 4.6.
  - Shown on the round results screen and in the final if the match has at least one human and at least one AI; otherwise the row is hidden.
  - A side's value for a round: the arithmetic mean of the points of the side's participants who played that round. Spectators and those who joined mid-round are not counted. A human who played but did not answer and a bot with no recorded guess are counted with 0 points.
  - A side's value for the match: the sum of its values over rounds.
  - Computed by a pure function in `shared/`. Tests: different numbers of participants, zero points, late join, a bot without a guess, absence of one side.
- **Bot personality and quip.** Milestone M2; refines sections 4.2, 4.5 and 5.1.
  - An AI slot has a "personality" field: a preset (neutral, braggart, modest, scholar) or the host's own text up to 200 characters without line breaks. It is inserted as one marked line into the prompt and affects only the tone of the explanation and quip; the limits and the tool set are set by the server, and the personality text cannot change them.
  - `submit_guess` gets an optional field `quip` (up to 120 characters, interface language). The last successful `submit_guess` call counts as a whole: coordinates, explanation and quip; if it has no quip, no quip is shown. In M1 the `quip` field is already in the schema but is not shown.
  - The quip is shown next to the bot's marker on the results screen and in the AI card, is rendered as plain text, does not affect points and is visible only after the round ends.
  - Tests: a too-long quip is truncated to the limit, a personality with a line break is rejected by the schema; of two calls the last is taken; an integration scenario with a fake harness shows the quip only on the results screen.
- **Entry and readiness of the invitation link.** Milestone M1; refines sections 4.1, 7 and 9.
  - The game server listens only on `127.0.0.1` in all modes. The token contains 128 bits of randomness and is compared in constant time.
  - The server serves `GET /healthz`: no token, the response is `ok`, no game data.
  - The invitation link is printed after two checks: the host name resolves through public DNS (a DoH request to `cloudflare-dns.com`, on error to `dns.google`; the local resolver is not used) and `GET /healthz` at the public address returns 200. Waiting up to 60 s, then an error with the cause (DNS or HTTP) and advice to restart `start`.
  - When the tunnel address changes, the checks are repeated and the link is printed again. With `--no-tunnel` there are no checks.
  - The host link is always local: `http://localhost:PORT/#t=<host token>`.
  - Tests: unit tests with mocked DNS and HTTP (success, delay, refusal, address change); `bun run test:tunnel` checks it live.
- **Own public address and login thresholds.** Milestone M3; refines sections 6, 7 and 9.
  - `bun run start --public-url <https://address>` does not launch `cloudflared`, but builds the invitation link from the given address and performs the same readiness checks for it. The custom tunnel or proxy must run on the same machine. The flags `--public-url` and `--no-tunnel` together give a startup error with an explanation.
  - The README and `bun run doctor --public-url <https://address>` remind to add this address to the browser key's referrer restriction; `doctor` prints the exact string for Cloud Console.
  - Client address: in quick tunnel mode it is taken from `CF-Connecting-IP`; in other modes and when the header is absent, from the socket address. The server does not trust headers from someone else's proxy. A connection from a loopback address without the header is considered local and does not take part in the per-address threshold; therefore with `--public-url` only the global threshold applies.
  - The token is checked on every connection, a login with a correct token is not blocked by any threshold. Thresholds concern only failed attempts.
  - More than 10 failed logins from one address in 60 s: for the next 60 s failed attempts from that address are closed without a response and without a log entry.
  - More than 30 failed logins in 60 s for the whole server: until the end of the minute all failed attempts are closed the same way.
  - Tests: unit tests on flag parsing, link building, client address selection (header present, header absent, loopback), both thresholds and a login with a correct token when thresholds are reached.
- **Static API errors.** Milestone M1; refines sections 5.1, 5.2 and 6.
  - All image requests go with `return_error_code=true`: when there is no imagery, Google answers HTTP 404 rather than a gray placeholder.
  - The unit for counting failures is a tool call. `look` fails if its image was not obtained. `move` fails if none of the four images was obtained; if at least one was obtained, the call succeeds, and in place of the missing ones the bot gets the text «снимка в этом направлении нет» ("there is no image in this direction").
  - The first 3 failed bot calls per round do not charge a move; starting with the fourth, a failed call costs a move. The `move` answer «в эту сторону дороги нет» is still free and not included in this count: it requests no images.
  - Tests: unit tests with a mocked 404 response (move not charged, fourth failure charged, partially successful `move`).
- **Round preparation failures.** Milestone M1; refines sections 4.3, 5.1 and 6.
  - Location: if 30 attempts did not find a panorama, the server repeats the series for another country, up to 3 series in total. After the third failure the round does not start: the host sees the error «панорама не найдена» ("panorama not found") and the buttons «Повторить» ("Retry") and «Завершить партию» ("End match"); the rounds already played are kept.
  - Starting images: if at least one of the four was not obtained, the server takes a new location, up to 3 locations in total; after that the same rule applies as for the location. Failed requests count toward the quota counter.
  - Preparation goes in advance while the lobby or results screen is open, so retries are invisible to players.
  - Panorama loading for a human: after 5 s of waiting the countdown starts for everyone; the latecomer has the same shared timer. If the panorama did not load on the client, they see a message and a «Повторить» button, the answer map remains available.
  - `observe()` returns the saved starting set and makes no Static API requests.
  - Tests: unit tests on three selection series and on replacing the location after a failed starting image; an integration test on the countdown start without a latecomer client.
- **Quota accounting.** Milestone M1 (Static counter, ceiling, pre-match check) and M3 (panoramas); refines section 6.
  - The application ceiling is an estimate of usage, not a billing guarantee. The real limit is set by the daily quotas in Cloud Console: the README and `doctor` give steps on which quotas to set, per the S3 spike report. The referrer restriction `*.trycloudflare.com/*` protects the browser key only weakly (the domain is shared), the README says so plainly.
  - Static: the counter in `quota.json`, the ceiling and the pre-match check appear in M1, before the first real Static API request. The counter grows on every request, including a failed one and round preparation requests, and is incremented before the request is sent, so parallel calls do not get past the ceiling. A repeated image request with the same parameters within a round is served from memory and does not count.
  - Panoramas (M3): the client sends the server `pano_loaded` after every panorama display (each round, page reload, reconnection, spectator); the counter grows on every such message. This is an upper estimate: Google may bill only the creation of a panorama object; the billing unit is reconciled by spike S3.
  - Before a match starts, the server computes the worst case: Static = rounds × (12 + sum over bots of (move limit + 3) × 4), where 12 is up to three sets of starting images; panoramas = rounds × number of humans × 2. If current usage plus the worst case exceeds the ceiling, the match does not start; the lobby shows usage, worst case and remainder, and the host reduces the number of rounds, bots or moves.
  - If the Static ceiling is nevertheless reached mid-match, `look` and `move` return to the bot «квота исчерпана, вызови submit_guess» ("quota exhausted, call submit_guess") without charging a move, and the match is played to the end. If the panorama ceiling is reached, the current match is played to the end and a new one does not start.
  - Tests: unit tests on the worst-case computation, start refusal, the "quota exhausted" response, counter growth from `pano_loaded`.
- **Bot process isolation.** Milestones M0 (spike S1) and M1; refines sections 5.3 and 5.4.
  - The harness process is launched with an environment from an allowlist (`PATH`, `HOME`, `LANG`, `TERM` and the variables without which the harness does not log in to the subscription). The Google keys and the contents of `.env` do not get into it. The bot's working directory: an empty temporary directory outside the repository.
  - The harness runs as the owner and reads its login files from `HOME`, so reading other files is closed off by the harness's own flags: for `claude` these are `--allowedTools "mcp__geo__*"` and `--strict-mcp-config`; for `codex` and `agy` the flag set is determined by spike S1 (`agy` has only `--sandbox` in its help).
  - For each harness, spike S1 checks with the chosen flags: the model cannot name the contents of a test file outside the temporary directory; web search and command execution are unavailable. The result is recorded in the report.
  - The harness's user settings from `HOME` (global instructions, hooks, plugins, memory) are turned off by the adapter with flags, if the harness has them. Spike S1 records what could be turned off and how what remains affects response time and the tool set.
  - A harness that could not be restricted is not hidden automatically: the decision on its admission is made by the owner based on the S1 report, `doctor` shows a note on it «читает файлы владельца» ("reads the owner's files").
  - The residual risk is accepted for a game among friends: the bot process runs as the owner and, if the flags were bypassed, could read the server's environment and memory. Subscription limits are shared with the owner's daily work; a match with three bots consumes them.
  - Tests: a unit test on the composition of the bot process environment; the test-file check is part of `bun run test:harness`.
- **Milestone order.** Milestones M0–M4; refines section 10.
  - M0: quality gates, then spike S1, then S2, S3 and S4. The M1 tasks without a real panorama and without bots (protocol, state machine, lobby, scoring, results) go on stubs right after the quality gates. Tasks with bots wait for S1, the task "real panorama in a round" waits for S3 (both APIs enabled, billing connected).
  - Spike S3 reconciles the free monthly volume with Google's current price table; the default ceiling of the quota counter is computed from the figures in the S3 report.
  - M2–M4 start after the "First game" gate; the owner confirms their contents based on its results.
  - The error states named in this section belong to the milestone where their rule is named; milestone M4 refines their look rather than adding them.
- **Image storage.** Milestone M1; refines sections 4.5 and 5.4.
  - The bot's full-size images live only until the end of the round. For the AI card the server keeps thumbnails in memory (JPEG, 160 px per side, up to 15 KB) until the return to the lobby after the final.
  - Upper memory bound: a typical match (5 rounds, 3 bots, 6 moves) at most 600 thumbnails, about 9 MB; the extreme one (20 rounds, 3 bots, 20 moves) at most 5,760 thumbnails, about 86 MB.
  - Images reach disk only in the `file` delivery mode, in the bot's temporary directory, which is deleted at the end of the round.
  - Test: an integration test, after the end of the match the thumbnails are unavailable and the temporary directory is deleted.
- **Failures during a match.** Milestones M1 and M3; refines sections 4.1, 5.1, 6 and 9.
  - Metadata: a "no panorama" response consumes a selection attempt. A key denial, quota exceeded and a network error (request timeout 5 s, one retry) stop round preparation immediately: the host sees the cause and the buttons «Повторить» and «Завершить партию».
  - Static: responses 403 and 429 are handled as a reached quota ceiling: `look` and `move` return to the bot «картинки недоступны, вызови submit_guess» ("images are unavailable, call submit_guess") without charging a move, and the host sees a warning with the cause.
  - Tool arguments are checked by the schema. On error the bot gets a text with the field name and the allowed values, the move is not charged, the previous guess remains. Too-long `explanation` and `quip` are truncated to the limit rather than rejected; an empty `explanation` is rejected.
  - If the bot recorded no guess at all, the AI card shows the reason for finishing and the last 300 characters of the harness's final text as plain text (model refusal, login error, subscription limit).
  - Tunnel: `start` watches the `cloudflared` process. If the process exited, `start` restarts it up to 3 times with pauses of 2, 5 and 10 s, repeats the readiness checks and prints the new link. The match on the server continues meanwhile; after the third failure the host sees an error with the cause.
  - Returning to a seat: a new tunnel address is a different site for the browser, and the saved `playerId` and secret are not there. Therefore participant nicknames are unique case-insensitively, and a player who joined via a valid invitation with the nickname of a disconnected participant takes their seat. The nickname of a connected participant cannot be taken: the login gets the response «ник занят» ("nickname taken").
  - Local files: `settings.json`, `quota.json` and the `matches.jsonl` lines carry a `version` field and are validated by a schema. An unreadable `settings.json` or `quota.json` is renamed to a file ending in `.bad`, the server starts with defaults (the quota counter from zero) and shows a warning in the terminal and in the host's lobby. A write error of `matches.jsonl` does not abort the match and is visible to the host on the final screen.
  - A Maps JavaScript API load error on the client (blocker, referrer restriction) goes to the server in a `client_error` message; the host sees a note with the cause at the player.
  - Harness update (M3, full `doctor`): `bun run test:harness` records the CLI versions it passed with into `~/.config/geoaissr/harness-verified.json`; `doctor` warns if the installed version differs and advises running `bun run test:harness`.
  - Tests: unit tests on a metadata key denial, a 403 from Static, wrong tool arguments, explanation truncation, login with the nickname of a disconnected and of a connected participant, unreadable settings and quota files; an integration test on restarting a fake tunnel process.
- **Event order and edge cases.** Milestone M1; refines sections 4.1, 4.3, 5.1 and 7.
  - Neither a guess nor a tool call changes the round outcome after its end. Each handler checks the round number and phase immediately before changing state, after all the waits (reading the request body, Google's response). A late call gets «раунд окончен» ("round over"), its result is discarded and does not get into the next round.
  - A move is reserved before the request to Google and returned if the call is deemed failed under the rules of the item "Static API errors". Therefore parallel calls of one bot do not spend more than the limit.
  - Human marker: the client sends the server the marker position at every placement, no more than 5 times per second; the server keeps the last one. That is the one that counts if the answer is not confirmed by the end of the timer. A repeated press of «Угадать» and a change of the marker after confirmation are ignored by the server.
  - The longitude of a marker and of a bot guess is normalized to the range from -180 to 180; a latitude outside the range from -90 to 90 is rejected.
  - The host's «Дальше» message carries the round number: a repeated press and a press simultaneous with the automatic advance do not skip a round.
  - Match settings change only in the lobby. A ninth human gets the response «комната полна» ("room full").
  - If by the end of the results screen no human is connected, the next round does not start until someone returns: the bots do not waste quota and subscription.
  - `GameEngine` and `LocationService` receive the clock and the random number generator as parameters; tests substitute controllable ones.
  - Tests: unit tests with controllable stop points for both completion orders (bot guess and timer end; Google response and round end; two parallel `look` calls with one move left); a marker without confirmation; a repeated «Дальше»; a pause with no humans. Integration scenarios of the fake harness: normal, hung, finished before a guess, finished after a guess, with wrong arguments, with parallel calls.
- **Secrets and tokens.** Milestones M0 and M1; refines sections 4.1, 6 and 9.
  - `.env` is added to `.gitignore`; `bun run check` fails if `.env` is tracked by git.
  - The host and invitation tokens are created anew at each `start`. A leaked invitation is revoked by restarting; excluding players by the host does not exist in the first version.
  - Keys and tokens do not get into the log or into error messages; where one token must be told from another, the first 4 characters are shown.
  - Tests: a unit test on token masking in the log; the check that `.env` is not tracked is part of `bun run check`.
- **Server and bot log.** Milestone M1; refines sections 5.3 and 9.
  - The server writes events as JSON lines to `~/.local/share/geoaissr/logs/<date>.jsonl`: round start and end, participants joining and leaving, launch and finish of each harness (exit code, reason, last stderr lines), each bot tool call (name, duration, outcome), the outcome of requests to Google, the quota counter value.
  - Answer coordinates get into the log only after the round ends. Files for the last 14 days are kept.
  - In the host's terminal one line is printed per round: who answered, which bots were cut off and why.
  - Test: an integration test, after a match with a fake harness the log contains the launch, the calls and the reason for finishing of each bot, and no tokens or keys.
<!-- /autoplan-accepted:ceo -->

The items below were added by the design review (phase 2) and are likewise mandatory.

- **Visual language and `DESIGN.md`.** Milestones M0 (the file) and M1 (application); refines sections 7 and 8.
  - Image: asphalt and road markings. The panorama and the map take the whole screen, the interface lies over them in dense dark panels. Usage scene: an evening, friends in a voice chat, each at their own monitor; the bright daytime panorama remains the main thing, the panels do not dazzle.
  - Text never lies directly on the panorama or the map: only on a solid opaque panel with a `1px solid var(--line)` line, so the panel reads even without a shadow. No glass effects, glows, gradients or decorative icons.
  - Fonts (both with Cyrillic, OFL license, kept in the repository via the packages `@fontsource-variable/unbounded` and `@fontsource-variable/onest`, no requests to foreign servers): Unbounded for the game title, the timer, scores and screen headings; Onest for everything else. Numbers are tabular everywhere (`font-variant-numeric: tabular-nums`). Sizes: 14 (captions only), 16 (main), 20, 28, 40, 64 px.
  - Colors are set by CSS variables in `web/src/styles/tokens.css`: panel `--asphalt-800: #1B1E23`, screen background `--asphalt-900: #14171B`, hover `--asphalt-700: #2A2E35`, lines `--line: #3A3F47`, text `--paper: #F4F1EA`, secondary text `--paper-dim: #B9B4A8`, accent `--paint: #FFD23F` (dark text `#14171B` on top), error and the last 10 s of the timer `--signal: #FF6369`, "answered" `--ok: #3DBB7A`. There is one accent, reserved for the screen's main action and the timer ring.
  - Spacing 4, 8, 12, 16, 24, 32, 48 px. Corner radii: 4 px for fields and buttons, 8 px for panels. Panel shadow with an offset: `0 2px 0 rgba(0,0,0,.35), 0 8px 24px rgba(0,0,0,.35)`.
  - Motion: 120 ms (press, hover), 240 ms (panel expansion), 400 ms (row reordering), 800 ms (map fly-over); curve `cubic-bezier(0.16, 1, 0.3, 1)`, no bounces. There is one signature moment: showing the round results.
  - Browser surfaces are styled from the same palette: a 2 px focus ring of `--paint` with a 2 px offset on every interactive element, text selection, caret, a thin scrollbar.
  - The map is light, there is no dark scheme: for MapLibre the OpenFreeMap style `positron`, for Google Maps the standard light scheme with venue icons hidden. Labels are Russian where they exist in the data: for Google Maps the parameter `language=ru`, for MapLibre the label field `name:ru` with fallback `name`.
  - Icons: one set `@lucide/svelte`, only where an icon carries meaning (answered, copy, warning, connection, AI chip). No emoji in the interface.
  - Texts: the language of actions and states («Угадать», «Ответ принят» ("Answer accepted"), «ИИ думают 0:14»), without greetings or slogans. All strings in `web/src/i18n/ru.ts`. Helpers live there too: Russian numeral declension via `Intl.PluralRules('ru')` («1 раунд, 2 раунда, 5 раундов»), numbers via `Intl.NumberFormat('ru-RU')` («4 872 очка»), distance below 1 km in meters («840 м»), beyond that in whole kilometers («12 345 км»). A long nickname is truncated with an ellipsis, the full one is visible in a tooltip.
  - Shared state components: `StatusBanner.svelte` (connection, warnings to the host) and `InlineState.svelte` (loading, empty, error with an action button inside the area). The M1 screens take their states from them, so milestone M4 changes the look, not the screens' code.
  - In milestone M0 these decisions are recorded in `DESIGN.md` at the repository root; the project `CLAUDE.md` links to it. A component that lacks a variable adds it to `tokens.css` and `DESIGN.md` rather than writing a color or size in place.
  - There are no mockups: the gstack designer on the owner's machine has no image generation key. The layouts below are given as diagrams; the owner may, after setting up a key, run `/design-shotgun` and correct `DESIGN.md` before the M1 screens begin.
  - Tests: `bun run check` fails if a color in the form `#rrggbb` or `rgb(` occurs in `web/src/**/*.svelte` (colors live only in `tokens.css`); a unit test computes the contrast of "text on background" pairs from `tokens.css` (not below 4.5:1, for numbers from 28 px not below 3:1).
- **Participants: color, shape, name.** Milestone M1; refines sections 4.1, 4.2 and 4.5.
  - Color is not the only marker of a participant. A human has a round avatar with the first letter of the nickname, an AI has a square one with a 6 px corner radius and a chip icon next to the letter. The marker on the map repeats the avatar's shape and letter; on hover, and on the results map, the nickname is visible next to the selected marker.
  - A participant palette of 12 colors in `tokens.css` (`--p-1` … `--p-12`): `#E8590C`, `#D6336C`, `#AE3EC9`, `#7048E8`, `#1C7ED6`, `#1098AD`, `#0CA678`, `#74B816`, `#8D5524`, `#868E96`, `#F06595`, `#22B8CF`. There is no yellow accent in it. The letter on the avatar is dark or light: whichever gives a contrast of at least 4.5:1 is taken.
  - A color taken by one participant is unavailable to another: on the login screen and in the AI slot, taken swatches are inactive, the first free one is preselected. The color swatches are labeled radio buttons («оранжевый» ("orange"), «синий» ("blue")), the selected one is marked with a check mark, not only by color.
  - Markers on the map and avatars over the panorama have a light 2 px outline and a dark offset shadow, so they read on any background.
  - An AI's default name is the model name; the host can change it. For screen readers an AI has a label like «Клод, ИИ» ("Claude, AI").
  - Tests: unit tests on handing out the first free color, refusing a taken one and the letter's contrast on each of the 12 colors.
- **Screen hierarchy.** Milestone M1; refines sections 4 and 7.
  - Transitions: login → lobby → (countdown → round → results) × number of rounds → final → lobby. On every screen after login, in the top right corner there is a connection indicator and, for the host, a menu.
  - Login. A single centered column. At the top the title `geoaissr` in Unbounded and a context line («В лобби: Миша, Оля и 2 ИИ» ("In the lobby: Misha, Olya and 2 AIs")). First: the field «Ваше имя» ("Your name") with a visible label and focus on open. Second: the color picker. Third: the «Войти» ("Join") button (Enter key); if a match is in progress, the button is labeled «Смотреть раунд» ("Watch the round"). If there are disconnected participants, under the field a line «Отключились: Оля. Введите тот же ник, чтобы вернуться на своё место» ("Disconnected: Olya. Enter the same nickname to return to your seat"). The error is shown next to its own field, the entered values are kept.
  - Lobby. First: who is in the room (humans on the left, AI slots under them). Second: match settings (on the right; the host changes them, guests see the same rows as values without input fields). Third: «Начать» ("Start") for the host, for guests the line «Начать может только хост. Ждём: Миша» ("Only the host can start. Waiting for: Misha"). This is two columns of rows, not a set of cards:

    ```
    +---------------------------------------------------------------+
    | geoaissr                 [Скопировать приглашение] [связь][≡] |
    +-------------------------------+-------------------------------+
    | ИГРОКИ 3 из 8                 | ПАРТИЯ                        |
    | (М) Миша, хост                | Раунды          [ 5 ]         |
    | (О) Оля                       | Время раунда    [ 120 с ]     |
    | (Д) Дима                      | Движение        [ вкл ]       |
    | ИИ-СОПЕРНИКИ 2 из 3           | Ожидание ИИ     [ 20 с ]      |
    | [К] Клод    claude, 4 хода    |   но не раньше 60-й секунды   |
    | [C] Кодекс  codex, 4 хода     | Картинок: 1 240 из 8 000,     |
    | + Добавить ИИ                 | партия возьмёт до 480         |
    |                               |                  [  Начать  ] |
    +-------------------------------+-------------------------------+
    ```
  - «Начать» is available when at least one human is connected, the first location is ready and the quota suffices. The reasons why starting is impossible are listed as lines next to the button, each says what to change. A disabled AI slot and a player with a Maps JavaScript API error do not block the start: the slot does not play, the player has a note.
  - An AI slot is edited in place: the row expands into a form (name, color, model, effort, move limit), there is no modal window, one slot is expanded at a time. The M2 fields (image size, time budget, personality) lie in the same form under the «Дополнительно» ("Advanced") disclosure. A limit of 0 is labeled «Только стартовые снимки» ("Starting images only"); the hint on the field: «Ход это дополнительный взгляд или шаг сверх четырёх стартовых снимков» ("A move is an extra look or step beyond the four starting images"). A value that changed by itself (the round raised to 60 s, the bot budget cut by the round duration) is explained by a line at its own field.
  - The «Проверить» result (M2) relates to the settings on which it was obtained: after a change of model, effort or image size, the mark «Зрение проверено, 12 с» ("Vision checked, 12 s") changes to «Не проверено на этих настройках» ("Not checked on these settings").
  - Round. First: the panorama full screen. Second: the timer at the top center on a solid plate. Third: the mini-map and the «Угадать» button at the bottom right, one action zone. The participant list on the left as a narrow column, the compass at the bottom left:

    ```
    +---------------------------------------------------------------+
    | раунд 2 из 5              ( 1:12 )                [связь][≡]  |
    | (М) Миша    ответил                                           |
    | (О) Оля                                                       |
    | (Д) Дима    ответил         ПАНОРАМА                          |
    | [К] Клод    ход 3 из 4      (весь экран)                      |
    | [C] Кодекс  ход 1 из 4                                        |
    | [А] Агент   ответил                           +-------------+ |
    |                                               | мини-карта  | |
    | (компас)                                      +-------------+ |
    |                                               [   Угадать   ] |
    | Google                              атрибуция Google на виду  |
    +---------------------------------------------------------------+
    ```
  - The Google logo and attribution line at the bottom of the panorama and the map stay visible: the mini-map and the compass stand above them with a margin.
  - Mini-map: 320 × 220 px at rest; on hover, focus or pressing the `M` key it expands to 45% of the window width and 55% of its height; a pin button fixes it expanded.
  - Countdown: the panorama loads under an opaque shutter of color `--asphalt-900`, in the center large digits 3-2-1, under them the line «Ждём: Дима» ("Waiting for: Dima") while someone's panorama is loading. The shutter is lifted at zero for everyone at once: before the round starts nobody sees the panorama, the bots included.
  - The timer is computed from the round end time sent by the server, corrected for the clock difference, so it is correct after reconnection. In the last 10 s the digits and the ring become `--signal` colored.
  - There is one timer on screen. When the last human has confirmed their answer and the bots are still working, the timer caption changes to «Все ответили. ИИ думают» ("Everyone has answered. The AIs are thinking"), and it shows the time until the true end of the round (taking the wait window and the 60th second into account).
  - A spectator sees the panorama and the participant list; instead of the mini-map a line «Вы зритель. Играете со следующего раунда» ("You are a spectator. You play from the next round"), in the last round «Вы зритель до конца партии» ("You are a spectator until the end of the match").
  - Round results. First: the map full screen with the answer flag and markers, above the table a line with the viewer's own result («Вы: 312 км, 2 140 очков» ("You: 312 km, 2,140 points")). Second: the round table on the right (place, avatar, name, distance, columns «За раунд» ("Round") and «Всего» ("Total")), the viewer's own row is highlighted. Third: «Дальше» for the host with an automatic-advance countdown, for guests the line «Следующий раунд через 0:24» ("Next round in 0:24"). At the bottom left the line «Правильный ответ: <страна>» ("Correct answer: <country>") (the Russian name from the `NAME_RU` field of the Natural Earth data):

    ```
    +---------------------------------------------------------------+
    | раунд 2 из 5      Люди 3 420 : 2 980 ИИ (M2)      [связь][≡]  |
    |                                       Вы: 310 км, 2 140 очков |
    |                                       +---------------------+ |
    |                                       | 1 (О) Оля    12 км  | |
    |    КАРТА: флаг ответа, метки,         | 2 [К] Клод   80 км  | |
    |    дуги                               |   «Вывеска на польск| |
    |                                       |   ом…»  почему? v   | |
    |                                       | 3 (М) Миша  310 км  | |
    | Правильный ответ: Россия              +---------------------+ |
    |                                       [    Дальше 0:24    ]   |
    +---------------------------------------------------------------+
    ```
  - In an AI's row, under the name, the first line of its explanation and the «почему?» ("why?") button are visible. It expands the card under the table row, not a modal window; a click on the AI's marker on the map opens the same card. The order in the card: the full explanation, the quip (M2), a strip of move thumbnails with compass captions, the line «4 хода, 48 с» ("4 moves, 48 s"). Esc closes the card and returns focus to the button.
  - Arcs on the map are thin and semi-transparent; a distance label on the map exists only at the viewer's own marker and at the selected participant, everyone's distances are in the table. A click on a row or a marker highlights the pair on the map and in the table and raises the marker above its neighbors. The arc follows the shortest path, the map bounds are chosen taking the 180th meridian into account.
  - A participant without an answer has no marker; in the table a human shows «нет ответа, 0» ("no answer, 0"), an AI shows «нет догадки» ("no guess") and the reason («оборван по времени» ("cut off by time"), «сбой харнесса» ("harness failure"), «лимит подписки» ("subscription limit")).
  - Final. First: the match outcome: the winner or «Места поделили: Оля и Клод» ("Places shared: Olya and Claude"), a podium of up to three places (as many steps as there are participants). Second: the viewer's own place and the overall list of places. Third: «Ещё раз» for the host, for guests «Ждём хоста» ("Waiting for the host"). The per-round table lies below in its own area with horizontal scrolling and a pinned name column; a round in which the participant did not play is marked with a dash (hyphen), a round without an answer with a zero, there is a column «Сыграно раундов» ("Rounds played").
  - If a human won, confetti in their color goes once for 2 s for everyone (`canvas-confetti`) and does not cover the buttons. If an AI won, there is no confetti; lines «Победил ИИ: Клод» ("AI won: Claude") and «Лучший из людей: Оля» ("Best of the humans: Olya").
  - A match ended early is labeled «Сыграно 3 из 5 раундов» ("Played 3 of 5 rounds"). If no round was played, there is no podium: «Партия завершена до первого результата» ("Match ended before the first result").
  - In milestone M4 a click on an AI's round cell in the final table opens its card for that round (thumbnails are kept until the return to the lobby).
- **Human answer: server confirmations.** Milestone M1; refines section 4.3 and the item "Event order and edge cases".
  - The server confirms every marker position and every press of «Угадать»; the client shows a state only upon confirmation.
  - States of the answer zone: no marker (the button is inactive, caption «Поставьте метку на карте» ("Place a marker on the map")); marker sent, no confirmation yet (the «Угадать» button is active); marker saved («Метка сохранена: засчитается, если время выйдет» ("Marker saved: it will count if time runs out")); «Угадать» pressed, no confirmation yet (the button «Отправляем…» ("Sending…")); answer accepted (the marker is pinned, instead of the button «Ответ принят. Ответили 2 из 6» ("Answer accepted. 2 of 6 have answered"), the panorama can still be explored); time is up.
  - On a connection drop the answer zone shows the last confirmed state and the line «Нет связи: изменения не отправлены» ("No connection: changes not sent"); after reconnection the client sends the last marker position again.
  - Tests: an integration test on marker and answer confirmation; E2E on the «Нет связи» state on a WebSocket drop after placing a marker.
- **Showing round results and the reading pause.** Milestone M1 (simple display and the pause) and M4 (the full sequence); refines sections 4.5 and 8.
  - Sequence: the map flies to the answer (800 ms), the answer flag, then markers one by one from the farthest to the nearest with a 300 ms step; an arc is drawn to each, the participant's row appears in the table, the points count up over 600 ms; after the last marker the rows are reordered (400 ms). The whole sequence takes no longer than 5 s with any number of participants.
  - A click on the map or the space bar shows the outcome immediately. With `prefers-reduced-motion` the outcome is always shown immediately: no fly-over, no timed arcs, no counting numbers and no confetti.
  - In M1 the display is simple: the map immediately in the bounds of all markers, markers and table without a sequence.
  - Results have no auto-advance countdown (removed after playtesting: players wanted to read AI explanations without a timer). Only the host's «Дальше» moves on.
  - Tests: unit test that results stay until the host's «Дальше» and that a guest cannot advance; E2E, after the space bar all markers and final points are on screen without waiting.
- **Interface states.** Milestone M1 (the rows on «Проверить», quip and side score in M2); refines sections 4, 6 and 8. What the person sees:

  | Element | Loading | Empty | Error | Success | Partial |
  |---|---|---|---|---|---|
  | Login | «Проверяем ссылку…» ("Checking the link…"), the form is inactive; after pressing «Входим…» ("Joining…"), a repeated press has no effect | no token in the address: «Нужна пригласительная ссылка. Попросите её у хоста» ("An invitation link is needed. Ask the host for it"); empty name: «Войти» is inactive, hint «От 1 до 20 символов» ("1 to 20 characters") | «Ссылка устарела или неверна. Попросите у хоста новую» ("The link is outdated or wrong. Ask the host for a new one") (no form); «Ник занят» ("Nickname taken") under the field; «Комната полна: 8 из 8» ("Room full: 8 of 8"); «Сервер не отвечает. Возможно, хост закрыл игру» ("The server is not responding. The host may have closed the game") and «Повторить» ("Retry") | transition to the lobby | a match is in progress: «Идёт раунд 2 из 5. Вы посмотрите его как зритель и сыграете со следующего» ("Round 2 of 5 is in progress. You will watch it as a spectator and play from the next one") |
  | Players in the lobby | does not occur: the list arrives with the first message | the host alone: «Пока вы одни. Отправьте друзьям приглашение» ("You are alone for now. Send your friends the invitation") and a copy button | a disconnected one: the row is dim, caption «отключился» ("disconnected"); a Maps JavaScript API error at a player: a note with the cause at the host | rows with an avatar, for the host the caption «хост» ("host") | «Комната полна» at 8 of 8 |
  | Invitation | «Ссылка проверяется…» ("The link is being checked…"), the button is inactive | with `--no-tunnel`: «Игра только на этом компьютере» ("The game is on this computer only") | the cause (DNS or HTTP) and advice to restart `start` | «Скопировано» ("Copied") for 2 s | the address changed: «Адрес игры сменился. Отправьте друзьям новую ссылку» ("The game address changed. Send your friends the new link") |
  | AI slots | model list: «Загружаем модели…» ("Loading models…"); «Проверить» (M2): «Проверяем зрение…» ("Checking vision…") in the button | for the host «ИИ-соперников нет. Добавьте до трёх» ("No AI opponents. Add up to three") and «Добавить ИИ» ("Add AI"); for guests «Хост пока не добавил ИИ» ("The host has not added any AI yet") | an unavailable harness: the slot is disabled, the cause and the fix command as a line; the check failed: the cause | collapsed row: avatar, name, harness, move limit; «Зрение проверено, 12 с» (M2) | «Не проверено на этих настройках»; «Отвечает медленно: 41 с при бюджете 60 с» ("Answers slowly: 41 s with a 60 s budget") (M2) |
  | «Начать» | «Готовим первый раунд…» ("Preparing the first round…") in the button while the location is not ready | does not occur | the quota is insufficient: the button is inactive, next to it usage, worst case, remainder and what to reduce | countdown | for guests the line «Начать может только хост» ("Only the host can start") |
  | Panorama | the `--asphalt-900` shutter and «Загружаем панораму…» ("Loading the panorama…") | does not occur | «Панорама не загрузилась» ("The panorama failed to load") and «Повторить», the map is available; Maps JS did not load: «Google Maps не загрузился. Отключите блокировщик для этого сайта и обновите страницу» ("Google Maps failed to load. Disable the blocker for this site and refresh the page") | the panorama | does not occur |
  | Mini-map and answer | «Загружаем карту…» ("Loading the map…") | no marker: «Поставьте метку на карте» | «Карта не загрузилась» ("The map failed to load") and «Повторить»; «Нет связи: изменения не отправлены» | «Ответ принят. Ответили 2 из 6» | «Метка сохранена: засчитается, если время выйдет»; time ran out with a marker: «Время вышло. Засчитана ваша метка» ("Time is up. Your marker was counted"); without a marker: «Время вышло. Ответа нет: 0 очков» ("Time is up. No answer: 0 points") |
  | Participants in a round | «загружает панораму» ("loading the panorama") until the round starts | does not occur | a human «отключился»; an AI «оборван» ("cut off") with the cause in a tooltip | «ответил» ("answered") with a check mark | an AI «ход 3 из 4»; a human without a caption while still looking |
  | Round preparation | «Ищем место…» ("Looking for a place…") | does not occur | host: the cause and «Повторить», «Завершить партию»; guests: «Раунд не начался. Хост решает, что делать» ("The round did not start. The host decides what to do") | countdown 3-2-1 | «Ждём: Дима», no longer than 5 s |
  | Results map | points and table are visible immediately, in place of the map «Загружаем карту…» | nobody answered: only the answer flag and the line «Никто не ответил» ("Nobody answered") | «Карта не загрузилась»: the round table remains | markers, arcs, distances | a participant without an answer: no marker, in the table «нет ответа, 0» or «нет догадки» with the cause |
  | AI card | the thumbnail is loading: a gray rectangle of the same size | no guess: the reason for finishing and the last 300 characters of the harness text | the thumbnail failed to load: the compass caption without a picture | explanation, moves, time | «Оборван по времени. Засчитана последняя догадка» ("Cut off by time. The last guess was counted"); without moves: «Ходов не делал, ответил по стартовым снимкам» ("Made no moves, answered from the starting images") |
  | Final | does not occur: the result arrives in one message | no rounds played: «Партия завершена до первого результата» | for the host: «Партия не записана в историю. На экране итог верный» ("The match was not recorded in the history. The result on screen is correct") with the cause | podium and list of places | a tie: «Места поделили: Оля и Клод»; early end: «Сыграно 3 из 5 раундов» |
  | Connection | banner «Связь потеряна. Переподключаемся, попытка 3» ("Connection lost. Reconnecting, attempt 3"); action buttons are inactive, the last confirmed state stays in place | does not occur | after 30 s: «Не удаётся подключиться. Возможно, у хоста сменился адрес: попросите новую ссылку» ("Cannot connect. The host's address may have changed: ask for a new link") | «Снова на связи» ("Back online") for 2 s | does not occur |

  - Test: E2E on the login states (no token, wrong link, taken nickname, full room, match in progress) and on the connection banner on a WebSocket drop.
- **Invitation in the interface and the host menu.** Milestone M1; refines sections 4.1 and 9.
  - The server tells clients the current invitation link and the state of its check. In the lobby the «Скопировать приглашение» ("Copy invitation") button is visible to everyone; after a press, for 2 s the caption changes to «Скопировано».
  - Host menu (an icon in the top right corner on the lobby, round, results and final screens): «Скопировать приглашение» and «Завершить партию».
  - If the tunnel address changed mid-match, the host sees the message «Адрес игры сменился. Отправьте друзьям новую ссылку» with a copy button; it does not disappear by itself.
  - «Завершить партию» asks for confirmation in place («Завершить? Сыграно 2 из 5 раундов» ("End? Played 2 of 5 rounds") and buttons «Завершить», «Отмена» ("Cancel")), cuts off the bots and takes everyone to the final with the rounds played. An unfinished round does not count.
  - Tests: a unit test on the state machine transition from `ROUND_ACTIVE` and `ROUND_RESULTS` to `FINAL` on a host command; E2E on copying the invitation.
- **Keyboard, contrast and window sizes.** Milestone M1; refines sections 7 and 8.
  - Design window 1280 × 720 and larger. From 900 to 1279 px in width the participant list in a round shrinks to avatars with status, the lobby columns are kept. The page does not scroll horizontally at any width; own horizontal scrolling exists only for the per-round table in the final.
  - Narrower than 900 px (a phone or browser zoom of 200%): before login a line «Игра рассчитана на компьютер. На телефоне играть неудобно» ("The game is designed for a computer. It is inconvenient to play on a phone") and a button «Всё равно войти» ("Join anyway"). In this mode one layout rule applies: the lobby columns and the results table go one under the other, the mini-map is replaced by a «Карта» ("Map") button that opens the map full screen with the «Угадать» button; the timer and the answer state stay in view. A separate mobile layout remains in `TODOS.md`.
  - All buttons and fields are at least 44 px high. The lobby settings are built from standard form elements (`input`, `select`, `button`, `fieldset` with labels), so they work from the keyboard without custom code. When the screen changes, focus goes to its main element.
  - Keys: Enter submits the login form; space in a round equals «Угадать» if a marker is placed; space or Enter for the host on results equals «Дальше»; `M` expands and collapses the mini-map and puts focus on it; Esc closes the AI card and the confirmation and takes focus away from the map. Global keys do not fire while focus is in an input field.
  - Placing a marker from the keyboard: when focus is on the mini-map, a crosshair is visible in its center; arrows move the map, `+` and `-` change the zoom (standard map behavior), Enter places a marker at the center. The panorama keyboard is controlled by the Google widget itself.
  - Screen readers: an `aria-live="polite"` region announces the start of the round, the remaining 30, 10 and 5 seconds, the end of the round and the viewer's own place; the results and final tables are real `table` elements with headers; avatars have an `aria-label`. The game by its nature requires sight; this limitation is stated in the README.
  - Text contrast not below 4.5:1, large numbers and control borders not below 3:1; main text no smaller than 16 px; inactive fields remain readable.
  - Tests: E2E goes through login, lobby and placing a marker using only the keyboard; `@axe-core/playwright` on each of the five screens without violations of serious and critical level; a check for the absence of horizontal page scrolling at window sizes 1280 × 720, 1024 × 640 and 390 × 844.

The items below were added by the DX review (phase 2.5) and are likewise mandatory.

- **First launch and client build.** Milestone M1; refines sections 9 and 10, closes WARNING 9.2.
  - Requirements for the machine to play: Bun (version pinned in `package.json`, the `engines` field, and in `.bun-version`), `cloudflared`, at least one harness that passed S1, logged in. For development also `shellcheck`. Linux and macOS are supported; Windows is not verified.
  - The README "Быстрый старт" ("Quick start") path, exactly four steps: `bun install`; `cp .env.example .env` and two keys per the "Как получить ключи" section; `bun run doctor`; `bun run start`.
  - `start` builds the client on every launch (`vite build`, a few seconds), so after `git pull` or an edit of any build input (`web/`, `shared/`, Vite and Svelte settings) the old client is not served. The terminal shows the line «Собираю клиент…» ("Building the client…") and the build time. A build cache will appear only if measurement shows that the build hinders the goal of a repeat launch.
  - Before starting the server, `start` makes quick checks without network: both keys are in `.env`; `cloudflared` is found (except with `--no-tunnel` and `--public-url`); the port is free. The default port is 5174, changed by the `--port` flag or the `PORT` variable.
  - When the link is ready, `start` prints a short block: the host link, the invitation link, «Ссылка готова за 14 с» ("Link ready in 14 s"), monthly quota usage, the harnesses available for AI slots. Then it opens the host link in the default browser (`xdg-open` or `open`); the `--no-open` flag disables this, without a graphical session the browser is not opened and a line says so.
  - Tests: unit tests on a busy port and a missing key; an integration test: `start --no-tunnel --no-open` on a clean directory builds the client and answers on `/healthz`.
- **Google keys: step-by-step instructions and check.** Milestone M1 (README and `doctor`), refined by the S3 spike report; refines sections 6 and 9.
  - The README section "Как получить ключи" lists the steps with direct links to Cloud Console pages: create a project; connect billing (a bank card is needed, Google requires it even within the free volume); enable the Maps JavaScript API and the Street View Static API; create a browser key with a referrer and API restriction (Maps JavaScript API only); create a server key with an API restriction (Street View Static API only); set daily quotas per the S3 report; put the keys into `.env`. There is also a time estimate: about 15 minutes on a first acquaintance with Cloud Console.
  - `doctor` checks the server key with a free metadata request. Together with the status `doctor` shows the `error_message` field from Google's response (the key is cut out of the text). Known texts (key invalid, API not enabled, billing not connected, key restriction does not allow it) are mapped to their step of the instructions; if the text is unfamiliar, `doctor` prints the steps to check in order: the key is copied in full, the Street View Static API is enabled, billing is connected, the API restriction allows the Street View Static API.
  - The browser key is checked where it works: in the host's browser when the lobby opens. A Maps JavaScript API load error (`RefererNotAllowedMapError`, `ApiNotActivatedMapError`, `InvalidKeyMapError` and others) goes to the server in a `client_error` message; the host sees in the lobby and in the terminal the error code and the step of the instructions that fixes it.
  - Tests: a unit test on parsing metadata responses (`OK`, `ZERO_RESULTS`, `REQUEST_DENIED` with a known and an unfamiliar `error_message`, `OVER_QUERY_LIMIT`) into `doctor` messages, the key is absent from the output; a unit test on mapping Maps JavaScript API error codes to the instruction steps.
- **Command-line and bot tool errors.** Milestone M1 (`start`, basic `doctor`, `geo` tools) and M3 (full `doctor`); refines sections 5.1 and 9.
  - All errors that the owner or an agent sees are collected in the registry `server/errors.ts`: a stable code (`GEO_ENV_KEY_MISSING`, `GEO_PORT_BUSY`, `GEO_CLOUDFLARED_MISSING`, `GEO_TUNNEL_NOT_READY`, `GEO_GOOGLE_KEY_DENIED`, `GEO_GOOGLE_QUOTA`, `GEO_HARNESS_NOT_LOGGED_IN`, `GEO_HARNESS_HIDDEN`, `GEO_SETTINGS_UNREADABLE`, `GEO_QUOTA_CEILING`, `GEO_CRASH` and others), a class, a text template and an anchor in `docs/errors.md`. Codes do not change; the text may change.
  - The form of an error in the terminal (stderr): the first line is what failed, with real values and the code; a «причина» ("cause") line with the original error of the dependency; a «контекст» ("context") line with versions (`geoaissr`, Bun, `cloudflared` or the harness) and environment variable names, but without their values; the last line «исправить:» ("fix:") with the exact command or what the person must do, and whether it is safe to repeat. Example:

    ```
    start: публичная ссылка https://….trycloudflare.com не ответила за 60 с: DNS не разрешает имя (GEO_TUNNEL_NOT_READY)
      причина: DoH cloudflare-dns.com и dns.google вернули NXDOMAIN
      контекст: geoaissr 0.1.0, cloudflared 2026.10.1; сервер работает на localhost:5174, партия не начата
      исправить: остановите start (Ctrl+C) и запустите снова `bun run start`; повторять можно, ничего не потеряется (docs/errors.md#GEO_TUNNEL_NOT_READY)
    ```
  - Exit codes: 1 invalid invocation (flags); 2 environment or configuration (`.env`, port, no `cloudflared`); 3 external dependency (Google, tunnel, harness); 70 unexpected failure. An error never ends with code 0.
  - `bun run doctor --json` prints an array of checks `{code, level, ok, what, fix, context}`: an agent that builds or repairs the project reads it without parsing text.
  - `doctor` check levels. Mandatory: both keys are in `.env`; the server key passes a metadata request; the Bun version is suitable; `cloudflared` is found (with `--no-tunnel` and `--public-url` the check is skipped and marked «пропущено» ("skipped")); at least one harness that passed S1 is installed and logged in to the subscription. Optional (warning): each separate harness (an unavailable one merely disables its own AI slots); the harness version differs from the one verified in `harness-verified.json` (the harness stays available, advice to run `bun run test:harness`; in M2 also «Проверить» at the slot); `shellcheck` and Playwright browsers (needed for development only). The `doctor` exit code is 0 if all mandatory checks passed; warnings do not change it.
  - On launch `start` prints the same harness version warnings, one line per harness, and starts.
  - An unexpected server failure: the full stack is written to `~/.local/share/geoaissr/logs/crash-<time>.log`, the terminal gets the first line, the path to the file and the line «исправить: запустите `bun run start` снова; партия потеряна, сыгранные раунды не записаны» ("fix: run `bun run start` again; the match is lost, the rounds played were not recorded") (state in memory, section 7). Players' browsers show the "Connection" state from the interface states table. Secrets and tokens do not get into the crash file (the rule of the item "Secrets and tokens").
  - A `geo` tool response with an error is returned with `isError: true` and a text in the same order: what is wrong, allowed values, what to do next («вызови submit_guess»), whether the move was charged.
  - Tests: a unit test that each registry code has a section in `docs/errors.md` and that no template substitutes the values of key-bearing variables; snapshots of the text of three errors; a unit test on the `doctor --json` schema; an integration test that an unexpected exception gives exit code 70, a crash file without tokens and the path to it in stderr.
- **Development without keys and subscriptions.** Milestone M0 (commands) and M1 (fakes); refines sections 9 and 11.
  - `bun run dev --fake` launches the server and Vite with the same fakes as in the integration tests: a fake panorama provider (a static image instead of Street View), fake bot images and a fake harness. Google keys, tunnel and subscriptions are not needed, quota is not spent. The mode is marked in the interface with a «Тестовый режим» ("Test mode") badge.
  - Data directories are set in one place: the variables `GEOAISSR_CONFIG_DIR` and `GEOAISSR_DATA_DIR`, by default `~/.config/geoaissr` and `~/.local/share/geoaissr`. No module builds these paths itself. `--fake` uses `.geoaissr-dev/` in the repository (added to `.gitignore`); each test gets its own temporary directory. The test harness fails if a data path points into the owner's real directories.
  - Preparing a working copy for development with one command `bun run setup:dev`: `bun install`, hook installation (`bun run hooks:install`), `bunx playwright install chromium`, a `shellcheck` check (if it is missing, the install command for Linux and macOS is printed). After that `bun run check` and `bun run test` pass without network and keys.
  - Commands for a human and an agent: `bun run check` (quality gates), `bun run test` (unit and integration, without network), `bun run test:e2e` (Playwright), `bun run test:harness` and `bun run test:tunnel` (on demand, with real CLIs and network). On failure `bun run check` names the step and the command to repeat only it.
  - The project `CLAUDE.md` lists these commands, the size limits and a link to `DESIGN.md` and `docs/errors.md`.
  - Tests: E2E runs in `--fake` mode by default; a unit test that data paths are taken from the variables and that the harness rejects the real directories.
- **Upgrade.** Milestone M1; refines sections 9 and 14 ("Failures during a match").
  - README "Обновление" ("Upgrade"): `git pull && bun install && bun run start`; the client rebuilds itself.
  - `settings.json`, `quota.json` and the `matches.jsonl` lines are migrated from an old format version by migration functions, one per version, with a test for each.
  - A file of a newer version than the program knows is not rewritten. `settings.json`: the server starts with defaults and the warning `GEO_SETTINGS_NEWER`. `quota.json`: `start` does not launch (`GEO_QUOTA_NEWER`, fix: update the program), because unknown usage cannot be treated as zero. `matches.jsonl`: new lines are appended with their own version, foreign lines are not touched.
  - An unreadable `quota.json` is still renamed to `.bad`, but counting does not silently start from zero: until the first match the host sees in the lobby «Расход за месяц неизвестен: файл квоты повреждён. Сверьте расход в Cloud Console» ("Monthly usage unknown: the quota file is damaged. Check usage in Cloud Console") and a button «Начать счёт с нуля» ("Start counting from zero"); without pressing it a match with bots does not start. This refines the item "Failures during a match".
  - Tests: unit tests on migration from each past version, on a file newer than the program for each of the three files and on the host's confirmation after a damaged `quota.json`.
- **First-launch measurement.** The "First game" gate; refines the item "\"First game\" gate".
  - The owner records in `docs/playtest-1.md` the time from `git clone` into a clean directory to the moment the second person joined the lobby via the invitation link and the Maps JavaScript API loaded for both without `client_error` (this checks the browser key too), and all errors met along the way with their codes.
  - Goals: the first launch no longer than 20 minutes, of which most of the time is in Cloud Console; a repeat launch on a game evening no longer than 1 minute from `bun run start` to the copied link. If the goal is not reached, the README and error texts are fixed based on the recorded errors before M2 starts.

The items below were added by the engineering review (phase 3) and are likewise mandatory.

- **Repository layout.** Milestone M0; refines section 7.
  - One `package.json` at the root and the directories `shared/`, `server/`, `web/`, `bot-tools/`, `scripts/` without workspaces. Two `tsconfig` files (browser for `web/`, Bun for the rest) and a shared root one.
  - Import boundaries are checked by ESLint (`no-restricted-imports` by paths) in `bun run check`: `web/` and `bot-tools/` import only `shared/`; `server/` does not import `web/`; `shared/` imports nothing from the project. A violation fails the build.
  - Unit and integration tests run through the built-in `bun test`; E2E through Playwright. Vitest is not used. Client logic worth testing separately (clock, formatting, projection of state onto a screen) lives in ordinary `.ts` modules in `web/src/lib/` without Svelte runes; components are checked by E2E.
  - `scripts/check-size.ts` checks `.svelte` too: a component file ≤ 500 lines. The ESLint rule `max-lines-per-function: 80` applies in tests as well, so the project `CLAUDE.md` asks not to wrap a test file in one big `describe`.
- **Game core: one state and pure transitions.** Milestone M1; refines sections 7 and 14 ("Event order and edge cases").
  - All mutable room state (participants, phase, round number, markers, answers, bots' move counters and reservations, reading pause, bot guesses) lies in one object `RoomState` with one owner: `server/engine/`.
  - Transitions are computed by a pure function `reduce(state, event, now) → {state, effects}` without waits and I/O. Effects (timer, starting or stopping a harness, a request to Google, broadcast to clients, a file write) are executed by `server/engine/shell.ts`; an effect's result returns to the core as an event with an operation tag: the match identifier `matchId` and the generation `gen`. The generation grows at every new round, at every repeated round preparation («Повторить»), at every settings change in the lobby and at «Ещё раз». An event with a foreign tag is discarded by the core in one place, not in each handler; the round number is not enough for this, because a repeated preparation and a new match use the same number.
  - The core files are split by phase: `lobby.ts`, `round.ts`, `results.ts`, `final.ts` and a shared `reduce.ts` that picks the handler by phase. This way no file approaches the 500-line limit.
  - What each participant sees is decided by one function `view(state, viewerId)`: during a round it contains no answer coordinates, other people's markers or bot guesses; coordinates appear only in the `ROUND_RESULTS` phase. The server sends each client its view in full with a version number; the client does not assemble state from deltas.
  - Tests: unit tests on `reduce` with a controllable clock (all transitions from the item "Event order and edge cases" become rows of one table); a unit test on `view`: in `ROUND_ACTIVE` any player's view contains no answer coordinates, other people's markers or bot guesses.
- **Acknowledgement protocol and clocks.** Milestone M1; refines the items "Human answer: server confirmations" and "Screen hierarchy" (timer).
  - Each client message carries a `seq` that grows within a connection. The server replies `ack {seq, result}`, where `result` is `ok` or a refusal code (`round_over`, `already_confirmed`, `not_in_round`, `invalid`). The client changes the answer zone state only upon `ack`.
  - Marker: the client sends `{roundId, lat, lng}` no more than 5 times per second; the server keeps the last one and replies with an `ack` to each. «Угадать»: `{roundId, lat, lng}`; the server records these coordinates and the confirmation in one transition, so a marker moved right before the press is not lost to rate limiting. A repeat gets `already_confirmed`.
  - Each server message carries `serverNow` (ms). The client keeps a clock offset from a ping every 20 s (from spike S2): the measurement with the smallest ping time over the last 5 is taken. The timer is computed from `endsAt` from the state view plus the offset.
  - After reconnection the client receives the full view and, if the round is the same and the answer is not confirmed, sends the last marker again.
  - Tests: a unit test on the offset computation (choosing the smallest ping, a jump of the client clock); an integration test on a marker `ack`, a repeated «Угадать» and a marker with the previous round's number.
- **Host, tabs and returning mid-round.** Milestone M1; closes question C-HOSTDROP from the CEO review; refines sections 4.1 and 4.5.
  - The host role is tied to the host token, not to the connection. A host who closed the tab returns via the same local link from the terminal and gets the role back.
  - While the host is absent: the automatic advance of results goes as usual; a round preparation error and the final screen wait for the host, guests see «Хост отключился. Ждём его возвращения» ("The host disconnected. Waiting for them to return"); the lobby waits for «Начать».
  - One identity in two tabs (the same host token or the same `playerId`): the last connection wins, the old one gets the message «Игра открыта в другой вкладке» ("The game is open in another tab") and is closed.
  - A round participant who returned before the end of the round plays it again: their marker and confirmed answer are kept. A new participant mid-round stays a spectator until the next one (as in section 4.1).
  - A connection without a token is closed after 5 s; no more than 8 connections awaiting login at the same time, extra ones are closed immediately. The ceiling of 32 connections from section 7 counts them too.
  - Tests: unit tests on the host's return, a second tab, a participant's return mid-round and the automatic advance without a host; an integration test on closing a connection without a token after 5 s.
- **Process launching and stopping.** Milestone M1; refines sections 5.3 and 5.4.
  - All child processes (bot harnesses, `cloudflared`, the Vite build) are launched by one function `spawnManaged` in `server/proc/`: each process in its own process group, output is collected into the log, stopping via SIGTERM to the group and SIGKILL to the group after 2 s. Otherwise a harness process leaves its descendants alive (the `bot-tools` bridge, helper processes).
  - The data directory belongs to one server: at startup the server takes a lock file `<DATA_DIR>/run/server.lock` with its process number and its start time. A second `start` with the same data directory ends with the error `GEO_ALREADY_RUNNING` (code 2) and touches nothing; the lock of a process that no longer exists is released.
  - The groups of live child processes are recorded in `<DATA_DIR>/run/children.json`: the process number, its start time (on Linux from `/proc/<pid>/stat`, on macOS from `ps -o lstart=`) and the command. Only after acquiring the lock does the server read the previous launch's file and stop a group for which all three attributes match; this way, after an emergency server termination, the harnesses do not waste the subscription, and a process with a reused number is not harmed.
  - On Ctrl+C, SIGTERM and an unexpected failure the server first stops all groups, then writes the crash file and exits.
  - Tests: a unit test that a fake process with a descendant is stopped entirely; a unit test on cleanup by `children.json` (all three attributes match: stopped; a different start time or command: untouched); a unit test on a second `start` with a live lock and on releasing the lock of a dead process; an integration test that exit code 70 leaves zero live fake-harness processes.
- **Harness adapters: flags per the help.** Milestones M0 (spike S1) and M1; refines section 5.3 and the item "Bot process isolation".
  - The list of harnesses is defined once: the adapter registry `server/bots/adapters/index.ts`. `doctor`, the `settings.json` schema, the harness choice in the lobby and `test:harness` take it from there.
  - `codex`: the temporary directory is not a git repository, so `--skip-git-repo-check` is needed; isolation candidates from the 0.167 help: `--ephemeral` (the session is not written to disk) and `--ignore-user-config` (do not read `config.toml`, the login is kept).
  - `claude`: `--bare` cannot be used: in this mode the claude.ai login is not read, only `ANTHROPIC_API_KEY` works. Candidates: `--tools ""` (turn off built-in tools), `--setting-sources` without `user`, `--no-session-persistence`, together with `--strict-mcp-config` and `--allowedTools "mcp__geo__*"`.
  - `agy`: `--settings` (settings for this session only), `--print-timeout` as an external time limit, `--sandbox`.
  - Spike S1 confirms each candidate and two more questions: the `bot-tools` bridge launched by the harness reaches `127.0.0.1:BOT_PORT` from under the harness's sandbox; the tool call result arrives in the form the adapter expects (`codex` has different forms of recording a call).
  - Test: a unit snapshot of each adapter's `argv` and environment (no Google keys, the MCP config points to the bridge with a token, isolation flags in place).
- **Round location.** Milestone M1; refines sections 4.3, 4.4, 5.2 and 6.
  - The round location is set once and does not change afterward: the `pano_id` and coordinates from the metadata response for this panorama (not the random point from which the search started).
  - Humans open exactly this panorama (`StreetViewPanorama` with `pano`), the bots' starting images are requested with the parameter `pano=<pano_id>`, points and arcs on the results map are computed from the panorama's coordinates.
  - Test: a unit test that points are computed from the panorama's coordinates, not from the sampling point; an integration test that the client and the starting images get the same `pano_id`.
- **Bot moves in sequence.** Milestone M1; refines sections 5.1, 5.2 and the item "Event order and edge cases".
  - The `look` and `move` calls of one bot are executed strictly in sequence: the next waits for the end of the previous. A bot has one current panorama; `look` looks from it, `move` starts from it and changes it only after success. `observe()` and `submit_guess` do not join the queue.
  - A `move` step is accepted only if the found panorama differs from the current one, lies no farther than 100 m and the direction to it differs from the requested one by no more than 45°; otherwise the answer is «в эту сторону дороги нет» without charging a move.
  - Such a step is an approximation: the neighboring panorama by distance and direction may turn out to be on a parallel street, while a human walks along the links of Google panoramas. After the keys are enabled, spike S3 compares, over 50 steps in a browser, the server's choice with the links (`links`) of the Maps JavaScript API and records the share of matches. If it is below 80%, the owner decides whether to keep `move` with this caveat or to turn movement off for everyone in M1.
  - Test: a unit test that two simultaneous `move` calls go one after the other and the second starts from the first one's panorama; a unit test on refusing a step with a direction 90° off the requested one.
- **A `bot-tools` bridge without logic.** Milestone M1; refines sections 5.1 and 5.3.
  - The bridge only translates MCP over stdio into HTTP to `127.0.0.1:BOT_PORT` and back. It gets the list of tools, their descriptions and schemas from the server at startup; the schemas are described once in `shared/bot-tools.ts` (zod) and translated into JSON Schema there.
  - `BOT_PORT` is chosen by the system at server startup (port 0); the bridge gets the bot's address and token via the environment from the MCP config.
  - If the server is unavailable, the bridge answers each call with the error «игра остановлена, заверши работу» ("the game is stopped, finish your work") and exits.
  - The fake harness in tests is an MCP client that launches the real bridge with the same MCP config as the adapter; this way the integration tests pass through the bridge and the bot API.
  - Test: an integration test that a previous round's bot token gets a refusal.
- **Captions on bot images.** Milestone M1; refines section 5.2.
  - The compass caption is drawn with a font from the repository (the Onest file from `@fontsource`, the `fontfile` parameter of `sharp`), not a system one: on a machine without Cyrillic fonts the caption would otherwise come out as squares, and the bot would read garbage without any error.
  - The image for the bot is encoded anew without metadata (the default behavior of `sharp`; a test pins this).
  - Spike S1 checks that `sharp` installs and works under Bun on the owner's machine.
  - Tests: a unit test that the caption is drawn (the image with the caption differs from the original in the caption area) and that the result has no EXIF and XMP.
- **Writing the quota counter.** Milestone M1; refines the item "Quota accounting".
  - `quota.json` is written by one owner (`server/storage/quota.ts`): a write to a temporary file and a rename, one write at a time, after every change of the counter.
  - Paid starting images are requested only for a match that passed the quota check: in the lobby the server in advance looks for only the first round's location (a free metadata request), and requests its starting images after «Начать», during the countdown. The following rounds are prepared in advance, as before, within the match's already-checked worst case. A region change in the lobby cancels the found location; this does not affect usage.
  - A write error is not hidden: the host sees a warning, and until a successful write the start of a new match with bots behaves as with a damaged file (the item "Upgrade").
  - The counter's month is determined by UTC; the time zone of Google's billing month is reconciled by spike S3.
  - Tests: a unit test on an interrupted write (the old file is intact), on a write error and on a month change.
- **`start` speed.** Milestone M1; refines the item "First launch and client build".
  - The client build runs in parallel with launching `cloudflared` and waiting for DNS: they do not depend on each other, and the DNS wait can be longer than the build. The link is printed when both are ready. The DoH request is repeated every 2 s.
- **Bot launch log and crash files.** Milestone M1; refines the items "Server and bot log" and "Command-line and bot tool errors".
  - The harness launch record: the adapter, the CLI version, `argv` with the token masked, the duration, the exit code or signal, the reason for finishing, the last 50 stderr lines after masking.
  - The `crash-<time>.log` files lie in the same log directory and are deleted by the same 14-day rule.
  - The README, in the section about bots, says that bots spend the owner's subscription limits and that the terms of each subscription are checked by the owner themselves (question C-SUBTERMS from the CEO review).
- **Thumbnails for the AI card.** Milestone M1; refines the item "Image storage".
  - Thumbnails are served at `GET /thumb/<id>`, where `id` contains 128 bits of randomness; after the return to the lobby the addresses answer 404. A token is not needed in the image address and is not passed.
  - Test: a unit test that after the return to the lobby the thumbnail address answers 404.
- **Map fake for `--fake` mode.** Milestone M1; refines the items "Owner decisions before code" and "Development without keys and subscriptions".
  - If the owner chooses Google Maps for the answer map, `dev --fake` and E2E without network get a fake map: a component with the same properties as `GuessMap` and `ResultsMap`, on a simple world image with a click translated into latitude and longitude. This is the only map substitution; there is no switch between two real maps. If MapLibre is chosen, the fake is not needed: in `--fake` mode an empty style without tiles is substituted.
- **Bot quality evaluation.** Milestone M2.
  - `bun run eval:bots`: a set of 10 or more locations photographed by the owner (Google imagery is not saved, clause 3.2.3(a)). Each location has four photographs by compass direction with captions and known coordinates. Only the guess from the starting images is checked (move limit 0): `look` and `move` cannot be honestly reproduced on pre-shot photographs.
  - The comparison is paired: the previous and the new version of the prompt or schemas are run on the same set 3 times each, the median and the spread of distances are written to `docs/evals/`. The difficulty presets and the usefulness of moves are checked by recorded matches (`matches.jsonl`), not by this set.

## Review record

<!-- autoplan-baseline-edits:ceo {"sourceSha256":"19686c49705d9ba726fd6d4d9bf8bd6a7b4c85fbec40dc6303d9b08460f4ec7e","replacements":[{"oldText":"панорам 15; Static-картинок в худшем случае 5 × (4 + 3 × 6 × 4) = 380. Бесплатного объёма хватает минимум на 26 таких партий в месяц в худшем случае.","newText":"панорам 15 без перезагрузок страниц (проверка перед стартом закладывает 30); Static-картинок в худшем случае 5 × (12 + 3 × (6 + 3) × 4) = 600, где 12 это до трёх наборов стартовых картинок, а «+ 3» бесплатные неудачные вызовы бота за раунд. При потолке 80% (8 000 Static-картинок) это 13 таких партий в месяц в худшем случае; без потолка 16. С лимитом 4 хода худший случай 480 картинок, 16 партий при потолке. Обычный расход в несколько раз меньше: `look` запрашивает одну картинку, а не четыре."},{"oldText":"Транспорт только WebSocket; работу WebSocket через quick tunnel проверяем отдельным спайком","newText":"Транспорт только WebSocket. Проверено вживую 2026-11-13: через quick tunnel проходят HTTPS 200 и `101 Switching Protocols`; имя туннеля появляется в публичном DNS с задержкой"},{"oldText":"- S2. WebSocket через quick tunnel `cloudflared`: соединение, пинг раз в 20 с, восстановление после обрыва.","newText":"- S2. WebSocket через quick tunnel `cloudflared`: само соединение уже проверено (раздел 3); остаётся пинг раз в 20 с, удержание соединения 15 минут и восстановление после обрыва."},{"oldText":"время одного хода каждого харнесса; условия Google о показе Street View рядом с не-Google картой.","newText":"время одного хода каждого харнесса. Условия Google прочитаны 2026-11-13 (Google Maps Platform Terms of Service, редакция от 26 августа 2026). Пункт 3.2.3(e) запрещает показывать Street View и не-Google карту на одном экране. Пункт 3.2.3(a) запрещает выносить Google Maps Content за пределы сервисов Google (хранить, передавать дальше). Пункт 3.2.3(c)(vii) запрещает использовать его для улучшения моделей ИИ (обучение, тестирование, проверка, дообучение). Исходный замысел в части карты и ИИ-соперников с этими пунктами расходится; решение за владельцем (раздел 14, «Решения владельца до кода»)."},{"oldText":"- Длительность раунда: 30–600 с, по умолчанию 120.","newText":"- Длительность раунда: 30–600 с, по умолчанию 120. Если в партии есть ИИ, минимум 60 с."},{"oldText":"лимит ходов 0–20 (по умолчанию 6)","newText":"лимит ходов 0–20 (по умолчанию 4, как в пресете «Любитель»), размер картинки, бюджет времени, характер, пресет сложности"},{"oldText":"Раунд кончается, когда истёк таймер или ответили все люди. Если все люди ответили раньше, ИИ получают ещё 20 с (настраивается) и затем обрываются.","newText":"Раунд кончается, когда истёк таймер, либо когда ответили все люди и завершились все боты. Если люди ответили раньше ботов, боты работают ещё 20 с (настраивается), но не меньше чем до 60-й секунды раунда, и затем обрываются."},{"oldText":"Кто не ответил, получает 0 очков. У ИИ засчитывается последняя предварительная догадка, если она была.","newText":"Кто не поставил метку, получает 0 очков; метка, поставленная, но не подтверждённая к концу таймера, засчитывается как ответ. У ИИ всегда засчитывается последняя записанная догадка, чем бы ни кончилась его работа (дедлайн, бюджет времени, сбой харнесса, лимит подписки); 0 очков бот получает, только если ни одной догадки не записано."},{"oldText":"`D` диагональ региона (мир: 14 916.862 км).","newText":"`D` диагональ региона (мир: 14 916.862 км). Для каждого пресета региона `D` это расстояние по большому кругу между противоположными углами ограничивающего прямоугольника его полигонов (с учётом 180-го меридиана); значения считает `scripts/build-regions.ts` при подготовке GeoJSON, они записаны константами в `shared/` и закреплены модульным тестом."},{"oldText":"- Итог: сумма по раундам. При равенстве выигрывает меньшая суммарная дистанция.","newText":"- Итог: сумма по раундам. При равенстве очков выше тот, у кого больше раундов с ответом, затем тот, у кого меньше суммарная дистанция по раундам с ответом; при полном равенстве место делится."},{"oldText":"- `submit_guess(lat, lng, explanation)`: записать догадку.","newText":"- `submit_guess(lat, lng, explanation, quip?)`: записать догадку."},{"oldText":"- Источник: Street View Static API, 640x640, по умолчанию `fov=90`, `pitch=0`.","newText":"- Источник: Street View Static API, запрос всегда 640x640, по умолчанию `fov=90`, `pitch=0`. Меньший размер для слота получается уменьшением на сервере."},{"oldText":"- Веб-поиск и прочие инструменты харнесса для бота выключены.","newText":"- Веб-поиск и прочие инструменты харнесса для бота выключаются флагами адаптера; что на деле выключено у каждого харнесса, проверяет спайк S1 (раздел 14, «Изоляция процесса бота»)."},{"oldText":"ограничение по referrer `*.trycloudflare.com/*` и `localhost`","newText":"ограничение по referrer `*.trycloudflare.com/*`, `localhost` и адрес из `--public-url`, если он задан"},{"oldText":"- Ограничение частоты неудачных входов по `CF-Connecting-IP`; потолок 32 соединения.","newText":"- Ограничение частоты неудачных входов по адресу клиента и общий потолок неудачных входов (пороги и источник адреса в разделе 14, «Свой публичный адрес и пороги входа»); потолок 32 соединения. `GET /healthz` отвечает без токена."},{"oldText":"- `bun run start --no-tunnel`: только локально.","newText":"- `bun run start --no-tunnel`: только локально.\n- `bun run start --public-url <https://адрес>`: без `cloudflared`, пригласительная ссылка строится от своего адреса."},{"oldText":"оба запускают `bun run check`.","newText":"оба запускают `bun run check`. Пока у репозитория нет remote, CI и pre-push не срабатывают, поэтому `bun run hooks:install` ставит ещё и `.githooks/pre-commit` с тем же `bun run check`; создание приватного remote входит в решения владельца до кода."},{"oldText":"Спайки (каждый оставляет короткий отчёт в `docs/spikes/` и решение):","newText":"Решения владельца до кода (раздел 14): карта для ответа, ИИ на снимках Google, приватный remote для CI.\n\nСпайки идут сразу после ворот качества, S1 первым (каждый оставляет короткий отчёт в `docs/spikes/` и решение):"},{"oldText":"как передать MCP-конфиг на один запуск без изменения глобальных настроек.","newText":"как передать MCP-конфиг на один запуск без изменения глобальных настроек; какими флагами закрыть харнессу чтение файлов вне временного каталога, веб-поиск и запуск команд; как отключить пользовательские настройки харнесса (общие инструкции, хуки, плагины, память). Затем на одноразовом коде: один полный раунд бота (стартовые картинки, ходы, догадка с объяснением) и три бота одновременно; состав и критерий в разделе 14."},{"oldText":"- S3. Ключи Google: включены оба API; доля удачных попаданий metadata-выборки по регионам; точные тексты ошибок для `doctor`.","newText":"- S3. Ключи Google: включены оба API; доля удачных попаданий metadata-выборки по регионам; точные тексты ошибок для `doctor`; сверка бесплатного месячного объёма и единицы тарификации панорам и карт с актуальной таблицей цен; какие дневные квоты выставить в Cloud Console.\n- S4. Час на обзор открытых клонов с проверкой лицензий: есть ли готовая основа для экранов M1. Решение записывается; по умолчанию своя сборка."},{"oldText":"состояния загрузки и ошибок на каждом экране, история партий, README.","newText":"состояния загрузки и ошибок на каждом экране, полный README."},{"oldText":"предупреждение в лобби, если ход дольше 1/3 раунда","newText":"предупреждение в лобби, если время из «Проверить» больше половины бюджета времени бота"},{"oldText":"Не проверено. Уточнить по тексту условий; запасной вариант карты: Google Maps JS (ключ уже нужен)","newText":"Проверено по тексту (раздел 3): исходный замысел расходится с пунктами 3.2.3(a), 3.2.3(c)(vii) и 3.2.3(e). Решает владелец до начала кода (раздел 14, «Решения владельца до кода»); вариант карты без расхождения: Google Maps JS (ключ уже нужен)"},{"oldText":"ошибка лимита показывается в карточке бота, бот получает 0","newText":"ошибка лимита показывается в карточке бота; засчитывается последняя записанная догадка, без неё 0"},{"oldText":"- Голос и чат.","newText":"- Голос и чат.\n\n## 14. Дополнения, принятые при обзоре\n\nПункты ниже обязательны. Там, где они расходятся с текстом разделов 3–12, действует текст этого раздела. У каждого пункта названа веха и разделы, которые он уточняет."},{"oldText":"- Движение людей по панораме: вкл/выкл.","newText":"- Движение по панораме: вкл/выкл. Настройка общая для людей и ботов: при выключенном движении инструмент `move` ботам недоступен."},{"oldText":"Жёсткий потолок по умолчанию 80% бесплатного объёма; при достижении новая партия не стартует, хост видит причину.","newText":"Потолок приложения по умолчанию 80% бесплатного объёма; правила учёта, проверка перед стартом партии и поведение при достижении потолка описаны в разделе 14 («Учёт квоты»). Счётчик это оценка, а не гарантия биллинга: настоящий предел задают дневные квоты в Cloud Console."},{"oldText":"### M1. Игра без ИИ\n\nПротокол и схемы, конечный автомат, вход по токену, лобби, раунд с настоящей панорамой и картой, очки, результаты, финал, переподключение.","newText":"### M1. Первая игра (сквозной срез)\n\nВсё, что нужно для одного игрового вечера: протокол и схемы, конечный автомат, вход по токену, лобби (раунды, длительность, слоты ИИ на одном харнессе, прошедшем S1), раунд с настоящей панорамой и картой, `bot-tools` (MCP), `BotImageService`, `BotRunner`, один адаптер, лимит ходов, дедлайн, счётчик и потолок квоты Static с проверкой перед стартом партии, очки, результаты с карточкой ИИ и объяснением, финал, переподключение, запуск `cloudflared` из `start` с проверкой готовности ссылки, базовый `doctor`, запись партии в `matches.jsonl`, простые переходы между экранами, README с шагами запуска. Регион: только мир.\n\nВорота «Первая игра» закрывают веху: партия с друзьями и замеры из раздела 14. По её итогам владелец подтверждает или меняет состав M2–M4."},{"oldText":"### M2. ИИ-соперники\n\n`bot-tools` (MCP), `BotImageService`, `BotRunner`, три адаптера, лимит ходов, дедлайн, карточка ИИ, проверка зрения в лобби, список моделей.","newText":"### M2. Все харнессы и настройка ИИ\n\nАдаптеры остальных харнессов, прошедших S1, список моделей, проверка зрения в лобби, сложность ботов, характер и реплика, счёт «Люди против ИИ», пресеты регионов."},{"oldText":"### M3. Туннель и защита\n\nЗапуск `cloudflared` из `start`, разбор URL, ссылки в терминале, ограничение частоты входов, счётчик квоты и потолок, `doctor`.","newText":"### M3. Защита и свой адрес\n\nПороги неудачных входов, учёт панорам в счётчике квоты, полный `doctor`, флаг `--public-url`."}]} -->

### Phase 1. CEO review (SELECTIVE EXPANSION mode)

#### Instruction reading log

- `autoplan/sections/ceo-phase.md`: lines 1–196 of 196 (to the end of the file).
- CEO methodology (`plan-ceo-review/SKILL.md` + `sections/review-sections.md`, combined file of 2224 lines): ranges 1–600, 601–1200, 1201–1720, 1721–2224 (to the end of the file). Re-read after context compaction.
- Parts the plan adds to gstack (skill, step, instruction, check, default value): none. The plan describes a separate project.

#### Pre-review audit

- The repository is empty: no commits, no remote repository, no `CLAUDE.md` and no architecture documents, no stashes. The working directory contains only `PLAN.md` and the `TODOS.md` created by this review.
- There is no design doc from `/office-hours`: the owner chose to skip it (answer to D1).
- There are no prior reviews of this plan and no recurring trouble spots.
- UI scope: present (5 screens, 8 components). Section 11 and the design phase are executed.
- DX scope: present (the `start`, `doctor`, `dev` commands, key setup, harness adapters). The DX phase is executed.
- Taste calibration. There is no code in the repository, so the examples are taken from the plan itself. Keep: an authoritative server with a state machine and zod protocol schemas; a harness adapter in one file with one function. Avoid: launching a CLI for every bot turn; timers and score calculation on the client side.

#### Market review (three layers)

- Layer 1, established. The genre is settled: a Street View panorama, a marker on a map, exponential scoring by distance, a sum over rounds. Open-source clones exist (WorldGuessr, GeoGuess and others), but the information about their licenses and composition comes from search and was not verified on site.
- Layer 2, new. Publications from 2025–2026 report that strong vision models locate a place from a photo at the level of strong players. None of the clones found offers AI opponents that play through local CLI harnesses and the owner's subscriptions.
- Layer 3, from first principles. The value of the project is not yet another clone, but that the AIs sit at the table as players: they see the same thing, are limited by turns, and explain their answer. Two conclusions follow. First: bot strength must be tunable, otherwise three humans will lose every match and it will get boring for a different reason. Second: the only irreplaceable dependency here is Street View; everything else (map, tunnel, harness) is replaceable.

#### Decision register

| ID and owner | Contract and basis | Current | Proposed | Status | Exact approval and scope |
|---|---|---|---|---|---|
| C-MODE (0E) | Review mode; `/autoplan` rule | SELECTIVE EXPANSION | none | approved | Set by `/autoplan`, the owner ran `/autoplan` |
| C-APPROACH (0D) | Build approach; section 7 of the plan | Own build: Bun + Svelte, bots via MCP inside a single harness session | Fork an open-source clone; hosting off the owner's machine | approved | Auto-decision, principle 1 (completeness): only an own build covers requirements 2, 5, 6, 7, 8 |
| C-E1 (0G) | Bot handicap and difficulty presets | none | Add | approved | Auto-decision, principle 2: within the plan's radius, less than a day of work. Milestone M2, after the "First game" gate |
| C-E2 (0G) | "Humans vs AI" score | none | Add | approved | Auto-decision, principle 2. Milestone M2 |
| C-E4 (0G) | Bot persona and quip | none | Add | approved | Auto-decision, principle 2. Milestone M2 |
| C-E14 (0G) | `--public-url` flag | none | Add | approved | Auto-decision, principle 2. Milestone M3 |
| C-D1…C-D5 (0G) | Sounds; history screen; custom point lists; recovery after restart; mobile layout | out of scope | To `TODOS.md` | deferred | Auto-decision, principle 3: outside the radius of the first version. Recorded in `TODOS.md` |
| C-X1…C-X5 (0G) | Bot thought feed; replay of a human's turn; speed bonus; AI hints to humans; spectator link | none | Do not do | declined | Auto-decision: the thought feed and hints break round fairness, the rest are not needed for the goal |
| C-F1 (0B) | Cost estimate and number of matches per month | 380 images, 26 matches | 600 images, 13 matches at the 80% cap, 16 without a cap; with a 4-turn limit 480 images and 16 matches | approved | Mechanical fix, recalculation below; after Codex remark 7 the repeated starting sets entered the worst case |
| C-F2 (review section 2) | Static API errors | not described | `return_error_code=true`; the unit for counting failures is a tool call; 3 free failed calls per round | approved | Mechanical fix |
| C-F3 (0B) | Readiness of the invitation link | the link is printed immediately | after a DNS and `/healthz` check | approved | Mechanical fix based on a live tunnel check |
| C-F4 (0I) | Spike S1 criterion | no criterion | go/no-go per harness | approved | Auto-decision, principle 5 (explicit) |
| C-F5 (0I, 0.5) | Milestone order | M1 game without AI, M2 AI, M3 tunnel and protection | M0: quality gates, S1, then S2–S4; M1 end-to-end "First game" slice with bots and tunnel; M2–M4 after the "First game" gate | approved | Auto-decision by the shared conclusion of both voices; the owner's requirements do not change, the order of work does. Shown at the final gate |
| C-F6 (0H) | Bot time | round from 30 s, grace period 20 s | minimum round and bot budget 60 s; the bot is cut off at the earliest of three moments; the warning is computed from the budget | approved | Auto-decision, principle 5 (explicit): otherwise the S1 criterion contradicts the round |
| C-F7 (0H) | Snapshot storage | not described | full images until the end of the round; 160 px thumbnails in memory until the end of the match, up to 86 MB | approved | Auto-decision, principle 1 (completeness) |
| C-F8 (0H) | Quality gates without a remote | CI and pre-push | plus `pre-commit` with the same `bun run check` while there is no remote | approved | Auto-decision, principle 1: the owner's rule about two enforcement places is not satisfied without a remote; limits were not changed |
| C-F9 (0H) | Bot score on failure | two different rules | always the last recorded guess; 0 only without a guess | approved | Mechanical fix of a contradiction |
| C-F10 (0H) | Tie-break and region `D` | smaller total distance; `D` only for the world | number of rounds with an answer, then distance; `D` for each preset | approved | Auto-decision, principle 1 |
| C-F11 (0H) | Quota accounting | the server "counts panorama loads" | `pano_loaded` from the client; worst-case check before start; behavior at the cap mid-match | approved | Auto-decision, principle 5 |
| C-F12 (0H) | Login protection | by `CF-Connecting-IP`, no thresholds | 10 failures per 60 s per address, 30 per server; thresholds apply only to failed attempts; `CF-Connecting-IP` is honored only in quick tunnel mode | approved | Auto-decision, principle 1. The `--trust-proxy` flag was dropped after the third check (principle 5) |
| C-F14 (0H) | Round preparation failures | not described | three point-sampling series; point replacement on a failed starting image; countdown without the late client | approved | Auto-decision, principle 1 |
| C-F15 (0H) | Static quota counter milestone; unconfirmed marker | counter in M3; rule not set | Static counter and cap together with the first bots (now M1); a marker at the end of the timer is counted | approved | Mechanical fix of order; marker rule per genre custom |
| C-F13 (0H) | Bot process isolation | "tools disabled" without verification | environment from an allowlist; flag verification in S1; admission of an unrestrictable harness is decided by the owner | approved | Auto-decision, principle 5; harness admission is not decided on the owner's behalf |
| C-PRESET (0H, 0.5) | Values of the new slot | turn limit 6 | 4 turns and 640 px in M1; presets with level names in M2 after reconciling with first-game data | approved | Auto-decision, principle 5; level names are not shown before calibration (Codex remark 6) |
| C-TOS (0A, 0.5) | AI on Google imagery; owner's requirements 5, 6 and 10; Google terms 3.2.3(a) and 3.2.3(c)(vii) | Street View Static images are passed to harness models | imagery from another source for bots, or a game without AI | unresolved | User Challenge UC-2. Not auto-decided: the owner decides at the final gate. Until the decision, the owner's original design applies |
| C-REMOTE (0H) | Private remote for CI | no remote | create | unresolved | Owner action, raised at the final gate; until then `pre-commit` works |
| C-MAP (0A, 0.5) | Map for the answer; owner's requirement 10: "the map can be a free one like OSM"; Google terms 3.2.3(e) | MapLibre + OpenFreeMap | Google Maps JS (same key) | unresolved | User Challenge UC-1. Not auto-decided: the owner decides at the final gate. Until the decision, the owner's original option applies |
| C-MOVE (0A) | What counts as an AI turn; owner's requirement 7 | `look` and `move` cost a turn; the starting look and the answer are free | Count every call to the model as a turn | approved | Taste auto-decision: the plan's interpretation is kept and fixed in section 5.1; at the final gate the owner is shown the interpretation itself |
| C-GATE1 (0.5) | "First game" gate after M1 | none | a match with friends, bot measurements, three questions to the owner, confirmation of the M2–M4 composition | approved | Auto-decision by the shared conclusion of both voices (Claude 9, Codex 2), principle 1 |
| C-S1FULL (0.5) | Composition of spike S1 | vision and the time of one turn | plus a full bot round, three bots at once, five rounds; S1 first after the quality gates | approved | Auto-decision (Claude 2, Codex 3), principle 5. Not placed before the quality gates: owner's rule |
| C-EXP-ORDER (0.5) | Place of extensions E1, E2, E4, E14 | in M2 and M3 mixed in with the core | keep in the plan after the "First game" gate; the voices' alternative: move to `TODOS.md` | approved | Taste auto-decision, principle 2; shown at the final gate, the owner may remove any of them |
| C-EQMOVE (0.5) | Panorama movement for bots | setting for humans only | a shared setting for humans and bots | approved | Auto-decision, principle 5 (Codex 6) |
| C-PREWARM (0.5) | Moment of harness launch | in `ROUND_ACTIVE` | in `ROUND_LOADING`, the first `observe()` is delayed until the round starts | approved | Auto-decision, principle 3 (Claude 12) |
| C-S4 (0.5) | Survey of open-source clones | not conducted | a one-hour spike S4 with license checks | approved | Auto-decision, principle 6 (Claude 11) |
| C-DIRECT-API (0.5) | Bots via the direct model API; owner's requirement 5 | harnesses and subscriptions | direct API calls | declined | Taste: remark of one voice (Claude 7), contradicts the owner's direct request for subscriptions. Shown at the gate as a reference |
| C-DEADLINE (0.5) | Fixed bot deadline | three cut-off moments and a waiting window | a single fixed deadline | declined | Taste: remark of one voice (Claude 12); the rules are already set and covered by tests, an early end of the round is needed for pacing |
| C-SUBTERMS (0.5) | Harness subscription terms when launched from the game | not verified | verify against each provider's terms text | unresolved | Remark of one voice (Claude 5). The modes `codex exec`, `claude -p`, `agy -p` are standard non-interactive; the terms texts were not read. Shown to the owner at the gate; shared subscription limits are recorded as a residual risk |
| C-R1 (sections 1 and 2) | Failures during a match | not described | stop preparation on key rejection; 403 and 429 as a cap; truncation of the explanation; reason when there is no guess; tunnel restart; seat by nickname; local file versions; `client_error`; harness version check | approved | Auto-decision, principle 1: rules in the item "Failures during a match" |
| C-R4 (section 4) | Event order and edge cases | not described | phase check after waits; turn and quota reserve; marker position on the server; round number in «Дальше» ("Next"); pause with no humans; clock and generator as parameters | approved | Auto-decision, principle 1: rules in the item "Event order and edge cases" |
| C-R3 (section 3) | Secrets and tokens | not described | `.env` outside git with a check; new tokens on every `start`; mask in the log | approved | Auto-decision, principle 1 |
| C-R5 (section 5) | Size limits for `spikes/` | exemption from limits | exemption removed | approved | Owner's rule: an exemption from limits requires his agreement; auto-decision in favor of the rule |
| C-R8 (section 8) | Server and bot log | not described | events in `logs/<date>.jsonl`, 14 days, one line per round in the terminal | approved | Auto-decision, principle 1 |
| C-HOSTDROP (section 1) | Host disconnect mid-match | auto-transitions | not chosen | unresolved | Not blocking; owner of the choice: engineering phase |
| C-BUILD (section 9) | Whether `start` builds the client itself | not stated | not chosen | unresolved | Not blocking; owner of the choice: DX phase |
| C-UI (section 11) | Visual language, narrow screens, invite button in the lobby | not described | not chosen | unresolved | Not blocking; owner of the choice: design phase |

Approval readiness: PASS. Rows checked: C-MODE, C-APPROACH, C-E1, C-E2, C-E4, C-E14, C-D1…C-D5, C-X1…C-X5, C-F1…C-F15, C-PRESET, C-MOVE, C-GATE1, C-S1FULL, C-EXP-ORDER, C-EQMOVE, C-PREWARM, C-S4, C-R1, C-R3, C-R4, C-R5, C-R8: for each, the basis is an `/autoplan` auto-decision under a named principle or an owner rule, and the plan contains only its scope. The rows C-MAP, C-TOS, C-REMOTE, C-SUBTERMS, C-HOSTDROP, C-BUILD, C-UI remain unresolved: the plan keeps the owner's original design, and no changes have been applied for them.

#### 0A. Premise check

The real problem: three people find it boring to play, they need additional opponents. Goal: a game night for 6 participants without looking for new people. Cost of inaction: everything stays as is, playing as three. The plan addresses the pain directly: it adds opponents, not a surrogate such as a "play against records mode".

Premises that may turn out to be wrong:

1. The bots will turn out to be interesting opponents, neither too strong nor too weak. Checked by the "First game" gate (C-GATE1); strength tuning (C-E1) and the "Humans vs AI" score (C-E2) come after it.
2. The harnesses manage to answer within a round. Not verified, closed by spike S1 with an explicit criterion (C-F4).
3. Images from the MCP tool reach the model in every harness. Not verified, spike S1.
4. Google's terms allow such a game. Checked against the text on 2026-11-13 and not confirmed: clause 3.2.3(e) forbids Street View and a non-Google map on one screen, clauses 3.2.3(a) and 3.2.3(c)(vii) forbid taking imagery outside Google services and using it to improve AI models. This is the only risk that can take away an irreplaceable dependency: Google may disable the key or the project. Raised at the gate as two User Challenges (C-MAP, C-TOS).
5. The owner understands "turn" the same way as the plan. Raised at the gate (C-MOVE).

After reading Google's terms, premise 4 in its original form is wrong; it was raised at the final gate as two User Challenges, and until the owner decides the plan keeps his design. The other premises are accepted.

#### 0B. What already exists and reality lines

There is no code, so there is nothing to reuse inside the repository. Outside the repository the plan relies on ready-made pieces: `cloudflared` (tunnel), three CLI harnesses (model execution), Maps JavaScript API and Street View Static API (panoramas), MapLibre GL and OpenFreeMap (map), Bun's built-in WebSocket and HTTP server, Svelte animations. An own build instead of a clone fork: the clones have no server model of "one host, a link with a token, bots via local CLIs", and reworking someone else's state and protocol into an authoritative server is more work than writing five screens from scratch.

Premise table:

| Premise | Claim | Receipt | Verdict |
|---|---|---|---|
| P1 | Three players is boring, opponents are needed | `PLAN.md:9` (the owner's words) | accepted |
| P2 | The tools are installed, versions are named | `PLAN.md:30` | verified |
| P3 | `codex` and `claude` are signed in to subscriptions | `PLAN.md:31` | verified |
| P4 | `agy` is not signed in | `PLAN.md:32` | verified |
| P5 | The CLI flags exist | `PLAN.md:33` | verified via `--help` |
| P6 | Google free volume | `PLAN.md:36` | unverified |
| P7 | WebSocket passes through a quick tunnel | `PLAN.md:37` | verified live |
| P8 | Images from MCP reach the model | `PLAN.md:39` | unverified |
| P9 | A harness turn fits into a round | `PLAN.md:39` | unverified |
| P10 | Google's terms allow laying out and passing on the imagery | `PLAN.md:39` | verified against the text: they do not allow it (3.2.3(a), 3.2.3(c)(vii), 3.2.3(e)) |
| P11 | The constant `D` in the scoring formula | `PLAN.md:74` | unverified |
| P12 | `agy --settings` accepts MCP for a single run | `PLAN.md:123` | unverified |
| P13 | The models play at the level of strong players | market review above, `PLAN.md:300` | unverified |
| P14 | Harness subscriptions allow launching from the game and withstand three bots at once | `PLAN.md:355` | unverified |

Recalculation of the number from section 6: Static images per match in the worst case `5 × (12 + 3 × (6 + 3) × 4) = 600` [estimated], where `12` is up to three sets of starting images and `+ 3` are the bot's free failed calls per round; the 80% cap of the free volume equals `8000` [estimated]; `8000 / 600 = 13.3`, that is 13 matches; without the cap `10000 / 600 = 16.7`, that is 16. With a 4-turn limit (the new slot's value): `5 × (12 + 3 × 7 × 4) = 480`, `8000 / 480 = 16.7`, that is 16 matches. The plan said 380 images and 26 matches at the active cap; corrected by the edit record.

REALITY: premise-table finding 14 premises, unverified=7; all seven are closed by M0 spikes or raised at the gate; premise P10 was checked and not confirmed PLAN.md:39
REALITY: already-done pass repository without commits and without a remote, no previously completed work PLAN.md:5
REALITY: surface-check pass the flags `codex exec`, `claude -p`, `agy -p`, `cloudflared tunnel --url` were checked against `--help`; passing MCP via `agy --settings` remains for spike S1 PLAN.md:119
REALITY: binding-decisions pass there is no Binding decisions section in the plan, no recorded decisions for the branch PLAN.md:13
REALITY: numbers finding the number of matches per month was recalculated with the cap and corrected [estimated] PLAN.md:147
REALITY: deferred-asks pass no related task; all ten owner requirements remain in the plan PLAN.md:15
REALITY: pr-count pass there is no ship-policy file, the default applies: one PR per wave PLAN.md:193

#### 0C. Dream map

```
  NOW                           THIS PLAN                          IN 12 MONTHS
  Three people play regular --> Own game for 3 humans + 3 AIs, --> A permanent game night: match
  GeoGuessr, it is boring       link with a token, bots via        history, a hall of fame of humans and
                                subscriptions, explanations,       models, custom point lists, sounds,
                                handicap, "Humans vs AI" score     phone, a match survives a restart
```

The plan moves toward the ideal: everything deferred (`TODOS.md`) is built on top of the same server, protocol and `matches.jsonl` file without rework.

#### 0D. Alternatives

| | A. Own build (the plan) | B. Fork of an open-source clone | C. External hosting instead of a tunnel |
|---|---|---|---|
| Requirements 1–10 | covers all | no bots via local CLIs, no "host + link" model | violates requirement 2 and breaks access to local subscriptions |
| Scope | 5 screens, server, MCP layer | studying someone else's code + the same bots | the same code + deployment |
| Risk | spike S1 | licenses not checked | harness subscriptions are bound to the owner's machine |

Choice: A. B and C do not satisfy the requirements, so no question to the owner is needed. Within A the bot loop runs in a single harness session via MCP; the fallback (the server runs the loop itself and calls the CLI for each turn with attached files) is left to the decision of spike S1. Two additions after two voices. Direct model API calls instead of harnesses (C-DIRECT-API) were not accepted: the owner explicitly asked for subscriptions, and this option does not remove the conflict with Google's terms. An hour for surveying open-source clones was added as spike S4: the fork decision is made from its report, by default an own build.

#### 0E. Mode

SELECTIVE EXPANSION, set by the `/autoplan` rules. The mode handoff was done (`gstack-ceo-mode-handoff`), the message to chat was sent. Scope estimate: about 60 new files (estimate), a project from scratch.

#### 0F and 0G. Expansions

HOLD SCOPE checks. Complexity: there are many parts, but each corresponds to an owner requirement; there is nothing to remove. Minimum for the goal: everything from sections 4–7 is needed for the first match with bots. The invariants (answer secrecy, authoritative server, bot isolation) are preserved. Nothing was deferred from the original scope.

The 10x vision: a game where the contest between humans and models is what is interesting, not just filled slots.

| No. | Proposal | What the player will feel | Scope | Risk | Decision | Why |
|---|---|---|---|---|---|---|
| E1 | Bot handicap: image size, time budget, three difficulty presets | A bot can be made equal to yourself | S | low | ACCEPTED | Hypothesis (P13, not verified): strong models otherwise win every match; the setting is cheap, measured in spike S1 |
| E2 | "Humans vs AI" score | A shared goal for three friends | S | low | ACCEPTED | A pure function and one interface line |
| E4 | Persona (4 presets or custom text) and a short bot quip | Bots feel like players | M | low | ACCEPTED | Touches the `submit_guess` schema, the prompt, the slot editor, the results screen and tests; the estimate was raised from S to M after checking the specification |
| E14 | `--public-url` flag | Works without a quick tunnel too | S | low | ACCEPTED | Quick tunnel has no guarantees, the address changes at every launch |
| D1 | Sounds | Stronger emotion | S | low | DEFERRED | Not needed for the first match |
| D2 | History screen and hall of fame | You can see who is stronger over a month | M | low | DEFERRED | The data is already written, the screen comes later |
| D3 | Custom point lists | Themed matches | M | low | DEFERRED | A separate source of points, outside the first version |
| D4 | Recovery after restart | A match is not lost | M | medium | DEFERRED | A deliberate simplification of the first version |
| D5 | Mobile layout | Playing from a phone | M | medium | DEFERRED | The owner did not ask for it |
| X1 | Bot thought feed during a round | You can see how the bot thinks | M | high | SKIPPED | Hints the answer to humans |
| X2 | Replay of a human's turn | Review of someone else's game | M | low | SKIPPED | Not needed for the goal |
| X3 | Speed bonus and streaks | More excitement | S | medium | SKIPPED | Changes the rule "the highest sum of points wins" |
| X4 | AI hints to humans | Learning | M | medium | SKIPPED | A different product |
| X5 | Spectator link | You can watch without playing | S | low | SKIPPED | Late joining already gives a spectator mode |

Total: 14 proposed, 4 accepted, 5 deferred, 5 skipped. The skipped extensions are labeled X1–X5 so they are not confused with spikes S1–S4. The owner did not ask for extensions E1, E4 and E14: all four accepted ones are shown to him at the final gate, and he may remove any. After two voices all four are placed after the "First game" gate (E1, E2, E4 in M2, E14 in M3): both voices advised not building them before the first real match.

#### Commitments accepted in the CEO phase

<!-- autoplan-accepted:ceo -->
- **Owner decisions before code.** Milestone M0; refines sections 6, 10 and 12.
  - Map for the answer. Clause 3.2.3(e) of Google's terms forbids Street View and a non-Google map on one screen. Options: Google Maps JS for the minimap and the results map (no conflict, the same browser key, map usage is checked by spike S3) or MapLibre GL JS with OpenFreeMap, as in section 6 (the conflict remains, the owner accepts the risk). Until the owner decides, the plan applies his original option.
  - AI on Google imagery. Clauses 3.2.3(a) and 3.2.3(c)(vii) forbid taking imagery outside Google services and using it to improve AI models. Options: keep the owner's design with the measures below (risk: Google may disable the key or the project); give the bots imagery from another source near the same point; play without AI. Until the owner decides, the plan applies his original design.
  - Measures if the design is kept: imagery is not written to disk outside `file` mode; the README asks the owner to disable the use of his data for model training in the harness accounts where such a setting exists.
  - A private remote for CI: create one or work with `pre-commit`.
  - `GuessMap` and `ResultsMap` are written right away for the chosen map, without a substitution layer. The map and bot tasks in M1 wait for the first two decisions; if AI is abandoned, milestone M1 is built without bots, and the "First game" gate is held without them.
  - The interpretation of a turn is fixed in section 5.1 and requires no separate decision.
- **Spike S1: a full bot round before feature code.** Milestone M0; refines sections 5 and 10.
  - S1 goes first after the quality gates and is written as throwaway code in `spikes/` (not part of the build, deleted after M1; the quality gates and size limits apply to it too).
  - Composition: a vision check on an image with a number; one full bot round via MCP (four starting images with captions, `look`, `move`, `submit_guess` with an explanation); three bots at once on one subscription; five rounds in a row.
  - Images: until the Google keys are ready (spike S3), our own street photos are used; after Street View Static API is enabled the round is repeated on real imagery.
  - A harness is admitted to the game if everything holds: the model correctly names the number from the image in at least one delivery mode (`mcp` or `file`); the MCP config is passed for a single run without changing global settings; cold start plus the first guess fit into 60 s (640 px image, low effort); with three bots at once, a guess is recorded in at least 4 of 5 rounds for each.
  - A harness that does not pass the criterion is hidden from the choice in the first version, `doctor` names the reason, and no adapter is written for it.
  - A saved slot with an unavailable harness (hidden by S1, not installed, or not signed in to a subscription) loads disabled with a visible reason and does not take part in the match until the host picks another harness. Test: a unit test for loading such a slot.
  - If no harness passes the criterion, work on bots stops until the owner decides.
- **"First game" gate.** Milestone M1; refines section 10.
  - After M1 the owner plays a match with friends: 5 rounds of 120 s, three bots at once on a harness that passed S1 (two with a 4-turn limit, the third with 0, to see whether turns help).
  - The server writes to `matches.jsonl` for each bot and round: whether there was a guess before the cut-off, time to the first and to the last guess, number of turns, score, the reason for finishing; for each round: how many seconds the humans waited for the bots after their last answer.
  - The "playable" criterion: for each bot a guess is recorded in at least 4 of 5 rounds; the average wait of humans after the last answer is at most 30 s. If the criterion is not met, the defaults are adjusted (round duration, turn limit, effort, waiting window) and the match is repeated.
  - The owner writes the answers to three questions into `docs/playtest-1.md`: does he want to play more; what was most interesting (the score, the AI's mistakes, the explanations); how many rounds were boring because of the location.
  - From this data the owner confirms or changes the composition of M2–M4. If there are more than 2 boring locations out of 5, the task "verified list of points" is added to M2 (currently deferred in `TODOS.md`).
- **Equal movement rules.** Milestone M1; refines sections 4.2 and 5.1.
  - The "Panorama movement" setting is shared: if it is off, `move` returns to the bot «движение выключено в этой партии» ("movement is disabled in this match") without deducting a turn, and the bot's prompt warns about this.
  - Test: a unit test for `move` with movement disabled.
- **Bot time and round duration.** Milestone M1; refines sections 4.2 and 4.3.
  - If the match has at least one AI, the minimum round duration is 60 s: when the first bot is added, a shorter round is raised to 60 s with a visible message, and the duration field does not allow setting less while the match has a bot.
  - The harness process is started in `ROUND_LOADING`, during the countdown, so that a cold start does not eat into round time. The server delays the first `observe()` response until the start of `ROUND_ACTIVE`: the bot does not see images before the humans do.
  - The bot's time budget in M1 equals the round duration; a separate field appears in M2. The budget clock runs from the start of `ROUND_ACTIVE`.
  - The bot is cut off at the earliest of three moments: the end of the round timer; the end of its time budget; the end of the waiting window after all humans have answered. In all three cases its last recorded guess is counted.
  - Waiting window: if all humans have answered and the bots are still working, the round lasts another 20 s (lobby field "AI wait after human answers", 0–120 s, default 20, stored in `settings.json`), but not less than until the 60th second of the round and not longer than the round timer. During this time humans are shown «ИИ думают» ("AIs are thinking") with a countdown.
  - The round ends early when all humans have confirmed their answer with the «Угадать» ("Guess") button and the processes of all bots have finished. An unconfirmed marker does not trigger an early end, but at the end of the timer it is counted as an answer.
  - Tests: unit tests for the state machine (humans answered early, bot finished early, bot did not finish, 60 s round, adding a bot with a 30 s round, unconfirmed marker at the end of the timer, `observe()` before the start of `ROUND_ACTIVE`).
- **AI slot in M1 and bot difficulty in M2.** Milestones M1 and M2; refines sections 4.2 and 5.2.
  - In M1 the slot has a name, color, model, effort and turn limit (default 4). The image is 640 px, the time budget equals the round duration. The settings are shown as numbers, without level names.
  - In M2 the following are added: image size (640, 400 or 256 pixels per side), the bot's time budget per round (from 60 s to the round duration; by default equal to it; if the host makes the round shorter than the budget, the round duration applies) and three presets that fill the image size, turn limit and effort all at once.
  - Preliminary preset numbers: «Новичок» ("Novice") (256 px, 2 turns, low effort), «Любитель» ("Amateur") (400 px, 4 turns, low effort), «Мастер» ("Master") (640 px, 6 turns, medium effort). Before implementation they are reconciled with the first game's data: a preset gets a level name only if its result in the recorded matches differs from its neighbor's.
  - After a manual edit of the image size, turn limit or effort, the preset caption changes to «Свои настройки» ("Custom settings"); name, color, persona and time budget do not change the caption. Each adapter translates the effort levels "low / medium / high" into the values of its harness.
  - The image is always requested from Google at 640x640; a smaller size is obtained by downscaling on the server (`sharp`), and the compass-direction caption is stamped after downscaling in a font no smaller than 14 px. Quota consumption does not depend on size.
  - The lobby shows a warning at the slot if the time from «Проверить» ("Check") (cold start plus an answer at the slot's current settings) is more than half of the bot's time budget.
  - Tests: unit tests for applying a preset and the «Свои настройки» caption, for downscaling an image to the slot size, for cut-off by time budget.
- **"Humans vs AI" score.** Milestone M2; refines sections 4.5 and 4.6.
  - Shown on the round results screen and in the final if the match has at least one human and at least one AI; otherwise the line is hidden.
  - A side's value for a round: the arithmetic mean of the scores of the side's participants who played that round. Spectators and those who joined mid-round are not counted. A human who played but did not answer, and a bot without a recorded guess, are counted with 0 points.
  - A side's value for the match: the sum of its per-round values.
  - Computed by a pure function in `shared/`. Tests: different numbers of participants, zero scores, late joining, a bot without a guess, the absence of one side.
- **Bot persona and quip.** Milestone M2; refines sections 4.2, 4.5 and 5.1.
  - The AI slot has a "persona" field: a preset (neutral, braggart, modest, scholar) or the host's own text of up to 200 characters without line breaks. It is inserted as a single marked line into the prompt and affects only the tone of the explanation and the quip; limits and the toolset are set by the server, and the persona text cannot change them. The preset names in the interface are «нейтральный» ("neutral"), «хвастун» ("braggart"), «скромник» ("modest"), «учёный» ("scholar").
  - `submit_guess` gets an optional `quip` field (up to 120 characters, in the interface language). The last successful `submit_guess` call is counted as a whole: coordinates, explanation and quip; if the quip is absent from it, no quip is shown. In M1 the `quip` field is already in the schema but is not shown.
  - The quip is shown next to the bot's marker on the results screen and in the AI card, rendered as plain text, does not affect scores and is visible only after the end of the round.
  - Tests: a too-long quip is truncated to the limit, a persona with a line break is rejected by the schema; of two calls the last is taken; an integration scenario with a fake harness shows the quip only on the results screen.
- **Login and readiness of the invitation link.** Milestone M1; refines sections 4.1, 7 and 9.
  - In all modes the game server listens only on `127.0.0.1`. The token contains 128 bits of randomness and is compared in constant time.
  - The server serves `GET /healthz`: without a token, the response is `ok`, with no game data.
  - The invitation link is printed after two checks: the host name resolves through public DNS (a DoH request to `cloudflare-dns.com`, on error to `dns.google`; the local resolver is not used) and `GET /healthz` at the public address returns 200. Wait up to 60 s, then an error with the cause (DNS or HTTP) and advice to restart `start`.
  - When the tunnel address changes, the checks are repeated and the link is printed again. With `--no-tunnel` there are no checks.
  - The host's link is always local: `http://localhost:PORT/#t=<host token>`.
  - Tests: unit tests with substituted DNS and HTTP (success, delay, refusal, address change); `bun run test:tunnel` checks live.
- **Own public address and login thresholds.** Milestone M3; refines sections 6, 7 and 9.
  - `bun run start --public-url <https://address>` does not launch `cloudflared`, but builds the invitation link from the given address and runs the same readiness checks for it. The own tunnel or proxy must run on the same machine. The flags `--public-url` and `--no-tunnel` together give a launch error with an explanation.
  - The README and `bun run doctor --public-url <https://address>` remind you to add this address to the referrer restriction of the browser key; `doctor` prints the exact string for the Cloud Console.
  - Client address: in quick tunnel mode it is taken from `CF-Connecting-IP`; in other modes and when the header is absent, from the socket address. The server does not trust headers from a foreign proxy. A connection from a loopback address without the header is considered local and does not take part in the per-address threshold; therefore with `--public-url` only the global threshold applies.
  - The token is checked on every connection; a login with the correct token is not blocked by any threshold. The thresholds apply only to failed attempts.
  - More than 10 failed logins from one address in 60 s: for the next 60 s failed attempts from that address are closed without a response and without a log entry.
  - More than 30 failed logins in 60 s across the whole server: until the end of the minute all failed attempts are closed the same way.
  - Tests: unit tests for flag parsing, link building, choice of client address (header present, header absent, loopback), both thresholds, and a login with the correct token when the thresholds have been reached.
- **Static API errors.** Milestone M1; refines sections 5.1, 5.2 and 6.
  - All image requests go with `return_error_code=true`: when there is no imagery, Google responds with HTTP 404 rather than a gray placeholder.
  - The unit for counting failures is a tool call. `look` fails if its image was not received. `move` fails if none of the four images was received; if at least one was received, the call succeeds, and instead of the missing ones the bot gets the text «снимка в этом направлении нет» ("there is no imagery in this direction").
  - The first 3 failed bot calls per round do not deduct a turn; starting from the fourth, a failed call costs a turn. The `move` response «в эту сторону дороги нет» ("there is no road in this direction") is still free and is not counted in this number: it requests no images.
  - Tests: unit tests with a substituted 404 response (turn not deducted, the fourth failure deducted, partially successful `move`).
- **Round preparation failures.** Milestone M1; refines sections 4.3, 5.1 and 6.
  - Point: if 30 attempts did not find a panorama, the server repeats the series for another country, up to 3 series in total. After the third failure the round does not start: the host sees the error «панорама не найдена» ("panorama not found") and the buttons «Повторить» ("Retry") and «Завершить партию» ("End match"); the rounds already played are saved.
  - Starting images: if at least one of the four was not received, the server takes a new point, up to 3 points in total; after that the same rule applies as for a point. Failed requests go into the quota counter.
  - Preparation runs in advance, while the lobby or the results screen is open, so players do not see the retries.
  - A human's panorama loading: after 5 s of waiting the countdown starts for everyone; the late player's timer is the shared one. If the panorama did not load on the client, they see a message and a «Повторить» button, and the answer map stays available.
  - `observe()` returns the stored starting set and makes no requests to the Static API.
  - Tests: unit tests for the three sampling series and point replacement on a failed starting image; an integration test for the countdown starting without the late client.
- **Quota accounting.** Milestone M1 (Static counter, cap, pre-start check) and M3 (panoramas); refines section 6.
  - The application cap is an estimate of consumption, not a billing guarantee. The real limit is set by the daily quotas in the Cloud Console: the README and `doctor` give steps on which quotas to set, per the S3 spike report. The referrer restriction `*.trycloudflare.com/*` protects the browser key only weakly (the domain is shared), and the README says so plainly.
  - Static: the counter in `quota.json`, the cap and the pre-start check appear in M1, before the first real request to the Static API. The counter grows with every request, including a failed one and round-preparation requests, and is incremented before the request is sent, so parallel calls do not get through above the cap. A repeated request for an image with the same parameters within a round is taken from memory and does not go into the counter.
  - Panoramas (M3): the client sends the server `pano_loaded` after each panorama display (every round, page reload, reconnection, spectator); the counter grows with each such message. This is an upper-bound estimate: Google may bill only the creation of the panorama object; the billing unit is verified by spike S3.
  - Before the match starts the server computes the worst case: Static = rounds × (12 + sum over bots (turn limit + 3) × 4), where 12 is up to three sets of starting images; panoramas = rounds × number of humans × 2. If current consumption plus the worst case exceeds the cap, the match does not start; the lobby shows the consumption, the worst case and the remainder, and the host reduces the number of rounds, bots or turns.
  - If the Static cap is nevertheless reached mid-match, `look` and `move` return to the bot «квота исчерпана, вызови submit_guess» ("quota exhausted, call submit_guess") without deducting a turn, and the match is played to the end. If the panorama cap is reached, the current match is played to the end and a new one does not start.
  - Tests: unit tests for the worst-case computation, start refusal, the «квота исчерпана» response, counter growth from `pano_loaded`.
- **Bot process isolation.** Milestones M0 (spike S1) and M1; refines sections 5.3 and 5.4.
  - The harness process is launched with an environment from an allowlist (`PATH`, `HOME`, `LANG`, `TERM` and the variables without which the harness does not sign in to the subscription). The Google keys and the contents of `.env` do not get into it. The bot's working directory: an empty temporary directory outside the repository.
  - The harness runs as the owner and reads its login files from `HOME`, so reading other files is closed off by the harness's own flags: for `claude` these are `--allowedTools "mcp__geo__*"` and `--strict-mcp-config`; for `codex` and `agy` the set of flags is determined by spike S1 (in the `agy` help there is only `--sandbox`).
  - For each harness, spike S1 checks with the chosen flags: the model cannot name the contents of a test file outside the temporary directory; web search and command execution are unavailable. The result is recorded in the report.
  - The harness's user settings from `HOME` (global instructions, hooks, plugins, memory) are disabled by the adapter with flags, if the harness has them. Spike S1 records that disabling succeeded, and how what remains affects response time and the toolset.
  - A harness that could not be restricted is not hidden automatically: the decision on its admission is made by the owner from the S1 report, and `doctor` shows a note next to it: «читает файлы владельца» ("reads the owner's files").
  - The residual risk is accepted for a game among friends: the bot process runs as the owner and, if the flags were bypassed, could read the server's environment and memory. The subscription limits are shared with the owner's everyday work; a match with three bots consumes them.
  - Tests: a unit test for the composition of the bot process environment; the check with the test file is part of `bun run test:harness`.
- **Milestone order.** Milestones M0–M4; refines section 10.
  - M0: quality gates, then spike S1, then S2, S3 and S4. The M1 tasks without a real panorama and without bots (protocol, state machine, lobby, scoring, results) go on stubs right after the quality gates. The tasks with bots wait for S1, the task "real panorama in a round" waits for S3 (both APIs enabled, billing attached).
  - Spike S3 reconciles the free monthly volume with Google's current price table; the default cap of the quota counter is computed from the figures in the S3 report.
  - M2–M4 begin after the "First game" gate; the owner confirms their composition based on its outcome.
  - The error states named in this section belong to the milestone where their rule is named; milestone M4 polishes their appearance, it does not add them.
- **Snapshot storage.** Milestone M1; refines sections 4.5 and 5.4.
  - The bot's full-size images live only until the end of the round. For the AI card the server keeps thumbnails in memory (JPEG, 160 px per side, up to 15 KB) until the return to the lobby after the final.
  - The upper bound of memory: an ordinary match (5 rounds, 3 bots, 6 turns) no more than 600 thumbnails, about 9 MB; the maximum (20 rounds, 3 bots, 20 turns) no more than 5,760 thumbnails, about 86 MB.
  - Images reach disk only in the `file` delivery mode, in the bot's temporary directory, which is deleted at the end of the round.
  - Test: an integration test, after the match ends the thumbnails are unavailable and the temporary directory is deleted.
- **Failures during a match.** Milestones M1 and M3; refines sections 4.1, 5.1, 6 and 9.
  - Metadata: a "no panorama" response consumes a sampling attempt. Key rejection, quota exceeded and a network error (request timeout 5 s, one retry) stop round preparation immediately: the host sees the cause and the buttons «Повторить» and «Завершить партию».
  - Static: the responses 403 and 429 are handled as a reached quota cap: `look` and `move` return to the bot «картинки недоступны, вызови submit_guess» ("images unavailable, call submit_guess") without deducting a turn, and the host sees a warning with the cause.
  - Tool arguments are validated by the schema. On error the bot gets text with the field name and permitted values, the turn is not deducted, the previous guess remains. Too-long `explanation` and `quip` are truncated to the limit rather than rejected; an empty `explanation` is rejected.
  - If the bot recorded no guess at all, the AI card shows the reason for finishing and the last 300 characters of the harness's final text as plain text (model refusal, login error, subscription limit).
  - Tunnel: `start` watches the `cloudflared` process. If the process exited, `start` restarts it up to 3 times with pauses of 2, 5 and 10 s, repeats the readiness checks and prints the new link. The match on the server continues meanwhile; after the third failure the host sees an error with the cause.
  - Returning to a seat: to the browser a new tunnel address is a different site, and the saved `playerId` and secret are not there. Therefore participants' nicknames are unique case-insensitively, and a player who joined via a valid invitation with the nickname of a disconnected participant takes their seat. The nickname of a connected participant cannot be taken: the login gets the response «ник занят» ("nickname taken").
  - Local files: `settings.json`, `quota.json` and the lines of `matches.jsonl` carry a `version` field and are checked by a schema. An unreadable `settings.json` or `quota.json` is renamed to a file ending in `.bad`, the server starts with default values (the quota counter from zero) and shows a warning in the terminal and in the host's lobby. A write error of `matches.jsonl` does not interrupt the match and is visible to the host on the final screen.
  - A client's Maps JavaScript API loading error (ad blocker, referrer restriction) goes to the server as a `client_error` message; the host sees a note with the cause next to the player.
  - Harness update (M3, full `doctor`): `bun run test:harness` records the CLI versions it passed with into `~/.config/geoaissr/harness-verified.json`; `doctor` warns if the installed version differs and advises running `bun run test:harness`.
  - Tests: unit tests for metadata key rejection, 403 from Static, wrong tool arguments, explanation truncation, login with the nickname of a disconnected and of a connected participant, unreadable settings and quota files; an integration test for restarting a fake tunnel process.
- **Event order and edge cases.** Milestone M1; refines sections 4.1, 4.3, 5.1 and 7.
  - Neither a guess nor a tool call changes the round's outcome after its end. Each handler checks the round number and phase immediately before changing state, after all the waits (reading the request body, Google's response). A late call gets «раунд окончен» ("round over"), its result is discarded and does not leak into the next round.
  - A turn is reserved before the request to Google and returned if the call is deemed failed by the rules of the item "Static API errors". Therefore parallel calls of one bot do not spend more than the limit.
  - A human's marker: the client sends the server the marker position on every placement, no more than 5 times per second; the server keeps the latest. It is the one counted if the answer is not confirmed by the end of the timer. A repeated press of «Угадать» and a marker change after confirmation are ignored by the server.
  - The longitude of the marker and of the bot's guess is brought to the range from -180 to 180; a latitude outside the range from -90 to 90 is rejected.
  - The host's «Дальше» message carries the round number: a repeated press and a press simultaneous with the auto-transition do not skip a round.
  - Match settings change only in the lobby. The ninth human gets the response «комната полна» ("room full").
  - If no human is connected by the end of the results screen, the next round does not begin until someone returns: bots do not waste quota and subscription.
  - `GameEngine` and `LocationService` receive the clock and the random number generator as parameters; the tests substitute controllable ones.
  - Tests: unit tests with controllable stopping points for both completion orders (a bot's guess and the end of the timer; Google's response and the end of the round; two parallel `look` calls with one turn left); an unconfirmed marker; a repeated «Дальше»; a pause with no humans. Integration scenarios with a fake harness: ordinary, hung, finished before a guess, finished after a guess, with wrong arguments, with parallel calls.
- **Secrets and tokens.** Milestones M0 and M1; refines sections 4.1, 6 and 9.
  - `.env` is added to `.gitignore`; `bun run check` fails if `.env` is tracked by git.
  - The host and invitation tokens are created anew on every `start`. A leaked invitation is revoked by restarting; there is no way for the host to kick players in the first version.
  - Keys and tokens do not get into the log or into error messages; where one token must be distinguished from another, the first 4 characters are shown.
  - Tests: a unit test for token masking in the log; the check for `.env` tracking is part of `bun run check`.
- **Server and bot log.** Milestone M1; refines sections 5.3 and 9.
  - The server writes events as JSON lines to `~/.local/share/geoaissr/logs/<date>.jsonl`: round start and end, participants joining and leaving, launch and completion of each harness (exit code, reason, last stderr lines), each bot tool call (name, duration, outcome), the outcome of requests to Google, the value of the quota counter.
  - The answer coordinates get into the log only after the end of the round. Files for the last 14 days are kept.
  - In the host's terminal one line is printed per round: who answered, which bot was cut off and why.
  - Test: an integration test, after a match with a fake harness the log contains the launch, calls and completion reason of each bot, and no tokens or keys.
<!-- /autoplan-accepted:ceo -->

Edits to the source text (recorded in the `autoplan-baseline-edits:ceo` line at the start of the section): 30 exact replacements. They remove discrepancies between the baseline text and the accepted commitments: the cost estimate (C-F1), the tunnel fact line and spike S2 (live WebSocket check), Google's terms (C-MAP, C-TOS), round duration and round end (C-F6), AI slot values (C-PRESET), panorama movement (C-EQMOVE), bot score and unconfirmed marker (C-F9, C-F15), region diagonal and tie-break (C-F10), the `submit_guess` signature (C-E4), the Static request size (C-E1), isolation (C-F13), the referrer restriction and commands (C-E14), the quota counter (C-F11), login protection (C-F12), quality gates (C-F8), the owner-decisions line in M0, spikes S1, S3 and S4 (C-S1FULL, C-S4), the composition of M1, M2, M3 and M4 (C-F5), three rows of the risk table and the heading of section 14.

The deferred items are recorded in `TODOS.md`: «Звуки» ("Sounds"), «Экран истории партий и зал славы» ("Match history screen and hall of fame"), «Свои списки точек» ("Custom point lists"), «Восстановление партии после перезапуска сервера» ("Recovering a match after a server restart"), «Мобильная раскладка» ("Mobile layout").

#### 0H. CEO summary and specification check

Summary: `~/.gstack/projects/tass/ceo-plans/2026-11-13-geoaissr.md`. The specification reviewer was run three times (the limit). First check: 14 remarks, 6/10. Second: 12 new, 6/10. Third: PASS, 7/10, no blocking ones, 8 minor. After the third check all 8 were fixed and reconciled with the plan text without a new run: issues verified: 8 of 8 (these are applied fixes, not the reviewer's verdict). Metrics are recorded in `spec-review.jsonl`: 3 runs, 34 found, 26 confirmed by the reviewer, 8 remaining per the last report.

Document approval (methodology question A/B/C): auto-decision A, both documents reflect the accepted decisions. This is approval of document versions, not of the implementation; the final word belongs to the owner at the final gate.

#### 0I. Time breakdown

```
  HOUR 1 (foundation):  owner decisions (map, consent to passing imagery, remote), Google keys
                        with billing, login to agy; quality gates and directory skeleton; spike reports S1–S4
  HOURS 2-3 (core):     state machine with three bot deadlines, scoring and tie-break, protocol;
                        the rules are set in sections 4 and 14. Not set: what happens when the host disconnects;
                        what a player who returns mid-round sees
  HOURS 4-5 (joining):  delivering images via MCP in each harness, cold start, the harness's user
                        settings, 404 from Static, tunnel DNS delay, the panorama billing unit
  HOUR 6+ (polish):     a fake harness for integration tests, a panorama stub for E2E,
                        a bot work log (what it did, why it was cut off), error states on screens
```

- Feasibility blockers: signing in to `agy` and enabling two Google APIs with billing (owner actions); the outcome of spike S1 is unknown. None prevents approving the plan; S1 has an explicit criterion and a stop rule.
- Choices deferred to the next phases: behavior when the host disconnects and when a player returns mid-round (engineering phase); the bot work log (review section 8); texts of errors and empty states (design phase).
- Effort (estimate): a human team about 3–4 weeks; CC + gstack about 2–3 days of work, accounting for the owner's waiting on spikes.

#### 0.5. Two voices

Both voices read one snapshot of the plan: `autoplan-ceo-JNXIhJ/ceo-implementation.md`, sha256 `f0007b49…be5a`, before the milestone reordering.

- The Claude voice (native subagent, source `in-host`): completed, the line `INPUT: ceo f0007b49…` matched the snapshot. 12 remarks (numbers 1–13, number 6 is absent in the report): 3 critical, 4 high, 5 medium.
- The Codex voice (external CLI, model `gpt-6-astra`, source `codex`): `OUTSIDE_STATUS: completed provider=codex host=claude`, `VERDICT: findings`, `FINDINGS: P1`. 7 remarks: 4 High, 3 Medium. The closing line: «Recommendation: Build and play a thin end-to-end prototype before expanding M1 because the plan has not yet established that concurrent subscription bots produce a feasible, well-paced game the three friends want to repeat.»

| Voice and no. | Severity | Remark | What was done |
|---|---|---|---|
| Claude 1 | critical | The scope of a product, not of a game for three: login thresholds, presets, personas, side score | The milestones were reordered: M1 is the "First game" end-to-end slice; extensions E1, E2, E4, E14 come after it (C-F5, C-EXP-ORDER) |
| Claude 2 | critical | The riskiest assumption (S1) is checked last | S1 goes first after the quality gates and is expanded to a full round (C-S1FULL). Not placed before the quality gates: the owner's rule requires them first |
| Claude 3 | critical | Google's terms are a fact, not a preference; a fallback imagery source is needed | The terms were read, the conflict is recorded in section 3 of the plan; two User Challenges at the final gate (C-MAP, C-TOS) |
| Claude 4 | high | The free-volume figures are not verified; the real limit is in the Cloud Console | Spike S3 reconciles prices; the cap is called an estimate; the Cloud Console daily quotas in the README and `doctor` |
| Claude 5 | high | Subscription CLIs as a game server: subscription terms, shared limits, flag changes | The residual risk and shared limits are recorded; `doctor` compares versions with `test:harness`. Subscription terms were not verified against the text (P14, C-SUBTERMS) |
| Claude 7 | high | Direct model API calls were not considered | Not accepted: the owner explicitly asked for subscriptions (C-DIRECT-API). Shown at the gate as a reference; the first game runs on one harness |
| Claude 8 | medium | There is no data that turns improve the result; a variant without turns is needed | In the "First game" gate match one bot plays with a limit of 0 turns |
| Claude 9 | high | In six months: a polished game that nobody played | The "First game" gate with measurements and three questions (C-GATE1) |
| Claude 10 | medium | Quick tunnel is temporary; a referrer restriction on a shared domain protects almost nothing | The README says so plainly; `--public-url` remains the fallback path |
| Claude 11 | medium | First, an hour to survey open-source clones | Spike S4 (C-S4) |
| Claude 12 | medium | The round-end rules are complex; a 60 s round leaves no time after a cold start | The harness starts in `ROUND_LOADING` (C-PREWARM). A fixed deadline was not accepted (C-DEADLINE) |
| Claude 13 | medium | The bot runs as the owner and, if the flags were bypassed, would read the server's memory | The residual risk is recorded in the item "Bot process isolation" |
| Codex 1 | High | The plan may "succeed" while losing AI; Google's terms are not verified | The terms were read; abandoning AI is a separate owner decision, not a silent fallback (C-TOS) |
| Codex 2 | High | "It's more fun with bots" is not verified | The "First game" gate: three questions to the owner after a real match (C-GATE1) |
| Codex 3 | High | S1 checks a detail, not a game night | S1: three bots at once, five rounds; the gate measures the humans' waiting (C-S1FULL, C-GATE1) |
| Codex 4 | High | The decisive experience is deferred behind a configurable product | Milestone reordering (C-F5) |
| Codex 5 | Medium | Random points do not mean interesting rounds | A question about boring locations at the gate; with more than 2 of 5, "verified point list" enters M2 |
| Codex 6 | Medium | Level names promise a calibration that does not exist; different movement rules | Level names only after the first game's data (C-PRESET); the movement setting is shared (C-EQMOVE) |
| Codex 7 | Medium | A "hard cap" promises more than it counts | The cap is called an estimate; repeated starting sets enter the worst case; the counter grows before the request is sent (C-F1, C-F11) |

```
CEO DUAL VOICES — CONSENSUS TABLE:
  Dimension                              Claude                     Codex                      Consensus
  1. Premises valid?                     no (Google terms,          no (Google terms,          CONFIRMED: key premises
                                         harness pace)              "more fun with bots")      are not verified
  2. Right problem to solve?             yes, but the slice must    yes, but a trial           CONFIRMED: the task is right,
                                         be thinner                 match first                proof before scope
  3. Scope calibration correct?          no, critical               no, High                   CONFIRMED: the first milestone is big,
                                                                                               extensions are premature
  4. Alternatives sufficiently explored? no (direct API,            partially (own pool        DISAGREE: taste decision,
                                         clone fork)                of points)                 see C-DIRECT-API, C-S4
  5. Competitive/market risks covered?   yes, low risk              did not assess             one voice [subagent-only]
  6. 6-month trajectory sound?           no: a game nobody          no: the decisive           CONFIRMED: a match with friends
                                         played                     experience is deferred     is needed before polishing
CONFIRMED = completed subagent + outside; primary cannot replace outside.
```

Critical remarks from one voice: Claude 1, 2 and 3 are marked critical only by Claude, but in substance coincide with Codex 4, 3 and 1; there is no disagreement here.

Decisions following the voices:

- Mechanical (applied): milestone reordering and the "First game" gate; the S1 expansion; a shared movement setting; launching the harness during the countdown; spike S4; the cap as an estimate; recording the residual risk.
- Taste (shown at the final gate): extensions E1, E2, E4, E14 were left in the plan after the "First game" gate, although both voices advise not building them before the first match (C-EXP-ORDER); direct API not accepted (C-DIRECT-API); a fixed bot deadline not accepted (C-DEADLINE).
- User Challenge (not auto-decided, the plan keeps the owner's original design):
  - UC-1, map for the answer (C-MAP). The owner said: «карту можно бесплатную типа OSM» ("the map can be a free one like OSM"). Google Maps JS is proposed. Why: clause 3.2.3(e) of Google's terms forbids Street View and a non-Google map on one screen. What the models may not know: how important a non-Google map is to the owner and whether he is willing to accept the risk for a private game. Cost of error: Google may disable the key or the project, and the game is left without panoramas; replacing the map after the code is written means rewriting two components.
  - UC-2, AI on Google imagery (C-TOS). The owner said: the AI receives screenshots of the Google panorama from different directions. Options for change: imagery from another source for bots, or a game without AI. Why: clauses 3.2.3(a) and 3.2.3(c)(vii) forbid taking imagery outside Google services and using it to improve AI models; subscriptions may train on submitted data unless that is disabled. What the models may not know: the owner's readiness to accept the risk for a game among three friends. Cost of error: disabling of the Google key or project. Cost of change: imagery from another source does not match what the humans see and covers fewer places; without AI the point of the project disappears.

#### Review sections 1–11

Current scope before section 1. Mode SELECTIVE EXPANSION (C-MODE). Accepted: own build (C-APPROACH); fixes C-F1…C-F15; milestone order and the "First game" gate (C-F5, C-GATE1, C-S1FULL); extensions C-E1, C-E2, C-E4, C-E14 after the gate. Deferred: C-D1…C-D5 (`TODOS.md`). Declined: C-X1…C-X5, C-DIRECT-API, C-DEADLINE. Waiting for the owner: C-MAP, C-TOS, C-REMOTE.

##### Section 1. Architecture

Checked: component boundaries, data flows, the state machine, coupling, failure points, access surfaces and rollback.

```
  [player's browser] ──WSS, invitation token──┐
  [host's browser]   ──WS localhost, host token┤         trust boundary: everything on the left is untrusted
                                               v
  cloudflared ──> game server 127.0.0.1:PORT ──┬─ static web/dist (no secrets)
                    │  GET /healthz (no token)  ├─ WebSocket /ws ─> schema ─> GameEngine (one room)
                    │                           ├─ LocationService ──> Google metadata (server key)
                    │                           ├─ BotImageService ──> Google Static ──> sharp
                    │                           └─ BotRunner ──spawn──> harness (allowlisted environment)
                    │                                                     └─ MCP stdio: bot-tools
                    └─ bot API 127.0.0.1:BOT_PORT <── HTTP + per-round bot token ──┘
  owner's files: settings.json, quota.json, matches.jsonl, logs/*.jsonl, harness-verified.json
```

```
            «Старт» (host)          all loaded or 5 s              timer | humans confirmed and bots finished
  LOBBY ─────────────────> ROUND_LOADING ───────────────> ROUND_ACTIVE ─────────────────> ROUND_RESULTS
    ^                         │ preparation failure:                                          │ host «Дальше»  
    │                         │ host «Повторить» (we stay) | «Завершить партию» ─> FINAL      │                                  
    │                                                                                         v
    └──────────── «Ещё раз» ──────────── FINAL <──── rounds are over ──── another round ──> ROUND_LOADING
  Forbidden and rejected by a single transition function: LOBBY→ROUND_ACTIVE, ROUND_ACTIVE→LOBBY,
  ROUND_RESULTS→ROUND_ACTIVE, a guess or tool call outside ROUND_ACTIVE, a settings change outside LOBBY.
```

Four paths of the "guess" flow: ordinary (marker, confirmation, score); empty (no marker, 0 points); missing (the player disconnected: the last marker remains on the server); erroneous (the message failed the schema or arrived after the end of the round: refused with a cause, the state does not change).

- Coupling: the server depends on the three CLIs only through adapters of one file each; the client depends on the Maps JavaScript API only through `PanoView`. The choice of map (C-MAP) determines `GuessMap` and `ResultsMap`; no substitution layer is built.
- Load: there is one room, up to 8 humans and 3 bots. What runs out first is not the processor but the Static quota and the subscription limit; both have a cap and a pre-start check.
- Failure points: the owner's machine, quick tunnel, the Google key, the harness subscription. Accepted as properties of a game run "from the owner's machine".
- Rollback: the application is local, rollback is returning to the previous git tag and restarting (minutes).
- Artifacts about the work: reports in `docs/spikes/` (they decide harness admission, not needed after M1), `docs/playtest-1.md` (the owner confirms M2–M4 from it). Both have a consumer and a lifetime.
- **WARNING 1.1.** Local files without a format version: an old or corrupt `settings.json` or `quota.json` would break startup. Decided: a `version` field, schema validation, a `.bad` file and default values (item "Failures during a match").
- **WARNING 1.2.** Behavior when the host disconnects is not set. The auto-transition after 30 s and the shared timer cover the rounds; the choice of who presses «Ещё раз» ("Play again") and «Повторить» remains. Not blocking; owner of the choice: engineering phase.

##### Section 2. Error and rescue map

Depth: implementation readiness at the level of the plan's components (there are no methods yet). The full table is in the register below. 7 gaps were found, all closed by the rules of the item "Failures during a match":

- **GAP 2.1.** Key rejection or the network on a metadata request would burn 90 attempts. Now preparation stops immediately with a cause.
- **GAP 2.2.** Responses 403 and 429 from Static mid-match. Now this is the "images unavailable" path.
- **GAP 2.3.** An explanation longer than 600 characters was rejected, and the bot's only guess could be lost. Now it is truncated.
- **GAP 2.4.** A bot without a guess stayed silent. Now the card shows the cause and the tail of the harness text (including a model refusal).
- **GAP 2.5.** `cloudflared` exiting mid-match and a player losing their seat at the new address. Now restart and login by the nickname of the disconnected participant.
- **GAP 2.6.** Unreadable local files (see 1.1).
- **GAP 2.7.** A Maps JavaScript API loading error for one player was invisible to the host. Now `client_error`.

For model calls the following are analyzed separately: wrong arguments (error text, turn not deducted), an empty response (no guess, cause in the card), invented coordinates out of range (rejection with the range), a model refusal (cause in the card).

##### Section 3. Security

| Threat | Likelihood | Damage | What the plan has |
|---|---|---|---|
| Leak of the invitation link, a stranger joins | low | low | A 128-bit token in the URL fragment; a new token at every `start`; a limit of 8 humans. No kicking of players (accepted) |
| Theft of the Google browser key from a joined player | low | medium | The referrer restriction is weak (shared domain), stated plainly; the limit is set by the Cloud Console daily quotas |
| The harness reads the owner's files | medium | high | Environment allowlist, harness flags, a check with a test file in S1, admission decided by the owner; the residual risk is recorded |
| Text in an image controls the model | low | low | The bot has only the `geo` tools; the explanation and quip are rendered as plain text |
| A foreign process on the machine calls the bot API | low | low | The port is only on `127.0.0.1`, the bot token is for one round |
| Token brute-forcing | low | low | 128 bits, constant-time comparison, failed-login thresholds (M3) |
| Keys in the repository or log | medium | medium | The item "Secrets and tokens" |
| Peeking at the coordinates via developer tools | high | low | Accepted in section 12 of the plan |

- **WARNING 3.1.** `.env` could end up in git. Decided: `.gitignore` and a check in `bun run check`.
- **WARNING 3.2.** The lifetime of tokens and their writing to the log were not set. Decided: new ones on every `start`, masked in the log.
- **OK 3.3.** There is no kicking of players by the host. Accepted: an invitation is revoked by restarting.

There are no high-severity threats without a measure. Passing imagery to third-party models is a question of Google's terms (UC-2), not of protection.

##### Section 4. Data flows and edge cases

```
  model ─> harness ─> bot-tools (MCP) ─> HTTP 127.0.0.1 ─> schema ─> turn and quota reserve ─> Google Static ─> sharp ─> response
     │          │            │                 │              │              │                    │            │
  model     hang         no token,        round over     wrong fields   turns exhausted,    404, 403, 429,  broken image
  refusal   (deadline)   foreign round    (after a wait) (error text)   quota exhausted     timeout         (failed call)

  map click ─> marker (WS, up to 5 per second) ─> schema ─> phase ROUND_ACTIVE? ─> write ─> «Угадать» ─> confirmation ─> score
  shadows: no marker (0) · message larger than 16 KB (close) · after the end of the round (refusal) · repeat (ignored) · disconnect (marker stays)
```

Order of asynchronous events. Shared state: the round phase, recorded guesses, the turn and quota counters. Invariant: after the end of the round its outcome does not change, and a bot does not spend more than its limit.

```
  submit_guess call          round timer              state
  reads the request body ... fires                    ROUND_ACTIVE -> ROUND_RESULTS
  resumed                    -                        phase check before writing: refusal «раунд окончен»
  (reverse order)            fires after the write    the guess is recorded, counted

  look #1                    look #2 (parallel)       turns left: 1
  reserves a turn            -                        0
  waits for Google           no reserve: refusal      0, «ходы кончились» ("turns exhausted")
```

Mechanism: checking the round number and phase immediately before the change and reserving the turn and quota before the wait. Bun's single-threadedness does not by itself guarantee ordering across `await`, so the rule is written explicitly and verified by tests with stopping points.

| Action | Edge case | Covered? | How |
|---|---|---|---|
| «Угадать» | double press | yes | the repeat is ignored |
| «Угадать» | after the timer ends | yes | refusal; the last marker is counted |
| Marker | not confirmed by the end of the timer | yes, now | the client sends the marker position, the server keeps the last |
| Marker | longitude beyond the 180th meridian | yes, now | brought into range |
| Login | the ninth player | yes, now | «комната полна» |
| Login | nickname taken | yes, now | «ник занят»; the nickname of a disconnected player returns the seat |
| Login | mid-round | yes | a spectator until the next round |
| Login | new tunnel address, empty `localStorage` | yes, now | seat by nickname |
| «Дальше» | double press, race with the auto-transition | yes, now | round number in the message |
| Lobby | settings change mid-match | yes, now | only in the lobby |
| Round | all humans disconnected | yes, now | a pause before the next round |
| Round | the panorama did not load for one player | yes | countdown after 5 s, «Повторить» for the player |
| Bot | parallel tool calls | yes, now | turn reserve |
| Bot | a call after the end of the round | yes, now | «раунд окончен» |
| Bot | a slot with an unavailable harness | yes | loads disabled |
| Host | disconnected mid-match | partially | auto-transitions; the rest is for the engineering phase (1.2) |

16 cases were analyzed; 10 were not covered and are closed by the item "Event order and edge cases" and by login by nickname, one is passed to the engineering phase.

##### Section 5. Code quality

Checked: directory composition, duplication, names, redundancy. There is no code yet, so the design is assessed: `shared/` keeps the protocol, scoring and side score in one place; a harness adapter is one file with one function; the bot cut-off rule is a pure function of three moments.

- **WARNING 5.1.** The throwaway code of spike S1 was exempted from the size limits. That is an exception to the owner's rule on limits, and it requires his agreement. Decided: the exception is removed, the quality gates apply to `spikes/` too.

The redundancy of the extensions was noted by both voices and raised at the gate (C-EXP-ORDER). There are no other remarks.

##### Section 6. Tests

```
  NEW IN THE PLAN                        TEST TYPE                  IN THE PLAN
  scoring formula, tie-break, region D   unit                       yes
  state machine, three cut-off moments   unit, controllable clock   yes (clock as a parameter: added)
  protocol and schemas                   unit                       yes
  point sampling, three series           unit, metadata substitution yes
  Static errors, quota, reserve          unit                       yes
  event order (races)                    unit, stopping points      added
  full match, 2 clients, 3 bots          integration, fake harness and panoramas   yes
  harness failures (6 scenarios)         integration                added
  link readiness, tunnel restart         unit and integration       yes / added
  login, thresholds, seat by nickname    unit                       yes / added
  two browsers, reconnection             E2E Playwright             yes
  real CLIs, test file                   contract, on demand        yes
  real tunnel                            on demand                  yes
  log without secrets                    integration                added
```

- The test you are not afraid to ship with: a full match over a real WebSocket with two clients and three fake bots through all states, with a check of the final scores.
- The hostile-tester test: a guess after the deadline, a 17 KB message, reuse of a bot token from a previous round, login with the nickname of a connected player.
- Chaos: the harness killed mid-round; `cloudflared` exited; Static answers 403 from the third round.
- The pyramid is right: many unit tests, fewer integration tests, one E2E scenario.
- What green tests do not prove: the behavior of real harnesses and models (a fake harness stands in for them; proven by `bun run test:harness`, spike S1 and the "First game" gate); acceptance of requests by Google (a substituted provider; proven by spike S3).
- **WARNING 6.1.** The tests of the state machine and sampling would depend on time and chance. Decided: the clock and generator as parameters.
- **WARNING 6.2.** The failure scenarios of the fake harness were not listed. Decided: six scenarios.
- **WARNING 6.3.** There were no event-order tests. Decided: tests with stopping points.

There are no model evaluation (eval) suites in the project, and `CLAUDE.md` is not yet written. The quality of the bot prompt is checked by the "First game" gate against the recorded matches.

##### Section 7. Performance

Checked: memory, caching, slow paths, number of connections. Memory is bounded: thumbnails at most 86 MB in the maximum match. Up to 12 simultaneous connections to Google (three bots by four images). The three slowest paths: the harness cold start (unknown, measured by S1), the model's turn (unknown, measured by S1), a set of four Static images (estimate 1–2 s with parallel requests). The cold start is moved out of round time by launching in `ROUND_LOADING`.

- **OK 7.1.** Identical image requests from different bots in one round would go to Google twice. Decided: a repeat within a round is taken from memory (item "Quota accounting").

##### Section 8. Observability

- **GAP 8.1.** It was impossible to reconstruct why a bot got 0 yesterday. Decided: the item "Server and bot log" (round events, tool calls, completion reason, stderr tail), a line in the terminal per round, a retention of 14 days.

The "it works" metric: the share of rounds with a guess for each bot and the humans' waiting; both are written to `matches.jsonl` and are part of the "First game" gate criterion. Alerts and dashboards are not needed for a local game: quota consumption and the remainder are visible in the lobby.

##### Section 9. Deployment

```
  git clone ─> bun install ─> bun run hooks:install ─> .env (two keys) ─> bun run doctor ─> bun run start ─> link to friends
  rollback: Ctrl+C ─> git switch --detach <previous tag> ─> bun install ─> bun run start
            files in ~/.config and ~/.local/share are read by the version field; unreadable ones go to .bad
```

There are no migrations, feature flags or an "old code beside new" window: there is one process. Post-launch verification: `doctor`, then the link passes the readiness check. Smoke test: `bun run test:tunnel` on demand.

- **WARNING 9.1.** Harnesses update and change flags (Claude's remark 5). Decided: `doctor` compares versions with the last successful `test:harness`.
- **WARNING 9.2.** It is not said whether `start` builds the client itself. Not blocking; owner of the choice: DX phase.

##### Section 10. Long-term trajectory

- Debt: the throwaway code of `spikes/` (deleted after M1); three adapters for other people's CLIs; the conflict with Google's terms if the owner keeps the original design.
- Reversibility: 4 of 5. There is no data in other systems. The only expensive fork is the choice of map: two components are written for it without a substitution layer.
- A year later the plan is understandable to a newcomer: state in one state machine, protocol in schemas, spike decisions in `docs/spikes/`.
- A look at the extensions: both voices consider E1, E4 and E14 premature, so they stand after the gate and are confirmed by the owner from match data. The deferred "custom point lists" may turn out to be needed sooner (Codex's remark 5): the gate rule exists for this.
- After the first version: a history screen, a hall of fame of humans and models, a permanent address. The match log with per-bot measurements already provides data for comparing models.

##### Section 11. Design and UX

```
  link ─> Join (nickname, color) ─> Lobby ─> countdown 3-2-1 ─> Round ─> RoundResults ─┬─> countdown ─> Round ...
              │ errors: token,       │ host: settings,           │ «ИИ думают»,         │ AI card
              │ room full,           │ AI slots, quota           │ waiting              └─> Final ─> «Ещё раз» ─> Lobby
              │ nickname taken       │ guest: view only          │ panorama did not load: «Повторить»
```

| Screen | Loading | Empty | Error | Success | Partial |
|---|---|---|---|---|---|
| Join | connecting | none | wrong token, room full, nickname taken | entering the lobby | none |
| Lobby | AI slot check | no AI slots | not enough quota, harness unavailable, settings file reset | start | a slot disabled with a cause |
| Round | the panorama is loading | marker not placed | the panorama did not load, connection lost | answer accepted | «ИИ думают», waiting |
| RoundResults | markers appear one by one | nobody answered | a bot without a guess, with a cause | table and arcs | some bots cut off |
| Final | none | a match of one round | saving the match failed | podium | places shared |

First, second, third on the round screen: the panorama, the timer, the minimap; the participant list at the side. The emotional arc: anticipation in the countdown, the tension of the timer, the payoff on the results map, the review of the AI's explanations.

- **WARNING 11.1.** Error states were assigned to M4, yet they are needed already in the first game. Decided: a state belongs to the milestone where its rule is named (item "Milestone order").
- **WARNING 11.2.** There is no visual language (`DESIGN.md` is absent), the description of the screens is general. Owner: design phase.
- **WARNING 11.3.** Narrow screens: the mobile layout is deferred, but a friend may open the link from a phone. Owner: design phase.
- **WARNING 11.4.** The invitation link is visible only in the terminal; there is no «copy invitation» button in the lobby. Owner: design phase.

Accessibility: `prefers-reduced-motion` is accounted for; keyboard, contrast and distinguishability of participants' colors are passed to the design phase. After implementation a `/design-review` on the live game is needed.

#### Mandatory outputs of the CEO phase

##### Not in scope

Deferred (recorded in `TODOS.md`):

- C-D1 «Звуки» ("Sounds"): not needed for the first match.
- C-D2 «Экран истории партий и зал славы» ("Match history screen and hall of fame"): the data is already written, the screen comes later.
- C-D3 «Свои списки точек» ("Custom point lists"): a separate source of points; included in M2 if the "First game" gate shows boring locations.
- C-D4 «Восстановление партии после перезапуска сервера» ("Recovering a match after a server restart"): a deliberate simplification.
- C-D5 «Мобильная раскладка» ("Mobile layout"): the owner did not ask for it.

Declined (does not go into `TODOS.md`):

- C-X1 bot thought feed: hints the answer to humans.
- C-X2 replay of a human's turn: not needed for the goal.
- C-X3 speed bonus: changes the winning rule.
- C-X4 AI hints to humans: a different product.
- C-X5 spectator link: late joining already gives a spectator mode.
- C-DIRECT-API bots via the direct API: the owner asked for subscriptions.
- C-DEADLINE a fixed bot deadline: the round-end rules are already set and covered by tests.
- Kicking a player by the host: an invitation is revoked by restarting.
- A model evaluation set on fixed points: the first calibration goes by the recorded matches.

##### What already exists

There is no code in the repository. Ready-made pieces outside the repository that the plan relies on: `cloudflared` (tunnel), the CLIs `codex`, `claude`, `agy` (model execution and MCP), Maps JavaScript API and Street View Static API, MapLibre GL and OpenFreeMap (while the original map choice applies), `Bun.serve` with WebSocket, Svelte animations, `sharp`, `zod`. Open-source clones of the genre are surveyed by spike S4; by default an own build.

##### Gap to the 12-month ideal

After this plan there is a game night for three humans and three AIs with explanations and match recording. What remains to the ideal: history and hall of fame, custom point lists, sounds, phone, a match that survives a restart, a permanent address. All of this is built on top of the same server and files without rework. The main gap is not technical: compliance with Google's terms depends on the owner's decisions UC-1 and UC-2.

##### Error and rescue register

| Component | What can go wrong | Rescued? | Action | What the person sees |
|---|---|---|---|---|
| `LocationService` | no panorama nearby | yes | up to 30 attempts, up to 3 series | nothing, preparation is in advance |
| `LocationService` | three series without a result | yes | the round does not start | host: «панорама не найдена», «Повторить», «Завершить партию» |
| `LocationService` | key rejection, metadata quota | yes | stop immediately | host: the cause and the same buttons |
| `LocationService` | network, 5 s timeout | yes | one retry, then stop | host: the cause |
| `BotImageService` | 404, no imagery | yes | a failed call; 3 free per round | bot: text; humans: nothing |
| `BotImageService` | 403, 429 | yes | «картинки недоступны» | host: a warning with the cause |
| `BotImageService` | starting image not received | yes | new point, up to 3 | nothing |
| `BotImageService` | broken image in `sharp` | yes | a failed call | bot: text |
| Quota counter | cap before the match starts | yes | the match does not start | lobby: consumption, worst case, remainder |
| Quota counter | cap mid-match | yes | «квота исчерпана» without deducting a turn | the match is played to the end |
| Quota counter | `quota.json` is unreadable | yes | `.bad`, counter from zero | a warning in the terminal and lobby |
| `BotRunner` | CLI not found or not signed in | yes | the slot is disabled | the cause at the slot, `doctor` gives the command |
| `BotRunner` | the harness hung | yes | SIGTERM, after 2 s SIGKILL at the deadline | «оборван» ("cut off"); the last guess is counted |
| `BotRunner` | the harness crashed | yes | the last guess, otherwise 0 | the cause in the AI card |
| `BotRunner` | subscription limit | yes | the last guess, otherwise 0 | the limit error in the AI card |
| `BotRunner` | the model refused to guess | yes | 0 points | the cause and the text tail in the AI card |
| `geo` tools | wrong arguments | yes | error text, turn not deducted | nothing |
| `geo` tools | long explanation or quip | yes | truncation | truncated text |
| `geo` tools | a call after the end of the round, a foreign token | yes | «раунд окончен» | nothing |
| `geo` tools | turns exhausted | yes | the error «вызови submit_guess» ("call submit_guess") | the turn counter in the participant list |
| WebSocket | wrong token | yes | close; counted in the thresholds (M3) | login screen: «ссылка недействительна» ("the link is invalid") |
| WebSocket | a message not matching the schema or larger than 16 KB | yes | refusal or close | player: an error message |
| WebSocket | connection lost | yes | reconnection, the seat is kept | «соединение восстанавливается» ("connection is being restored") |
| Tunnel | the name did not appear in DNS within 60 s | yes | an error with the cause | host: advice to restart `start` |
| Tunnel | `cloudflared` exited | yes | up to 3 restarts, a new link | host: the new link; players log in by nickname |
| Client | Maps JavaScript API did not load | yes | `client_error`, «Повторить» | player: a message; host: a note |
| Match recording | a write error of `matches.jsonl` | yes | the match is not interrupted | host: a message on the final screen |

27 rows, no gaps without a decision.

##### Failure mode register

| Path | Failure | Rescued? | Test? | What the person sees | In the log? |
|---|---|---|---|---|---|
| Round preparation | panorama not found | yes | yes | host: error and buttons | yes |
| Round preparation | Google key rejection | yes | yes | host: the cause | yes |
| Bot images | 404 | yes | yes | nothing | yes |
| Bot images | 403, 429 | yes | yes | host: a warning | yes |
| Quota | cap before the start | yes | yes | lobby: the calculation | yes |
| Quota | cap mid-match | yes | yes | the match is played to the end | yes |
| Harness | hang | yes | yes | «оборван» | yes |
| Harness | crash before a guess | yes | yes | the cause in the card | yes |
| Harness | model refusal | yes | yes (fake harness) | the cause in the card | yes |
| Harness | the real CLI changed its flags | partially | on demand (`test:harness`) | `doctor`: the version changed | yes |
| Tools | parallel calls beyond the limit | yes | yes | nothing | yes |
| Tools | a call after the end of the round | yes | yes | nothing | yes |
| Login | new tunnel address, seat lost | yes | yes | login by nickname | yes |
| Tunnel | the process exited | yes | yes (fake process) | a new link | yes |
| Client | the panorama did not load | yes | E2E with a stub | «Повторить»; a note for the host | yes |
| Files | unreadable settings or quota | yes | yes | a warning | yes |
| Host | disconnected mid-match | partially | not set | auto-transitions | yes |

17 rows. There are no rows "not rescued, no test, silent": critical gaps 0. The two "partially" rows have owners: CLI flag changes (contract tests on demand) and host disconnection (engineering phase).

##### Extension decisions

The full record is in the summary `~/.gstack/projects/tass/ceo-plans/2026-11-13-geoaissr.md`.

- Accepted: E1 (bot difficulty), E2 (the "Humans vs AI" score), E4 (persona and quip), E14 (`--public-url`); all after the "First game" gate.
- Deferred: D1–D5, recorded in `TODOS.md`.
- Skipped: X1–X5.

##### Diagrams

7 were drawn up: architecture with the trust boundary (section 1), the state machine (section 1), data flows with shadow paths (section 4), the order of asynchronous events (section 4), the test map (section 6), deployment and rollback (section 9), the player's path through the screens (section 11). The error scheme is given by the register above. There are no stale diagrams: the one diagram of the working plan (section 7) is correct.

##### Implementation Tasks

Synthesized from this review's findings. Each task derives from a specific
finding above. Run with Claude Code or Codex; checkbox as you ship.

- [ ] **T1 (P1, human: ~30min / CC: n/a)** — owner decisions — choose the map, decide the question of AI on Google imagery, create a private remote
  - Surfaced by: 0.5 Two voices, UC-1 and UC-2; C-REMOTE
  - Files: PLAN.md
  - Verify: the decisions are recorded in the plan before M1 code begins
- [ ] **T2 (P1, human: ~2h / CC: ~10min)** — quality gates — `pre-commit` with `bun run check` while there is no remote; a check for `.env` tracking
  - Surfaced by: C-F8; section 3, remark 3.1
  - Files: .githooks/pre-commit, .githooks/pre-push, .gitignore, package.json
  - Verify: `bun run hooks:install`, then a commit violating a limit is rejected
- [ ] **T3 (P1, human: ~2d / CC: ~3h)** — spike S1 — a full bot round on each harness, three bots at once, an isolation check
  - Surfaced by: Claude 2, Codex 3; C-S1FULL, C-F13
  - Files: spikes/, docs/spikes/
  - Verify: a report in `docs/spikes/` with a decision against the admission criterion for each harness
- [ ] **T4 (P1, human: ~1d / CC: ~1h)** — spikes S2, S3, S4 — tunnel for 15 minutes, Google keys and prices, a survey of clones
  - Surfaced by: Claude 4, Claude 11, Codex 7
  - Files: docs/spikes/
  - Verify: three reports with decisions; daily quotas set in the Cloud Console
- [ ] **T5 (P1, human: ~3d / CC: ~2h)** — `GameEngine` — three bot cut-off moments, the waiting window, launching the harness in `ROUND_LOADING`, a pause with no humans
  - Surfaced by: C-F6, C-PREWARM; section 4
  - Files: to be determined
  - Verify: unit tests of the state machine with a controllable clock
- [ ] **T6 (P1, human: ~2d / CC: ~1h)** — event order — phase check after waits, turn and quota reserve, marker position on the server
  - Surfaced by: section 4, order of asynchronous events
  - Files: to be determined
  - Verify: unit tests with stopping points for both completion orders
- [ ] **T7 (P1, human: ~2d / CC: ~1h)** — images and quota — `return_error_code=true`, failed calls, 403 and 429, the counter and the pre-start check
  - Surfaced by: C-F2, C-F11; section 2, gaps 2.1 and 2.2
  - Files: to be determined
  - Verify: unit tests with substituted Google responses
- [ ] **T8 (P1, human: ~2d / CC: ~1h)** — round preparation — three sampling series, point replacement, immediate stop on key rejection
  - Surfaced by: C-F14; section 2, gap 2.1
  - Files: to be determined
  - Verify: unit tests of sampling with a controllable generator
- [ ] **T9 (P1, human: ~2d / CC: ~1h)** — link and tunnel — readiness check, `cloudflared` restart, seat by nickname
  - Surfaced by: C-F3; section 2, gap 2.5
  - Files: to be determined
  - Verify: unit tests with substituted DNS and HTTP; `bun run test:tunnel`
- [ ] **T10 (P1, human: ~1d / CC: ~45min)** — bot isolation — allowlisted environment, harness flags, a working directory outside the repository
  - Surfaced by: C-F13; Claude 13
  - Files: to be determined
  - Verify: a unit test of the environment composition; `bun run test:harness` with a test file
- [ ] **T11 (P1, human: ~1d / CC: ~45min)** — `geo` tools — argument validation, explanation truncation, a cause when there is no guess
  - Surfaced by: section 2, gaps 2.3 and 2.4
  - Files: to be determined
  - Verify: unit tests of the schema; an integration scenario "harness without a guess"
- [ ] **T12 (P1, human: ~1d / CC: ~45min)** — "First game" gate — per-bot measurements in `matches.jsonl`, a `docs/playtest-1.md` template
  - Surfaced by: Claude 9, Codex 2; C-GATE1
  - Files: docs/playtest-1.md
  - Verify: after a match with a fake harness the record contains all the measurement fields
- [ ] **T13 (P2, human: ~1d / CC: ~30min)** — log — server and bot events in `logs/<date>.jsonl`, a line per round in the terminal
  - Surfaced by: section 8, gap 8.1
  - Files: to be determined
  - Verify: an integration test: the log contains the completion reason of each bot and no tokens
- [ ] **T14 (P2, human: ~1d / CC: ~30min)** — local files — a `version` field, a schema, a `.bad` file, a message on a match-write error
  - Surfaced by: section 1, remark 1.1
  - Files: to be determined
  - Verify: unit tests for unreadable files
- [ ] **T15 (P2, human: ~1d / CC: ~30min)** — scoring — the bot's last guess, tie-break, `D` for region presets
  - Surfaced by: C-F9, C-F10
  - Files: shared/, scripts/build-regions.ts
  - Verify: unit tests of the formula and tie-break
- [ ] **T16 (P2, human: ~1d / CC: ~30min)** — bot snapshots — thumbnails in memory until the lobby, full images until the end of the round, a repeated request served from memory
  - Surfaced by: C-F7; section 7, remark 7.1
  - Files: to be determined
  - Verify: an integration test: after the match the thumbnails are unavailable, the temporary directory is deleted
- [ ] **T17 (P2, human: ~3d / CC: ~2h)** — M2 after the gate — bot difficulty, the "Humans vs AI" score, persona and quip
  - Surfaced by: C-E1, C-E2, C-E4; C-EXP-ORDER
  - Files: to be determined
  - Verify: unit tests of presets, the side score and the quip schema
- [ ] **T18 (P2, human: ~2d / CC: ~1h)** — M3 after the gate — `--public-url`, login thresholds, panorama accounting, harness version check in `doctor`
  - Surfaced by: C-E14, C-F12, C-F11; section 9, remark 9.1
  - Files: to be determined
  - Verify: unit tests of flags, thresholds and `pano_loaded`

Estimate assumption: the human figure counts a full team with verification; CC counts the agent's work without waiting for the owner.

##### Unresolved decisions

- UC-1 (C-MAP): the map for the answer. Decided by the owner at the final gate.
- UC-2 (C-TOS): AI on Google imagery. Decided by the owner at the final gate.
- C-REMOTE: a private remote. Owner action.
- 1.2: behavior when the host disconnects. Engineering phase.
- 9.2: whether `start` builds the client itself. DX phase.
- 11.2, 11.3, 11.4: visual language, narrow screens, the invite button in the lobby. Design phase.

##### Reality lines and summary

Seven `REALITY:` lines are recorded in step 0B above. The check `gstack-plan-reality check --phase ceo --plan <snapshot autoplan-ceo-Tg3Hze>` printed:

`PLAN_REALITY: phase=ceo rows=7/7 missing=none unverified=7 verdict=complete`

```
  +====================================================================+
  |            MEGA PLAN REVIEW — COMPLETION SUMMARY                   |
  +====================================================================+
  | Mode selected        | SELECTIVE EXPANSION                         |
  | System Audit         | empty repository, no remote or CLAUDE.md    |
  | Step 0               | SELECTIVE EXPANSION; own build; 4 accepted  |
  |                      | 5 deferred, 5 skipped; 15 fixes             |
  | Section 1  (Arch)    | 2 issues found                              |
  | Section 2  (Errors)  | 27 error paths mapped, 7 GAPS (all closed)  |
  | Section 3  (Security)| 3 issues found, 0 High severity             |
  | Section 4  (Data/UX) | 16 edge cases mapped, 1 unhandled (to Eng)  |
  | Section 5  (Quality) | 1 issues found                              |
  | Section 6  (Tests)   | Diagram produced, 3 gaps (all closed)       |
  | Section 7  (Perf)    | 1 issues found                              |
  | Section 8  (Observ)  | 1 gaps found (closed)                       |
  | Section 9  (Deploy)  | 2 risks flagged                             |
  | Section 10 (Future)  | Reversibility: 4/5, debt items: 3           |
  | Section 11 (Design)  | 4 issues (1 resolved, 3 to the design phase)|
  +--------------------------------------------------------------------+
  | NOT in scope         | written (14 items)                          |
  | What already exists  | written                                     |
  | Dream state delta    | written                                     |
  | Error/rescue registry| 27 rows, 0 CRITICAL GAPS                    |
  | Failure modes        | 17 total, 0 CRITICAL GAPS                   |
  | TODOS.md updates     | 5 items proposed (all recorded)             |
  | Scope proposals      | 14 proposed, 4 accepted (EXP + SEL)         |
  | CEO plan             | written                                     |
  | Outside voice        | codex completed                             |
  | Lake Score           | N/A (there were no questions to the owner)  |
  | Diagrams produced    | 7 (arch., state machine, flows, order,      |
  |                      | tests, deployment, player path)             |
  | Stale diagrams found | 0                                           |
  | Unresolved decisions | 8 (list above)                              |
  | Reality rows         | 7/7 rows (PLAN_REALITY), 7 unverified       |
  +====================================================================+
```

#### Autonomous decision log

<!-- AUTONOMOUS DECISION LOG -->

| No. | Phase | Decision | Class | Principle | Rationale | Rejected |
|---|---|---|---|---|---|---|
| 1 | CEO | Mode SELECTIVE EXPANSION | mechanical | `/autoplan` rule | Set by the pipeline | the other modes |
| 2 | CEO | Approach: own build | mechanical | 1, completeness | Only it covers requirements 2, 5–8 | clone fork, external hosting |
| 3 | CEO | Accept E1, bot handicap | mechanical | 2 | Within the radius, less than a day | defer |
| 4 | CEO | Accept E2, "Humans vs AI" | mechanical | 2 | Within the radius, less than a day | defer |
| 5 | CEO | Accept E4, persona and quip | mechanical | 2 | Within the radius, less than a day | defer |
| 6 | CEO | Accept E14, `--public-url` | mechanical | 2 | Removes the dependency on quick tunnel | defer |
| 7 | CEO | Defer D1–D5 to `TODOS.md` | mechanical | 3 | Outside the first version | accept now |
| 8 | CEO | Skip X1–X5 | mechanical | 3, 4 | Break fairness or duplicate the spectator mode | accept |
| 9 | CEO | Fix the cost estimate: 560 images, 14 matches at the cap | mechanical | 5 | Recalculation with failed calls | keep 26 |
| 10 | CEO | `return_error_code=true`, the turn is not deducted | mechanical | 1 | Otherwise the bot gets a gray placeholder and loses a turn | leave as is |
| 11 | CEO | The link after a DNS and `/healthz` check | mechanical | 1 | A live check showed the DNS delay | print immediately |
| 12 | CEO | A go/no-go criterion for S1 | mechanical | 5 | A spike without a criterion gives no decision | leave without a criterion |
| 13 | CEO | M1 after S3 | mechanical | 5 | Without keys there is no real panorama | in parallel |
| 14 | CEO | Map for the answer: keep MapLibre + OSM | taste | owner's direction | The owner explicitly allowed OSM; Google's terms were not verified against the current text | Google Maps JS |
| 15 | CEO | "Turn" = `look` or `move` | taste | 5 | A simple rule, matches the bot's actions | turn = a call to the model |
| 16 | CEO | Minimum round and bot budget 60 s; the earliest of three deadlines | mechanical | 5 | The S1 criterion otherwise contradicts the round | keep 30 s |
| 17 | CEO | 160 px thumbnails in memory until the end of the match | mechanical | 1 | A memory bound and a storage rule are needed | keep full images |
| 18 | CEO | `pre-commit` with `bun run check` while there is no remote | mechanical | 1 | Without a remote neither CI nor pre-push works | wait for a remote |
| 19 | CEO | Bot score: the last recorded guess | mechanical | 5 | The plan had two rules | 0 on any error |
| 20 | CEO | Tie-break: rounds with an answer, then distance; `D` per preset | mechanical | 1 | One who did not answer has no distance | distance only |
| 21 | CEO | Quota: `pano_loaded`, a worst-case check before the start | mechanical | 5 | The server does not see loads in the browser | an estimate by the number of rounds |
| 22 | CEO | Login protection: thresholds 10 and 30, `--trust-proxy` | mechanical | 1 | Headers can be forged | always trust headers |
| 23 | CEO | Bot isolation: environment allowlist, a check in S1 | mechanical | 5 | A read-only sandbox does not prevent reading files | an empty `HOME` (breaks subscription login) |
| 24 | CEO | A new slot with the «Любитель» preset | mechanical | 5 | Matches the preset of the S1 criterion | 6 turns |
| 25 | CEO | Passing imagery to models: keep, owner's confirmation at the gate | taste | owner's direction | The basis of requirements 5 and 6; Google's terms not verified | remove AI on Google imagery |
| 26 | CEO | Private remote: raise at the gate | taste | 6 | An external action is done by the owner | create it myself |
| 27 | CEO | The E4 estimate raised from S to M, the extension kept | taste | 2 | Within the plan's radius, less than a day | cut to a single quip |
| 28 | CEO | Round preparation failures: three series, point replacement | mechanical | 1 | The behavior was not described | leave for implementation |
| 29 | CEO | Static counter and cap in M2 | mechanical | 5 | Otherwise the M2 bots spend quota without a cap | leave in M3 |
| 30 | CEO | An unconfirmed marker at the end of the timer is counted | mechanical | 5 | Genre custom | 0 points |
| 31 | CEO | Drop `--trust-proxy`, keep E14 | taste | 5 | The owner has no proxy of his own; the shared threshold suffices | remove E14 entirely |
| 32 | CEO | A lobby warning from half of the bot budget | mechanical | 5 | At a third, a harness that passed S1 would always be warned | a third |
| 33 | CEO | Approval of the step 0H documents: option A | mechanical | 6 | The documents reflect the decisions; the check is PASS | review |
| 34 | CEO | Cost recalculation: 600 images, 13 matches at the cap (replaces row 9) | mechanical | 5 | Repeated starting sets entered the worst case (Codex 7) | keep 560 |
| 35 | CEO | Map for the answer: User Challenge UC-1 (replaces row 14) | User Challenge | not auto-decided | Google's terms were read, clause 3.2.3(e) | decide on the owner's behalf |
| 36 | CEO | AI on Google imagery: User Challenge UC-2 (replaces row 25) | User Challenge | not auto-decided | Google's terms, clauses 3.2.3(a) and 3.2.3(c)(vii) | decide on the owner's behalf |
| 37 | CEO | Milestone order: M1 is the "First game" end-to-end slice (replaces row 13) | taste | 6 | The shared conclusion of both voices; the owner's requirements do not change | the previous order: a game without AI, then AI, then the tunnel |
| 38 | CEO | The "First game" gate with measurements and three questions | mechanical | 1 | "It's more fun with bots" and the bots' pace are not verified (Claude 9, Codex 2, 3) | without a trial match |
| 39 | CEO | S1 expanded to a full round and three bots; goes first after the quality gates | mechanical | 5 | The riskiest assumption is checked first | S1 before the quality gates (against the owner's rule) |
| 40 | CEO | Extensions E1, E2, E4, E14 left in the plan after the "First game" gate | taste | 2 | Both voices advise not building before the first match; the owner confirms the composition of M2–M4 | move to `TODOS.md` |
| 41 | CEO | Static counter and cap in M1 (replaces row 29) | mechanical | 5 | The first bots are now in M1 | leave in M2 |
| 42 | CEO | The movement setting is shared by humans and bots | mechanical | 5 | Equal rules (Codex 6) | movement for bots only |
| 43 | CEO | The harness starts in `ROUND_LOADING`, `observe()` is delayed | mechanical | 3 | The cold start does not eat round time (Claude 12) | raise the minimum round to 90–120 s |
| 44 | CEO | Difficulty level names only after the first game's data | mechanical | 5 | The names promise a calibration (Codex 6) | name them right away |
| 45 | CEO | Spike S4: an hour to survey open-source clones | mechanical | 6 | A cheap check before M1 (Claude 11) | do not look |
| 46 | CEO | Direct API instead of subscriptions: not accepted | taste | owner's direction | One voice; the owner asked for subscriptions | replace the harnesses with the API |
| 47 | CEO | A fixed bot deadline: not accepted | taste | 5 | The rules are set and covered by tests; an early end is needed for pacing | a single deadline |
| 48 | CEO | The application cap is called an estimate; the real limit is in the Cloud Console | mechanical | 5 | The counter does not guarantee billing (Codex 7, Claude 4) | keep the "hard cap" |
| 49 | CEO | The residual isolation risk and shared subscription limits are recorded; subscription terms are raised to the owner | mechanical | 5 | Claude 5 and 13 | stay silent |
| 50 | CEO | Failure rules during a match (metadata, 403 and 429, explanation truncation, a cause without a guess, tunnel, seat by nickname, file versions, `client_error`) | mechanical | 1 | Seven gaps of the error map | leave for implementation |
| 51 | CEO | A disconnected player's seat is returned by nickname | taste | 3 | A new tunnel address is a different site, `localStorage` is empty | a return code in a personal link |
| 52 | CEO | Event order: phase check after waits, turn and quota reserve, marker position on the server | mechanical | 1 | Races of a tool call with the end of the round | rely on single-threadedness |
| 53 | CEO | A pause before the next round if there is not a single human | mechanical | 3 | Bots do not waste quota and subscription | keep playing |
| 54 | CEO | Secrets: `.env` outside git with a check, new tokens on every `start`, a mask in the log | mechanical | 1 | Keys could end up in git or the log | without a check |
| 55 | CEO | The exemption of `spikes/` from size limits is removed | mechanical | owner's rule | An exemption from limits requires the owner's agreement | keep the exemption |
| 56 | CEO | Server and bot log, 14 days | mechanical | 1 | Otherwise it is impossible to reconstruct why a bot got 0 | `matches.jsonl` only |
| 57 | CEO | A repeated image request within a round is taken from memory | mechanical | 3 | Saves quota on identical bot turns | request every time |
| 58 | CEO | `doctor` compares harness versions with the last successful `test:harness` | mechanical | 5 | CLIs change flags (Claude 5) | pin versions by hand |
| 59 | CEO | Error states belong to the milestone of their rule, not to M4 | mechanical | 5 | They are needed already in the first game | leave in M4 |
| 60 | CEO | Host disconnection, client build in `start`, visual language: passed to the next phases | mechanical | 6 | Not blocking, each has a named owner | decide in the CEO phase |

### Phase 2. Design review

#### How the phase went

- Entering phase 2 through the `/autoplan` pipeline was rejected by its guard hook (`close_required`), even though phase 1 is closed and published. Cause: the hook reads the session log only up to the first context-compaction boundary and does not see the closure. The hook was not bypassed. The phase was run by the fallback path from the gstack documentation: the separate `/plan-design-review` skill with the `/autoplan` auto-decision rules.
- No mockups were generated: `No image API key found (OpenAI or Gemini)`. The review is text-only; layouts are given as diagrams in section 14. Fix: `~/.claude/skills/gstack/design/dist/design setup` or the `GEMINI_API_KEY` variable.
- The gstack records under the project key `tass` (design document, earlier design-review tasks, learned lessons) belong to a different project with the same key and were not used.

#### Pre-review audit

- UI scope: 5 screens (`Join`, `Lobby`, `Round`, `RoundResults`, `Final`) and 8 components from section 7. No code, no commits.
- `DESIGN.md` and `CLAUDE.md` are absent. This is a gap: without them every M1 screen would get its own look.
- There are no earlier design reviews of this plan.
- Inherited from phase 1: C-UI and WARNING 11.2 (no visual language), 11.3 (narrow screens), 11.4 (invitation only in the terminal).

#### Step 0

- **0A. Rating: 3 out of 10.** The plan described behavior and failures in detail but barely described appearance: names of screens and components, "pulses", "confetti", "full screen". A 10 plan names fonts, colors, spacing and motion, gives every screen a "first, second, third" order and a diagram, lists what a person sees in each state, and specifies keyboard, contrast and narrow-window behavior.
- **0B. `DESIGN.md`:** absent. Decision: the file is created in M0 from the item "Visual language and `DESIGN.md`".
- **0C. What already exists:** there is no code, nothing to reuse. We rely on standard form elements, built-in Svelte transitions, ready-made maps (MapLibre or Google Maps), the Lucide icon set.
- **0D. Focus:** all 7 passes (the `/autoplan` rule: full depth).

#### Two voices

Both voices received the full plan text (397 lines) without my conclusions.

**CODEX SAYS (design critique)**, 13 findings, no critical ones, 9 high. The wrapper returned `unverified` (severity labels are not in its format); the review text was received in full.

1. High. No visual and layout contract: font, scales, surfaces, layer order.
2. High. Keyboard, contrast, 200% zoom and narrow window are not defined as criteria.
3. High. Recovery rules exist, but there is no common look for connection states.
4. High. Join: no order of validation, no look for errors, no explanation of the spectator role, no return to one's seat.
5. High. The lobby is a list of settings with no start hierarchy; it is not defined when starting is possible.
6. Medium. The "Check" mark goes stale after settings change; the changed values themselves are not explained.
7. High. The main round action has no confirmations: the player does not know whether the answer was accepted.
8. High. The 5 s cutoff for panorama loading makes a network failure part of the competition.
9. Medium. Waiting for bots should be shown by one honest timer.
10. High. The results reveal conflicts with the AI explanation; auto-advance interrupts reading.
11. Medium. Results map density (11 markers, arcs, the 180th meridian), mixing "this round" and "total".
12. High. The final has no variants: tie, fewer than three participants, early end, who presses "Play again".
13. Medium. A late joiner just looks weak in the standings.

Codex summary: "Revise the UI specification before M1 because submission feedback, loading fairness, screen hierarchy, and accessible layouts remain undefined".

**CLAUDE SUBAGENT (design completeness)**, 16 findings, 3 critical, completeness rating 3 out of 10.

1. Critical. There is no visual system, and no task for it.
2. Critical. Participants differ only by color, the palette is not defined, humans and AIs are not distinguished.
3. Critical. The round screen layout is not defined; text over the panorama without a contrast rule.
4. High. The invitation link is only in the terminal.
5. High. The join screen is nearly empty: no token errors, no connection errors, no place for "nickname taken".
6. High. The lobby is overloaded, the guest view is not defined, the reason for an inactive "Start" is not shown.
7. High. There are no connection states despite the declared reconnection.
8. High. The results reveal conflicts with the 30 s auto-advance.
9. High. The "AI beat the humans" storyline is not designed; the sides score is in M2.
10. Medium. The countdown screen is not defined; whether people see the panorama until zero.
11. High. No keyboard or accessibility support apart from `prefers-reduced-motion`.
12. Medium. The final table will overflow (11 participants over 20 rounds).
13. Medium. No motion durations and curves.
14. Medium. No rules for Russian text: declensions, number format, nickname truncation.
15. Medium. The map choice changes the look of the mini-map and the results map.
16. Medium. M4 postpones the look of states.

```
DESIGN OUTSIDE VOICES — LITMUS SCORECARD
| Check                                 | Claude     | Codex      | Result                       |
|---------------------------------------|------------|------------|------------------------------|
| 1. Product recognizable on 1st screen | NOT SPEC'D | NOT SPEC'D | gap confirmed, closed        |
| 2. One strong visual anchor           | NOT SPEC'D | YES        | disagreement, closed by diagrams |
| 3. Clear from the headings            | NOT SPEC'D | NOT SPEC'D | gap confirmed, closed        |
| 4. Each section has one job           | YES*       | YES        | confirmed (*except lobby)    |
| 5. Cards are needed                   | NOT SPEC'D | NO         | no cards, except for the AI  |
| 6. Motion helps hierarchy             | YES        | YES        | confirmed                    |
| 7. Looks fine without decorative shadows | NOT SPEC'D | NOT SPEC'D | gap confirmed, closed     |
| Hard rejections                       | risk 4     | risk 4     | text only on panels          |
```

Agreement of the two voices (10): visual system; participant marker besides color; round layout; join; lobby and start conditions; connection states; results reveal versus auto-advance; final; keyboard and narrow window; keyboard marker. Disagreements: the 5 s cutoff (Codex only) and moving the sides score into M1 (Claude only); both are put up for final approval.

#### Passes

**Pass 1. Information architecture: 3 → 8.** No screen had a "first, second, third" order, diagrams, a place for the "Угадать" ("Guess") button, or a guest view in the lobby. Added the item "Screen hierarchy" with diagrams of the lobby, round and results, conditions for the "Начать" ("Start") button, and the one-timer rule. To reach 10, approved mockups are missing.

**Pass 2. States: 5 → 9.** The failure rules existed in the plan but had no appearance. Added the table "Interface states" (13 elements by 5 states), the item "Human answer: server confirmations", and the shared components `StatusBanner` and `InlineState`.

**Pass 3. Player journey: 4 → 8.**

| Step | What the person does | What they feel | How the plan supports it |
|---|---|---|---|
| 1 | Opens the link from the chat | "Am I in the right place?" | Game name, the line "В лобби: Миша, Оля и 2 ИИ" ("In the lobby: Misha, Olya and 2 AIs"), one field and one button |
| 2 | Waits in the lobby | Curiosity: which AIs are playing | List of humans and AIs on the left, settings visible to the guest as values |
| 3 | Countdown | Anticipation | Shutter and large digits; nobody sees the panorama until zero |
| 4 | Looks at the panorama | Focused | Full-screen panorama, interface on panels at the edges |
| 5 | Places a marker and presses "Угадать" | "Was the answer accepted?" | Answer-zone states driven by server confirmation |
| 6 | Waits for the others | Impatience | One timer "Все ответили. ИИ думают" ("Everyone has answered. The AIs are thinking"), counter of bot turns |
| 7 | Results reveal | Excitement, the main moment | Markers from farthest to nearest, own result row, skip with space |
| 8 | Reads why the AI decided so | Laughter or annoyance | First line of the explanation visible at once, card under the row, auto-advance pause |
| 9 | Final | Victory or "rematch?" | Outcome in the first line, "Победил ИИ: Клод" ("The AI won: Claude"), "Лучший из людей: Оля" ("Best of the humans: Olya") |
| 10 | "Ещё раз" ("Play again") | Wants more | Button for the host, "Ждём хоста" ("Waiting for the host") for guests, settings preserved |

Horizons: first 5 seconds (join: one action); 5 minutes (round and results reveal); long (the humans-versus-AIs score between games is deferred to `TODOS.md`, "Game history screen and hall of fame").

**Pass 4. Templateness: 3 → 8.** Type: an application interface with full-screen content. The risks were hidden: the names `BotCard` and `BotSlotEditor` pushed toward a set of cards, and the default font and palette. Now: two columns of rows instead of cards, the AI card expands under the row, one accent, fonts are named, glass, glow, gradients, emoji and decorative icons are forbidden. No hard rejections. To reach 10, mockups are missing to see this in practice.

**Pass 5. Design system: 1 → 8.** There was no `DESIGN.md` and no task for it. Now color variables, fonts, spacing and motion scales are written in the plan, the file is created in M0, the `bun run check` check does not let colors bypass `tokens.css`, and a test checks contrast.

**Pass 6. Narrow windows and accessibility: 2 → 8.** There was only `prefers-reduced-motion`. Added the item "Keyboard, contrast and window sizes": a design window, behavior from 900 to 1279 px, a mode narrower than 900 px, tap target sizes, keys, keyboard marker placement, screen reader announcements, axe checks. A separate mobile layout remains deferred.

**Pass 7. Unresolved:** 30 decisions are written into the plan, 6 are put up for final approval as questions of taste, 2 are passed to the engineering phase.

#### Out of scope

- Separate mobile layout: already in `TODOS.md`; the first version has a warning and a fallback single-column layout.
- Dark map scheme and light interface theme: one theme, an evening usage scene.
- Sounds: already in `TODOS.md`.
- Replaying a round without scoring if a player's panorama failed to load (Codex suggestion): added to `TODOS.md`.
- Fanning out overlapping markers: replaced by raising the selected marker.
- Approved mockups: there is no image generation key; the owner can make them before the M1 screens.

#### What already exists

There is no code and no `DESIGN.md`. Ready-made things the design relies on: standard HTML form elements, Svelte transitions (`transition`, `animate:flip`, `Tween`), keyboard control of the map in MapLibre and Google Maps, `Intl.PluralRules` and `Intl.NumberFormat`, fontsource font packages, Lucide icons, `canvas-confetti`, `@axe-core/playwright`.

#### Changes to `TODOS.md`

One entry: "Replay a round when the panorama is not loaded" (P3). The other accepted edits went into the plan tasks.

#### Implementation Tasks

Synthesized from this review's findings. Each task derives from a specific finding above. Run with Claude Code or Codex; checkbox as you ship. Estimate: the "human to CC" ratio is about 30 for screens and 50 for tests.

- [ ] **T19 (P1, human: ~1d / CC: ~30min)** — design system — Write `DESIGN.md`, `tokens.css`, wire up fonts, the color check and the contrast test
  - Surfaced by: Pass 5 — no `DESIGN.md` and no visual language (both voices, finding 1)
  - Files: `DESIGN.md`, `CLAUDE.md`, `web/src/styles/tokens.css`, `scripts/check-colors.ts`, `web/src/styles/tokens.test.ts`
  - Verify: `bun run check`
- [ ] **T20 (P1, human: ~1d / CC: ~30min)** — identity — Avatar and participant marker: shape, letter, a 12-color palette, taken colors
  - Surfaced by: Pass 4 — participants differed only by color (Claude 2, Codex 2)
  - Files: `web/src/components/Avatar.svelte`, `shared/colors.ts`, `shared/colors.test.ts`
  - Verify: `bun test shared/colors.test.ts`
- [ ] **T21 (P1, human: ~1w / CC: ~3h)** — screens — Build the five screens per the item "Screen hierarchy"
  - Surfaced by: Pass 1 — the screens had no order or diagrams (Claude 3, 5, 6, 10, 12; Codex 4, 5, 7, 12)
  - Files: `web/src/screens/*.svelte`, `web/src/components/*.svelte`, `web/src/i18n/ru.ts`
  - Verify: Playwright E2E, a game of two rounds
- [ ] **T22 (P1, human: ~3d / CC: ~1h)** — states — `StatusBanner`, `InlineState` and all rows of the "Interface states" table
  - Surfaced by: Pass 2 — the failure rules had no appearance (Claude 7, 16; Codex 3)
  - Files: `web/src/components/StatusBanner.svelte`, `web/src/components/InlineState.svelte`, screens
  - Verify: E2E for join states and the connection banner
- [ ] **T23 (P1, human: ~2d / CC: ~45min)** — protocol — Marker and answer confirmations, answer-zone states, timer driven by server time
  - Surfaced by: Pass 2 — the player did not know whether the answer was accepted (Codex 7, 9; Claude 7)
  - Files: `shared/protocol.ts`, `server/game-engine.ts`, `web/src/components/GuessMap.svelte`, `web/src/components/TimerRing.svelte`
  - Verify: integration test of confirmations; E2E of a connection drop after placing a marker
- [ ] **T24 (P1, human: ~2d / CC: ~45min)** — host — Lobby invitation with a check state, host menu, "Завершить партию" ("End the game")
  - Surfaced by: WARNING 11.4 and Pass 1 (Claude 4, Codex 5)
  - Files: `shared/protocol.ts`, `server/game-engine.ts`, `web/src/components/HostMenu.svelte`, `web/src/screens/Lobby.svelte`
  - Verify: unit test of the transition to `FINAL` on the host's command; E2E of copying
- [ ] **T25 (P1, human: ~1d / CC: ~30min)** — results — Auto-advance pause while an AI card is open (limit 90 s)
  - Surfaced by: Pass 3 — auto-advance interrupted reading the explanations (Claude 8, Codex 10)
  - Files: `shared/protocol.ts`, `server/game-engine.ts`, `web/src/screens/RoundResults.svelte`
  - Verify: unit tests of the state machine pause
- [ ] **T26 (P1, human: ~3d / CC: ~1h)** — a11y — Keys, keyboard marker, announcements, width modes, axe checks
  - Surfaced by: Pass 6 — keyboard and narrow windows are not defined (Claude 11, Codex 2), WARNING 11.3
  - Files: `web/src/lib/keys.ts`, `web/src/components/GuessMap.svelte`, `web/tests/a11y.spec.ts`
  - Verify: keyboard-only E2E; `@axe-core/playwright` on the five screens
- [ ] **T27 (P2, human: ~1d / CC: ~20min)** — i18n — Declensions, number and distance format, nickname truncation
  - Surfaced by: Pass 4 — no rules for Russian text (Claude 14)
  - Files: `web/src/i18n/ru.ts`, `web/src/i18n/format.ts`, `web/src/i18n/format.test.ts`
  - Verify: `bun test web/src/i18n/format.test.ts`
- [ ] **T28 (P2, human: ~3d / CC: ~1h)** — motion — Full results reveal, final (confetti, "Лучший из людей"), AI card from the final table (M4)
  - Surfaced by: Pass 3 — the main moment of the game was not described (Claude 8, 9, 12; Codex 10, 11, 12, 13)
  - Files: `web/src/components/ResultsMap.svelte`, `web/src/screens/RoundResults.svelte`, `web/src/screens/Final.svelte`
  - Verify: E2E, after space the result is on screen without waiting

#### Design Review Completion Summary

```
  +====================================================================+
  |         DESIGN PLAN REVIEW — COMPLETION SUMMARY                    |
  +====================================================================+
  | System Audit         | No DESIGN.md; 5 screens, 8 components       |
  | Step 0               | 3/10; all 7 passes                          |
  | Pass 1  (Info Arch)  | 3/10 → 8/10 after fixes                     |
  | Pass 2  (States)     | 5/10 → 9/10 after fixes                     |
  | Pass 3  (Journey)    | 4/10 → 8/10 after fixes                     |
  | Pass 4  (AI Slop)    | 3/10 → 8/10 after fixes                     |
  | Pass 5  (Design Sys) | 1/10 → 8/10 after fixes                     |
  | Pass 6  (Responsive) | 2/10 → 8/10 after fixes                     |
  | Pass 7  (Decisions)  | 30 resolved, 8 deferred                     |
  +--------------------------------------------------------------------+
  | NOT in scope         | written (6 items)                           |
  | What already exists  | written                                     |
  | TODOS.md updates     | 1 item proposed                             |
  | Approved Mockups     | 0 generated, 0 approved                     |
  | Decisions made       | 30 added to plan                            |
  | Decisions deferred   | 8 (listed below)                            |
  | Overall design score | 1/10 → 8/10                                 |
  +====================================================================+
```

All passes are at 8 or above. The decisions were made in `/autoplan` auto mode and await the owner's approval at the final step; until then the plan is not considered approved on design. After implementation, `/design-review` is needed for a live check.

#### Unresolved after phase 2

For final approval (questions of taste; the recommended option is in effect in the plan):

- **D-1. Visual language.** The "asphalt and road markings" image, Unbounded and Onest fonts, one yellow accent. There are no mockups, the owner sees only the description. Alternative: configure an image key and choose a direction from mockups (`/design-shotgun` or `/design-consultation`).
- **D-2. Reading pause.** Auto-advance stands still while anyone has an AI card open, for no more than 90 s per round. Alternative: keep a hard 30 s.
- **D-3. 5 s cutoff for panorama loading.** Kept: the round starts for everyone, a latecomer has the shared timer. Codex suggests waiting longer and letting the host replay the round without scoring; deferred to `TODOS.md`.
- **D-4. "Люди против ИИ" ("Humans vs AI") score in M2.** Kept in M2 by the phase 1 decision. The Claude voice suggests moving it to M1: the function is pure, and the "humans against machines" storyline is the main one.
- **D-5. Phone.** A warning and a fallback single-column layout instead of blocking entry.
- **D-6. "Завершить партию" in the host menu on any screen.** A small extension: previously the button existed only on a round preparation failure.

Passed to the engineering phase:

- What happens when the host is disconnected (who presses "Дальше" ("Next") and "Ещё раз"): the guest view depends on this rule.
- The format of marker and answer confirmations and the way to reconcile the client clock with the server.

Closed from the inherited items: C-UI, WARNING 11.2, 11.3 and 11.4.

#### Auto-decision log, phase 2

| No. | Phase | Decision | Class | Principle | Rationale | Rejected |
|---|---|---|---|---|---|---|
| 61 | Design | The phase was run by the separate `/plan-design-review` skill | mechanical | gstack documentation | The guard hook does not see the closure of phase 1 after context compaction; it must not be bypassed | reading protected files with another tool |
| 62 | Design | Review without mockups | mechanical | 6 | No image generation key | drawing mockups by hand instead of a designer |
| 63 | Design | Visual language "asphalt and road markings", Unbounded and Onest, one accent | taste | 5 | Dark dense panels do not compete with the panorama; both fonts have Cyrillic and a free license | system fonts, light theme, glass over the panorama |
| 64 | Design | `DESIGN.md` and `tokens.css` in M0, color check in `bun run check` | mechanical | 1 | Both voices: without a system every screen gets its own look | postpone to M4 |
| 65 | Design | Participant: color, shape and letter; a 12-color palette | mechanical | 1 | Both voices: color cannot be the only marker with 11 participants | color only |
| 66 | Design | Square avatar with a chip icon for AI | taste | 5 | A square and a circle are distinguishable at a small size | hexagon (Claude) |
| 67 | Design | Screen layouts as diagrams; lobby in two columns of rows | mechanical | 5 | Both voices: layout not defined; cards are not needed | set of cards, bottom panel |
| 68 | Design | Participant list in a round with names, shrinks to avatars narrower than 1280 px | taste | 5 | Names are needed to see who has answered | always avatars only (Claude) |
| 69 | Design | Shutter over the panorama until the end of the countdown | mechanical | 1 | Equal conditions with bots, whose `observe()` is delayed | dimmed but visible panorama |
| 70 | Design | Server confirmations and answer-zone states | mechanical | 1 | Codex 7: the player must know the answer was accepted | show "accepted" right away on the client |
| 71 | Design | One timer; caption "Все ответили. ИИ думают" | mechanical | 5 | Codex 9: two countdowns conflict | a separate countdown of the waiting window |
| 72 | Design | Auto-advance pause while an AI card is open, limit 90 s | taste | 1 | Both voices: 30 s is not enough for three explanations of up to 600 characters | hard 30 s; pause without a limit |
| 73 | Design | The first line of the AI explanation is visible in the table without a click | mechanical | 1 | Explanations are a distinguishing feature of the game, they must not be hidden behind an icon | AI icon only |
| 74 | Design | Distance labels on the map only for one's own and the selected marker | taste | 5 | Codex 11: 11 labels and arcs are unreadable | labels for all |
| 75 | Design | Final: tie, fewer than three participants, early end, AI victory without confetti | mechanical | 1 | Both voices: outcome variants not defined | one podium look |
| 76 | Design | AI card from the final table (M4) | taste | 2 | Thumbnails are kept anyway until the return to the lobby; the change is small | do not do it |
| 77 | Design | Lobby invitation with a check state; host menu | mechanical | 1 | WARNING 11.4, both voices | link only in the terminal |
| 78 | Design | "Завершить партию" in the host menu on any screen | taste | 2 | Otherwise a failed game can only be interrupted by stopping the server | only on a preparation failure |
| 79 | Design | Keyboard marker: crosshair and Enter | mechanical | 1 | Both voices; the maps already move with arrows, the change is small | pointer only |
| 80 | Design | Design window 1280 × 720; narrower than 900 px a warning and one column | taste | 3 | WARNING 11.3: a friend may open the link from a phone | forbid joining from a phone; full mobile layout |
| 81 | Design | axe checks and no-horizontal-scroll checks in E2E | mechanical | 1 | Accessibility not written into tests will not appear | manual check |
| 82 | Design | The 5 s cutoff for panorama loading kept | taste | 3 | One slow client must not hold everyone; friends are in a voice chat | long wait and round replay (Codex 8) |
| 83 | Design | The "Люди против ИИ" score stays in M2 | taste | phase 1 decision | The scope after the "First game" gate is confirmed by the owner | move to M1 (Claude 9) |
| 84 | Design | Russian text rules via `Intl` | mechanical | 4 | Standard facilities instead of custom declension tables | custom declension function |
| 85 | Design | Light map: `positron` or the standard Google scheme | taste | 5 | A light map reads better, the dark panels frame it | dark map scheme |
| 86 | Design | The "Check" mark is tied to the settings it was obtained on | mechanical | 1 | Codex 6: a green mark must not confirm the unchecked | mark without expiry |
| 87 | Design | Conditions of the "Начать" button and reasons next to it | mechanical | 5 | Codex 5, Claude 6 | inactive button without explanation |
| 88 | Design | Behavior on host disconnect passed to the engineering phase | mechanical | 6 | This is a state machine rule, the appearance follows from it | decide in design |

### Phase 2.5. DX review (DX POLISH mode)

#### How the phase went

- Like phase 2, it was run by the separate `/plan-devex-review` skill with the `/autoplan` auto-decision rules (the pipeline's guard hook does not see the closure of phase 1 after context compaction).
- The skill's questions (product type, persona, narrative, time goal, magical moment, mode, friction points) were resolved by the 6 principles and recorded in the log below; only questions of taste are put up for final approval.
- The gstack records under the key `tass` (learned lessons, earlier DX-review tasks, past scores) belong to a different project and were not used. There are no earlier DX reviews of this plan.

#### Product type and persona

Type: a command-line tool (`bun run start`, `doctor`, `dev`) with setup of external services; second layer: a project built by AI agents.

```
TARGET DEVELOPER PERSONA
========================
Who:       the owner, a TypeScript developer on Linux; Bun, cloudflared and logged-in harnesses are already installed
Context:   sets up the project and the Google keys once, then on game night runs start and sends the link to friends in the chat
Tolerance: first run up to 20-30 minutes (he understands Google setup); on game night no more than a minute, friends are already in the voice chat
Expects:   one launch command, a clear cause and a fix command for every error, nothing to assemble by hand
```

Second persona: an AI agent (Claude Code, Codex) that builds the project from the plan. It reads the output of `bun run check`, the tests and `doctor` literally, cannot ask follow-up questions, and repeats commands blindly.

#### The owner's story (per the plan, no code)

"I clone the repository and run `bun install`. The README tells me to get two Google keys. I go to Cloud Console: a project, billing, two APIs, two keys with restrictions. The plan did not spell out these steps, and I would spend about twenty minutes guessing which restriction goes on which key and what quotas to set. I put the keys into `.env` and run `doctor`: it checks the server key and the harness logins and prints a command for every problem. I run `start`. Here the plan was silent: whether to build the client myself, which port, what happens if the link is not ready within 60 s, with what exit code everything fails. The browser key is checked only in the browser. If the server crashes in the middle of a game, I will not know why. The agent that writes the code has nothing to develop the screens with without keys and subscriptions." The gaps of this story (build, keys, error codes, development without keys) are closed by the items of section 14.

#### Comparison with similar projects

| Project | Start → result | Time, kind of estimate | DX decision | Source |
|---|---|---|---|---|
| Azimuth | clone → `.env` with one Google key → `npm install` → `npm run dev` | not measured | the key can also be entered in the game settings | github.com/mesmerica/azimuth |
| WorldGuessr | clone → `pnpm install` → `pnpm run dev` | not measured | an ordinary dev server | github.com/codergautam/worldguessr |
| Enigjewo | billing → Maps JS API → key in Credentials | not measured | the Google steps are listed in the README | github.com/leny/Enigjewo |
| Earthwalker | Docker → localhost:8080 | not measured | no Google key, via public embedding | github.com/daehli/earthwalker |
| geoaissr (plan) | clone → keys → `doctor` → `start` → friend in the lobby | estimate: 20 min the first time, up to 1 min afterwards | two keys, tunnel, verified link, the host's browser opens by itself | section 14 |

Limitation: no time is measured, similar projects have no tunnel and no bots, so decisions are compared, not minutes. The Earthwalker path without a Google key does not fit: the plan uses the official API, and Google's terms were checked in phase 1.

Goal (auto-decision, the "realistic" option): first run up to 20 minutes, most of it in Cloud Console; a repeat run on game night up to 1 minute from `bun run start` to the copied link. By the skill's scale, the first run stays in the "Red Flag" class (over 10 minutes) because of Google; the repeat run is in the "Champion" class.

#### Magical moment

`bun run start` builds the client, verifies the link, prints «Ссылка готова за 14 с» ("Link ready in 14 s") and itself opens the host's lobby in the browser; in the lobby there is a «Скопировать приглашение» ("Copy invitation") button; a friend opens the link and appears in everyone's lobby live. The means are already in the plan (link verification, the copy button from phase 2); browser opening with the `--no-open` flag is added.

#### Owner's path

```
STAGE           | DEVELOPER DOES                         | FRICTION POINTS                              | STATUS
----------------|----------------------------------------|----------------------------------------------|--------
1. Discover     | reads the README                       | none                                         | ok
2. Install      | bun install, keys, .env                | Google steps not spelled out                 | fixed
3. Hello World  | doctor, start, friend joins            | client build, port, browser key              | fixed
4. Real Usage   | game night: start, link to the chat    | none                                         | ok
5. Debug        | start error, server crash, bot at 0    | no codes, exit codes, crash file             | fixed
6. Upgrade      | git pull, bun install, start           | new file format, quota                       | fixed
```

#### Newcomer report

```
FIRST-TIME DEVELOPER REPORT
============================
Persona: the owner (and the AI agent that builds the project)
Attempting: geoaissr, first run

CONFUSION LOG:
T+0:00  bun install. No questions.                                              ok
T+0:30  README: "Google keys". Which APIs, which restrictions, which quotas?    fixed: "Как получить ключи" ("How to get the keys")
T+15:00 doctor: "REQUEST_DENIED". The key or the API? Which step to repeat?     fixed: error_message and steps in order
T+17:00 start: build the client or not? What does "not ready within 60 s" mean? fixed: build on every launch, error format
T+18:00 a friend opened the link, the map does not load: browser key referrer   fixed: client_error with a code and an instruction step
T+40:00 the agent writes the lobby screen, has no keys or subscriptions         fixed: dev --fake, separate data directories
```

#### Passes

**Pass 1. First run: 4 → 7.** There were no Google steps, no answer about building the client, the port, or preliminary checks. Now: four README steps, a build in `start`, checks before launch, browser opening. Reaching 10 is blocked by Cloud Console: billing and two keys take most of the time, and this cannot be avoided without giving up the official API.

**Pass 2. Commands: 6 → 8.** The commands are named simply (`start`, `doctor`, `dev`), defaults exist. Added `--port`, `--no-open`, `--fake`, `doctor --json`, `setup:dev`, `doctor` check levels, shared data-directory variables. The commands do not ask questions in the terminal, so nothing blocks the agent.

**Pass 3. Errors: 3 → 8.**

```
ERROR PATH MATRIX (agent-ready-v1), before the edits
Path                         | Class       | what | fix  | recovery | code | context | trace | redaction | channel | Cap
start: no key in .env        | usage       | fail | fail | N/A      | fail | N/A     | N/A   | pass      | fail    | CAP6:fix
start: link not ready in 60 s| dependency  | pass | pass | fail     | fail | fail    | N/A   | pass      | fail    | CAP6:recovery
doctor: harness not logged in| environment | pass | pass | pass     | fail | fail    | N/A   | pass      | fail    | CAP6:context
server crashed mid-game      | unexpected  | fail | fail | fail     | fail | fail    | fail  | pass      | fail    | CAP6:trace
geo tool: invalid argument   | validation  | pass | pass | N/A      | fail | N/A     | N/A   | pass      | fail    | -
```

Secrets were already masked by the phase 1 decision, there are no questions in the terminal, so there is no CAP4. After the edits all five paths pass: the code registry with `docs/errors.md`, an error format with the fix on the last line, exit codes 1, 2, 3 and 70, `doctor --json`, a crash file without tokens, `isError: true` on the `geo` tools. An example of a corrected line is given in the item "Command-line and bot tool errors". There is no verbose output mode: the full log and the crash file replace it.

**Pass 4. Documentation: 4 → 7.** The README got an exact composition: «Быстрый старт» ("Quick start"), «Как получить ключи», «Обновление» ("Upgrade"), `docs/errors.md`, `CLAUDE.md` with the commands. `dev --fake` replaces a game sandbox. Reaching 10 lacks a README check on a clean machine: it is part of the first-run measurement.

**Pass 5. Upgrade: 5 → 7.** There was a `version` field and the `.bad` rule. Added migrations by version, separate behavior for a file newer than the program (the quota is not reset), client rebuild on every launch. A CHANGELOG and semantic versions are not needed for a single-owner project.

**Pass 6. Dev environment: 6 → 8.** There were `dev` with reload, a fake harness and a panorama provider in tests. Added `dev --fake`, data-directory isolation, `setup:dev`, requirements for `shellcheck` and Playwright browsers. The owner's quality gates (strict linters, limits of 500, 1000 and 80 lines with a checker and an exceptions list, a CI job and a pre-push hook installed with one command, `CLAUDE.md`) are in the plan in M0; no findings.

**Pass 7. Community: 5 → 5.** A project for three friends in a private repository; community is not a goal. Spike S4 checks the licenses of open clones. No edits.

**Pass 8. Measurement: 4 → 7.** There was a measurement of the game at the "First game" gate, but no measurement of setup. Added "Ссылка готова за N с" ("Link ready in N s") in `start` and a record of the first run in `docs/playtest-1.md` before the second person joins, with the codes of the errors encountered.

#### Outside voice

CODEX SAYS (plan review — outside voice), 8 findings, 3 high, summary "Revise the DX contract before implementation because startup success, diagnostic requirements, and persistence isolation are still ambiguous enough for agents to build incompatible or unsafe behavior":

1. High. `doctor` would fail with one harness not logged in, although one is enough for the game. Accepted: check levels.
2. High. A quota file newer than the program would reset the count. Accepted: `start` does not launch; a corrupted file requires host confirmation (refines the phase 1 decision).
3. High. Fakes and tests would write to the owner's real directories. Accepted: directory variables, `.geoaissr-dev/`, temporary directories in tests.
4. Medium. The sum of sources for the build decision missed the build inputs. Accepted: build on every launch.
5. Medium. A new harness version without a rule for what stays available. Accepted: a warning, the harness is available.
6. Medium. A working copy without `shellcheck` and Playwright browsers. Accepted: `setup:dev`.
7. Medium. The first-run measurement ended before the browser key was checked. Accepted: the measurement ends after the second person joins.
8. Medium. `REQUEST_DENIED` does not give an exact step. Accepted: Google's `error_message` and steps in order.

No disagreements with my own review: all 8 findings refine items of this phase, none changes the owner's intent.

#### Out of scope

- Playing without a Google key via public embedding (like Earthwalker): diverges from the chosen official API.
- A key setup wizard in the browser: the README and `doctor` are cheaper and need no interface.
- A QR code of the link in the terminal: a phone is not a goal of the first version.
- CHANGELOG, semantic versions, a community channel: a single-owner project.
- A client build cache: until it is measured that the build gets in the way.

#### What already exists

There is no code. The plan already had: `doctor` with a cause and a fix command, the `version` field and the `.bad` rule, token masking, the server log, a fake harness and panorama provider for tests, link readiness check, quality gates in M0. The new items build on them.

#### Changes to `TODOS.md`

None: all accepted edits went into the plan tasks.

#### Implementation Tasks

Synthesized from this review's findings. Each task derives from a specific finding above. Run with Claude Code or Codex; checkbox as you ship. Estimate: the "human to CC" ratio is about 30 for commands and 50 for tests.

- [ ] **T29 (P1, human: ~1d / CC: ~30min)** — cli/start — Client build, checks before launch, `--port`, `--no-open`, ready-link block
  - Surfaced by: Pass 1 — WARNING 9.2, the "Hello World" path
  - Files: `server/cli/start.ts`, `server/cli/preflight.ts`, `server/cli/start.test.ts`
  - Verify: integration `start --no-tunnel --no-open` on a clean directory
- [ ] **T30 (P1, human: ~1d / CC: ~30min)** — cli/errors — Code registry, error format, exit codes, crash file, `docs/errors.md`
  - Surfaced by: Pass 3 — error matrix, CAP6 on four paths
  - Files: `server/errors.ts`, `server/cli/report-error.ts`, `docs/errors.md`, `server/errors.test.ts`
  - Verify: `bun test server/errors.test.ts`; integration for code 70 and the crash file
- [ ] **T31 (P1, human: ~1d / CC: ~30min)** — cli/doctor — Check levels, `--json`, Google `error_message`, harness versions
  - Surfaced by: Pass 2 and Codex 1, 5, 8
  - Files: `server/cli/doctor.ts`, `server/cli/doctor.test.ts`
  - Verify: `bun test server/cli/doctor.test.ts`
- [ ] **T32 (P1, human: ~4h / CC: ~15min)** — docs — README «Быстрый старт», «Как получить ключи», «Обновление»
  - Surfaced by: Pass 4 — the Google steps are not spelled out
  - Files: `README.md`, `.env.example`
  - Verify: first-run measurement on a clean directory
- [ ] **T33 (P1, human: ~1d / CC: ~30min)** — dev — `dev --fake`, data-directory variables, `setup:dev`, isolation in tests
  - Surfaced by: Pass 6 and Codex 3, 6
  - Files: `server/paths.ts`, `server/dev/fake.ts`, `scripts/setup-dev.ts`, `test/setup.ts`, `CLAUDE.md`
  - Verify: `bun run setup:dev && bun run check && bun run test` without network
- [ ] **T34 (P1, human: ~4h / CC: ~20min)** — storage — Version migrations, a file newer than the program, host confirmation after a corrupted quota
  - Surfaced by: Pass 5 and Codex 2
  - Files: `server/storage/migrate.ts`, `server/storage/quota.ts`, `server/storage/migrate.test.ts`
  - Verify: `bun test server/storage`
- [ ] **T35 (P2, human: ~2h / CC: ~10min)** — gate — First-run measurement in `docs/playtest-1.md`
  - Surfaced by: Pass 8 and Codex 7
  - Files: `docs/playtest-1.md`
  - Verify: the record exists before M2 starts

#### DX Review Scorecard

```
+====================================================================+
|              DX PLAN REVIEW — SCORECARD                             |
+====================================================================+
| Dimension            | Score  | Prior  | Trend  |
|----------------------|--------|--------|--------|
| Getting Started      |  7/10  |  4/10  |  +3 ↑  |
| API/CLI/SDK          |  8/10  |  6/10  |  +2 ↑  |
| Error Messages       |  8/10  |  3/10  |  +5 ↑  |
| Documentation        |  7/10  |  4/10  |  +3 ↑  |
| Upgrade Path         |  7/10  |  5/10  |  +2 ↑  |
| Dev Environment      |  8/10  |  6/10  |  +2 ↑  |
| Community            |  5/10  |  5/10  |  0     |
| DX Measurement       |  7/10  |  4/10  |  +3 ↑  |
+--------------------------------------------------------------------+
| TTHW                 | 20 min | 30 min | -10 ↓  |
| Competitive Rank     | Red Flag (first run), Champion (repeat run) |
| Magical Moment       | designed via start + verified link + browser |
| Product Type         | CLI Tool                                    |
| Mode                 | POLISH                                      |
| Overall DX           |  7/10  |  4/10  |  +3 ↑  |
+====================================================================+
| DX PRINCIPLE COVERAGE                                               |
| Zero Friction      | gap: Cloud Console is unavoidable              |
| Learn by Doing     | covered: dev --fake                            |
| Fight Uncertainty  | covered: codes, fix, doctor --json             |
| Opinionated + Escape Hatches | covered: port, --no-open, --no-tunnel |
| Code in Context    | covered: four-step README                      |
| Magical Moments    | covered                                        |
| Agents Are Users   | covered: --json, exit codes, no questions      |
+====================================================================+
```

The "Prior" scores are the plan's scores before this phase (the first DX review). TTHW is estimated, not measured. Only "Community" is below 6, and it is not a project goal. The first run takes more than 10 minutes because of Cloud Console; it is not considered a blocker because the repeat run fits in a minute.

```
DX IMPLEMENTATION CHECKLIST
============================
[ ] First run < 20 min, repeat run < 1 min
[ ] Installation: bun install and four README steps
[ ] start prints the verified link and the time
[ ] Magical moment: the host's browser opens by itself, a friend appears in the lobby
[ ] Every error follows the agent-ready contract (Pass 3)
[ ] Command names are clear without documentation
[ ] Every flag has a default value
[ ] README checked on a clean directory
[ ] dev --fake works without keys and subscriptions
[ ] File format migrations with tests
[ ] Works in CI without special setup (bun run check, bun run test)
```

#### Unresolved after phase 2.5

For final approval (questions of taste; the recommended option is in effect in the plan):

- **X-1. DX POLISH mode**, not DX EXPANSION. For a single-owner project, DX expansions (a key wizard, a QR code) do not pay off.
- **X-2. A corrupted `quota.json` requires host confirmation** before the first game with bots. Phase 1 decided to start the count from zero with a warning; Codex showed that this makes the quota protection disappear silently.

Passed to the engineering phase: the format of the crash file and how it combines with the 14-day log.

#### Auto-decision log, phase 2.5

| No. | Phase | Decision | Class | Principle | Rationale | Rejected |
|---|---|---|---|---|---|---|
| 89 | DX | The phase was run by the separate `/plan-devex-review` skill | mechanical | gstack documentation | Same reason as in phase 2 | hook bypass |
| 90 | DX | Product type: command-line tool | mechanical | 5 | `start`, `doctor`, `dev` are the owner's whole surface | platform, SDK |
| 91 | DX | Persona: the owner; second: the AI agent | mechanical | 1 | One person sets up the game; agents build it | owner only |
| 92 | DX | Goal: 20 min the first time, up to 1 min afterwards | mechanical | 3 | Cloud Console cannot be shortened; game night can | under 2 minutes the first time |
| 93 | DX | Magical moment: verified link, time, host's browser | mechanical | 4 | The means are already in the plan | QR code in the terminal |
| 94 | DX | DX POLISH mode | taste | 3 | The recommended option; a single-owner product | DX EXPANSION |
| 95 | DX | `start` builds the client on every launch | mechanical | 5 | Closes WARNING 9.2; Codex 4: the sum of sources missed the inputs | sum of sources; a separate build command |
| 96 | DX | Checks before launch and port 5174 with `--port` | mechanical | 1 | The error must come before the tunnel, not after | checks only in `doctor` |
| 97 | DX | `start` opens the host's browser, `--no-open` | mechanical | 4 | Magical moment; without a graphical session a line instead of a browser | only print the link |
| 98 | DX | Google steps in the README with a time estimate | mechanical | 1 | Most of the first run's time goes there | a link to Google's documentation |
| 99 | DX | The browser key is checked via `client_error` in the lobby | mechanical | 5 | The server cannot check the referrer on behalf of the browser | check in `doctor` |
| 100 | DX | Code registry, error format, exit codes, `docs/errors.md` | mechanical | 1 | The Pass 3 matrix: CAP6 on four paths | free-text errors |
| 101 | DX | `doctor --json` | mechanical | 1 | Second persona: the agent reads the output literally | text only |
| 102 | DX | Crash file with a full stack, without tokens | mechanical | 1 | An unexpected crash cannot be diagnosed otherwise | stack in the terminal |
| 103 | DX | `isError: true` on the `geo` tools | mechanical | 5 | The MCP error channel | error as plain text |
| 104 | DX | `dev --fake` | mechanical | 2 | Fakes already exist in tests; developing screens without keys and quota | development only with keys |
| 105 | DX | Data-directory variables, `.geoaissr-dev/`, temporary directories in tests | mechanical | 1 | Codex 3: tests could write to the owner's real files | paths in code |
| 106 | DX | `setup:dev` | mechanical | 1 | Codex 6: `shellcheck` and Playwright browsers | a command list in the README |
| 107 | DX | `doctor` check levels | mechanical | 1 | Codex 1: one harness not logged in must not fail `doctor` | all checks mandatory |
| 108 | DX | New harness version: a warning, the harness is available | mechanical | 6 | Codex 5; game night matters more than strict checking | hide the harness |
| 109 | DX | Google `error_message` and steps in order | mechanical | 5 | Codex 8: the status does not name the cause | one step per status |
| 110 | DX | Migrations by version; a file newer than the program | mechanical | 1 | Upgrading without losing settings | only `.bad` |
| 111 | DX | Quota newer than the program: `start` does not launch | mechanical | 1 | Codex 2: unknown usage is not zero | default values |
| 112 | DX | Corrupted quota: host confirmation | taste | 1 | Codex 2; refines the phase 1 decision | silently from zero |
| 113 | DX | Measure the first run until the second person joins | mechanical | 1 | Codex 7: the measurement must verify the browser key | until the link is ready |

### Phase 3. Engineering review

#### How the phase went

The phase was run by the separate `/plan-eng-review` skill with the `/autoplan` auto-decision rules (the same fallback path as in phases 2 and 2.5). There were no questions along the way; contested decisions are put up for final approval. There is no code in the repository, so the review checks the plan against itself, against the help output of the installed CLIs, and against short checks on the owner's machine.

Prior knowledge: a search by project returned 10 entries from a different project with the same slug `tass`. Two of them apply in substance.

- Prior learning applied: telegram-stop-controller-timeout-observability (confidence 10/10, from 2026-11-05). A separate process group bounds the stopping of child processes; hence `spawnManaged` with groups.
- Prior learning applied: codex-tool-call-shape-and-rendered-delivery-proof (confidence 10/10, from 2026-11-07). In `codex` a tool call is recorded in different shapes; hence the S1 item about the result shape.

History: no commits, no reverts (`git log` is empty); all paths in the plan are future ones.

#### Step 0. Scope check

**A. Assessment.**

- What already solves subtasks: built-in `Bun.serve` with WebSocket, `bun test`, `node:child_process` with `detached` (verified below), zod with conversion to JSON Schema, the `fontfile` parameter of `sharp`, `StreetViewPanorama` with the `pano` parameter. No custom code is needed for them.
- Minimal change set: the plan already cuts M1 down to one harness and one region. The only thing that can be deferred without harm is `eval:bots` (done: M2).
- Complexity: about 60 source and test files in M1 per sections 7 and 14 [estimated], more than two new services (`GameEngine`, `LocationService`, `BotImageService`, `BotRunner`, the `bot-tools` bridge, the quota store). The threshold for a structure question is passed.
- Search: a short check instead of web search. Bun 1.4.2: `spawn(..., {detached: true})` creates a group, `process.kill(-pgid)` stopped 3 of 3 processes of the group, the start-time field in `/proc/<pid>/stat` is readable [measured: scratchpad pg-probe.ts]. A functional core with an effect executor [Layer 1]; process group [Layer 1]; an MCP stdio-to-HTTP bridge [Layer 2, checked by S1].
- `TODOS.md`: nothing in it blocks the plan; "Round replay" and "Mobile layout" remain deferred. A new entry: MCP HTTP transport instead of the bridge (below).
- Distribution: the game runs from a working copy (`git clone`, `bun install`); there are no builds or publications, CI waits for a private remote (the owner's decision before code).

Reality checks:

| Premise | Claim | Confirmation | Conclusion |
|---|---|---|---|
| CLI versions | `codex` 0.167, `claude` 2.1.322, `agy` 1.5.7, `bun` 1.4.2 | PLAN.md:30; `Bun.version` 1.4.2 today | confirmed |
| Adapter flags | `-i`, `-c`, `-s`, `--json`; `--mcp-config`, `--strict-mcp-config`, `--allowedTools`; `-p`, `--settings`, `--output-format` | `--help` of all three today | confirmed; found `--skip-git-repo-check`, `--bare` without OAuth |
| `agy` not signed in | `Please sign in` | PLAN.md:32 | confirmed earlier |
| Key without Street View | `REQUEST_DENIED` | PLAN.md:35 | confirmed earlier |
| Google free tier | 5,000 / 10,000 per month | PLAN.md:36 | unverified (page date not confirmed; S3) |
| Quick tunnel and WebSocket | `101 Switching Protocols` | PLAN.md:37 | confirmed earlier |
| The model sees images from MCP | not checked | PLAN.md:39 | unverified (S1) |
| Harness turn time | not checked | PLAN.md:39 | unverified (S1) |
| Process groups in Bun | `detached` and `kill(-pgid)` | pg-probe.ts | confirmed today |

unverified=3.

Numbers recomputed: the worst case Static 5 × (12 + 3 × (6 + 3) × 4) = 600 and 5 × (12 + 3 × 7 × 4) = 480 match PLAN.md:147; 8,000 / 600 = 13, 10,000 / 600 = 16, 8,000 / 480 = 16 match. The thumbnail bound 5,760 (PLAN.md:364) is overstated: by the storage rules it comes to 20 × (4 + 3 × 20 × 4) = 4,880; as an upper estimate it is fine [estimated]. The world diagonal 14,916.862 km [estimated: community formula]. Free tier [re-measure before gate: S3].

REALITY: premise-table finding unverified=3: Google free tier, images from MCP, turn time; all three are closed by spikes S1 and S3 PLAN.md:36
REALITY: already-done pass no commits and no remote, no previously completed work PLAN.md:1
REALITY: surface-check finding flags checked against `--help`: `codex` outside git requires `--skip-git-repo-check`, `claude --bare` disables claude.ai login PLAN.md:121
REALITY: binding-decisions pass `gstack-decision-search` is empty; the owner's decisions (agy instead of gemini, the quality-gate rule) are respected PLAN.md:9
REALITY: numbers finding the quota calculations match, the thumbnail bound is overstated (4,880 versus 5,760), the free tier awaits S3 PLAN.md:364
REALITY: deferred-asks pass no related task; of the owner's requests only the choice of any model for all harnesses is deferred (M2, per S1) PLAN.md:221
REALITY: pr-count pass there is no `.gstack/ship-policy.json`, by default one PR per wave; without a remote there is no PR at all PLAN.md:201

**B. Structure.** The threshold is passed, the `plan-eng-review-structure` question was resolved by auto-decision following the recommendation.

- Original arrangement: five top-level directories, the packaging method is not defined (five workspaces with five `package.json` and `tsconfig` files are possible).
- Smaller arrangement (chosen): one `package.json`, two `tsconfig` files, directory boundaries checked by ESLint. The same functions, contracts and tests; fewer settings and no drift of dependency versions.

Pending remedies not decided here: none.

Scope record: feature answers: no reductions were proposed; structure: Smaller arrangement (auto-decision, principles 5 and 3); accepted scope: the plan of phases 1–2.5 unchanged plus the phase 3 items; pending remedies: none. Scope Challenge: scope accepted as-is.

**C. Scope remarks.** No issues found: there is nothing to cut, M1 is already an end-to-end slice.

#### Section 1. Architecture

```
browsers ──WSS──> /ws ──parse(zod)──> event ──┐
                                               v
timers, Google, harnesses ──event {matchId,gen}──> reduce(state, event, now)
                                               │        │
                                               │        └─> effects[] ──> shell.ts ──> timer | spawnManaged | fetch | file write
                                               v
                                        RoomState (single owner)
                                               │
                                  view(state, viewerId) ──> a whole view for each client

harness ──stdio MCP──> bot-tools (bridge) ──HTTP + token──> 127.0.0.1:BOT_PORT ──> bot queue ──> event
```

Two forms:

- Form A (plan): services hold their own pieces of state (`BotRunner` counts turns, handlers check the phase themselves after each wait).
- Form B (chosen): `reduce(state, event, now) → {state, effects}`, an effect executor, a single `RoomState`.

Depth argument: B hides all event-ordering rules behind one function with one entry point; the rule "check the phase after a wait" stops being a convention an agent will forget in a new handler. All races from the item "Event ordering" become rows of one test table.

Red flags:

1. Shallow module: the `bot-tools` bridge (forwarding). Fix: the bridge has no logic, schemas come from the server; it is transport, otherwise stdio cannot be connected.
2. Information leakage: who sees what would be decided by each broadcast. Fix: a single `view(state, viewerId)`.
3. Temporal decomposition: none; services are named by knowledge (location, images, bots).
4. Pass-through method: the bridge (see 1).
5. Split ownership: the turn counter in `BotRunner` and the phase in `GameEngine`. Fix: everything in `RoomState`.
6. Two ways to do one thing: launching processes (harnesses, `cloudflared`, Vite). Fix: one `spawnManaged`.
7. Imported internals: `web/` could import `server/`. Fix: boundaries in ESLint.
8. A list reconciled by hand: harnesses in `doctor`, the settings schema, the lobby and tests; tool schemas in the bridge and the server. Fix: an adapter registry and `shared/bot-tools.ts`.

Findings:

- [CRITICAL] (confidence: 7/10) PLAN.md:165 — "The server is authoritative: game state, timers, scoring" and PLAN.md:379 "Every handler checks the round number and phase": the rule depends on the discipline of every handler. Fix: form B.
- [CRITICAL] (confidence: 8/10) PLAN.md:165 — it is not said what exactly each client receives; broadcasting the shared state would give away other players' markers during a round. Fix: `view`.
- [CRITICAL] (confidence: 8/10) PLAN.md:137 — "the server kills the harness process (SIGTERM, after 2 s SIGKILL)": a signal to a single process leaves its descendants alive, and after a server crash the harnesses live on. Fix: process groups, `children.json`, a directory lock.
- [CRITICAL] (confidence: 9/10) PLAN.md:121 — `codex exec -m <model> -s read-only ...` in an empty temporary directory: without `--skip-git-repo-check`, `codex exec` does not run outside a git repository. Checked today in an empty directory: "Not inside a trusted directory and --skip-git-repo-check was not specified."
- [INFORMATIONAL] (confidence: 9/10) PLAN.md:353 — "The harness's user settings ... the adapter disables with flags": the shortest path `claude --bare` disables login via claude.ai (help of 2.1.322). A prohibition and candidates are recorded.
- [INFORMATIONAL] (confidence: 7/10) PLAN.md:82 — "The host presses «Дальше»" ("Next"): it is not said what happens without a host (question C-HOSTDROP), with two tabs, and with a return in the middle of a round.
- [INFORMATIONAL] (confidence: 7/10) PLAN.md:47 — "The client sends it as the first WebSocket message": a connection without a token holds a slot in the ceiling of 32 for any length of time.
- [INFORMATIONAL] (confidence: 7/10) PLAN.md:494 — "The server confirms every marker position": the confirmation format and the clock calculation are not defined (passed on by the design phase).
- [INFORMATIONAL] (confidence: 5/10) PLAN.md:121 — "read-only sandbox without network": Medium confidence, verify this is actually an issue. A bridge launched by the harness may not reach `127.0.0.1` from inside the sandbox. Added to S1.

Dispositions: all 9 accepted by auto-decision (log 116–118, 121–127); form B is put up for final approval as E-1.

#### Section 2. Code quality

- [CRITICAL] (confidence: 7/10) PLAN.md:108 — "the server stamps the caption ... via `sharp`": a system font without Cyrillic will give squares, the bot will read garbage, and there will be no error. Fix: a font from the repository, a test.
- [INFORMATIONAL] (confidence: 8/10) PLAN.md:119 — the list of harnesses is repeated in the adapter table, `doctor`, the lobby and `harnesses.json`. Fix: an adapter registry.
- [INFORMATIONAL] (confidence: 8/10) PLAN.md:117 — tool schemas would live both in the bridge and on the server. Fix: `shared/bot-tools.ts`, the bridge takes them from the server.
- [INFORMATIONAL] (confidence: 7/10) PLAN.md:164 — directory boundaries are not checked. Fix: ESLint.
- [INFORMATIONAL] (confidence: 7/10) PLAN.md:200 — `check-size.ts` is not named for `.svelte`; `max-lines-per-function: 80` in tests will hit large `describe` blocks. Fix: a `.svelte` check and a rule in `CLAUDE.md`. The limits do not change.
- [INFORMATIONAL] (confidence: 7/10) PLAN.md:137 — processes are launched in three places in three ways. Fix: `spawnManaged`.
- [INFORMATIONAL] (confidence: 8/10) PLAN.md:270 — "`GuessMap` and `ResultsMap` are written straight for the chosen map, without a substitution layer" versus PLAN.md:571 "Google keys, tunnel and subscriptions are not needed" for `dev --fake`: when Google Maps is chosen, an E2E without network is impossible. Fix: a single map fake for `--fake` only.
- [INFORMATIONAL] (confidence: 7/10) PLAN.md:344 — "the counter ... is incremented before the request is sent": it is not said how it reaches the disk and what happens on a write error. Fix: an atomic write, the error is visible to the host.

Quality gates per the owner's rule: M0 has strict linters and a formatter (PLAN.md:199), size limits with a checker and an exceptions list that may only shrink (PLAN.md:200), CI and a pre-push hook with one command (PLAN.md:201), `CLAUDE.md` with the limits and commands (PLAN.md:202). No findings.

Shared code: there is no code, no call sites in sources; the proposed places (adapter registry, `spawnManaged`, `shared/bot-tools.ts`) are recorded as the plan's assumptions, M1 will verify them.

Dispositions: all 8 accepted by auto-decision (log 126, 128, 129, 134, 138, 140–142); the map fake is put up for approval as E-3.

#### Section 3. Tests

Framework: there is none in the repository yet. The plan: `bun test` and Playwright (log 140).

```
CODE PATHS                                              USER FLOWS
[+] server/engine/reduce.ts                             [+] Game
  ├── [PLANNED] transitions and races (§14 "Order")       ├── [PLANNED] [→E2E] two browsers, two rounds
  ├── [GAP]     event with a foreign {matchId,gen}        ├── [PLANNED] [→E2E] join and lobby by keyboard
  └── [GAP]     "Угадать" with coordinates                ├── [GAP]     [→E2E] host closed the tab mid-game
[+] server/engine/view.ts                                 └── [GAP]     second tab of the same identity
  └── [GAP]     no foreign markers or answer in a round [+] Errors visible to a person
[+] server/net/ws.ts                                      ├── [PLANNED] [→E2E] connection banner
  ├── [GAP]     connection without a token for 5 s        ├── [PLANNED] [→E2E] join states
  └── [GAP]     participant returns mid-round             └── [GAP]     second start with a live server
[+] server/proc/spawn.ts
  ├── [GAP]     the group stops as a whole
  └── [GAP]     cleanup by children.json and the lock
[+] server/bots/adapters/*
  └── [GAP]     argv and environment snapshot
[+] server/bots/queue.ts
  ├── [GAP]     two moves in the queue
  └── [GAP]     step with a 90° direction rejected
[+] server/images/label.ts
  └── [GAP]     caption drawn, no metadata
[+] server/storage/quota.ts
  └── [GAP]     interrupted write, write error, month change
[+] server/location.ts
  └── [GAP]     score from panorama coordinates
[+] web/src/lib/clock.ts
  └── [GAP]     offset by the smallest ping

LLM integration: [GAP] [→EVAL] prompt and tool schemas: eval:bots (M2)

COVERAGE: 0/27 paths covered by code (no code)  |  test named in plan: 9/27  |  after phase 3: 27/27
QUALITY: all new tests planned as ★★★ (behavior, edge, error)  |  GAPS before phase 3: 18 (1 E2E, 1 eval)
Legend: [PLANNED] test already named in the plan  |  [GAP] the plan had no test  |  [→E2E] end-to-end test needed  |  [→EVAL] model evaluation needed
```

Every gap is closed by a test in a phase 3 item (section 14). Gaps that reduce to the `reduce` table are added as rows in it, not as separate files. The value cards are in the Test Plan Artifact. There are no stale tests (there are no tests). There is no regression risk for existing behavior: there is no code.

Test Plan Artifact: `~/.gstack/projects/tass/tass-unknown-eng-review-test-plan-20261113-083416.md` (the name has `unknown`: the repository has no commits yet, and `gstack-slug` does not see the branch).

Dispositions: 12 new test requirements accepted (they pin down accepted items); `eval:bots` accepted into M2 (log 139).

#### Section 4. Performance

- [INFORMATIONAL] (confidence: 7/10) PLAN.md:544 — "`start` builds the client on every launch (`vite build`, a few seconds)" and PLAN.md:318 "Waiting up to 60 s": done sequentially, the build adds to the DNS wait, and the repeat-run goal is 1 minute. Fix: in parallel; DoH once every 2 s.

The rest is fine: markers 5 times per second from 8 players are up to 40 messages per second without being broadcast to others; the state view for 11 participants is a few KB [estimated]; thumbnails are bounded (up to 86 MB, PLAN.md:364); bot images are requested in parallel, 4 per `move`.

Dispositions: accepted (log 135).

#### Outside voice

Running the outside voice automatically (standard step). Disable: `gstack-config set codex_reviews disabled`.

The first attempt did not start: trimming the plan to 30 KB cut a UTF-8 character in half, and Codex refused to read the input. The input was fixed, the second attempt completed (`OUTSIDE_STATUS: completed provider=codex host=claude`, model gpt-6-astra).

```
CODEX SAYS (plan review — outside voice):
════════════════════════════════════════════════════════════
1. **High — Process cleanup can kill another live game.** ENG's `children.json` is shared across launches. Starting a second instance on another port can find matching commands and terminate the first instance's bots or tunnel. Command equality also does not establish ownership after PID reuse. Require exclusive ownership of the data directory and verifiable process identity before signalling anything.

2. **High — Round number is insufficient to reject stale effects.** ENG's reducer checks only the round number. Preparation retries, lobby configuration changes, and a new match can reuse that number. An old location response or timer can therefore affect current state. Use a match identifier plus an operation generation; invalidate outstanding work when preparation restarts.

3. **High — "Guess" can confirm the wrong marker.** Marker updates are throttled to five per second, but confirmation carries only `roundId`. Move the marker and immediately press "Guess": confirmation can reach the server before the buffered update, locking the previous location. WebSocket ordering cannot protect an update that has not been sent. Include coordinates in confirmation and commit them atomically. See [the existing answer rules](/home/tass/myprojects/geoaissr/PLAN.md:493).

4. **High — `move` does not implement movement along a road.** Finding a different panorama near an offset point establishes proximity, not connectivity. It can jump to a parallel road, another elevation, or a disconnected location while humans follow panorama links. The "same movement rules" promise is therefore unsupported. Prove a shared navigation model in S1, or disable movement for everyone in M1. See [the movement algorithm](/home/tass/myprojects/geoaissr/PLAN.md:105).

5. **High — Turn reservation does not serialize the bot's position.** Two concurrent `move` calls can start from the same panorama and finish in either order; an overlapping `look` has no defined origin. Reserving turns prevents overspending but leaves navigation nondeterministic. Serialize position-dependent operations per bot, or define explicit position versions and reject stale results. The proposed parallel-call tests cover accounting, not navigation.

6. **High — The scoring location and displayed panorama lack a shared identity contract.** The plan samples a geographic point and then finds a nearby panorama, but never explicitly requires scoring against the returned panorama's coordinates or loading that exact panorama for both humans and bots. Independent resolution or scoring against the sampled point can penalize a correct identification. Define one immutable round location containing the selected panorama and its actual coordinates. See [location selection](/home/tass/myprojects/geoaissr/PLAN.md:139).

7. **Medium — Prefetching conflicts with both quota admission and mutable lobby settings.** Paid starting images are prepared in the lobby, while the match budget is checked only at "Start." There is no rule for when preparation begins, how settings invalidate it, or how repeated preparations are bounded. The global ceiling prevents unlimited spending but does not preserve enough budget to play. Freeze a preparation configuration and reserve its budget before fetching. See [preparation and quota rules](/home/tass/myprojects/geoaissr/PLAN.md:335).

8. **Medium — The proposed bot evaluation cannot validate the advertised difficulty controls.** Ten individual street photographs do not provide the four directional views and navigable locations needed to evaluate `look`, `move`, or turn limits. Comparing one run with the previous run also mixes model variability with the change being tested. Define reproducible observation sequences and paired baseline/candidate runs before treating `eval:bots` as evidence for presets.

Recommendation: revise these contracts before M1 because the proposed tests can pass while the game confirms wrong coordinates, applies stale work, gives bots different movement rules, or terminates another running instance.
════════════════════════════════════════════════════════════
```

Model disagreements:

| No. | Codex finding | Decision | Class |
|---|---|---|---|
| 1 | Cleanup may kill someone else's game | Accepted: data-directory lock, three process identity markers | mechanical |
| 2 | The round number is not enough for stale effects | Accepted: `matchId` and the generation `gen` | mechanical |
| 3 | "Угадать" may lock an old marker | Accepted: coordinates in the confirmation | mechanical |
| 4 | `move` does not follow the road | The step with a direction check is kept, an honest caveat and a measurement in S3; if the match is below 80%, the owner decides | taste, E-2 |
| 5 | A single bot's moves are not ordered | Accepted: a per-bot queue, one current panorama | mechanical |
| 6 | The round location is not pinned down | Accepted: `pano_id` and the panorama coordinates | mechanical |
| 7 | Paid preparation before the quota check | Accepted: only free location search in the lobby | mechanical |
| 8 | `eval:bots` does not check moves and presets | Accepted: paired runs, starting snapshots only; presets from recorded games | mechanical |

Five Codex findings (1, 2, 3, 5, 8) found holes in items of phase 3 itself or in the protocol handed over by the design phase; three (4, 6, 7) concern the original plan. None changes the owner's intent: there are no User Challenges.

#### Out of scope

- MCP HTTP transport instead of the `bot-tools` bridge: depends on support in all three harnesses; recorded in `TODOS.md`.
- A bot move strictly along panorama links (via the Maps JavaScript API in the browser): requires a browser on the server and runs into the same Google terms question as UC-2.
- Protection against stopping the server with SIGKILL without cleanup at the next start: cleanup at start covers this sufficiently.
- Signed thumbnail addresses with a token: 128 bits of randomness in the address are enough for a game among friends.

#### What already exists

There is no code. Ready-made means are used: `Bun.serve` and its WebSocket, `bun test`, `node:child_process` with process groups (verified), zod and its conversion to JSON Schema, `sharp` with `fontfile`, `StreetViewPanorama` with `pano`, `@fontsource` for the caption font. The plan writes no replacements of its own for them.

#### Diagrams

The event flow diagram is in section 1. Inline diagrams are needed in `server/engine/reduce.ts` (the table of phases and events) and `server/proc/spawn.ts` (the life of a process group: launch, record, stop, cleanup).

```
LOBBY ──Начать (quota ok)──> ROUND_LOADING ──all loaded or 5 s──> ROUND_ACTIVE
  ^                              │  gen+1 on «Повторить»                    │ timer | all answered and bots finished | waiting window
  │                              v                                           v
  │                         location error ──Завершить──┐             ROUND_RESULTS ──Дальше | 30 s (pause up to 90 s)──> ROUND_LOADING
  │                                                    v                     │ last round
  └──────────── Ещё раз ─────────────────────────── FINAL <──────────────────┘   (and «Завершить партию» from ROUND_ACTIVE and ROUND_RESULTS)
```

#### Failure modes

| Path | Realistic failure | Test | Handling | Visible to a person |
|---|---|---|---|---|
| Harness | the server crashed, the harness lives on and spends the subscription | cleanup by `children.json` | stop at the next start | a line in the terminal during cleanup |
| Image caption | no Cyrillic font | caption test | font from the repository | not needed |
| `move` | a step onto a parallel street | S3 measurement | direction check, caveat | a hint in the lobby |
| «Угадать» | the marker was shifted before pressing | integration | coordinates in the confirmation | «Ответ принят» ("Answer accepted") with the correct marker |
| Preparation | an old Google response after «Повторить» | a `reduce` table row | discarded by `gen` | no: nothing changes |
| `quota.json` | disk full | unit | warning, start as with a corrupted file | host banner |
| Second `start` | two servers on one directory | unit | `GEO_ALREADY_RUNNING`, code 2 | error text |
| Bridge | server unavailable | integration | error «игра остановлена» ("the game has stopped") | AI card: the cause |

Critical gaps: before phase 3 there were two (harnesses after a server crash, a caption without a font): silent, without a test and without handling. Both are closed by accepted items; in the final plan there are 0.

#### Parallel work

| Step | Modules | Depends on |
|---|---|---|
| Quality gates | root, `scripts/` | — |
| Protocol and schemas | `shared/` | Quality gates |
| Core and view | `server/engine/`, `server/net/` | Protocol and schemas |
| Processes, storage, CLI | `server/proc/`, `server/storage/`, `server/cli/` | Quality gates |
| Bots | `server/bots/`, `bot-tools/`, `server/images/` | Protocol and schemas, S1 |
| Screens | `web/` | Protocol and schemas |

- Lane A: Protocol and schemas → Core and view (`shared/` first).
- Lane B: Processes, storage, CLI (independent).
- Lane C: Bots (after S1 and the protocol).
- Lane D: Screens (after the protocol).
- Order: quality gates; then A (protocol) and B in parallel; after the protocol is merged, C and D in parallel with the core.
- Conflicts: `shared/` is touched by A and C (tool schemas); `server/engine/` receives events from C. A writes the tool schemas, C only uses them.

#### Changes to `TODOS.md`

Added (auto-decision A, P3): "MCP HTTP transport instead of the `bot-tools` bridge".

#### Implementation Tasks

Synthesized from this review's findings. Each task derives from a specific finding above. Run with Claude Code or Codex; checkbox as you ship. Estimate: the "human to CC" ratio is about 30 for functions, 50 for tests, 5 for architecture.

- [ ] **T36 (P1, human: ~2d / CC: ~1h)** — engine — The `reduce` core and effect executor, a single `RoomState`, the operation tag `{matchId, gen}`, files split by phase
  - Surfaced by: Section 1 — the phase rule depended on handlers; Codex 2
  - Files: `server/engine/reduce.ts`, `server/engine/lobby.ts`, `server/engine/round.ts`, `server/engine/results.ts`, `server/engine/final.ts`, `server/engine/shell.ts`, `server/engine/reduce.test.ts`
  - Verify: `bun test server/engine`
- [ ] **T37 (P1, human: ~1d / CC: ~30min)** — protocol — `view(state, viewerId)`, `seq` and `ack`, coordinates in «Угадать», `serverNow` and clock offset
  - Surfaced by: Section 1 — no projection and no confirmation format; Codex 3
  - Files: `shared/protocol.ts`, `server/engine/view.ts`, `web/src/lib/clock.ts`, `server/engine/view.test.ts`, `web/src/lib/clock.test.ts`
  - Verify: `bun test server/engine/view.test.ts web/src/lib`
- [ ] **T38 (P1, human: ~1d / CC: ~30min)** — proc — `spawnManaged` with groups, `children.json` with three identity markers, data-directory lock, stop on exit and on crash
  - Surfaced by: Section 1 — SIGTERM to a single process; Codex 1
  - Files: `server/proc/spawn.ts`, `server/proc/registry.ts`, `server/proc/lock.ts`, `server/proc/spawn.test.ts`
  - Verify: `bun test server/proc`; integration for code 70 with no live processes
- [ ] **T39 (P1, human: ~1d / CC: ~30min)** — bots — Adapter registry, flags from the help output, snapshot of `argv` and environment
  - Surfaced by: Section 1 — `--skip-git-repo-check`, `--bare`; Section 2 — the list of harnesses is reconciled by hand
  - Files: `server/bots/adapters/index.ts`, `server/bots/adapters/codex.ts`, `server/bots/adapters/claude.ts`, `server/bots/adapters/agy.ts`, `server/bots/adapters/adapters.test.ts`
  - Verify: `bun test server/bots/adapters`
- [ ] **T40 (P1, human: ~1d / CC: ~30min)** — bot-tools — A bridge without logic, schemas in `shared/bot-tools.ts`, ephemeral `BOT_PORT`, a fake harness through the real bridge
  - Surfaced by: Section 2 — schemas in two places
  - Files: `bot-tools/main.ts`, `shared/bot-tools.ts`, `server/bots/api.ts`, `test/fake-harness.ts`
  - Verify: integration with the fake harness; rejection of the previous round's token
- [ ] **T41 (P1, human: ~1d / CC: ~30min)** — bots — Bot move queue, one current panorama, step direction check
  - Surfaced by: Codex 4 and 5
  - Files: `server/bots/queue.ts`, `server/bots/move.ts`, `server/bots/queue.test.ts`
  - Verify: `bun test server/bots/queue.test.ts`
- [ ] **T42 (P1, human: ~4h / CC: ~20min)** — location — Round location: `pano_id` and the panorama coordinates for humans, bots and scoring
  - Surfaced by: Codex 6
  - Files: `server/location.ts`, `web/src/components/PanoView.svelte`, `server/location.test.ts`
  - Verify: `bun test server/location.test.ts`; integration for a shared `pano_id`
- [ ] **T43 (P1, human: ~4h / CC: ~20min)** — images — Caption with a font from the repository, without metadata
  - Surfaced by: Section 2 — squares instead of Cyrillic
  - Files: `server/images/label.ts`, `server/images/label.test.ts`
  - Verify: `bun test server/images`
- [ ] **T44 (P1, human: ~1d / CC: ~30min)** — net — Host role by token, last tab, return mid-round, connections without a token
  - Surfaced by: Section 1 — C-HOSTDROP and the connection ceiling
  - Files: `server/net/ws.ts`, `server/engine/lobby.ts`, `server/net/ws.test.ts`
  - Verify: `bun test server/net`
- [ ] **T45 (P1, human: ~4h / CC: ~20min)** — storage — Atomic write of `quota.json`, write error is visible, month by UTC, paid images only after «Начать»
  - Surfaced by: Section 2 — the write path; Codex 7
  - Files: `server/storage/quota.ts`, `server/storage/quota.test.ts`, `server/engine/lobby.ts`
  - Verify: `bun test server/storage`
- [ ] **T46 (P1, human: ~4h / CC: ~15min)** — tooling — Import boundaries, `check-size` for `.svelte`, the `describe` rule in `CLAUDE.md`, `bun test` and Playwright
  - Surfaced by: Section 2 — boundaries and limits
  - Files: `eslint.config.js`, `scripts/check-size.ts`, `CLAUDE.md`
  - Verify: `bun run check` fails on a forbidden import
- [ ] **T47 (P2, human: ~2h / CC: ~10min)** — cli/start — Build in parallel with the tunnel, DoH once every 2 s
  - Surfaced by: Section 4
  - Files: `server/cli/start.ts`
  - Verify: repeat-run measurement in `docs/playtest-1.md`
- [ ] **T48 (P2, human: ~4h / CC: ~15min)** — logs — A record of harness launch, crash files under the 14-day rule, README about subscriptions
  - Surfaced by: passed on by phases 1 and 2.5 (bot log, C-SUBTERMS, crash file)
  - Files: `server/log.ts`, `README.md`, `server/log.test.ts`
  - Verify: integration log after a game without tokens
- [ ] **T49 (P2, human: ~2h / CC: ~10min)** — http — 128-bit thumbnail addresses, 404 after the lobby
  - Surfaced by: Section 1 — an image cannot carry a header with a token
  - Files: `server/http/thumbs.ts`, `server/http/thumbs.test.ts`
  - Verify: `bun test server/http`
- [ ] **T50 (P2, human: ~1d / CC: ~30min)** — spikes — Additions to S1 and S3: flag candidates, a bridge from inside the sandbox, the result shape, `sharp` under Bun, measuring the bot step
  - Surfaced by: Section 1; Codex 4
  - Files: `docs/spikes/s1.md`, `docs/spikes/s3.md`, `spikes/`
  - Verify: spike reports with an answer to each item
- [ ] **T51 (P2, human: ~1d / CC: ~30min)** — web — A map fake for `--fake` (only when Google Maps is chosen)
  - Surfaced by: Section 2 — the contradiction between "no substitution" and "no network"
  - Files: `web/src/components/FakeMap.svelte`
  - Verify: `bun run test:e2e` without network
- [ ] **T52 (P2, human: ~1d / CC: ~30min)** — eval — `eval:bots`: paired runs on own photographs, median and spread (M2)
  - Surfaced by: Section 3 [→EVAL]; Codex 8
  - Files: `scripts/eval-bots.ts`, `docs/evals/README.md`
  - Verify: two runs of the same version give close medians
- [ ] **T53 (P1, human: ~4h / CC: ~20min)** — maps — Reuse of map objects, `map_loaded` in the quota counter, maps in the worst case of a game, the daily Maps JavaScript API quota in the README and `doctor`
  - Surfaced by: final approval — UC-1 (Google Maps JS) made map loads a paid service
  - Files: `web/src/components/GuessMap.svelte`, `web/src/components/ResultsMap.svelte`, `server/storage/quota.ts`, `server/cli/doctor.ts`, `README.md`, `web/tests/maps.spec.ts`
  - Verify: E2E: two `map_loaded` per client per game; `bun test server/storage`

List registration: `gstack-tasks add --phase eng-review` was not run. The earlier phase list under the slug `tass` (run 20261031T120028Z-3551562, tasks from T39) belongs to a different project; closing or carrying it over would corrupt someone else's records. The rows are written to `.gstack/tmp/tasks-eng-review-rows.jsonl`.

#### Unresolved after phase 3

For final approval (questions of taste; the recommended option is in effect in the plan):

- **E-1. The game core as a pure transition function with an effect executor** (form B), rather than services with their own pieces of state. More expensive at the start, cheaper in every race.
- **E-2. The bot `move`**: a step to the nearest panorama with a direction check and an honest caveat is kept; S3 measures the match with Google's links, and if the match is below 80% the owner decides. Codex suggested proving a shared movement model in S1 or disabling movement in M1.
- **E-3. A map fake for `--fake` when Google Maps is chosen.** Refines the phase 1 decision "no substitution layer": there is no switch between real maps, but tests without network need one fake.

#### Eng Review Completion Summary

- Step 0: Scope Challenge — scope accepted as-is (structure: Smaller arrangement)
- Reality rows: 7/7 applicable rows emitted (`PLAN_REALITY: complete`), 3 unverified premises
- Architecture Review: 9 issues found
- Code Quality Review: 8 issues found
- Test Review: diagram produced, 12 gaps identified
- Performance Review: 1 issues found
- NOT in scope: written
- What already exists: written
- TODOS.md updates: 1 items proposed to user
- Failure modes: 0 critical gaps flagged (2 closed during the phase)
- Unresolved decisions: 3 in this review
- Outside voice: codex, completed (8 findings, all handled; the first attempt did not start because of a cut UTF-8 character)
- Parallelization: 4 lanes, 2 parallel / 2 sequential
- Lake Score: 14/15 = answers picking a 10/10 option / answers scored for Completeness

#### Auto-decision log, phase 3

| No. | Phase | Decision | Class | Principle | Rationale | Rejected |
|---|---|---|---|---|---|---|
| 114 | Eng | The phase was run by the separate `/plan-eng-review` skill | mechanical | gstack documentation | Same reason as in phases 2 and 2.5 | hook bypass |
| 115 | Eng | One `package.json`, two `tsconfig` files, no workspaces | mechanical | 5, 3 | The same functions, fewer settings | five packages |
| 116 | Eng | The `reduce` core and effect executor | taste | 5 | Races are resolved in one place | services with their own state |
| 117 | Eng | One `view(state, viewerId)`, a whole view | mechanical | 5 | Foreign markers cannot leak from a new broadcast | deltas |
| 118 | Eng | `seq` and `ack`, `serverNow`, offset by the smallest ping | mechanical | 1 | Passed on by the design phase | client time |
| 119 | Eng | Coordinates in «Угадать» | mechanical | 1 | Codex 3 | `roundId` only |
| 120 | Eng | Operation tag `{matchId, gen}` | mechanical | 1 | Codex 2 | round number |
| 121 | Eng | Host role by token, waiting for the host | mechanical | 1 | C-HOSTDROP | role by connection |
| 122 | Eng | The last tab wins | mechanical | 3 | A simple and predictable rule | forbid a second tab |
| 123 | Eng | Connections without a token: 5 s, no more than 8 | mechanical | 1 | The ceiling of 32 cannot be occupied by silence | no limit |
| 124 | Eng | `spawnManaged` with process groups | mechanical | 1 | Verified in Bun 1.4.2 | a signal to a single process |
| 125 | Eng | Data-directory lock, three process identity markers | mechanical | 1 | Codex 1 | command match |
| 126 | Eng | The adapter registry as the only list | mechanical | 4 | The list would be reconciled by hand | a list in each module |
| 127 | Eng | `--skip-git-repo-check` for `codex`, `--bare` forbidden for `claude` | mechanical | 1 | CLI help | flags from the plan's table |
| 128 | Eng | A bridge without logic, schemas from the server | mechanical | 4 | A single place for schemas | schemas in the bridge |
| 129 | Eng | Caption with a font from the repository, without metadata | mechanical | 1 | Silent image corruption | system font |
| 130 | Eng | Round location: `pano_id` and its coordinates | mechanical | 1 | Codex 6 | the sampled point |
| 131 | Eng | Bot move queue | mechanical | 1 | Codex 5 | turn reservation only |
| 132 | Eng | The `move` step with a direction check and an S3 measurement | taste | 3 | Codex 4; walking along links requires a browser on the server | disable movement in M1 |
| 133 | Eng | Paid images only after «Начать» | mechanical | 3 | Codex 7 | preparation in the lobby |
| 134 | Eng | Atomic write of `quota.json`, the error is visible | mechanical | 1 | Silent quota undercounting | write without rename |
| 135 | Eng | Build in parallel with the tunnel | mechanical | 3 | The repeat-run goal is 1 minute | sequentially |
| 136 | Eng | Bot launch log, crash files within 14 days, README about subscriptions | mechanical | 1 | Passed on by phases 1 and 2.5 | separate cleanup |
| 137 | Eng | Thumbnails at 128-bit addresses | mechanical | 5 | `<img>` carries no headers | token in the address |
| 138 | Eng | A map fake when Google Maps is chosen | taste | 1 | Tests without network | E2E with network |
| 139 | Eng | `eval:bots`: paired runs, starting snapshots only, M2 | mechanical | 1 | Codex 8 | comparison with the previous run |
| 140 | Eng | `bun test` and Playwright, no Vitest | mechanical | 4 | A built-in tool | Vitest |
| 141 | Eng | Import boundaries in ESLint | mechanical | 5 | An agent imports whatever compiles | an agreement |
| 142 | Eng | `check-size` for `.svelte`, the `describe` rule | mechanical | 1 | The owner's limits without exceptions | raise the limit |
| 143 | Eng | The task list is not registered in `gstack-tasks` | mechanical | safety | Someone else's list under the same slug | close the other tasks |
| 144 | Eng | `TODOS.md`: MCP HTTP transport | mechanical | 6 | Depends on S1 | build now |

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 1 | ISSUES OPEN | 14 proposals, 4 accepted, 5 deferred |
| Outside Review | codex (`codex exec`, gpt-6-astra) in the CEO, design, DX and engineering phases | Independent 2nd opinion | 4 | completed (design: text received, output check unverified) | design 13, DX 8, engineering 8 findings |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | ISSUES OPEN | 30 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | ISSUES OPEN | score: 1/10 → 8/10, 30 decisions |
| DX Review | `/plan-devex-review` | Developer experience gaps | 1 | ISSUES OPEN | score: 4/10 → 7/10, TTHW: 30 min → 20 min first, 1 min repeat |

- **OUTSIDE COVERAGE:** codex, CEO phase: two voices (Phase 1, 0.5); design phase: completed, output unverified (code 4, the text of 13 findings was used); DX phase: completed, 8 findings; engineering phase: completed on the second attempt (the first did not start because of a cut UTF-8 character in the input), 8 findings. Log entries from 2026-10-22 to 2026-10-30 under the same slug belong to a different project and are not counted here.
- **CROSS-MODEL:** the Claude host (Opus 5.5) and Codex (gpt-6-astra). In the engineering phase there are no matches: 5 Codex findings found holes in the phase 3 items themselves and in the design phase's protocol, 3 concern the original plan (bot move, round location, paid preparation). The disagreement about the `move` step (E-2) was resolved by the owner in the recommended option.
- **VERDICT:** there are no reviews with status CLEAR: all four ended with ISSUES OPEN, the findings were carried into section 14 and tasks T1–T53 (T53 was added after approval: Google map loads). The owner approved the plan on 2026-11-13: UC-1 Google Maps JS, UC-2 AI on Google snapshots with safeguards, questions of taste in the recommended options. The review log counts 11 decisions as open (CEO 1, design 8, DX 2) by the entries before approval; of them only C-REMOTE is open (a private remote for CI, an owner action), the other 10 were accepted at approval. eng review required

**UNRESOLVED DECISIONS:**
+ 11 unresolved from prior reviews
