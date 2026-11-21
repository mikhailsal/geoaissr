# Detective spike: pre-registration and gate report

This file decides the gate in the bot-journal plan ("Gate: one-cycle spike on the eval photo set", amendments D-GATEBAR, D-REPEATS, D-TRANSCRIBE, and the delegated rows ASK-CUTOFF and EYES-DOWN). The pre-registration below was committed before any paid Detective round ran. The gate report is appended under it after the runs and does not change the pre-registration.

## Pre-registration

### What runs

The spike lives in `spikes/detective/` and runs outside the game UI: `bun run spike:detective -- --help`. One round has two `claude -p` processes behind a loopback tool server. The server binds each token to one role:

- **Brain.** Text only. Tools: `ask` and `final_guess`. The server strips every image from a brain reply. The brain's work directory is a sibling of the eyes' directory and never holds a frame. Its start text gives only the region (`весь мир`), the distance scale (the region diagonal, about 14,917 km), the budget and the feature catalog.
- **Eyes.** Tools: `observe` (the 4 start frames, numbered 1–4), `look` (each call is a paid turn and returns a new numbered frame; the budget is the same move limit a single agent has), a blocking `next_request` and `answer`. Eval rounds have no `move`, as in `eval:bots`.
- **Broker (server-owned).** Each request has an id, and only one request is outstanding at a time. Each request is settled exactly once; a late answer is dropped. `ask` takes 1–5 questions. Each question is a catalog feature (`docs/evals/dataset/catalog.json`, 8 features with closed value lists) or a literal transcription request (`{"kind":"text","target":…}`).
  - Every non-abstaining answer must cite a frame number that the server issued to the eyes.
  - A feature answer must be a catalog value, `not_visible` or `unreadable`.
  - `ask` returns after 30 s, or when 10 s of the budget remain, whichever comes first. If less than 10 s remain, the ask is not sent.
  - The status of each question is `answered`, `abstained`, `timeout` or `eyes_down`.
  - When the eyes process exits, the pending ask and every later ask settle as `eyes_down` at once (EYES-DOWN).
- **Guard.** A transcription target that contains a country name, its stem or a demonym is refused before it reaches the eyes (`GEO_DETECTIVE_PLACE_WORD`), and the refusal does not count against the 5-question cap. Script names built from demonyms («японская», «грузинская») are refused as well, because the script is asked through the catalog feature. The plan's script-name whitelist exists for brain-written value lists (Open Question 1), which the spike does not have. Answers may contain any visible text (D-TRANSCRIBE).
- **Journal.**
  - From the second `ask` on, `finding` and `current_guess` are required. One correction is allowed per ask (`GEO_BOT_JOURNAL_FIELD_MISSING`); after it the ask goes through and is recorded with `findingState: missing`.
  - `hypothesis` carries the "why": what the brain wants to know and what each answer would mean.
  - `current_guess` is a checkpoint. A round without a final guess scores the last checkpoint, as in Stage 1.
  - `final_guess` needs `summary` and `finding`, with one correction.
- **Clock.** The budget starts when both processes are spawned, as in `eval:bots`, where it starts at the observe release right after spawn. CLI start-up therefore counts against the budget. A `final_guess` after the budget is refused, so "has a final guess" means "finished inside the budget".

Fixed settings for every arm: harness `claude`, model `claude-haiku-5-5` for both roles, effort `low`, move limit 4, frame size 640, concurrency 2 (4 CLI processes at most), the committed 28-spot eval set (dataset hash `8599d87ad828` with the current hash function; it is the same manifest and frames as the Stage 1 runs, whose summaries carry `ea531211bacf` from the older function, which hashed the manifest only).

### Arms

| Arm                  | Command                                                                                      | Rounds                    | Use                                                                           |
| -------------------- | -------------------------------------------------------------------------------------------- | ------------------------- | ----------------------------------------------------------------------------- |
| Pilot                | `--budget 90 --limit 3`                                                                      | 3 (+ at most 2 re-pilots) | Protocol check only; not counted                                              |
| **detective-90**     | `--budget 90 --repeats 3 --label detective-90`                                               | 84                        | Decides bars 1–5                                                              |
| detective-60         | `--budget 60 --label detective-60`                                                           | 28                        | Reported, no bar (D-GATEBAR)                                                  |
| labels-90            | `--arm labels --budget 90 --label labels-90`                                                 | 28                        | Leak comparison: the brain is fed the human labels and the labelled sign text |
| Stage 1 single agent | existing runs `candidate-90` and `candidate-60` (claude, haiku, low, move limit 4, 3 passes) | 84 + 84                   | Baseline for unsupported findings and tokens; no new run                      |

Pilot rule: re-pilot at most twice, and only if the pilot finishes fewer than 2 of 3 rounds or the protocol is broken (a tool error loop, frames not reaching the eyes, answers never settling). Pilot fixes may change prompts and protocol bugs. After the last pilot the prompts are frozen: the summary's `promptHash` and `toolSchemaHash` must be the same in all three measured arms, and the report states them. No tuning on the measured arms.

Infra rule: rounds where the brain CLI fails before its first tool call are infra errors. They are excluded from the rates and counted. The run stops at the first one (as `eval:bots` does), and the missing rounds of that arm are run once more with the same settings after the cause is fixed. If more than 4 of the 84 rounds of detective-90 end as infra errors, the bars are marked inconclusive.

### Bars (all read from detective-90)

Every rate is reported with a Wilson 95% interval. A bar passes on its point estimate; the interval is reported next to it.

1. **Finish:** at least 90% of measured rounds end with a final guess inside the 90 s budget. The 60 s rate from detective-60 is reported next to it (D-GATEBAR).
2. **Exchanges:** the median number of exchanges per round is at least 3. An exchange is an `ask` settled by an answer. Timed-out and `eyes_down` asks are counted separately and are not exchanges.
3. **Feature agreement:** the eyes' value equals the human label on at least 80% of answered feature questions. Answered means a value other than `not_visible` or `unreadable`. A missing or null label counts as `not_visible`, so an answer to a feature the labeller saw as not visible counts as a disagreement. Abstentions, timeouts and `eyes_down` items are reported separately, as is a per-feature breakdown. The labels were made by a model and have not been reviewed by a person, so a disagreement can be a label error. The report names the features that drive the misses.
4. **Transcription:** at least 80% of answered transcription questions match the spot's `signText`. Matching rule (`spikes/detective/scoring.ts`): lowercase both, drop everything except letters and digits, and collapse the spaces. The answer matches when it contains one labelled text, or one labelled text contains the answer, or the two share a word of 3 or more characters. An answered transcription on a spot with no `signText` counts as a mismatch, and these are reported as their own count. Invented place names are counted and reported, with no bar: these are place names found in an answer (Russian country names from `shared/regions`, or about 55 common English country and city names) that the spot's labelled text does not contain.
5. **Unsupported findings:** detective-90's share of unsupported step findings is at least 10 percentage points lower than the Stage 1 single agent's (`candidate-90`) (D-REPEATS). The step findings compared are the Detective brain's `ask.finding` values (from the second ask on) and the Stage 1 `look` step findings. Final-guess findings are left out of the bar because the Stage 1 round records do not keep them. The Newcombe (hybrid Wilson) 95% interval of the difference is reported. If the interval includes 0, the reading is "no difference", whatever the point estimate, and the bar fails.

The gate passes only if all five bars pass. If it fails, Stage 1 ships alone and Detective stays an experiment (plan, Gate).

### Unsupported-finding rubric (blinded model judge)

The judge is a model, not a person. It is a separate `claude -p` process (`claude-sonnet-5-5`, read-only access to the frames), one call per spot. The human-review sheet is left for the owner.

- **Input per spot.** The 4 full-resolution frames from the dataset. Every zoom the eyes or the Stage 1 agent made is a crop of these frames, so every true visual claim can be checked in them. The input also has all step findings for that spot from detective-90 and candidate-90, mixed together, shuffled with a fixed seed, and numbered.
- **Blinding.** Arm, role, round and timing fields are removed. These words are masked as `[…]`: «мозг», «глаза», «напарник», «ответ(ы)», «запрос», «кадр N». The two arms still write in different styles, so the blinding is partial, and the report says so.
- **Rubric, per finding.**
  - List the finding's visual claims: statements about what is or is not visible in the scene. Claims about places, countries or the bot's own reasoning do not count.
  - A finding with no visual claim is `no_visual_claim` and is left out of the rate.
  - The finding is `unsupported` if at least one visual claim is contradicted by the frames, or describes something that appears in none of them.
  - Otherwise it is `supported`.
  - The judge also marks whether the geographic rule the finding states is correct (`rule_ok: true | false | none`). This is reported only.
- **Output.** JSON, one entry per finding number. The script maps the numbers back to arms after the judge answers.

### Other reported numbers (no bars)

- Time to final guess: p50 and p95. Asks sent per round. Asks settled by an answer vs by a timeout. Guard rejections. Late answers dropped. Invalid answers refused. Corrections. Paid looks by the eyes per round.
- **ASK-CUTOFF.** p50 and p95 of a full ask cycle (from `ask` to a settled answer) over the answered asks of detective-90. The Stage 2 ask timeout is set no lower than this p95.
- **Tokens.** Median tokens per round for brain, eyes and both together, against Stage 1's median per round (`candidate-90`: 41,820 tokens).
- **Error.** Median error in km and its IQR for each arm, against Stage 1 (`candidate-90`: 5.8 km median).
- **Leak comparison.** labels-90 against detective-90 on the same spots. Reported for each arm: median error and finish rate. Paired per spot: the detective-90 median of the 3 passes against the labels-90 value, plus the number of spots where each arm is closer. If the eyes-fed brain is closer than the label-fed brain on most spots, the eyes carry place information beyond the labels; transcriptions with place names are the likely channel. A label-fed brain that is much closer shows what the eyes' errors cost.
- **Open Question 1.** The report gives a recommendation on the closed catalog vs values written by the brain, based on the agreement numbers, the abstention rate, the guard rejections and how often the brain needed a transcription to say what the catalog could not.

## Gate report

_Appended after the runs._
