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

**What:** Fix four tests that fail from time to time on unchanged code.

- `server/proc/spawn.test.ts`, "stops entire detached process group": it reads the pid file as soon as the file exists, before the shell has written the pid. A fix (wait for a positive pid) is on the branch of PR #24, commit `e6079b0`.
- `web/tests/lobby-characters.spec.ts:228`, avatar drag: it expects exactly 4 `avatar_turn` messages and sometimes gets 5. The cause is not established.
- `web/tests/lobby-character-inspection.spec.ts:128`, AI tabs.
- `web/tests/audio.spec.ts`, lobby music hand-off: GitHub issue #21.

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

**Why:** The Detective mode is checked with unit tests, scripted CLI processes over the real MCP bridge and the fake pair. No real model has played a round of it in the game. The timings in the prompts («отчёт приходит на 20–30-й секунде», «один запрос занимает около 10 с») come from the spike on still photos, not from the game.

**Context:** Prompts are in `server/bots/prompts/`. `bot_tool_call` records in the daily log carry the `role`. A paid run needs the owner's approval.

**Effort:** S
**Priority:** P1

### Detective: notes from the pre-landing review

**What:** Small items the review of PR #26 found below the blocking floor. None of them breaks a round.

- Text inside «…» and answers to text requests are never masked, so a place name can reach the brain inside quotes (`server/bots/detective/guard.ts`). The guard also misses names written with mixed alphabets or in scripts it has no list for.
- The vision check of a Detective slot runs at the slot's effort, while the eyes play at `low` (`server/bots/vision-check.ts`).
- The prompts state timings by hand. `detective-brain.txt` says a request with a drive takes «до 30 с», while the eyes get 45 s for it (`detective-eyes.txt` and `server/bots/detective/broker.ts`). The owner tunes these files, so the numbers are left to them.
- A journal correction is counted as used when a later check refuses the same `ask` (`server/bots/detective/brain.ts`).
- The bot shows as finished up to 8 s after its brain exits, while the eyes are still reporting tokens (`server/bots/detective/monitor.ts`).
- `settledIds` and `movesAtDelivery` grow by one entry per request (`server/bots/detective/state.ts`); a round has a few dozen at most.
- Calls are serialized per role, so a `final_guess` sent in parallel with a waiting `ask` would queue behind it (`server/bots/detective/session.ts`). No CLI in use sends parallel calls.
- One integration test waits a fixed 700 ms before checking that no second finish event came (`test/detective.integration.test.ts`).

**Why:** Recorded so they are not lost; each is a short fix or a prompt edit.

**Effort:** S
**Priority:** P3

### Detective in `eval:bots`

**What:** Let `bun run eval:bots` measure a Detective configuration (a `--style detective` flag, two processes per round, usage summed by role).

**Why:** The eval tool launches one Intuit process per round, so the two styles cannot be compared on the photo set yet. The numbers from the spike (PR #24) were measured by throwaway code.

**Context:** `scripts/eval-bots.ts`, `scripts/eval-bots/`, `server/bots/detective/launch.ts`. The current set has no movement, so a drive cannot be measured on it (see the roads set below).

**Effort:** M
**Priority:** P2

### Detective for `codex` and `agy`

**What:** Run the two-process launch with the `codex` and `agy` harnesses and add them to `DETECTIVE_HARNESSES`.

**Why:** A slot with one of these harnesses set to Detective plays Intuit. `agy` delivers frames as files, which the eyes prompt does not describe yet.

**Context:** `shared/play-style.ts`, `server/bots/detective/procs.ts`, `server/bots/adapters/`.

**Effort:** M
**Priority:** P3

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
