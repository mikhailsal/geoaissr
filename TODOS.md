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

**Context:** Raised in the eng review of the bot step journal (2026-11-20). `server/bots/queue.ts` serializes calls; the operation ID would be checked before the turn is charged. The bridge transport error (`GEO_BOT_BRIDGE_UNREACHABLE`) already tells the model to retry only once.

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
