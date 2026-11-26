# TODOS

Deferred during the review of the `PLAN.md` plan (CEO phase of /autoplan, 2026-11-13). Not part of the first version.

## Game

### Match history screen and hall of fame

**What:** A screen with a list of past matches and a summary table of human and AI wins.

**Why:** Friends are curious who wins more often in a month and which model is stronger.

**Context:** The data is already written to `~/.local/share/geoaissr/matches.jsonl` (section 4.6 of `PLAN.md`). Only a reading screen and an aggregating function are needed. The match record format should be fixed by a schema in `shared/` already in the first version, so that old matches stay readable.

**Effort:** M
**Priority:** P3
**Depends on:** milestone M1

### Custom location lists

**What:** A match based on a predefined file of locations (coordinates or `pano_id`) instead of a random selection.

**Why:** Themed matches (one city, familiar places) and repeatable bot tests.

**Context:** In the plan, `LocationService` picks locations randomly by country polygons (section 6 of `PLAN.md`). A location list can be made a second source behind the same interface. Verify each location with a free metadata request when the list is loaded.

**Effort:** M
**Priority:** P3
**Depends on:** milestone M1

### Maps: follow-ups after the maps and regions release

**What:** Items left open when the maps and the «Карта» and «Регион» split shipped in 0.4.0.

- The «Ретро» map plays the 28 countries of `server/maps/retro.data.json`, measured in November 2026. Google keeps replacing old panoramas, so the list shrinks with time: rerun `bun run scan:retro` (about half an hour of free metadata lookups) when retro rounds get slow, then `bun run build:map-availability`.
- A country near the bar of the retro measurement (5 old panoramas in 480 lookups) comes and goes between scans. Mexico and South Africa found 7 to 9 in two runs and fell under the bar in the third, so they are off the map, and with South Africa the retro map has no country in Africa. More lookups for the countries near the bar would make the list steadier (`scripts/scan-retro.ts`).
- The cities builder keeps an urban centre only when a known place of 150 thousand people or more sits in its outline. That drops the dense countryside of India, Bangladesh and the Nile valley as intended, and with it some real cities whose city proper is small (Chiang Mai). A list of exceptions by name would bring them back (`scripts/build-cities.ts`).
- `standingToOutline` in `scripts/build-cities.ts` measures the 3 km margin to the outline's vertices, not to its edges. Outlines follow a 1 km grid, so vertices are dense, but a core city beside a long straight edge could still be missed. Measure to the edges.
- The cities dataset is built without mainland China (`scripts/build-cities.ts`). Hong Kong and Taiwan stay. Macau has no centre of its own in the built dataset.
- On a point map the round's country comes from the place, corrected across a border only when a settlement of 15 thousand people or more of the other country is clearly closer (`server/maps/country-label.ts`). A border without such a settlement keeps the place's country.
- The lobby and the round search go by `server/maps/coverage.data.json`, measured in November 2026 (`bun run scan:coverage`): 103 of 175 countries are playable on the standard map, 101 on the wild one, and the point maps drop the places of a country where under one lookup in a hundred found a panorama. Google keeps adding countries, so rerun the scan from time to time, then `bun run build:map-availability`. Known limits: a country near the bar (one find in 40 lookups) can come and go between scans; a lookup that never reached Google counts as a miss, as in `scan:retro` below; a country without an outline in the regions dataset (Hong Kong, Singapore, about 60 small ones) is never measured and keeps its places; a covered city inside a country that is bare on the whole (a capital with a few covered streets) is dropped with the country.
- A round search that is running when the host stops the match keeps sending lookups until it finds a place or spends its budget (up to 600 on «Ретро»). The lookups are free, so this costs time only. Cancel the search when the match stops, and give it a time limit.
- A country without polygons in the regions dataset takes the continent of the coast nearest to its biggest settlement (its first airport when it has no settlement), so the whole country is on one continent whichever map asks. Guam and Palau are set to Oceania by hand (`server/maps/countries.ts`). Aruba, Curaçao and the whole of Bonaire, Sint Eustatius and Saba count as South America, next to the coast of Venezuela; Christmas Island and the Cocos Islands count as Asia. Decide whether a table by ISO code should replace the nearest-coast rule.
- Hargeisa is listed under Somalia in GeoNames, and the regions dataset has Somaliland as a country of its own, so a one-country match in Somaliland has no places on the point maps and Hargeisa plays as Somalia.
- A country whose outlines all lie on one continent answers for all of its places, so the airports of Melilla and of the Canary Islands play in Europe with Spain, and Easter Island in South America with Chile. Decide whether a detached territory should follow its own position.
- In `--fake` mode the north and retro maps cut their scene lists (the twelve biggest northern towns, the drawn scenes) before the played countries are taken out, so a fake world match repeats a country at round five. Take the played countries out first.
- A one-country match on a point map can start on land the outlines do not draw: the Azores and Madeira for Portugal, the Canary Islands for Spain, Easter Island for Chile. The score scale of the region comes from the outlines, so such a round is scored on the diagonal of the mainland. Either measure the diagonal over the places too, or keep these places out of the one-country region.
- A point map draws a country anew at every lookup, so a place with thin coverage is played less often than its weight says: of two capitals with equal weight, the one found at every lookup is taken about ten times as often as the one found at one lookup in ten. Keeping a drawn country for a few lookups would even this out, at the price of more lookups where many places have no panorama at all (the capitals of Africa already need about 29 a round); it belongs with the coverage-aware availability above.
- The map note of a bot's start prompt («; карта «Глушь»: …») is put together in `shared/maps.ts` and reaches the prompt files inside `regionLabel`. Give the files the map's name and description as variables of their own with a flag, so the wording can be changed in `server/bots/prompts/` like the rest of the prompt.
- GeoNames marks no capital for Israel, Palestine and Western Sahara (Jerusalem is listed as a regional seat), so the capitals map has no place there.
- The core of three urban centres stands just off their own outline (Goma, and one centre each in Pakistan and South Africa), because no city of 150 thousand people or more is inside it. A round still starts inside the outline, within reach of that core.
- The place-word guard of the Detective style (`server/bots/detective/guard.ts`) matches a country name by its words. A few names are too short or too ordinary for that and pass: «США», «Чад», «ЮАР», «Того», «Гвинея», «ЦАР». A territory name made of ordinary words («Сан-Марино», «остров Рождества») is caught only when written whole.
- `scripts/build-cities.ts` keeps the outer ring of a city outline and drops its holes, so a probe can fall on a lake or a park inside the outline. The 750 m search then finds the nearest street or misses.
- `bun run scan:retro` counts a lookup that never reached Google, or that Google answered with `UNKNOWN_ERROR`, as a place without an old panorama. A scan on a bad network can so drop a country near the bar and still look complete. Count such lookups apart and do not rewrite the dataset when they are more than a few.
- The search counts lookups that failed to reach Google in the order they finish (`server/location/metadata.ts`). In a «Ретро» batch of 12, three lookups that each fail twice finish last and end the round with `GEO_GOOGLE_UNREACHABLE`, although the other nine reached Google. Count per batch in lookup order.
- The regions dataset names South Sudan `SDS`, Palestine `PSX` and Western Sahara `SAH`, so `--region country:SSD` is refused. Accept the ISO codes as other names for the same regions.
- A panorama that lies within reach of a bigger country's place and closer to a settlement of a small neighbour takes the neighbour's label (`server/maps/country-label.ts`): a round in central Rome can be labelled as the Vatican.
- The ZIP reader of the dataset builders (`scripts/lib/zip.ts`) checks the unpacked length of an entry and not its CRC-32.

**Why:** Recorded so they are not lost. None of them blocks play.

**Effort:** S
**Priority:** P3
**Depends on:** nothing

### Match recovery after a server restart

**What:** Save the room state to disk and resume the match after a crash or restart.

**Why:** Currently a server crash aborts the match (a deliberate decision for the first version).

**Context:** The room state is in memory (section 7 of `PLAN.md`). This will need a snapshot of the state machine on every transition, a rule for a round interrupted midway (replay it), and a new tunnel link for the players.

**Effort:** M
**Priority:** P3
**Depends on:** milestone M3

### MCP HTTP transport instead of the `bot-tools` bridge

**What:** The game server itself serves the `geo` tools over MCP via HTTP on `127.0.0.1`, and the harness connects to it at the address from the MCP config; the `bot-tools` bridge and its per-bot process go away.

**Why:** Fewer processes and one less link between the bot and the server: the bridge currently only forwards calls.

**Pros:** No separate package and process; the "bridge crashed" failure disappears; tool schemas live only on the server.

**Cons:** Support for the MCP HTTP transport differs between `codex`, `claude` and `agy` and changes from version to version; stdio works everywhere.

**Context:** Proposed by the engineering review (`PLAN.md`, "Phase 3. Engineering review", section 1). The first version uses a bridge without logic (the item "`bot-tools` bridge without logic"). Start from the S1 spike report: if all allowed harnesses connect to MCP over HTTP with a token in a header, the bridge can be removed.

**Effort:** S
**Priority:** P3
**Depends on:** spike S1, the "First game" gate

### Idempotent bot tool calls through bridge operation IDs

**What:** The MCP bridge stamps each tool call with an operation ID; the server answers a repeated ID with the stored result instead of running the action again.

**Why:** A bridge retry after a network blip can today charge a second paid turn or write a second checkpoint. The step journal dedupes identical writes, but not a repeated camera action.

**Context:** Raised in the eng review of the bot step journal (2026-11-20). `server/bots/queue.ts` serializes calls; the operation ID would be checked before the turn is charged. Until then the bridge transport error (`GEO_BOT_BRIDGE_UNREACHABLE`) tells the model to repeat a free call only once and never to repeat a paid `look` or `move` (v0.3.1). Tracked as GitHub issue #23.

**Effort:** S
**Priority:** P3
**Depends on:** bot step journal (Stage 1)

### Cancel in-flight image fetches when a bot round is aborted

**What:** Pass the queue's abort signal into the Street View fetches of `look` and `move`, so an aborted round stops downloading frames.

**Why:** Today a late fetch finishes and its result is dropped (no journal, thumb or checkpoint event), but the request still spends quota and time. Stage 2 (Detective) doubles the processes per bot, so the waste grows.

**Context:** Raised in the eng review of the bot step journal (2026-11-20). `runner-handlers.ts` already receives the signal and checks it after the fetch; `server/images/bot-image-service.ts` does not accept one yet.

**Effort:** S
**Priority:** P2
**Depends on:** before Stage 2 (Detective play style)

## Interface

### Replaying a round when a panorama has not loaded

**What:** A host button "Replay the round without scoring" if a player's panorama has not loaded by the start of the round.

**Why:** The countdown starts after panorama readiness or timeout and at least 6.8 seconds of round loading. A player on a slow network can still lose round time through no fault of their own.

**Pros:** The score does not depend on connection quality.

**Cons:** A new state machine transition, extra quota and subscription usage for the replayed round, a temptation to replay unlucky rounds.

**Context:** Proposed by the Codex voice in the design review (`PLAN.md`, "Phase 2. Design review", decision D-3). The first version applies the rule from the item "Round preparation failures": a shared timer and a «Повторить» ("Retry") button on the client. Come back to this if the first match shows that it happens.

**Effort:** S
**Priority:** P3
**Depends on:** the "First game" gate

### Mobile layout

**What:** A phone layout: the panorama fills the screen and the map slides in from the bottom.

**Why:** Some friends may want to play from a phone.

**Context:** The first version targets a desktop browser (section 13 of `PLAN.md`). The main work: the minimap and the participant list on a narrow screen, touch target sizes, panorama gestures versus map gestures.

**Effort:** M
**Priority:** P3
**Depends on:** milestone M4

### Lobby captions below 14 px

**What:** Raise the label and caption sizes of the lobby bot settings to the 14 px minimum of `DESIGN.md`. The slot form rules in `web/src/styles/global.css` (`.slot-label` 0.85rem, `.slot-hint` 0.78rem) and the same sizes in `BotSlotAdvanced`, `BotCard`, `HostMenu` and other lobby components are below it.

**Why:** Small grey text on the dark lobby is hard to read. Raising one component alone would make it stand out, so all of them change in one pass.

**Context:** Found by the design review of PR #26 (2026-11-24); the owner chose to keep the current sizes in that PR.

**Effort:** S
**Priority:** P3

### Human guess versus bot pin trail on the results map

**What:** On the results screen, draw the bot's pin trail (its `current_guess` after each step) next to the human's pin, so a player sees where the bot's belief moved and where their own guess sat.

**Why:** The step journal shows «точка сдвинулась на N км» as text; a map overlay makes the comparison with the human guess immediate and is the strongest teaching moment.

**Context:** Deferred in the CEO review of the bot step journal (2026-11-20). The trail already reaches clients as `currentGuess` on each journal step. The results map already draws pins; the trail needs a line layer and a legend.

**Effort:** M
**Priority:** P3
**Depends on:** bot step journal card

## Deferred on 2026-11-23

The owner put these aside to build the Detective play style first. Nothing here is started.

### Flaky tests in CI

**What:** Fix five tests that fail from time to time on unchanged code.

- `server/proc/spawn.test.ts`, "stops entire detached process group": it reads the pid file as soon as the file exists, before the shell has written the pid. A fix (wait for a positive pid) is on the branch of PR #24, commit `e6079b0`.
- `web/tests/lobby-characters.spec.ts:228`, avatar drag: it expects exactly 4 `avatar_turn` messages and sometimes gets 5. The cause is not established.
- `web/tests/lobby-character-inspection.spec.ts:128`, AI tabs.
- `web/tests/audio.spec.ts`, lobby music hand-off: GitHub issue #21.
- `web/tests/audio.spec.ts:282`, native lobby music loop: in a full local run on 2026-11-24 a source ended 2 ms before the next one was scheduled to start (`ended` 5.5554 s, start 5.5578 s). It passed on the rerun.

**Why:** Each failure costs a CI rerun of about 10 minutes and hides real failures.

**Effort:** S
**Priority:** P2

### Long move: replies and error statuses

**What:** Three follow-ups of the long move (v0.3.2).

- A walk that stops at a sharp, tight bend replies that the road ends, although it goes on. A walk that runs out of search time replies that the road is too winding. Both replies should say what really happened.
- A Street View metadata reply with an error status (for example `OVER_QUERY_LIMIT`) is read as "no panorama here". It should surface as an error.
- `DESIGN.md` shows step titles without the " · N м" suffix of a long move.

**Context:** `server/bots/road-walk.ts`, `moveReplyText` in `server/bots/runner-handlers.ts`, the limits listed in `docs/bot-tools.md`.

**Effort:** S
**Priority:** P2

### Detective: first rounds with a real model

**What:** Play a few Detective rounds with a real model and read the logs: does the brain wait for the report, how many requests fit into a round, do the eyes obey the report format, does a drive finish inside 45 seconds.

**Why:** The owner has played one match with a Detective on `claude`, and `bun run test:harness --detective` has played one round on fake images on each of `claude`, `codex` and `agy` and one mixed pair (2026-11-24). Nobody has read the logs of those rounds against the prompts yet. The timings in the prompts («отчёт приходит на 20–30-й секунде», «один запрос занимает около 10 с») come from the spike on still photos, not from the game.

**Context:** Prompts are in `server/bots/prompts/`. `bot_tool_call` records in the daily log carry the `role`. A paid run needs the owner's approval.

**Effort:** S
**Priority:** P1

### Token usage of `agy` in long rounds

**What:** Read the usage counters of a long `agy` session correctly. In a 110-second Detective round the eyes on `agy` reported `input_tokens` 63 803, `cache_read_tokens` 452 978 and `total_tokens` 65 161. The parser expects the cache reads to be part of the input, as in a one-turn session, refuses the record as `invalid`, and the badge shows «н/д».

**Why:** Every `agy` bot that runs more than a few turns, Intuit or Detective, shows no tokens and no price. Whether `input_tokens` is the uncached input of all turns or the context of the last turn is not known, so the right sum cannot be guessed from one record.

**Context:** `normalize` in `server/bots/usage.ts`, the `harness_usage` records in the daily log, the `agy` headless docs. Needs a few `agy` sessions of known length to settle the meaning.

**Effort:** S
**Priority:** P2

### Detective: notes from the pre-landing review

**What:** Small items the review of PR #26 found below the blocking floor. None of them breaks a round.

- Text inside «…» and answers to text requests are never masked, so a place name can reach the brain inside quotes (`server/bots/detective/guard.ts`). The guard also misses names written with mixed alphabets or in scripts it has no list for.
- The prompts state timings by hand. `detective-brain.txt` says a request with a drive takes «до 30 с», while the eyes get 45 s for it (`detective-eyes.txt` and `server/bots/detective/broker.ts`). The owner tunes these files, so the numbers are left to them.
- A journal correction is counted as used when a later check refuses the same `ask` (`server/bots/detective/brain.ts`).
- The bot shows as finished up to 8 s after its brain exits, while the eyes are still reporting tokens (`server/bots/detective/monitor.ts`).
- `settledIds` and `movesAtDelivery` grow by one entry per request (`server/bots/detective/state.ts`); a round has a few dozen at most.
- Calls are serialized per role, so a `final_guess` sent in parallel with a waiting `ask` would queue behind it (`server/bots/detective/session.ts`). No CLI in use sends parallel calls.
- One integration test waits a fixed 700 ms before checking that no second finish event came (`test/detective.integration.test.ts`).
- A drive request has no direct broker test for a timeout, the eyes going down, the session closing or a late answer (`server/bots/detective/broker.ts`); the same paths are tested for the other request kinds.

**Why:** Recorded so they are not lost; each is a short fix or a prompt edit.

**Effort:** S
**Priority:** P3

### Detective: notes from the outside review

**What:** Items the outside voices and the adversarial passes of the PR #26 review raised below the blocking floor. The owner chose to record them, not fix them in that PR.

- The `agy` file guard is checked only when the brain first calls a game tool, and a missing record only marks the round «Изоляция зрения не подтверждена»; the round goes on and the guess counts. The eyes process has no such check. A fail-closed option would refuse the brain's guess (or stop it) when the record is missing. The owner kept the warning for now (`server/bots/detective/isolation.ts`, `server/bots/adapters/agy.ts`).
- With a `codex` brain and `agy` eyes, the frames are files in the eyes' directory. The brain runs read-only and without a shell, but its image viewer may still be on, nothing confirms it cannot open those files, and the round is not marked. Check with `bun run test:harness --detective --only codex --eyes agy`, then turn the viewer off or refuse the pair (`server/bots/adapters/codex.ts`, `server/bots/detective/isolation.ts`).
- An `agy` model whose name ends in an effort (`…-medium`) fixes its own, so the eyes' effort («Усилия глаз», low by default) is dropped and both the round and «Проверить зрение» run at that model's effort. Pick the variant with the chosen effort or refuse the pair, also when the eyes inherit the brain's model (`server/bots/detective/run.ts`, `server/bots/adapters/agy.ts`).
- The guard keeps any place word that stands next to a script noun, even across punctuation: «Флаг Японии; буквы латинские», «Япония письмо» and «вывеска в Токио буквы» all reach the brain unchanged. Limit the exception to adjectives, as in «грузинское письмо» (`isScriptName` in `server/bots/detective/guard.ts`).
- The guard knows no Latin city names, and a letter with a diacritic splits a word: «Tokyo», «Zürich» and «Japón» pass. Fold diacritics before matching and add Latin city stems. In the other direction it refuses ordinary words that equal a city stem, such as «дели», «лос» and «рим»; a refused `ask` costs the brain time.
- A saved Detective whose eyes CLI is missing is disabled at startup and on any slot edit, although in a round under 90 seconds it would play Intuit with the brain alone. Startup and slot edits should use the round-aware check that the round engine uses (`server/cli/start-runtime.ts`, `server/engine/bot-slot-patch.ts`).
- Each repeated `observe` renders four new frames that no journal step references; enough repeats can push other frames out of the thumbnail cache. The panoramas themselves are cached, so no Google request is repeated (`server/bots/detective/eyes.ts`, `server/http/thumbs.ts`).
- When the round deadline finalizes a bot that is waiting for its eyes to exit, the other players do not hear its confirmation cue: `completion.confirmedIds` is built from the state before the finalization (`server/engine/results.ts`).
- A broken tag inside an inactive `{{#if}}` branch of a prompt file is dropped without an error and shows up only when the bot moves to a harness with the other delivery mode. Check the whole file before choosing branches (`server/bots/prompt-files.ts`).
- `bun run test:harness --detective` passes when the eyes filed no report and no request was answered, and passes with no harness installed. It should require a report and one answered request, and fail when there is nothing to run (`scripts/test-harness-detective.ts`, `scripts/test-harness.ts`).
- When the engine throws while it records the bot's finish, the cleanup of the bot (its tokens, handle and work directory) is skipped until the engine stops the bot. Run it in a `finally` (`onBrainExit` in `server/bots/detective/monitor.ts`).
- A brain that exits cleanly after a checkpoint (an `ask` with `current_guess`, or a refused `final_guess`) is reported as «завершил ход», although its guess was not final. The checkpoint is scored as the fallback guess either way; confirm the label is what the owner wants (`brainOutcome` in `server/bots/detective/monitor.ts`).
- The eyes' model is checked only for length, not against the harness's model list; the brain's model has the same gap (`server/engine/bot-slot-patch.ts`).

**Why:** Recorded so they are not lost. The first item is a decision the owner may revisit; the rest are short fixes.

**Effort:** M
**Priority:** P2

### Detective: result card and settings layout

**What:** Five design notes from the outside review of PR #26.

- «кадр N» in the report and in the answers is plain text. It should open that frame, or say that the frame is missing.
- In a round under 90 seconds the saved style «Детектив» stays highlighted and its eyes settings stay editable, while the style that will play is a note below the help text. Show «В этой партии: Интуит» next to the selector, with a way to the round length setting.
- «Запрос N» headings do not say what the request was about. Add a short topic and keep the number and the control check label.
- The brain's harness and model sit above the style choice, the eyes inside it, and the brain's effort lower down as «Усилия (effort)». Group the two roles under the style choice.
- The token badge shows a count while only one process has reported; the missing one appears as «н/д» only in the tooltip. Mark the badge as partial until both have reported. The price already stays unknown until then.

**Why:** Players check the clues behind a guess through the frames, and the host needs to see which style will play.

**Context:** `web/src/components/StepReport.svelte`, `StepExchange.svelte`, `StepFrames.svelte`, `BotPlayStyle.svelte`, `JournalStep.svelte`, `web/src/lib/journal-format.ts`, `BotSlotEditor.svelte`, `BotAccounting.svelte`.

**Effort:** M
**Priority:** P3

### Detective in `eval:bots`

**What:** Let `bun run eval:bots` measure a Detective configuration (a `--style detective` flag, two processes per round, usage summed by role).

**Why:** The eval tool launches one Intuit process per round, so the two styles cannot be compared on the photo set yet. The numbers from the spike (PR #24) were measured by throwaway code.

**Context:** `scripts/eval-bots.ts`, `scripts/eval-bots/`, `server/bots/detective/launch.ts`. The current set has no movement, so a drive cannot be measured on it (see the roads set below).

**Effort:** M
**Priority:** P2

### Roads and rural places in the eval set

**What:** A second eval set of about 30 open road and village panoramas from Panoramax (no key, CC BY-SA), with neighbouring panoramas so that bots can move.

**Why:** The current 28 spots are mostly streets with readable text, movement is off on them, and 24 of them have no real compass heading, so the driving-side and sun hints and the long move cannot be measured there.

**Context:** Proposed on 2026-11-22: at least 10 left-hand-traffic spots and 10 in the southern hemisphere, spots drawn by lot inside a region, rejection rules written before the draw, compass computed from the sun position (the Panoramax compass field was off by 36 to 93 degrees on 3 of 7 samples). Two neighbours each way make about 110 MB; a long move needs many more panoramas per spot, and that size is not worked out. Africa and Central Asia need a Mapillary key from the owner. Wikimedia Commons refused downloads without a contact in the request header and is not needed.

**Effort:** M
**Priority:** P2
**Depends on:** the owner's go-ahead; a paid run on the set needs a separate approval

### Paid eval runs that wait for approval

**What:** None of these runs without the owner's approval.

- Both play styles on the new road set: 30 spots, 3 repeats, 2 bots, 180 rounds plus judges.
- Stage 1 again at concurrency 2 (about 170 rounds): the plan asked for at most two rounds at once and the runs used three. The slowest final guess took 22.5 s of 60, so the result is not in doubt.
- The spike 3 follow-up that spends the brain's unused time on finding text (84 rounds). The run on the new set replaces it.

**Priority:** P3

### Spike reports of PR #24

**What:** Decide whether to merge PR #24 (Detective spikes 1 to 3: `spikes/detective/` and three reports in `docs/evals/`). If it is merged, add two limits to the spike 3 report: movement was off for both bots, and the set has few roads and rural scenes.

**Context:** The Detective play style in `server/bots/detective/` was built from main and does not depend on that branch.

**Priority:** P3

### Release tooling

**What:** Two optional settings.

- `.gstack/ship-policy.json` with `"bump": "patch"`, so that `/ship` stops offering minor and major versions. The rule itself is in `CLAUDE.md`.
- The gstack credential scan before a push: gstack installs its hook into the git directory, and this repository uses `.githooks` through `core.hooksPath`, so nothing was installed. It needs a line in `.githooks/pre-push`.

**Effort:** S
**Priority:** P3

## Completed

### Sounds

**What:** Short sounds: the 3-2-1 countdown, the last 10 seconds, markers appearing, victory.

**Why:** Sound strengthens the feeling of a match, especially when everyone is in a voice chat.

**Context:** The first-version plan has only visual animation (section 8 of `PLAN.md`). Needed: a set of free sounds, a volume toggle in the interface, handling of browsers blocking audio until the first click. Start with the results screen.

**Effort:** S
**Priority:** P3
**Depends on:** milestone M4

**Completed:** v0.2.2 (2026-11-19)

**Delivery:** Original CC0 event sounds, a Suspense lobby loop and a continuous seven-track gameplay queue, with independent profile-owned volume and mute controls, reset, gesture activation and hidden/disconnected-tab silence. The timer warning covers the final 15 seconds. See [the audio reference](docs/audio.md).
