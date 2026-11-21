# Detective spike: pre-registration and gate report

This file decides the gate in the bot-journal plan ("Gate: one-cycle spike on the eval photo set", amendments D-GATEBAR, D-REPEATS, D-TRANSCRIBE, and the delegated rows ASK-CUTOFF and EYES-DOWN). The pre-registration below was committed before any paid Detective round ran. The gate report is appended under it after the runs and does not change the pre-registration.

A second spike tested this report's recommendation (brain-written choices, zoom before abstaining, a stronger brain model): see [detective-spike-2.md](./detective-spike-2.md).

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

**Verdict: the gate fails.** Bars 1 and 2 pass. Bars 3, 4 and 5 fail. Under the plan's rule, Stage 1 ships alone and Detective stays an experiment.

All three measured arms ran on 2026-11-21 from commit `233e7d4` with no code change between them: claude, `claude-haiku-5-5`, effort low, move limit 4, concurrency 2. None had an infra error, and all are complete. The aggregate results are in `docs/evals/results/detective/`: `detective-90.json`, `detective-60.json`, `labels-90.json`, `judge-90.json` and `leak-90.json`. The per-round files are not committed.

### Bars (detective-90, 84 rounds)

| #   | Bar                                           | Result                                        | 95% interval                                     | Verdict                         |
| --- | --------------------------------------------- | --------------------------------------------- | ------------------------------------------------ | ------------------------------- |
| 1   | ≥90% finish inside 90 s                       | 84/84 = 100%                                  | 95.6–100%                                        | **pass**                        |
| 2   | median exchanges ≥3                           | 3 (77/84 rounds have ≥3)                      | 83.8–95.9% for ≥3                                | **pass** (at the bar)           |
| 3   | feature agreement ≥80% of answered            | 297/440 = 67.5%                               | 63.0–71.7%                                       | **fail**                        |
| 4   | transcription match ≥80% of answered          | 29/43 = 67.4%                                 | 52.5–79.5%                                       | **fail**                        |
| 5   | unsupported findings ≥10 points below Stage 1 | Detective 39/206 = 18.9%; Stage 1 6/89 = 6.7% | difference −12.2 points (Newcombe −19.1 to −3.6) | **fail**: Detective is _higher_ |

**60 s (detective-60, 28 rounds, reported only).**

- Finish: 28/28 = 100% (87.9–100%). The median of exchanges is 3, but only 19 of 28 rounds reach 3.
- Feature agreement: 93/132 = 70.5%. Transcription match: 5/8.
- Median error: 2,365 km.

**Details behind bars 3–5.**

- **Features.**
  - The eyes abstained on 444 of 884 feature questions (50%). No question timed out, and no eyes process went down.
  - Per feature (agree/answered): script 63/69, vegetation 77/94, roof type 60/79, centre line 37/53, plate colour 14/26, pole material 33/68, driving side 7/17, soil colour 6/34.
  - 61 of the 143 misses are an eyes value where the label says `not_visible` or `none_visible`. The largest group is `soil_colour: brown` against `not_visible`, 22 times. The labels are model-made and unreviewed, so part of bar 3 may be label error.
  - A post-hoc reading that is not pre-registered and cannot pass the bar: on the 353 items whose label is a positive value, agreement is 279/353 = 79.0%.
- **Transcriptions.**
  - The brain asked 199 transcription questions, in 83 of 84 rounds. The eyes answered 43 and abstained on 156.
  - Every pilot and measured round shows the eyes rarely zoom: 60 of 84 rounds made no `look` at all.
  - Several misses are near-misses under the strict rule: «BULGARI» against «BVLGARI», «TAXIMETER» against «TAXI-METER», «km 3 / 9» against «39». A post-hoc lenient rule (spaces and punctuation removed, small edit distance) gives 35/43 = 81.4%. It was not pre-registered and does not change the verdict.
  - Invented place names under the pre-registered detector: 0. Not counted by the detector: «NEPALI» and «NEPALO» for a sign labelled «NEPARU».
- **Unsupported findings.**
  - Judge: a model (`claude-sonnet-5-5`), not a person. It judged all 295 findings, and none was without a visual claim.
  - The Detective brain cannot see, so its unsupported claims are mostly the eyes' wrong answers repeated. For example, on one spot it wrote "flat roofs" where the frames show pitched slate roofs, and on another "brown soil, deciduous forest" in an urban scene with palms.
  - The geographic rules stated in the findings were wrong in 57 of 128 Detective findings that state one, against 3 of 25 for Stage 1.
  - The interval treats findings as independent. Findings of one round are correlated, so the interval is optimistic in both directions.
  - The blinding is partial: Stage 1 findings name frames by compass letter, and the two arms write in different styles.
  - The blind sheet and the key are kept outside the repo for the owner's human review.

### Accuracy and the leak comparison

| Arm                                         | Median error | Rounds within 25 km | Rounds within 750 km | Time to final p50 / p95 |
| ------------------------------------------- | ------------ | ------------------- | -------------------- | ----------------------- |
| Stage 1 single agent, 90 s (`candidate-90`) | 5.8 km       | 57/84               | 80/84                | 13.5 / 18.1 s           |
| detective-90 (brain fed the eyes)           | 3,484 km     | 12/84               | 28/84                | 25.0 / 33.8 s           |
| detective-60                                | 2,365 km     | 4/28                | 9/28                 | 21.5 / 26.1 s           |
| labels-90 (brain fed the human labels)      | 899 km       | 7/28                | 14/28                | 13.7 / 18.1 s           |

Leak comparison, paired by spot (detective-90 median of 3 passes against labels-90):

- The label-fed brain is closer on 20 spots, the eyes-fed brain on 5, and 3 are ties.
- The median paired difference is 245 km in favour of the labels.

There is no sign that the eyes carry place information beyond the labels: no invented place names, and the eyes-fed brain is worse, not better. The comparison also shows a second cost that does not depend on the eyes. Even with perfect catalog answers, the brain's median error is 899 km, while the single agent that sees the frames is at 5.8 km. Most of the place signal in these photos (architecture, landmarks, brands, the look of a street) never passes through eight catalog features and a few transcriptions.

### Cost and timing

- **Tokens.** The median per round is 145,622 (brain 55,802, eyes 89,109), against 41,820 for the Stage 1 single agent at 90 s: **3.5×**. At 60 s it is 130,632 against 41,702 (3.1×). The labels arm uses 53,376 tokens per round, brain only.
- **ASK-CUTOFF.** A full ask cycle takes p50 2.3 s and p95 6.9 s (291 answered asks). Every ask was settled by an answer: 0 timeouts, 0 `eyes_down`, 1 late answer dropped, 1 invalid answer refused and corrected. If Detective is revisited, a cutoff of 15 s keeps more than twice the p95; the 30 s in the design is safe but loose.
- **Journal.** 206 of 207 due asks carried a `finding` (99.5%). There were 6 corrections, and the guard rejected nothing.
- **Pace.** The brain finishes early, around 25 s into a 90 s budget, even though the pilot-2 prompt fix tells it to keep asking while more than 25 s remain.

### Open Question 1: closed catalog or values written by the brain

The closed catalog did what it was chosen for. Every answer was measurable, it leaked no place names, and the guard was never needed. But it is the main reason Detective loses: perfect catalog answers still leave the brain at 899 km against 5.8 km for the single agent. Brain-written values would let the brain ask about what actually separates places here, such as an architectural style, a brand or the form of a sign. That would cost a labelling pass over the questions actually asked and the place-name guard on brain text, before any agreement or leak number could be claimed. Recommendation: do not ship the closed catalog as the Detective protocol. If Detective is revisited, test brain-written values with a stronger brain model (Open Question 5), and with eyes that are required to zoom before they abstain on text. Judge that test first on the accuracy gap to the single agent, because neither agreement nor finish rate caught the real problem.

### Runs and deviations

- **Paid rounds:** 146.
  - 2 pilots × 3 rounds; detective-90 84; detective-60 28; labels-90 28.
  - 118 of them are two-CLI Detective rounds.
  - Judge: 28 `claude-sonnet-5-5` calls, about 0.57 M tokens, plus 1 smoke call on a pilot round to check the parser.
  - Paid wall time from the first pilot to the end of the judge: about 40 minutes.
- **Re-pilot.** Pilot 1 finished 3 of 3 rounds, but the runner killed both CLIs at the final guess, before `claude -p` printed its usage. That is a protocol bug, so there was one re-pilot under the pre-registered rule. The same fix commit (`233e7d4`) changed the brain prompt ("keep asking while more than 25 s remain; ask for literal text") and the eyes prompt ("zoom before abstaining on small details"). Pilot 2 finished 3 of 3 with 3, 4 and 4 exchanges. The prompts were frozen there.
- **Prompt hashes.** The pre-registration asked for one `promptHash` across the measured arms. That cannot hold, because the hash covers the budget value and the eyes prompt. The arms carry `2486b60c4355` (90 s), `aacc0472791c` (60 s) and `4c076d0c1a57` (labels, brain only), all built from the same frozen templates at `233e7d4`. `toolSchemaHash` is `7058c794c8a8` for all three.
- **Guard.** The script-name whitelist is not used for transcription targets (stated in the pre-registration). No question was rejected.
- **Stage 1 baseline concurrency.** The Stage 1 baseline ran at concurrency 3. The Stage 1 numbers above are used only for findings, tokens and accuracy, not for a finish bar.
