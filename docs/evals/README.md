# Bot quality evaluation (`bun run eval:bots`)

`eval:bots` measures one bot configuration (one harness, one budget, one move limit) on a fixed set of spots and reports how well and how fast it guesses. It does not compare prompts by itself: to compare prompt or tool changes, run the same command at two different commits and compare the two result files in `docs/evals/results/` (check that `datasetHash` matches, and look at `promptHash` and `toolSchemaHash` to see what changed).

Principles:

- Photos come from the internet under CC0, CC BY or CC BY-SA and are committed with attribution. Google imagery is never used.
- Prompts and tool contracts are not tuned on the eval set. Use the set to measure, then change prompts based on other material, or the numbers stop meaning anything.
- Repeats (`--repeats`) reduce noise for the spots you have; they add no coverage. Ten repeats of three spots still tell you about three spots. Add spots to learn about more places.
- A bot never sees the spot id, the label or the country: every runtime path, work directory and match id uses an opaque execution id (first 10 hex of sha256 of run name, spot id, attempt and a random value), because file-delivery harnesses can read their own paths.

## Smoke path

1. Pipeline check with fake bots, no tokens, no CLI:

   ```bash
   bun run eval:bots -- --dry --repeats 1
   ```

2. One real round with a real harness (spends subscription tokens):

   ```bash
   bun run eval:bots -- --dataset docs/evals/dataset --spot <id> --repeats 1
   ```

   `<id>` is a manifest id. If the harness cannot start, the command says so and exits 1 (see exit codes); run `bun run doctor`.

3. The full run, named so its aggregate summary is copied into `docs/evals/results/`:

   ```bash
   bun run eval:bots -- --dataset docs/evals/dataset --repeats 3 --label baseline-claude-<short-commit>
   ```

## Dataset

The dataset is made of internet panoramas with a checked licence (CC0, CC BY or CC BY-SA), committed together with attribution (author, source page, licence and licence URL in the manifest). Google imagery is never used: saving Street View frames would break the Google Maps Platform terms (licence 3.2.3(a)).

Each spot is four 1024x1024 JPEG perspective frames (90 degree field of view, yaw 0/90/180/270 from the panorama centre) and an entry in `manifest.json` (a JSON array):

```json
[
  {
    "id": "spot-01",
    "countryNameRu": "Польша",
    "lat": 52.2297,
    "lng": 21.0122,
    "imagePaths": ["./01-0.jpg", "./01-90.jpg", "./01-180.jpg", "./01-270.jpg"],
    "headingDeg": 143.5,
    "source": {
      "title": "...",
      "pageUrl": "...",
      "author": "...",
      "license": "CC BY-SA 4.0",
      "licenseUrl": "..."
    },
    "labels": { "driving_side": "right", "script": "latin" },
    "signText": [{ "frame": 1, "text": "ul. Marszalkowska" }],
    "labelledBy": "..."
  }
]
```

`id` must be unique and match `^[a-z0-9][a-z0-9-]{0,63}$` (it is used in flags and logs, never shown to a bot). A manifest with a duplicate or unsafe id is rejected. Only `id`, `countryNameRu`, `lat`, `lng` and `imagePaths` are required; the other fields are optional, so older manifests keep working. `labels` holds the catalogue features (`driving_side`, `script`, `centre_line`, `pole_material`, `plate_colour`, `vegetation`, `soil_colour`, `roof_type`); their value ids are listed in `catalog.json` next to the manifest. The evaluator itself only reads `headingDeg`; the rest is for dataset review and later analysis.

Without `--dataset`, `--dry` uses three built-in fake spots (`sample-warsaw`, `sample-tokyo`, `sample-milan`) with no frames. Live runs always need `--dataset`.

The dataset itself is built separately under `docs/evals/dataset/`; this tool only reads the manifest format above. `imagePaths` are relative to the manifest directory and are resolved to absolute paths at load time. The sha256 of `manifest.json` is recorded as `datasetHash`.

### Headings and the unknown-compass limitation

`headingDeg` is the compass heading of frame 0. When it is known, the headings the bot sees (start frames and `look` labels) are compass headings. When it is `null`, headings are measured from frame 0 (frame 0 is labelled 0 degrees, "С"). Such spots still show N/E/S/W-style labels, but they are relative to frame 0, not real compass directions. This is a known limitation: a bot that reasons about the sun or the compass will be misled on these spots.

### How `look` works on frames

A `look` crops the nearest of the four frames. The crop is offset by the difference between the requested heading and the frame centre, and by the requested pitch, using a rectilinear (tangent) approximation. Its size follows the requested field of view, where the game maps `zoom` to `fov = clamp(round(90 / zoom), 10, 120)` before the image service is called. The crop is clamped to the frame (so `fov` above 90 returns the whole frame) and resized to `--image-size`. `move` is unavailable.

## Viewing protocol

Each spot is four 90 degree frames (yaw 0, 90, 180, 270). `observe` shows all four. A `look` is a crop or zoom over those four frames, never a new photo, and costs one paid step; the number of paid steps is capped by `--move-limit`. `move` is unavailable. Time is capped by `--budget` seconds (a round is declared timed out at budget + 15 s).

## Flags

Both `--flag value` and `--flag=value` work. Unknown, duplicate or malformed flags, and unknown `--spot` ids, are rejected before anything is launched: one line on stderr with the problem, a suggestion and `GEO_INVALID_ARGS`, exit code 2. `bun run eval:bots -- --help` prints the same table.

| Flag            | Default                                | Meaning                                                                           |
| --------------- | -------------------------------------- | --------------------------------------------------------------------------------- |
| `--help`        | off                                    | Print every flag with its default, exit 0                                         |
| `--dry`         | off                                    | Fake bot, no CLI calls, no tokens; the summary is marked `dry: true`              |
| `--harness`     | claude                                 | `claude`, `codex` or `agy`                                                        |
| `--dataset`     | none                                   | Dataset directory with `manifest.json`                                            |
| `--spot <id>`   | all spots                              | Manifest spot id; repeatable                                                      |
| `--repeats`     | 3                                      | Rounds per spot (1-1000)                                                          |
| `--budget`      | 60                                     | Bot time budget in seconds (60-600)                                               |
| `--move-limit`  | 4                                      | Paid looks per round (0-20)                                                       |
| `--image-size`  | 640                                    | Image size shown to the bot: 256, 400 or 640                                      |
| `--concurrency` | 1                                      | Rounds in parallel (1-3; 3 is a hard cap, recorded in the summary)                |
| `--limit`       | all                                    | Use only the first N selected spots                                               |
| `--label`       | none                                   | Run name; an aggregate copy goes to `docs/evals/results/<label>.json` (see below) |
| `--out`         | `.geoaissr-dev/evals/<label or time>/` | Directory for `rounds.jsonl` and `summary.json`                                   |

The bot uses the neutral personality and the effort `low`.

## Exit codes

| Code | Meaning                                                                                                             |
| ---- | ------------------------------------------------------------------------------------------------------------------- |
| 0    | The run finished. Bot timeouts and rounds without a guess are measured outcomes and do not change the exit code.    |
| 1    | `GEO_EVAL_HARNESS_FAILED`: at least one round could not start its bot CLI. Not measured. Fix with `bun run doctor`. |
| 2    | `GEO_INVALID_ARGS`: invalid flags or spot ids. Nothing was launched.                                                |
| 130  | Interrupted with Ctrl-C. A partial `summary.json` with `complete: false` was written.                               |

A harness launch failure is recorded per round as an infra error (`infraError` in `rounds.jsonl`). Infra rounds are excluded from every rate, no new rounds are started after the first one, and at the end one stderr line gives the spot and attempt, the fix, the `rounds.jsonl` path and the code.

On Ctrl-C no new rounds start, running bots are killed, interrupted rounds are discarded (they are not measurements) and the summary is written with the counts so far. A second Ctrl-C exits immediately.

## Output files

- `rounds.jsonl` (raw, one record per round, under `.geoaissr-dev/`, which is gitignored): spot id, execution id, repeat, harness, model, outcome flags, time to final, scored pin and its source, error in km, first checkpoint, pin movement, paid looks, tool-call audit, `infraError`, token usage and step texts.
- `summary.json`: aggregate only, written for every run, also partial ones.
- `docs/evals/results/<label>.json`: a copy of the summary, written only with `--label` and only for a run that is not dry, is complete, and has no infra errors. The committed file is aggregate-only and the writer refuses JSON that contains an absolute path (such as a home directory). Raw rounds are never committed.

## Summary fields

| Field                                          | Meaning                                                                                                                                                                                                                                                                      |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `label`, `date`, `gitCommit`                   | Run name, start time, short commit                                                                                                                                                                                                                                           |
| `harness`, `model`, `effort`                   | Bot CLI, its default model, reasoning effort                                                                                                                                                                                                                                 |
| `budgetSec`, `moveLimit`, `imageSize`          | The configuration under test                                                                                                                                                                                                                                                 |
| `concurrency`                                  | Rounds in parallel (at most 3)                                                                                                                                                                                                                                               |
| `repeats`, `spots`                             | Rounds per spot, number of selected spots                                                                                                                                                                                                                                    |
| `dry`                                          | Fake-bot run; never a measured result                                                                                                                                                                                                                                        |
| `promptHash`                                   | First 12 hex of sha256 of the system prompt text sent to the bot                                                                                                                                                                                                             |
| `toolSchemaHash`                               | First 12 hex of sha256 of the tool list JSON sent to the bot                                                                                                                                                                                                                 |
| `datasetHash`                                  | First 12 hex of sha256 of `manifest.json`; `null` for the built-in dry spots                                                                                                                                                                                                 |
| `plannedRounds`                                | `spots x repeats`                                                                                                                                                                                                                                                            |
| `completedRounds`, `rounds`                    | Rounds that ran (measured plus infra errors)                                                                                                                                                                                                                                 |
| `infraErrorRounds`                             | Rounds that could not start the harness; excluded from all rates                                                                                                                                                                                                             |
| `measuredRounds`                               | `completedRounds - infraErrorRounds`; the denominator of the rates                                                                                                                                                                                                           |
| `complete`                                     | `true` only if every planned round ran and the run was not interrupted                                                                                                                                                                                                       |
| `interrupted`                                  | The run was cut by Ctrl-C                                                                                                                                                                                                                                                    |
| `correctionCount`, `correctionRate`            | Tool calls rejected with `isError` (journal corrections, incomplete finals, invalid arguments, limit errors) and their share of audited tool calls; `null` when the dispatch audit saw no calls (fake bots). The definition is the same on both arms, so the numbers compare |
| `finishRate`, `finishRateCi95`                 | Share of measured rounds with a final guess before the bot finished, and its Wilson 95% interval `{low, high}`                                                                                                                                                               |
| `noPinRate`                                    | Share of measured rounds with no pin at all                                                                                                                                                                                                                                  |
| `timeToFinalP50Sec`, `timeToFinalP95Sec`       | Time until the server accepted the final guess, measured from the release of the start frames (not process exit)                                                                                                                                                             |
| `medianErrorKm`, `iqrErrorKm`                  | Distance from the scored pin to the truth                                                                                                                                                                                                                                    |
| `medianPinMovementKm`, `shareMovementOver25Km` | How far the pin moved from the first checkpoint to the scored pin, and the share of rounds that moved more than 25 km                                                                                                                                                        |
| `medianPaidLooks`                              | Median paid steps per round                                                                                                                                                                                                                                                  |
| `shareStepsWithFinding`                        | Share of paid steps whose journal finding was recorded (from `bot_finding` events); `null` for a bot contract without findings (the baseline arm)                                                                                                                            |

Every metric whose denominator is zero is `null`, never `0` or `NaN`.

Notes:

- Event data carries no timestamps, so times are measured by the evaluator from the moment the start frames are released.
- A bot that exits with only draft guesses is reported as finished by the runner; the evaluator separates this case: it is not counted in the finish rate and the pin source is `checkpoint`.
- With `--concurrency` above 1, rounds share the subscription rate limits, which can slow the harness and inflate times.
- Baseline and candidate: the old tool contract (`draft_guess`, `final_guess` with facts and conclusion) lives at the milestone-1 commit `98186e4`/`064a38c` on `feat/bot-step-journal`; the step journal (`finding`, `shifts`, `current_guess`, `summary`) is the candidate. Run the same command in a checkout of each commit; `gitCommit`, `promptHash` and `toolSchemaHash` in the two summaries show that the arms really differ. Results of the first comparison are in `docs/evals/results/` and summarised in [comparison.md](./results/comparison.md) once it exists.
