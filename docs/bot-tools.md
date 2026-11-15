# Bot tools and accounting

Bots inspect the panorama through the local bridge. Reasoning and usage appear in the result card after the round; active-round views expose progress only.

## Exploration and guesses

| Tool           | Effect                                                | Paid turns   |
| -------------- | ----------------------------------------------------- | ------------ |
| `observe`      | Return the starting views                             | 0            |
| `look`         | Change heading, pitch or field of view                | 1 on success |
| `move`         | Move along the road when movement is enabled          | 1 on success |
| `draft_guess`  | Replace the current checkpoint and continue exploring | 0            |
| `final_guess`  | Freeze the final answer                               | 0            |
| `submit_guess` | Deprecated final submission with legacy behavior      | 0            |

Failed calls do not spend a turn. A final submission remains available after the paid-turn limit. Final answers cannot be overwritten. If the process exits or time expires without a final answer, the latest draft is scored; without either, the bot has no guess. Process completion drains terminal usage without holding round completion for a price request.

Advertised draft and final schemas are strict. Their field order is `facts`, `rejected_guesses`, `conclusion`, `lat`, `lng`, then optional `quip`:

- `facts`: nonempty text, at most 1,000 characters.
- `rejected_guesses`: optional; when provided, 1–3 objects with `guess` (1–120 characters) and `reason` (1–300 characters).
- `conclusion`: nonempty text, at most 600 characters.
- `lat`: finite number in `[-90, 90]`; `lng`: finite number, normalized to `[-180, 180]`.
- `quip`: optional text, at most 120 characters.

Ingress preserves valid coordinates even if reasoning is missing or malformed. Long text is truncated to its field limit, and valid rejected alternatives are retained independently. Legacy `explanation` fills the conclusion slot when no valid conclusion exists, including with partial structured blocks. Modern calls with no nonempty `facts`, `conclusion` or legacy `explanation` save a draft and request an explanation; an empty `final_guess` returns an error without closing the session, allowing correction. The deprecated `submit_guess` retains its previous finalization behavior.

The prompt requests a short evidence-based draft immediately after viewing the initial frames. Explanations must name visible details and connect them to a geographic deduction or a rejected alternative, acknowledging uncertainty rather than inventing clues. Alternatives are optional. File-based harnesses may use `read_file` only for game-provided images. These instructions do not guarantee a model's compliance or geographic accuracy.

The advertised time budget is capped by the round duration. Every tool response reports remaining time; at 15 seconds or less, an active bot without a final answer is asked to submit one, while the prompt asks the bot to reserve time for submission. An early end to the shared AI waiting window can still end the round before that personal budget.

`look` accepts heading, optional pitch, optional `fov` and optional `zoom` in `1..9`. Explicit finite `fov` takes precedence and is clamped to `10..120`; otherwise `fov = clamp(round(90 / zoom), 10, 120)`, defaulting to 90. A field of view of 20–45 zooms in, while 120 is wide. Fake images use the same field-of-view projection. `look` and `move` advertise a nonempty hypothesis of at most 300 characters; older or incomplete calls can omit it. Successful step records preserve the effective parameters and valid hypothesis.

## Usage and price estimates

Normalized `inputTokens` includes cached reads; `cachedInputTokens` is a subset. `totalTokens` is normalized input plus output. Claude input includes its separately reported cache creation and cache reads. Codex already includes cached reads in its input count. AGY's separate cache-read treatment is inferred from the consecutive examples in its [official headless documentation](https://antigravity.google/docs/cli/headless/#read-the-results). Terminal totals are used without also summing intermediate snapshots. Missing or invalid usage is unavailable. Codex skips unrelated oversized lines and discards accumulated counters when a malformed, truncated or oversized terminal event is identifiable in its bounded prefix.

The public [OpenRouter model list](https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties) supplies USD-per-token prompt, completion and optional cache-read prices. The estimate is:

```text
max(0, inputTokens - cachedInputTokens) * promptPrice
  + cachedInputTokens * (cacheReadPrice ?? promptPrice)
  + outputTokens * completionPrice
```

Matching first preserves known exact or canonical catalog IDs, then removes effort suffixes, normalizes provider/version/name order and considers nearby versions within the same provider, family and tier. This keeps a genuine model name ending in `max` distinct from an effort suffix. Fuzzy version matches are labelled approximate. Unknown matches or unavailable prices yield `costUsd: null`.

The cache lives at `{dataDir}/openrouter-models-cache.json`, is fresh for 24 hours, and falls back to readable stale data on refresh failure. Pricing runs asynchronously; late estimates enrich the matching result and in-memory round archive, including its Final card, without changing scores or resetting an open card's focus, tooltip or preview. A different match or round generation cannot receive the update. Historical matches are not backfilled. These are reference estimates; CLI subscriptions and provider-specific charges can differ.
