# Bot tools and accounting

Bots inspect the panorama through the local bridge. Reasoning and usage appear in the result card after the round; active-round views expose progress only.

## Exploration and the step journal

| Tool          | Effect                                          | Paid turns   |
| ------------- | ----------------------------------------------- | ------------ |
| `observe`     | Return the four starting views (journal step 0) | 0            |
| `look`        | Change heading, pitch or field of view          | 1 on success |
| `move`        | Move along the road when movement is enabled    | 1 on success |
| `final_guess` | Freeze the final answer                         | 0            |

There is no `draft_guess` or `submit_guess`: both are unknown tools. Checkpoints come only from `current_guess` on `look` and `move`.

Failed calls do not spend a turn. A final submission remains available after the paid-turn limit. Final answers cannot be overwritten. If the process exits or time expires without a final answer, the latest checkpoint is scored; with no checkpoint and no final answer the bot has no guess (no pin, zero points, "нет догадки"). Process completion drains terminal usage without holding round completion for a price request.

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

Transport errors: if the bridge cannot reach the server, the bot gets «Нет связи с сервером игры. Повторите вызов один раз; если ошибка повторится — вызовите final_guess.» with `isError: true` and `[GEO_BOT_BRIDGE_UNREACHABLE]` (see [errors](./errors.md#GEO_BOT_BRIDGE_UNREACHABLE)).

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

`shared/bot-journal.ts` defines one shape (zod and types): steps `{index, kind: observe | look | move, reason?, frames, finding?, findingState: pending | recorded | missing | round-ended, shifts?, currentGuess?, pointMissing?, movedKm?, atMs}` plus `{summary?, finalFinding?}`. The engine event `bot_finding` attaches a finding, shifts and point to a step; the journal reaches clients as `journal` on the AI entry of the round results. Old results with `facts`, `conclusion` or `rejectedGuesses` and no journal still parse, and a record without a journal shows no steps.

The prompt asks the bot to keep several region versions, record the reason before each action and the finding after it, add shifts that exclude or weaken a version, send the current point with every paid action and finish with a first-person summary. A clue counts only if it is tied to a frame and shifts the weight between versions. File-based harnesses may use `read_file` only for game-provided images. These instructions do not guarantee a model's compliance or geographic accuracy.

The advertised time budget is capped by the round duration. Every tool response reports remaining time; at 15 seconds or less it says «Немедленно отправь лучшую версию через final_guess с выводом по последнему кадру.», while the prompt asks the bot to reserve time for submission. Remaining time is the earlier of the bot's own budget end and the engine's round end: when every human has confirmed, the engine shortens the round to the shared AI waiting window and the bots read that shorter deadline from then on. The checkpoint that counts is the last one the server received before the round was finalized.

`look` accepts heading, optional pitch, optional `fov` and optional `zoom` in `1..9`. Explicit finite `fov` takes precedence and is clamped to `10..120`; otherwise `fov = clamp(round(90 / zoom), 10, 120)`, defaulting to 90. A field of view of 20–45 zooms in, while 120 is wide. Fake images use the same field-of-view projection. Successful step records preserve the effective parameters and the valid hypothesis (the step's reason).

## Usage and price estimates

Normalized `inputTokens` includes cached reads; `cachedInputTokens` is a subset. `totalTokens` is normalized input plus output. Claude input includes its separately reported cache creation and cache reads. Codex already includes cached reads in its input count. AGY's reported total determines whether its raw input already includes cache reads or reports them separately, so cached input is counted once. Ambiguous or contradictory AGY usage is unavailable. See its [official headless documentation](https://antigravity.google/docs/cli/headless/#read-the-results) for the raw counters. Terminal totals are used without also summing intermediate snapshots. Missing or invalid usage is unavailable. Codex skips unrelated oversized lines and discards accumulated counters when a malformed, truncated or oversized terminal event is identifiable in its bounded prefix.

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

- `bot_tool_call` records each requested game tool, including rejected calls and final-answer submissions. It includes bounded original arguments, result text and image metadata/counts (not image bytes), whether a checkpoint was saved, duration and `ok` status.
- `bot_journal_correction` records each one-time correction with `harness`, `tool`, `missing` (field names) and the code, so the correction rate per harness can be counted. It never contains prompt text, environment values or file paths.
- `harness_start` and `harness_end` record the selected model, context and process lifecycle. `harness_usage` records raw counters, usage status (`reported`, `missing`, `invalid` or `truncated`), normalized `tokenUsage` or `null`, the number of terminal usage records, and safe CLI metadata when available (`conversation_id`, `status`, `num_turns`, `duration_seconds`). `num_turns` is the CLI's counter; it is not a count of model generations. `rawCounterScope` is `terminal` for Claude and AGY and `last-turn` for Codex.
- `harness_cost` records an asynchronous reference price estimate. It is not the provider's actual bill.
- `harness_tool_call` copies AGY guard attempts with `phase: "attempt"`, observed time, tool and allow/deny decision; a record shows an attempted operation, not proof that it completed successfully. The hook journal is copied before the round's `workDir` is removed. Concurrent writes are serialized and capped at 256 KiB; collection accepts at most 512 records. Malformed, overflowing or dropped journal records produce `harness_monitor_error`, while permission decisions remain unchanged.
- `harness_monitor_error` reports issues collecting usage or diagnostics. Diagnostic capture is best-effort and does not alter gameplay.

The logger redacts known tokens and keys, omits payload fields such as base64/data and data URIs, and bounds diagnostic content (strings to 4,096 characters, approximately 16 KiB of total text, nesting depth 6, arrays to 32 items and objects to 40 keys). Terminal JSON does not provide hidden model reasoning or per-generation provider usage, so those details are not captured. Usage values and cost estimates describe only the counters and pricing available from the CLI and catalog.

For example, filter one match and event from the current day's file with `jq`:

```sh
jq 'select(.data.matchId == "MATCH_ID" and .event == "bot_tool_call")' \
  "$GEOAISSR_DATA_DIR/logs/$(date -u +%F).jsonl"
```
