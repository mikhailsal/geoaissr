# Bot quality evaluation (`bun run eval:bots`)

`eval:bots` measures one bot configuration (one harness, one budget, one move limit) on a fixed set of spots and reports how well and how fast it guesses. It does not compare prompts by itself: to compare prompt or tool changes, run the same command at two different commits and compare the two result files in `docs/evals/results/`.

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

Only `id`, `countryNameRu`, `lat`, `lng` and `imagePaths` are required; the other fields are optional, so older manifests keep working. `labels` holds the catalogue features (`driving_side`, `script`, `centre_line`, `pole_material`, `plate_colour`, `vegetation`, `soil_colour`, `roof_type`); their value ids are listed in `catalog.json` next to the manifest. The evaluator itself only reads `headingDeg`; the rest is for dataset review and later analysis.

Without `--dataset`, `--dry` uses three built-in fake spots with no frames.

### Headings and the unknown-compass limitation

`headingDeg` is the compass heading of frame 0. When it is known, the headings the bot sees (start frames and `look` labels) are compass headings. When it is `null`, headings are measured from frame 0 (frame 0 is labelled 0 degrees, "С"). Such spots still show N/E/S/W-style labels, but they are relative to frame 0, not real compass directions. This is a known limitation: a bot that reasons about the sun or the compass will be misled on these spots.

### How `look` works on frames

A `look` crops the nearest of the four frames. The crop is offset by the difference between the requested heading and the frame centre, and by the requested pitch, using a rectilinear (tangent) approximation. Its size follows the requested field of view, where the game maps `zoom` to `fov = clamp(round(90 / zoom), 10, 120)` before the image service is called. The crop is clamped to the frame (so `fov` above 90 returns the whole frame) and resized to `--image-size`. `move` is unavailable.

## Running

Flags (all optional):

| Flag            | Default                                | Meaning                                                         |
| --------------- | -------------------------------------- | --------------------------------------------------------------- |
| `--harness`     | claude                                 | `claude`, `codex` or `agy`                                      |
| `--dataset`     | none                                   | Dataset directory with `manifest.json`                          |
| `--repeats`     | 3                                      | Rounds per spot                                                 |
| `--budget`      | 60                                     | Bot time budget in seconds (60-600)                             |
| `--move-limit`  | 4                                      | Paid looks per round (0-20)                                     |
| `--image-size`  | 640                                    | Image size shown to the bot: 256, 400 or 640                    |
| `--concurrency` | 1                                      | Rounds in parallel (1-3)                                        |
| `--limit`       | all                                    | Use only the first N spots of the manifest                      |
| `--label`       | none                                   | Run name; the summary is also written to `results/<label>.json` |
| `--out`         | `.geoaissr-dev/evals/<label or time>/` | Directory for `rounds.jsonl` and `summary.json`                 |
| `--dry`         | off                                    | Fake bot, no CLI calls, no tokens                               |

The bot uses the neutral personality. Each round waits for `bot_finished`, or for budget + 15 seconds; a round that hits the limit is recorded with `timedOut: true` and scored from its last checkpoint, if any.

Dry run (checks the pipeline, spends nothing):

```bash
bun run eval:bots --dry --repeats 1
```

Baseline run (live, spends subscription tokens):

```bash
bun run eval:bots --harness claude --dataset docs/evals/dataset --repeats 3 --budget 60 --move-limit 4 --label baseline-claude-<short-commit>
```

Smoke run with a single round: add `--limit 1 --repeats 1`.

## Output

`rounds.jsonl` has one record per round: spot id, repeat, harness, model, budget, whether a `bot_finished` arrived and whether a final guess was submitted, time to final guess, the scored pin and its source (`final`, `checkpoint` or `none`), error in km, the first checkpoint, pin movement from the first checkpoint to the scored pin, number of paid looks, number of steps with a finding, token usage when the harness reports it, and the step texts (`hypothesis`, and `finding` when the bot contract has it) for a manual review sheet.

The summary (`summary.json`, and `results/<label>.json` when `--label` is given) has: rounds, finish rate (a final guess before `bot_finished`), no-pin rate, time to final p50 and p95, median error and IQR in km, median pin movement and the share of rounds that moved over 25 km, median paid looks, the share of paid steps with a finding, and the run configuration (harness, model, budget, move limit, repeats, git commit, date).

Notes on the numbers:

- Event data carries no timestamps, so times are measured by the evaluator from the moment the start frames are released.
- The share of steps with a finding is `null` while the bot contract has no per-step finding field. It is detected per round from the step events, so a round that carries the field but leaves it empty counts as zero findings.
- A bot that exits with only draft guesses is reported as finished by the runner; the evaluator separates this case: it is not counted in the finish rate, and the pin source is `checkpoint`.
- With `--concurrency` above 1, rounds share the subscription rate limits, which can slow the harness and inflate times.
