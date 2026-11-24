# Bot tools and accounting

Bots inspect the panorama through the local bridge. Reasoning and usage appear in the result card after the round; active-round views expose progress only.

## Exploration and the step journal

| Tool          | Effect                                           | Paid turns   |
| ------------- | ------------------------------------------------ | ------------ |
| `observe`     | Return the four starting views (journal step 0)  | 0            |
| `look`        | Change heading, pitch or field of view           | 1 on success |
| `move`        | Step or drive along the road when movement is on | 1 on success |
| `final_guess` | Freeze the final answer                          | 0            |

There is no `draft_guess` or `submit_guess`: both are unknown tools. Checkpoints come only from `current_guess` on `look` and `move`.

Failed calls do not spend a turn. A final submission remains available after the paid-turn limit. Final answers cannot be overwritten. If the process exits or time expires without a final answer, the latest checkpoint is scored; with no checkpoint and no final answer the bot has no guess (no pin, zero points, "нет догадки"). Process completion drains terminal usage without holding round completion for a price request.

### Moving

`move` takes a `heading` and an optional `distance_m`.

- Without `distance_m` it is one short step: the server looks for the panorama nearest to a point 18 m ahead (then 40 m ahead) and returns one frame that looks along the requested heading.
- With `distance_m` (20 to 2000; a value outside the range is clamped, not rejected) it is a long move for the same single paid turn. The server walks the road from panorama to panorama: each hop asks for the panorama nearest to a point 150, 60 or 18 m ahead on the current bearing, and the next hop continues on the bearing of the hop just made, so the walk follows the bends of the road. The first hop may leave the requested heading by up to 90 degrees (it snaps to the road); later hops may turn by up to 60 degrees, so the walk stops at a T-junction or a dead end instead of picking a side. It never returns to a panorama it left. When the short probes miss (a gap in the coverage, a hairpin), a long move tries the longer ones before it gives up. The longest probe looks 150 m ahead and accepts a panorama within 75 m of that point, so a move can overshoot the requested distance by up to about 215 m; the reply always states the distance really covered.
- A long move ends when the distance is covered, the road ends, or the search budget runs out (40 metadata lookups or 8 seconds). The budget is checked before every lookup, and a lookup still in flight when the 8 seconds are up is abandoned, so the walk never runs longer than that. A lookup that fails after the walk has moved ends the move there, with the distance covered so far; a failure before the first hop is returned as an error and charges no turn. It returns one frame that looks along the road at the new position, and its reply says how far it went and whether it stopped short. Only Street View metadata lookups are made on the way; they are free of charge and use no quota. The one image at the end is the only billed request, as for a short step. A 1,000 to 2,000 m move took 1.4 to 6.8 seconds on six real roads over two trials (8 to 33 lookups), against about 0.7 seconds for a short step.
- A move that finds no panorama in the requested direction fails, charges no turn and leaves the bot where it was. A move whose search ran out of time before the first hop fails the same way, with a reply that says the server ran out of time instead of naming a missing road.
- When the round ends while the server is still walking the road, nothing is committed: the bot stays where it was and no frame is requested, so the billed image request is not made. A frame request that is already in flight when the round ends is not cancelled: it completes and its result is dropped.
- A long move can stop early at a sharp, tight bend. Because later hops turn by at most 60 degrees, a street corner or a tight hairpin can end the walk with a reply that the road ends, although the road goes on. Gentle bends and wide curves are followed. The bot keeps the distance covered and can move again on a new heading.
- A metadata reply that carries an error status (for example `OVER_QUERY_LIMIT`) is read as "no panorama here", so during such a failure a move reports a missing road or a road end instead of an error. This holds for the short step too.
- The metadata API has no list of neighbouring panoramas, so a hop is accepted on distance and bearing alone. Where the road ends or bends away, a probe can land on another road nearby (a parallel street, a road across a gap) that is not connected to the one the bot was on. This holds for the short step too. The frame is still a real place within the distance the reply states.

The scored target is the start panorama: a bot that reads an address two kilometres away answers two kilometres off.

The eval tool has no `move`: its dataset holds four frames of one panorama per spot.

### Fields

Every step records the reason before the action and the finding after it. No extra model turn is spent: the finding about the previous frame travels with the next call.

- `hypothesis` (`look`, `move`): why this next action is taken and what each outcome would mean; at most 300 characters. It becomes the step's reason.
- `finding` (`look`, `move`, `final_guess`): what the PREVIOUS frame(s) showed and what that changes; at most 600 characters. The server attaches it to the previous step (the observe step for the first call). It is required once `observe` returned frames.
- `shifts` (optional, at most 3, on `look`, `move` and `final_guess`): `{version, effect, because}` with `effect` one of `excluded`, `weaker`, `stronger`. They replace the old `rejected_guesses`.
- `current_guess` `{lat, lng}` (`look`, `move`): the bot's best point after the previous frame. It is stored on that same step (with `movedKm`, the distance from the previous recorded point) and as a checkpoint, through the same path as the final answer with `finalized = false`.
- `final_guess`: `lat` (finite, `[-90, 90]`), `lng` (finite, normalized to `[-180, 180]`), `finding`, `shifts`, required first-person `summary` (at most 600 characters) and optional `quip` (at most 120). `facts`, `rejected_guesses` and `conclusion` are gone.

### One-time correction

The allowance belongs to the pending step (the one whose finding is due), not to the call arguments. A `look`/`move` missing `finding` (when one is due) or `current_guess`, or a `final_guess` missing `summary` or `finding` (empty or whitespace-only counts as missing), is rejected with `isError: true` and one Russian message that lists all missing fields and ends with `[GEO_BOT_JOURNAL_FIELD_MISSING]` (see [errors](./errors.md#GEO_BOT_JOURNAL_FIELD_MISSING)). A rejected `look`/`move` persists nothing: no finding, no checkpoint, no frame and no turn. A rejected `final_guess` saves its coordinates as a checkpoint only. The next call for the same pending step is accepted even with fields still missing, whatever its camera arguments: a missing finding marks the step `missing` (card text «вывод не записан»), a missing `current_guess` leaves the checkpoint unchanged and marks the step «новая точка не записана». On acceptance the finding, shifts and point are written first, then the camera action runs; if the frame fetch fails, the journal write stays and a retry never duplicates it.

If the round ends before the last step got its finding, that step is `round-ended` (card text «раунд закончился раньше вывода»). Steps start as `pending` while the bot is working.

Parallel calls: a `look`, `move` or `final_guess` sent before the pending step's frame was delivered could not have seen that frame. It is accepted without a correction, its `finding` and `shifts` are not written (the pending step shows «вывод не записан»), and its `current_guess` still becomes the checkpoint. A repeated `observe` returns the same four frames and adds no step. After the round is aborted or finalized, a late call emits no journal, frame or checkpoint event.

Transport errors: if the bridge cannot reach the server, the bot gets «Нет связи с сервером игры. Повторите вызов один раз; если ошибка повторится — вызовите final_guess.» with `isError: true` and `[GEO_BOT_BRIDGE_UNREACHABLE]` (see [errors](./errors.md#GEO_BOT_BRIDGE_UNREACHABLE)). For `look` and `move`, whose turn may already be charged, the line asks for `final_guess` instead of a repeat.

### Example

One round, as the bot sends it (`observe` → one `look` with a bounced first attempt → `final_guess`):

```jsonc
// 1. observe: no arguments; returns four frames and opens step 0 «Первый взгляд».
{}
// 2. look without a finding: rejected, nothing stored, no turn charged.
{ "heading": 90, "pitch": 0, "fov": 40, "hypothesis": "Щит справа: кириллица значит восток Европы, латиница — запад.",
  "current_guess": { "lat": 50.1, "lng": 14.4 } }
// → isError: «Вызов look отклонён: не хватает поля finding (что показал предыдущий кадр). Повторите тот же вызов и добавьте finding. Кадр не запрошен, ход не списан. Исправление одно на шаг: … [GEO_BOT_JOURNAL_FIELD_MISSING]»
// 3. the same look with the finding about step 0: accepted, opens step 1.
{ "heading": 90, "pitch": 0, "fov": 40, "hypothesis": "Щит справа: кириллица значит восток Европы, латиница — запад.",
  "finding": "Правостороннее движение, жёлтая разметка по краю, ели: Центральная Европа.",
  "shifts": [{ "version": "Скандинавия", "effect": "weaker", "because": "Разметка по краю жёлтая." }],
  "current_guess": { "lat": 50.1, "lng": 14.4 } }
// 4. final_guess: the finding is about step 1's frame.
{ "lat": 49.2, "lng": 16.6, "finding": "На щите чешские диакритики: Brno 12.",
  "shifts": [{ "version": "Польша", "effect": "excluded", "because": "Буква ě бывает только в чешском." }],
  "summary": "Сначала понял, что это Центральная Европа, потом на щите увидел чешскую букву ě и Брно в 12 км.",
  "quip": "Брно, я тебя вижу!" }
```

### Journal data

`shared/bot-journal.ts` defines one shape (zod and types): steps `{index, kind: observe | look | move | ask, reason?, frames, finding?, findingState: pending | recorded | missing | round-ended, shifts?, currentGuess?, pointMissing?, movedKm?, atMs}` plus `{summary?, finalFinding?}`. A Detective journal adds `style: detective`, `confidence` and `clue`; its step 0 carries the `report` (lines `{section, text, frame}`), and request number k of the brain is step k with `kind: ask`, the brain's `reason`, the `requests` (`{n, kind, text, status: pending | answered | abstained | timeout | eyes_down, value?, confidence?, frame?}`) and `control` for the control check. Frames the eyes take while answering belong to that step and carry their number `n` and `action`. The engine event `bot_finding` attaches a finding, shifts and point to a step; the journal reaches clients as `journal` on the AI entry of the round results. Old results with `facts`, `conclusion` or `rejectedGuesses` and no journal still parse, and a record without a journal shows no steps.

The prompt asks the bot to keep several region versions, record the reason before each action and the finding after it, add shifts that exclude or weaken a version, send the current point with every paid action and finish with a first-person summary. A clue counts only if it is tied to a frame and shifts the weight between versions. File-based harnesses may use `read_file` only for game-provided images. These instructions do not guarantee a model's compliance or geographic accuracy.

The advertised time budget is capped by the round duration. Every tool response reports remaining time; at 15 seconds or less it says «Немедленно отправь лучшую версию через final_guess с выводом по последнему кадру.», while the prompt asks the bot to reserve time for submission. Remaining time is the earlier of the bot's own budget end and the engine's round end: when every human has confirmed, the engine shortens the round to the shared AI waiting window and the bots read that shorter deadline from then on. The checkpoint that counts is the last one the server received before the round was finalized.

`look` accepts heading, optional pitch, optional `fov` and optional `zoom` in `1..9`. Explicit finite `fov` takes precedence and is clamped to `10..120`; otherwise `fov = clamp(round(90 / zoom), 10, 120)`, defaulting to 90. A field of view of 20–45 zooms in, while 120 is wide. Fake images use the same field-of-view projection. Successful step records preserve the effective parameters and the valid hypothesis (the step's reason).

## Detective play style

A bot slot has a play style. **Intuit** (the default) is everything above: one process sees the frames and guesses. **Detective** splits the bot into two processes that talk only through the server:

- the **eyes** see the frames and describe them. They never name a place;
- the **brain** reads the descriptions, asks for more and places the pin. It never receives an image.

The split is there to stop a model from seeing what its own guess expects. The eyes do not know the guess; the brain cannot ask a leading question.

### When a slot plays Detective

`shared/play-style.ts` decides per round (`resolvePlayStyle`). A slot set to Detective plays Intuit, and the lobby says why, when the round is shorter than 90 seconds (`DETECTIVE_MIN_BUDGET_SEC`). The round duration caps the bot's budget, and a report plus two requests do not fit into less. The lobby also keeps the budget of a Detective slot at 90 seconds or more.

### Where each process runs

The Detective runs on `claude`, `codex` and `agy`. The brain runs on the slot's harness and model at the slot's effort. The eyes run on the same harness and model unless the slot sets `eyes: {harness, model}` («Глаза детектива» in the slot settings); they always play at effort `low`. The eyes' harness must be available too: a slot whose eyes harness is missing is disabled in the lobby, and a round does not launch it. «Проверить зрение» of a Detective slot tests the eyes: their harness and model at `low`.

Each process has its own work directory, `<bot dir>/brain` and `<bot dir>/eyes`. On `agy` the eyes get their frames as files in their directory and read them with `read_file`; the prompt says so (`fileDelivery`). The file guard of an `agy` process lets the eyes read only their own directory and lets the brain read no file at all. `claude` and `codex` processes get no file tools. The guard writes a record before every tool call. If the brain runs on `agy` and its first call reaches the server with no record, the guard did not run: the server logs `harness_monitor_error` with `isolationUnconfirmed`, and the result card says «Изоляция зрения не подтверждена» instead of «Мозг не видел кадров».

`codex` gets the tools of its role approved up front and a 120-second MCP call timeout (`MCP_TOOL_TIMEOUT_SEC`); Claude Code reads the same limit from `MCP_TOOL_TIMEOUT`. An `ask` with a drive waits up to 45 seconds, so the default limits of the CLIs would cut it.

### Tools by role

Each process gets its own bearer token, and the bridge (`bot-tools/main.ts`, `GEO_BOT_ROLE`) lists only the tools of its role. A call to a tool of the other role is refused.

| Role  | Tool           | Effect                                                              | Paid turns   |
| ----- | -------------- | ------------------------------------------------------------------- | ------------ |
| eyes  | `observe`      | The four starting views, numbered 1–4                               | 0            |
| eyes  | `look`         | Turn or zoom the camera; the new frame gets the next number         | 1 on success |
| eyes  | `move`         | Step or drive along the road (listed only when movement is on)      | 1 on success |
| eyes  | `report`       | File the scene report, once, before the first request               | 0            |
| eyes  | `next_request` | Wait up to 20 s for the brain's next request                        | 0            |
| eyes  | `answer`       | Answer every item of the current request                            | 0            |
| brain | `briefing`     | Wait for the report and read it                                     | 0            |
| brain | `ask`          | Send up to 5 requests and wait for the answers                      | 0            |
| brain | `final_guess`  | Freeze the final answer with `confidence`, `clue` and the `summary` | 0            |

`look` and `move` share the slot's move limit. Every frame has a number; report lines, answers and the result card cite frames by it.

### Report, requests and answers

The eyes first hunt for text with at most three paid actions (`PRE_REPORT_ACTIONS`), then file the report: seven fixed sections (`texts`, `road`, `vehicles`, `poles_signs`, `buildings`, `nature`, `unusual`), each line `{text, frame}`. The prompts agree on three lines the report always has: «Сторона движения:», «Дорога идёт:» and «Солнце:».

A request names a topic to look at, never an expected answer:

- `{kind: "describe", topic}`: describe the topic in the eyes' own words;
- `{kind: "text", target}`: copy a text letter for letter;
- `{kind: "drive", heading, distance_m, topic}`: drive along the road, then describe the new place. One per `ask`, only when movement is on and a paid turn is left. The other requests of that `ask` are answered from the new place.

Each answer carries `value`, `confidence` (`sure` or `unsure`) and the `frame` it rests on. Instead of a description the eyes may abstain with `not_visible`, `unreadable` or, for a drive, `no_road`. A drive answer is accepted only after a successful `move` and must cite a frame taken by that move or later; without a move only `no_road` answers a drive. An answer carries exactly one item for every request: one with a repeated or a missing number comes back to the eyes for correction.

The server enforces the separation whatever the prompts say:

- a request with `?` or the particle «ли» is refused with `GEO_DETECTIVE_QUESTION_FORM`, one that names a country, a city or a people with `GEO_DETECTIVE_PLACE_WORD`. A refused `ask` is not counted;
- place words the eyes write in their own words reach the brain as `[…]`; text copied from a frame inside «…» is kept;
- frames taken 15 metres or more from the start are annotated for the brain («кадр 7, 640 м к СВ от старта»), because the answer is about the start;
- an `ask` waits 30 seconds for its answers, 45 with a drive; unanswered items come back as timed out. With less than 10 seconds left an `ask` is not sent. When every human has confirmed and the round gets shorter, a waiting `ask` or `briefing` is cut so that 10 seconds stay for the final guess. The request text tells the eyes how long the brain really waits;
- `final_guess` waits for the round start, like an Intuit bot's, so no guess is final before the eyes have a frame;
- a `final_guess` before any `ask` with `control: true` gets one reminder (`GEO_DETECTIVE_CONTROL_MISSING`) while more than 30 seconds are left; the second one is accepted. Its point is kept as a checkpoint either way;
- an `ask` without `finding` or `current_guess`, and a `final_guess` without `summary`, `finding`, `confidence` or `clue`, gets the one-time correction `GEO_BOT_JOURNAL_FIELD_MISSING`, as for an Intuit bot. `hypothesis` is required by the `ask` schema.

The codes are described in [errors](./errors.md#GEO_DETECTIVE_QUESTION_FORM).

### Processes and the round end

The server owns the deadline, both tokens and both processes. If the eyes exit early, pending and later requests come back as `eyes_down` and the brain is told to send its final guess. The round counts the bot as finished when the brain has exited and the eyes have exited too or 8 seconds have passed; the eyes are then stopped. This keeps the token usage of both processes on the badge. A process that cannot start fails the launch for the round («сбой запуска»). If the brain exits without a final guess, the latest `current_guess` is scored, as for an Intuit bot. A bot whose final guess is recorded counts as finished («завершил ход») even if the round or its budget ends while its processes are still exiting; this holds for Intuit bots too.

### Prompts

The start prompts are plain text files in `server/bots/prompts/`: `intuit.txt`, `detective-brain.txt` and `detective-eyes.txt`. A file is read at every bot launch, so an edit applies from the next round without a restart. The tag syntax, the variables of each file and what happens when a file is broken are in [the prompts README](../server/bots/prompts/README.md).

### Fake mode

With `--fake` a scripted brain and scripted eyes play through the real session: a report, three exchanges (one with a drive when movement is on, one unreadable text, one unsure answer, one control check) and a final guess. The token numbers on the badge are made up, so the split by process can be seen without a CLI.

## Usage and price estimates

Normalized `inputTokens` includes cached reads; `cachedInputTokens` is a subset. `totalTokens` is normalized input plus output. Claude input includes its separately reported cache creation and cache reads. Codex already includes cached reads in its input count. AGY's reported total determines whether its raw input already includes cache reads or reports them separately, so cached input is counted once. Ambiguous or contradictory AGY usage is unavailable. See its [official headless documentation](https://antigravity.google/docs/cli/headless/#read-the-results) for the raw counters. Terminal totals are used without also summing intermediate snapshots. Missing or invalid usage is unavailable. Codex skips unrelated oversized lines and discards accumulated counters when a malformed, truncated or oversized terminal event is identifiable in its bounded prefix.

A Detective bot reports the sum of its two processes as `tokenUsage`, the parts as `roleUsage: {brain?, eyes?}` and the model of each process as `roleModels: {brain, eyes}`. Each part is priced at its own model and the prices are added; the price is unknown when the price of either part is. The badge tooltip shows the split («Мозг», «Глаза»), with the model names when the two processes ran on different ones.

A paid game turn counts a successful `look` or `move`, not a model request. Observation, checkpoint and final submissions and image-file reads can require further model exchanges and repeated input processing even when only one paid turn is used.

The public [OpenRouter model list](https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties) supplies USD-per-token prompt, completion and optional cache-read prices. The estimate is:

```text
max(0, inputTokens - cachedInputTokens) * promptPrice
  + cachedInputTokens * (cacheReadPrice ?? promptPrice)
  + outputTokens * completionPrice
```

Matching first preserves known exact or canonical catalog IDs, then removes effort suffixes, normalizes provider/version/name order and considers nearby versions within the same provider, family and tier. This keeps a genuine model name ending in `max` distinct from an effort suffix. Fuzzy version matches are labelled approximate. Unknown matches or unavailable prices yield `costUsd: null`.

The cache lives at `{dataDir}/openrouter-models-cache.json`, is fresh for 24 hours, and falls back to readable stale data on refresh failure. Pricing runs asynchronously; late estimates enrich the matching result and in-memory round archive, including its Final card, without changing scores or resetting an open card's focus, tooltip or preview. A different match or round generation cannot receive the update. Historical matches are not backfilled. These are reference estimates; CLI subscriptions and provider-specific charges can differ.

## Server diagnostics

The server writes daily JSON Lines files at `{dataDir}/logs/YYYY-MM-DD.jsonl` and prunes log files older than 14 days. Diagnostic records identify a bot run with `matchId`, `gen`, `roundNumber` and `slotId`; timestamps are UTC. Bot diagnostics are bounded and secret-redacted before they reach the log.

- `bot_tool_call` records each requested game tool, including rejected calls and final-answer submissions. It includes bounded original arguments, result text and image metadata/counts (not image bytes), whether a checkpoint was saved, duration and `ok` status. For a Detective bot the record names the `role` (`brain` or `eyes`) and holds the tool, bounded arguments, duration and `ok` status.
- `bot_journal_correction` records each one-time correction with `harness`, `tool`, `missing` (field names) and the code, so the correction rate per harness can be counted. It never contains prompt text, environment values or file paths. A Detective's line also names the `role` and a short `reason`; the control reminder has a code and no `missing`, and an `answer` the eyes had to correct is logged with `reason` only.
- `bot_style_fallback` records, at round start, each slot set to Detective that plays Intuit in that round, with the `reason` (`budget` or `harness`).
- `harness_start` and `harness_end` record the selected model, context and process lifecycle; a Detective bot writes one pair per process, each with its `role`. `harness_usage` records raw counters, usage status (`reported`, `missing`, `invalid` or `truncated`), normalized `tokenUsage` or `null`, the number of terminal usage records, and safe CLI metadata when available (`conversation_id`, `status`, `num_turns`, `duration_seconds`). `num_turns` is the CLI's counter; it is not a count of model generations. `rawCounterScope` is `terminal` for Claude and AGY and `last-turn` for Codex.
- `harness_cost` records an asynchronous reference price estimate. It is not the provider's actual bill.
- `harness_tool_call` copies AGY guard attempts with `phase: "attempt"`, observed time, tool and allow/deny decision; a record shows an attempted operation, not proof that it completed successfully. The hook journal is copied before the round's `workDir` is removed. Concurrent writes are serialized and capped at 256 KiB; collection accepts at most 512 records. Malformed, overflowing or dropped journal records produce `harness_monitor_error`, while permission decisions remain unchanged.
- `harness_monitor_error` reports issues collecting usage or diagnostics. Diagnostic capture is best-effort and does not alter gameplay.

The logger redacts known tokens and keys, omits payload fields such as base64/data and data URIs, and bounds diagnostic content (strings to 4,096 characters, approximately 16 KiB of total text, nesting depth 6, arrays to 32 items and objects to 40 keys). Terminal JSON does not provide hidden model reasoning or per-generation provider usage, so those details are not captured. Usage values and cost estimates describe only the counters and pricing available from the CLI and catalog.

For example, filter one match and event from the current day's file with `jq`:

```sh
jq 'select(.data.matchId == "MATCH_ID" and .event == "bot_tool_call")' \
  "$GEOAISSR_DATA_DIR/logs/$(date -u +%F).jsonl"
```
