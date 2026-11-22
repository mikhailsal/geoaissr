# Detective spike 3: pre-registration and report

The second spike ([detective-spike-2.md](./detective-spike-2.md)) did not support building Stage 2: the journal was far less supported by the photos than the single agent's, and 46% of rounds ended more than 2,000 km from the spot. On 2026-11-21 the owner asked for a third spike with a changed protocol, a judge on a stronger model, and relaxed bars 4 and 5.

This file is committed in parts. Each part is committed before its first paid call and is not changed after it. Parts B and C may still be amended by a dated commit until their own first paid call. The report is appended under the pre-registration.

## Why the protocol changes: what spike 2's records show

No paid run was made for this section. Every number is computed from the stored rounds and judge files of spike 2 (`detective2-90`) and of the Stage 1 run (`candidate-90`).

**Where the unsupported findings come from.**

- 66 of the 75 unsupported findings were written after at least one eyes answer that the eyes judge marked wrong. Findings with a wrong answer before them are unsupported in 66 of 155 cases (43%); findings with none in 9 of 45 (20%).
- The brain restates everything it has learnt in each finding, so one wrong fact is counted again in later findings. The unsupported share by position in the round: first finding 19/80 (24%), second 27/63 (43%), third 21/44 (48%), fourth 8/12 (67%).
- Brain-written options bundle several features («высотки с кондиционерами и ржавыми балконами»). The eyes pick the closest bundle, and the brain records all of it.
- A rough per-claim error, from the judge's own list of visual claims and assuming independent claims: about 1.5% for the single agent (5.1 claims per finding), 4.5% for spike 1's fixed catalog (4.6 claims) and 13% for spike 2 (3.3 claims). The single agent and the eyes are the same model at the same effort.

**What decides accuracy.**

- A round in which the eyes read at least one text has a median error of 76 km (49 rounds, 33 within 750 km). A round with no text read has 8,284 km (35 rounds, 10 within 750 km). In 18 of those 35 rounds the eyes judge could read text that the eyes said was unreadable.
- The eyes answered 78 of 240 transcription requests (96% judged correct) and abstained on 162; 57 of the abstentions were judged wrong.
- The driving side was asked 95 times and answered 28 times with a side. Against the country's real driving side the eyes were right 21 times and wrong 7 times.
- The single agent's first checkpoint, made on the four start frames before any zoom, already has a median error of 6.1 km. Its pin moves by more than 100 km in 4 of 84 rounds. The vision model recognises a place as a whole far better than it reads single features, and the Detective protocol only lets it do the second.
- The budget is not used. The brain's final guess comes at 47.6 s (median) of 90 s, and before 60 s in 78 of 84 rounds. The eyes are busy for about 20 s per round and have 4 zooms; they used all 4 in 36 rounds.
- An `ask` already holds up to 5 questions, and the brain sends 3.6 on average. More questions per ask would add wrong facts, not information.

**How far the judge can be trusted.**

- Two `claude-sonnet-5-5` judge runs saw the same 89 single-agent findings (spike 1 and spike 2). They agree on 82 (92.1%). The first run marks 6 unsupported and the second 7, but only 3 findings are marked in both. The flips are near-misses («MAXIMETER» for «TAXI-METER», plane trees for chestnuts).
- Where the truth is known, the eyes judge was right: on all 28 driving-side answers its verdict matches the country's real driving side.
- The model that wrote this report (not a person) read the photos of two spots against 19 findings: all four frames of spot-07 and two of spot-14. It agrees with the judge on the plain cases: there is no desert, steppe or acacia on spot-07's brick-paved village lane. One of the 11 unsupported verdicts was debatable (plastered walls against «бетонные»), and one rests on a single wrong detail among three true ones.
- The frames are 1,024-pixel JPEGs (median 174 KB), and some are dark or blurred. The eyes see them at 640 pixels; a zoom is a crop of the same file (`scripts/eval-bots/crop.ts`), so it adds at most 1.6× detail. In the game a zoom fetches a new, sharper image, so this data set understates what zooming gives.

So the gap between Detective and the single agent is not a judge artefact, but single verdicts are noisy, the rubric fails a finding on one wrong detail, and the judge has no way to say that a photo cannot settle a claim. Part A changes the judge accordingly.

## Pre-registration

### Part A: the judge (committed with this section; first paid call after it)

**Changes.**

1. **Model.** Both judges run on `claude-opus-5-5` (`--judge-model`), a stronger model than either role and not the model of the eyes or the brain.
2. **Findings rubric v2** (`--rubric v2`). The judge lists the visual claims of a finding as before and marks each one:
   - `ok`: the photos agree with the claim;
   - `contradicted`: the photos show otherwise, including a claimed absence of something that is plainly there;
   - `absent`: the claim describes something that appears in none of the photos;
   - `unclear`: the photos are too small, dark or blurred to settle the claim either way.

   The script, not the judge, derives the verdict of a finding:
   - no visual claim: `no_visual_claim`, left out of the rate;
   - at least one claim `contradicted` or `absent`: `unsupported`;
   - otherwise, at least one claim `ok`: `supported`;
   - every claim `unclear`: `unclear`, left out of the rate and counted.

   `rule_ok` stays as in spike 1. The per-claim error is reported: `contradicted` plus `absent`, over all claims that are not `unclear`.

3. **Two runs.** The findings judge runs twice with different seeds (20261123 and 20261124), so the items are shuffled differently. Every share is pooled over both runs (`spikes/detective/judge-agree.ts`). The interval of a difference uses the number of distinct findings, not of verdicts, because two verdicts on one finding are not independent. The agreement between the two runs is reported per finding.
4. **Eyes judge.** The rubric of spike 2 is unchanged; it already has `cannot_tell`. Model `claude-opus-5-5`, one run, seed 20261125.

**Re-judging spike 2 (paid, before any spike 3 round).** The new judge reads the same items the old one read: the 200 findings of `detective2-90` and the 89 of `candidate-90`, and the 1,028 eyes answers of `detective2-90`.

Reported:

- the pooled unsupported share and the per-claim error of each arm, and their difference with a Newcombe interval;
- agreement between the two opus runs, and between each opus run and the old sonnet run, per finding;
- the eyes judge's correct share of answered choices and its agreement with the sonnet run, per item.

**Reading, fixed here.**

- Spike 2's bar-5 conclusion (Detective's journal is much less supported than the single agent's) stands if the pooled difference is above 10 points and its interval excludes 0. It is withdrawn if the difference is below 5 points. In every other case it is reported as weakened.
- Spike 2's bar 3 is re-read with the opus verdicts and reported. It does not change spike 2's gate.

**Spending cap:** 56 findings-judge calls and 28 eyes-judge calls on `claude-opus-5-5`, each with at most one retry.

### Part B: the ceiling test (may be amended until its first paid call)

**Question.** Can a brain that sees no picture place a spot from a full written description at all? If it cannot, no question protocol will fix Detective, and the live part is not run.

**Method.**

- **Describers.** `claude-haiku-5-5` and `claude-sonnet-5-5` at effort `medium`, one call per spot each, with read-only access to the four full-size frames and no time limit. Each writes the scene report of Part C: text copied literally, the road and driving side, vehicles and plates, poles and signs, buildings, nature, and what is unusual. A describer never names or guesses a place. The server masks a place name or a demonym that a report holds outside «…» before the brain reads it (the word becomes `[…]`), and counts it. Text inside «…» is a transcription and is left as it is. Before the first paid call the guard's list of ordinary words was extended from the stored texts of spikes 1 and 2 and a hand-written list of scene words (compass adjectives, «лесополоса», «катафот», «камера»); it is not changed after that call.
- **Brain.** `claude-sonnet-5-5`, no tools and no images. It gets the region, the scale and one report, and returns a point, a confidence and the deciding clue.
  - Three passes per spot and describer at effort `medium`: 168 calls.
  - Three more passes per spot at effort `low`, the live setting of spike 2, on the better describer's reports: 84 calls.

**Reported, per describer:** median error, rounds within 25 km and within 750 km, rounds beyond 2,000 km, the masked words, and the comparison by spot with `detective2-90` and `candidate-90`.

**Rules, fixed here.** The better describer is the one with the larger share of its 84 medium-effort rounds within 750 km; on a tie it is `claude-haiku-5-5`.

- **Stop rule.** If the better describer has fewer than 60% of its 84 medium-effort rounds within 750 km, the spike stops: a text-only brain is not supported even with a full description. `detective2-90` had 51%.
- **Eyes model for Part C.** `claude-haiku-5-5`, unless the sonnet describer's share within 750 km is at least 10 points higher; then `claude-sonnet-5-5`.
- **Brain effort for Part C.** `low`, unless the low-effort share within 750 km is at least 10 points below the medium-effort share on the same reports; then `medium`.

**Spending cap:** 56 describer calls and 252 brain calls, each with at most one retry.

**Note of 2026-11-21, written after the first paid call of this part: smoke calls and a format fix.**

- **Smoke calls.** A smoke run on one spot (spot-01) came before the measured run, from commit `7365409`. It made 3 describer calls on top of the 56 of the cap: one `claude-sonnet-5-5` call, which returned a report of 33 lines, and two `claude-haiku-5-5` calls. The first haiku reply wrote the report lines as bare strings, not as objects with `text` and `frame`, and failed the schema. The retry passed with 24 lines.
- **Format fix.** The fix changes how the reply format is described to the describer, and nothing else. The last line of the prompt now says that every line of every section is an object with the fields `text` and `frame`, that `frame` is the number of one frame, and that the text does not repeat that number. The sample reply shows two such lines instead of one (`REPORT_FORMAT_RU` and `REPORT_JSON_EXAMPLE` in `spikes/detective/report.ts`). The rules, the sections, the schema and the guard's word list are as they were at the first paid call.
- **What is measured.** The two smoke reports are kept apart and are not used. The measured run describes all 28 spots again with the fixed prompt, so both describers are measured on the same prompt. The fix was in the working tree when the measured run started, and it is committed together with this note.

### Part C: the live protocol (may be amended until its first paid call)

**What changes against spike 2** (`--protocol report`). The round clock, the broker, the frame size (640), the data set and the infra rule stay.

1. **Scene report first.** After `observe`, the eyes file a `report` with the fixed sections of Part B, each line with the number of the frame it was seen in. The brain's first call is `briefing`, which returns the report. The brain no longer opens with blind questions.
2. **Facts in the eyes' words.** An `ask` holds up to 5 requests of two kinds: describe something, or copy text literally. Each names what to look at («люди на улице: одежда, чем заняты»), not what the brain expects to find. A request is a topic, not a question: the server refuses one that holds a «?» or the particle «ли», because an eyes model tends to confirm what it is asked about. The eyes answer with a short description and a confidence (`sure` or `unsure`), or abstain; they no longer choose among options written by the brain. The server masks a place name or a demonym in the eyes' own words (outside «…») before the brain reads them, as in Part B, and counts it. The brain's `finding` states only what the new answers change; it does not restate earlier facts.
3. **Text hunt.** The eyes get 8 zooms per round instead of 4 and are told to zoom on signs and plates before they file the report. The zoom-before-abstaining rule stays.
4. **Control question and confidence.** The prompt tells the brain to have the fact its version rests on checked once more before the final guess. `final_guess` carries `confidence` (`country`, `region` or `guess`) and the deciding clue.
5. **No hunch from the eyes (owner's decision, 2026-11-21).** A draft of this protocol had the eyes send their own best point to the server, hidden from the brain. The owner rejected it: an eyes process that has named a place attends to its own answer instead of the picture and may confirm what that place "should" show. The eyes never name or guess a place, as in spikes 1 and 2. The comparison with intuition uses the existing single-agent run, which is a separate process.

**Arms.**

| Arm       | Settings                                                                                                                                         | Rounds                    | Use                              |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------- | -------------------------------- |
| Pilot     | as v3-90, `--limit 3`                                                                                                                            | 3 (+ at most 2 re-pilots) | Protocol check only; not counted |
| **v3-90** | brain `claude-sonnet-5-5` at the effort set by the Part B rule, eyes model by the Part B rule at effort low, 8 zooms, budget 90 s, concurrency 2 | 84                        | Decides the bars                 |

Baselines are the existing runs: `candidate-90` (single agent), `detective2-90` (spike 2). The pilot rule and the infra rule are those of spike 2.

**Bars (all read from v3-90).** Every rate carries a Wilson 95% interval, and a bar passes on its point estimate.

1. **Finish:** at least 90% of rounds end with a final guess inside the 90 s budget.
2. **Dialogue:** the median number of asks answered after the briefing is at least 2.
3. **Eyes statements:** at least 80% of the judged report lines and answers are correct (opus eyes judge; `cannot_tell` left out and counted).
4. **Transcription (relaxed by the owner):** at least 90% of the texts the eyes copied are judged correct. The strict match with the labelled sign text is reported, without a bar.
5. **Unsupported findings (relaxed by the owner):** the pooled unsupported share of the brain's findings is at most 15% (opus, rubric v2, two runs). The single agent's share under the same judge and the difference are reported.
6. **Accuracy:** the median error is at most 750 km, and at most 25% of rounds end more than 2,000 km from the spot. `detective2-90` had 479 km and 46%; `candidate-90` has 5.8 km and 2%.

**Reading.** Spike 3 supports building Stage 2 if all six bars pass. If bar 6 fails, Detective stays an experiment whatever the other bars say.

**Other reported numbers (no bars).**

- Intuition what-ifs, computed after the run by pairing each v3-90 round with the `candidate-90` round of the same spot and pass: the error if the brain's pin is replaced by the single agent's pin (a) when no text was read in the round, (b) when the brain's confidence is `guess`. On `detective2-90`, rule (a) gives a median of 38 km and 65 of 84 rounds within 750 km.
- Error by the brain's confidence level. How often the control question was asked and how often it changed the answer.
- Share of rounds with at least one text read, and the eyes' wrong abstentions on text.
- Per-claim error and `rule_ok` of the findings. Tokens by role. Time to the report, to the first ask and to the final guess. Guard rejections on both roles, and requests refused for their question form. Zooms per round.

**Spending cap:** at most 9 pilot rounds and 84 measured rounds; 56 findings-judge calls and 28 eyes-judge calls on `claude-opus-5-5`, plus 1 smoke call per judge on a pilot round.

**Amendment of 2026-11-21, made before the first paid call of this part.** Parts A and B are finished; their reports are below. Where this amendment and the text above differ, the amendment holds. The spending cap is unchanged.

1. **Settings fixed by the Part B rules.** The eyes run on `claude-sonnet-5-5` and the brain at effort `low`. The run line of v3-90 is `--protocol report --brain-model claude-sonnet-5-5 --eyes-model claude-sonnet-5-5 --brain-effort low --require-zoom --move-limit 8 --budget 90 --repeats 3 --concurrency 2`.
2. **The report is short and comes early.** The brain cannot start before the report, so:
   - the eyes may spend at most 3 of their 8 zooms before the report, and the server refuses a fourth;
   - the eyes are told to write at most 4 lines per section (8 in `texts`), each of at most 120 characters. The describers of Part B were told 8, 12 and 200;
   - a line with a frame number that was never issued does not reject the report. It is counted.
3. **Journal fields from the first ask.** The brain has read the report by its first `ask`, so `finding` and `current_guess` are due in every `ask`, with one correction per ask as before.
4. **Control check.** The brain marks the `ask` that re-checks its deciding fact with `control: true`. The check changed the answer when the final pin is more than 100 km from the `current_guess` of that ask.
5. **Guard word list.** The sonnet reports of Part B had two words masked, both by mistake: «косой» (taken for Kosovo) and «катакана» (taken for Qatar). Before the first paid call of this part the guard's list of ordinary words gained these two with their case forms, and scene words with the same kind of clash: «катамаран», «катание», «костёл», «костыль», «кость», «костра», «белизна», «белила», «суда». With the new list no word is masked in the 56 reports of Part B. The list is not changed after the first paid call.
6. **Bar 2.** The server refuses an `ask` before the briefing, so every ask comes after it. The bar reads the median number of asks that the eyes answered.
7. **Bar 3.** The judged statements are every line of every filed report and every answered request, `describe` or `text`. Abstentions (`not_visible`, `unreadable`) are judged and reported apart, as in spike 2.
8. **Bar 4.** The copied texts are the lines of the `texts` section of a report that hold a «…» quote, and the answered `text` requests.
9. **Eyes judge.** `claude-opus-5-5`, one run, seed 20261128, one call per spot. It reads two new kinds of item:
   - a report line is `wrong` if any part of it is contradicted by the photos or describes something that appears in none of them. A quote of writing in «…» must reproduce text that appears in the photos, allowing one or two wrong characters per word. A line that says a text cannot be read is `wrong` only if that text is clearly readable;
   - an answer to a `describe` request is judged like a report line, and an abstention as in spike 2.

   The judge is not shown the frame number of a line. Answered requests are also tallied by the confidence the eyes gave.

10. **Bar 5 is re-anchored.** Part A showed that the limit of 15% cannot be read as written. Under the opus judge the single agent itself has 31.5%, and half of its unsupported verdicts hold no wrong claim about what is in the scene. The bar is now relative to the single agent, and it counts claims that something is there:
    - **Rubric v3** is rubric v2 with two changes. The judge gives each visual claim a kind: `seen` (something is visible, or what it looks like) or `not_seen` (something is absent, not visible or cannot be read). The judge is told that the players could zoom into parts of the photos, and that a mention of a zoomed view or of a frame number above 4 is not a visual claim.
    - **Judged findings**, as in spikes 1 and 2: the `finding` of every ask of v3-90 and the step findings of `candidate-90`, blinded and shuffled together per spot. The word «отчёт» is masked with the other role words. Two runs on `claude-opus-5-5`, seeds 20261126 and 20261127.
    - **Bar:** pooled over both runs, the error of the `seen` claims of v3-90 is at most 5 points above the error of the `seen` claims of the single agent in the same calls. The error is `contradicted` plus `absent`, over those plus `ok`. The bar passes on its point estimate. A 95% interval of the difference is reported: a percentile bootstrap that resamples spots (2,000 resamples, seed 20261129).
    - **Reported without a bar:** per arm, the share of findings with a wrong `seen` claim, the share of findings with a wrong claim of either kind (the reading of rubric v2, comparable with the 44.8% and 31.5% of Part A), and the error of `not_seen` claims; the agreement of the two runs.
    - For orientation only: by the keyword split of Part A, the error of `seen` claims was 17.3% for `detective2-90` and 3.8% for the single agent, 13.5 points apart.
11. **Bar 6.** A round without a pin counts as 20,000 km in the median and as more than 2,000 km from the spot.
12. **More reported numbers (no bars).** Zooms refused before the report. Place words masked in the eyes' report and answers. A leak check made after the run with a hand-written list of name and demonym stems for the countries of the data set: the rounds in which the eyes' own words, outside «…», name the spot's country, and how many of them the guard masked.

## Report

**Summary of the three parts.**

- **Part A.** A stronger judge does not clear spike 2: its conclusion stands, by a small margin.
- **Part B.** A brain that sees no picture and reads a full description of the scene is within 750 km in 76% of rounds, against 51% for the live protocol of spike 2. The stop rule did not fire.
- **Part C.** The live report protocol passes all six bars, three of them at their limit, so by the rule fixed before the run spike 3 supports building Stage 2. Detective still guesses much worse than the single agent: a median error of 140 km against 5.8 km.

### Part A: the opus re-judge of spike 2

**Reading under the rule fixed in Part A: spike 2's bar-5 conclusion stands, by a much smaller margin.** Pooled over the two opus runs, 44.8% of Detective's findings are unsupported, against 31.5% of the single agent's. The difference is 13.3 points (Newcombe 1.0 to 24.4): above 10 points, with an interval that excludes 0. Under the sonnet judge of spike 2 it was 29.6 points (19.8 to 37.6).

The stronger judge does not clear Detective. It is stricter with both arms, and most of all with the single agent, whose unsupported share goes from 7.9% to 31.5%. A post-hoc split by keyword (below) finds that half of the single agent's unsupported verdicts hold no wrong claim about what is in the scene: they rest on claims that something cannot be seen or read, or on claims about a frame.

**Runs.** The three runs were made in parallel on 2026-11-21, after the pre-registration commit `8d475a3`. They started at 15:04 (+03) and the last one ended at 15:13, about 8.5 minutes later.

- Findings judge: `claude-opus-5-5`, rubric v2, seeds 20261123 (run A) and 20261124 (run B); 28 calls and about 0.56 M tokens per run.
- Eyes judge: `claude-opus-5-5`, the rubric of spike 2, seed 20261125; 28 calls and about 0.68 M tokens.
- That is 84 calls, the number of the cap. Every spot was judged on the first attempt, so no retry was used, and no verdict is missing.
- The aggregates are in `docs/evals/results/detective/`: `judge3-opus-on-spike2.json` and `judge-eyes3-opus-on-spike2.json`, both made by `spikes/detective/judge-agree.ts`. The verdict files, which hold the text of the findings, are not committed.
- The model and the rubric changed together. This run cannot say how much of a change comes from opus and how much from rubric v2.

**Unsupported findings (bar 5 of spike 2).**

| Judge run                   | Detective           | Single agent       | Difference (Newcombe 95%)     | Per-claim error: Detective | Per-claim error: single agent |
| --------------------------- | ------------------- | ------------------ | ----------------------------- | -------------------------- | ----------------------------- |
| sonnet, rubric v1 (spike 2) | 75/200 = 37.5%      | 7/89 = 7.9%        | 29.6 points (19.8 to 37.6)    | not marked                 | not marked                    |
| opus, run A                 | 95/200 = 47.5%      | 27/89 = 30.3%      | 17.2 points (4.9 to 28.2)     | 20.2%                      | 6.8%                          |
| opus, run B                 | 84/200 = 42.0%      | 29/89 = 32.6%      | 9.4 points (−2.8 to 20.6)     | 17.6%                      | 7.9%                          |
| **opus, pooled**            | **179/400 = 44.8%** | **56/178 = 31.5%** | **13.3 points (1.0 to 24.4)** | **18.9%**                  | **7.4%**                      |

- The pooled interval counts each finding once (200 and 89), as fixed in Part A. Like the intervals of spikes 1 and 2, it treats findings as independent, although the findings of one round are not. It is too narrow for that reason.
- The reading rests on the pooled number. Run B alone gives 9.4 points and an interval that includes 0, and the pooled interval starts at 1.0 point.
- Claim marks, pooled over both runs:
  - Detective: 1,344 claims, of which 1,013 `ok`, 186 `contradicted`, 50 `absent` and 95 `unclear`;
  - single agent: 949 claims, of which 844 `ok`, 57 `contradicted`, 10 `absent` and 38 `unclear`.
- A single-agent finding holds 5.3 claims on average, and a Detective finding 3.4. One wrong claim fails a finding, so the longer findings of the single agent fail more easily. Per claim, Detective is wrong 2.6 times as often (18.9% against 7.4%); per finding, 1.4 times as often.
- No finding was left out of the rates: none was without a visual claim, and none had every claim `unclear`.
- Geographic rules stated in findings were judged wrong in 65 of 166 verdicts for Detective (39%) and in 11 of 81 for the single agent (14%). The sonnet judge had 8 of 29 and 3 of 13.

**Agreement per finding (289 findings).**

| Pair              | Same verdict | Unsupported in the first | In the second | In both |
| ----------------- | ------------ | ------------------------ | ------------- | ------- |
| opus A and opus B | 256 = 88.6%  | 122                      | 113           | 101     |
| sonnet and opus A | 223 = 77.2%  | 82                       | 122           | 69      |
| sonnet and opus B | 228 = 78.9%  | 82                       | 113           | 67      |

- Two runs of the same judge on the same findings differ on 33 of 289 verdicts, about 1 in 9. The counts move less: the two runs differ by 11 unsupported findings of 200 for Detective and by 2 of 89 for the single agent.
- Opus does not undo sonnet's verdicts on Detective. Of the 75 Detective findings that sonnet called unsupported, opus calls 62 (run A) and 61 (run B) unsupported too. It adds 33 and 23 that sonnet had passed.
- The judges part on the single agent. Sonnet called 7 of its 89 findings unsupported. Opus calls 27 and 29 unsupported, 22 of them in both runs. They include all 7 of sonnet's in run A and 6 in run B.

**Eyes answers (bar 3 of spike 2, re-read).**

- Opus judges 523 of 617 answered choices correct: 84.8% (81.7–87.4%), with 9 `cannot_tell` left out. Sonnet had 510 of 609: 83.7% (80.6–86.5%), with 17 left out. Bar 3 (at least 80%) passes under both judges. This does not change spike 2's gate.
- Answered transcriptions: 72 of 78 correct (sonnet 75). Transcription abstentions where the judge could read the text: 53 of 162 (sonnet 57). Abstentions on choices judged wrong: 31 of 162, with 3 `cannot_tell` (sonnet 42, with 1).
- Agreement per item with the sonnet run:

  | Group                    | Items     | Same verdict    | Wrong: sonnet | Wrong: opus | Wrong: both |
  | ------------------------ | --------- | --------------- | ------------- | ----------- | ----------- |
  | choice, answered         | 626       | 536 = 85.6%     | 99            | 94          | 59          |
  | choice, abstained        | 162       | 137 = 84.6%     | 42            | 31          | 24          |
  | transcription, answered  | 78        | 73 = 93.6%      | 3             | 6           | 2           |
  | transcription, abstained | 162       | 150 = 92.6%     | 57            | 53          | 49          |
  | **all**                  | **1,028** | **896 = 87.2%** | **201**       | **184**     | **134**     |

- The picture is the same as for findings. The share barely moves (84.8% against 83.7%), but the two judges name the same answered choice wrong in only 59 cases, out of 99 for sonnet and 94 for opus.

#### Post hoc, not pre-registered: what the wrong claims are about

This split was not planned in Part A. It was made after the verdicts were read, and it does not enter the reading above.

**Method.** `claimKind` in `spikes/detective/judge-agree.ts` sorts each claim, as the judge worded it, by keyword:

- `not_seen`: the claim says that something is absent, not visible or unreadable («no», «not», «unreadable», «не видно», «нет» and the like);
- `frame`: the claim names a frame, a zoom or a heading («frame», «кадр», «zoom», a degree sign) and is not `not_seen`;
- `seen`: every other claim, that is, a claim that something is there.

It is a keyword heuristic, and the field in `judge3-opus-on-spike2.json` is named `claimsByKeywordHeuristic` for that reason. The model that wrote this report (not a person) read samples of the sorting:

- all 45 sampled `not_seen` claims are of that kind;
- 1 of 45 sampled `seen` claims is a claim of absence («без разметки»);
- 3 of the 29 `frame` claims are ordinary claims that hold the words «window frames».

| Arm          | Kind       | `ok` | Wrong | `unclear` | Error           |
| ------------ | ---------- | ---- | ----- | --------- | --------------- |
| Detective    | `seen`     | 860  | 180   | 90        | 17.3%           |
| Detective    | `not_seen` | 151  | 56    | 5         | 27.1%           |
| Detective    | `frame`    | 2    | 0     | 0         | 0% (two claims) |
| Single agent | `seen`     | 741  | 29    | 31        | 3.8%            |
| Single agent | `not_seen` | 84   | 30    | 7         | 26.3%           |
| Single agent | `frame`    | 19   | 8     | 0         | 29.6%           |

Wrong is `contradicted` plus `absent`. The error is wrong over `ok` plus wrong. Both runs are pooled.

| Arm          | Verdicts | Unsupported | With a wrong `seen` claim | Unsupported only through `not_seen` or `frame` claims |
| ------------ | -------- | ----------- | ------------------------- | ----------------------------------------------------- |
| Detective    | 400      | 179         | 149 (37%)                 | 30                                                    |
| Single agent | 178      | 56          | 28 (16%)                  | 28                                                    |

**What it shows.**

- Claims of absence are wrong equally often in both arms: 27.1% and 26.3%. They do not tell the arms apart.
- Claims that something is there do: 17.3% are wrong for Detective against 3.8% for the single agent, more than four times as often.
- Half of the single agent's unsupported verdicts (28 of 56) hold no wrong `seen` claim. Counting only verdicts with a wrong `seen` claim, the shares are 37% for Detective and 16% for the single agent.

**Two effects on the judge's side.** Each counts against an arm for something the arm may not have got wrong. Both weigh more on the single agent, whose findings report what its looks showed.

1. **The judge sees more than the arms saw.** The judge reads every frame at full size, 1,024 pixels. The eyes and the single agent get the frames at 640 pixels and see full detail only where they zoom in. When a finding says that a text cannot be read and the judge can read it, the claim is `contradicted` and the finding is unsupported:
   - spot-05, «The front car's plate is blurred and can't be read»: the judge reads the plate in frame 1. The model that wrote this report cut the plate out at both sizes: it is clear at 1,024 pixels and at the limit of reading at 640.
   - spot-06, «no readable text»: the judge reads «EVERGREEN» on a truck.
   - spot-10, «Sign text at 270° is unreadable/not visible»: the judge reads most of «Dal lunedì al sabato… Domenica e festivi» in frame 4.
   - spot-01, «No inscriptions or signs visible»: the judge sees placards with writing.

   Only the spot-05 case was checked at both sizes, so some of the others may be plain misses by the arm. The sonnet judge passed all four findings, and its reasons show that it saw the same things. On spot-06 it wrote "Only the Latin EVERGREEN is legible". On a like finding of spot-26 it wrote "The plate on the pole is actually legible, but that is about the writer's reading rather than something the scene contradicts." Rubric v2 tells the judge to mark a claimed absence of something that is plainly there as `contradicted`. The eyes judge shows the same effect from the other side: it could read the text in 53 of the 162 transcription abstentions.

2. **The judge has only the four base frames.** A look is a crop of one of them (`scripts/eval-bots/crop.ts`), so what it showed is in the photos. The judge is not told this, and it marks a claim about a look `absent`:
   - spot-12, «Look 70°E: same architecture and mixed traffic»: "The extra 70° view is not among the photos."
   - spot-11, «extra 300° NW frame showing same buildings»: "there is no fifth frame".
   - spot-23, «Extra 200° view where signs and plates are unreadable»: "None of the four frames is an extra 200° view."

   By a hand count, 5 of the 10 single-agent claims marked `absent` in the two runs were refused for this reason. On spot-18 both runs marked a claim of the same kind («zoomed sign on the right is unreadable») `unclear`, which does not fail a finding. The judge is not consistent here.

The opus judge also fails a finding on a small point: a real object named with another frame number than the judge's (the yellow sign of spot-08, the monument of spot-26), or a sign read one letter off («NEPALO» for «NEPARU» on spot-12, a plate prefix «FL» for «FN» on spot-11). The sonnet judge passed the first three of these findings and failed the fourth.

**Was the judge of spike 2 wrong?** That was the owner's question behind Part A.

- About Detective it was not. A stronger judge with a finer rubric confirms most of its verdicts and adds more. On claims that something is there, Detective is wrong more than four times as often as the single agent.
- About the single agent it was lenient. Its 7.9% does not hold under opus. Part of the 31.5% is the two effects above, which come from what the judge is given and told, not from the arm.
- Picture quality explains little. The judge found the photos too small, dark or blurred to settle 95 of Detective's 1,344 claims (7%) and 38 of the single agent's 949 (4%). These claims are left out of the error, and no finding rested on such claims alone.
- A single verdict of either judge is weak evidence. Shares over a whole run are usable, but the two opus runs are 5.5 points apart on Detective, so a gap of that size between two runs is noise.

**Consequence for Part C.** Bar 5 of Part C asks for a pooled unsupported share of at most 15% under this judge and rubric. It was written when the single agent's share was known only from the sonnet judge (7.9%). Under the opus judge the single agent itself has 31.5%, about twice the limit, so the single agent would fail the bar as written. Bar 5 must be re-anchored by a dated amendment to Part C before Part C's first paid call. That amendment is not part of this report.

### Part B: the ceiling test

**Reading under the rules fixed in Part B: the stop rule did not fire, the eyes of Part C run on `claude-sonnet-5-5`, and the brain runs at effort `low`.** A brain that sees no picture and reads a full description written by `claude-sonnet-5-5` puts 76.2% of rounds within 750 km of the spot. The live protocol of spike 2 had 51.2%, and the single agent has 95.2%.

**Run.** One run on 2026-11-21, from 15:26 to 15:35 (+03), from commit `7365409` with the format fix described in the note to Part B.

- 56 describer calls, one per spot and describer, and 1 retry: the first `claude-haiku-5-5` reply for spot-10 named a section that the schema does not have. 252 brain calls, none retried; every one returned a point.
- About 1.1 M tokens for the describers and 1.2 M for the brain.
- A sonnet report has 34 lines at the median (17 to 42), 4 of them in `texts`. A haiku report has 30.5 lines (17 to 54). Each describer copied at least one text in 22 of the 28 spots.
- The aggregate is `docs/evals/results/detective/ceiling3.json`, made by `spikes/detective/ceiling.ts`. The reports and the brain's replies are not committed.

**Accuracy.** The two last rows are the existing runs, for comparison. Intervals are Wilson 95%.

| Arm                                      | Median error | Within 25 km  | Within 750 km              | Beyond 2,000 km |
| ---------------------------------------- | ------------ | ------------- | -------------------------- | --------------- |
| haiku reports, brain at `medium`         | 203 km       | 30/84 = 35.7% | 55/84 = 65.5% (54.8–74.8%) | 23/84 = 27.4%   |
| **sonnet reports, brain at `medium`**    | **122 km**   | 37/84 = 44.0% | 64/84 = 76.2% (66.1–84.0%) | 10/84 = 11.9%   |
| sonnet reports, brain at `low`           | 121 km       | 34/84 = 40.5% | 64/84 = 76.2% (66.1–84.0%) | 13/84 = 15.5%   |
| `detective2-90` (spike 2, live protocol) | 479 km       | 24/84 = 28.6% | 43/84 = 51.2%              | 39/84 = 46.4%   |
| `candidate-90` (single agent)            | 5.8 km       | 57/84 = 67.9% | 80/84 = 95.2%              | 2/84 = 2.4%     |

**The rules, applied.**

- **Better describer:** `claude-sonnet-5-5`, with 76.2% of its medium-effort rounds within 750 km against 65.5%.
- **Stop rule:** not fired. 76.2% is above the limit of 60%.
- **Eyes model for Part C:** `claude-sonnet-5-5`. The sonnet share is 10.7 points higher, and the rule asks for at least 10. The margin is one round: the gap is 9 rounds of 84, and with 8 the rule would have named `claude-haiku-5-5`. The two intervals overlap.
- **Brain effort for Part C:** `low`. The share within 750 km is 76.2% at both efforts.

**By the brain's own confidence** (sonnet reports).

| Confidence | Effort `medium`: rounds | Median error | Within 750 km | Effort `low`: rounds | Median error | Within 750 km |
| ---------- | ----------------------- | ------------ | ------------- | -------------------- | ------------ | ------------- |
| `country`  | 46                      | 8.6 km       | 42 = 91.3%    | 54                   | 13.2 km      | 49 = 90.7%    |
| `region`   | 10                      | 228 km       | 7             | 2                    | 1,984 km     | 1             |
| `guess`    | 28                      | 673 km       | 15 = 53.6%    | 28                   | 736 km       | 14 = 50.0%    |

- When the brain says `country`, it is within 750 km about 9 times in 10. When it says `guess`, about every second time. The level tells a player how far to trust the pin.
- On the haiku reports the picture is the same and sharper: `country` 49 rounds with 45 within 750 km, `guess` 30 rounds with 8 within 750 km and a median error of 5,799 km.

**By spot** (median of the three passes; sonnet reports, brain at `medium`).

- Against `detective2-90`: closer on 21 of 28 spots, further on 6, 1 tie. The median of the spot medians is 91.5 km against 397 km.
- Against the single agent: closer on 10 spots, further on 15, 3 ties. The median of the spot medians is 91.5 km against 4.9 km.
- Seven spots have a median error above 750 km: spot-01 (Australia, 1,058 km), spot-06 (Georgia, 1,250 km), spot-08 (India, 1,734 km), spot-14 (New Zealand, 9,470 km), spot-15 (Puerto Rico, 5,772 km), spot-17 (USA, 3,735 km) and spot-27 (Japan, 827 km). `detective2-90` has 13 such spots. The single agent has one, the same spot-14 (8,764 km).

**Masked words.** The server masked two words in the sonnet reports, «косой» and «катакана», once each, and none in the haiku reports. Both are mistakes of the guard: neither names a place. The amendment to Part C adds them to the guard's list of ordinary words.

**What this test does and does not show.**

- A text-only brain can place a spot from a description. This was the question of Part B, and the answer is yes: the median error falls from 479 km to about 120 km, and the rounds beyond 2,000 km from 46% to 12–16%.
- The description does not carry what the single agent sees. With the same pictures the single agent is within 25 km in 68% of rounds, and the report brain in 40–44%.
- It is an upper bound for the report, not a forecast of Part C. The describers read full-size frames at effort `medium` with no time limit. The live eyes get 640-pixel frames and zooms, work at effort `low`, share 90 s with the brain, and are told to write at most 4 lines per section. A live round has one thing the test lacks: the brain can ask for more after the report.
- The three passes of a spot read the same report, so the 84 rounds of an arm are 28 reports read three times. The intervals treat the rounds as independent and are too narrow for that reason.

### Part C: the pilots (written before the measured run)

Two pilots of three rounds each: spots 01 to 03, one pass. Pilot rounds are not counted in any bar.

| Pilot | Spot    | Error     | Final guess at | Report at | Report lines | Asks answered | Zooms | Control check                    |
| ----- | ------- | --------- | -------------- | --------- | ------------ | ------------- | ----- | -------------------------------- |
| 1     | spot-01 | 1,058 km  | 28.2 s         | 13.9 s    | 11           | 1             | 2     | no                               |
| 1     | spot-02 | 10,020 km | 38.4 s         | 16.0 s    | 15           | 2             | 2     | yes                              |
| 1     | spot-03 | 44 km     | 12.9 s         | 9.6 s     | 12           | 0             | 0     | no                               |
| 2     | spot-01 | 1,058 km  | 42.5 s         | 19.7 s    | 21           | 2             | 7     | yes                              |
| 2     | spot-02 | 16 km     | 54.8 s         | 20.7 s    | 20           | 3             | 7     | yes, after the server's reminder |
| 2     | spot-03 | 55 km     | 35.9 s         | 16.2 s    | 21           | 2             | 6     | yes                              |

Pilot 1 ran commit `4fd094a` with prompt hash `917d92e6179c`. Pilot 2 ran the working tree with the fixes below, which are committed together with this section; its prompt hash is `e59b2fac7ca1`. The tool schemas are the same in both (`d7dc442807ab`).

**What pilot 1 showed.** All three rounds ended with a final guess. The protocol did not run as designed, though.

- **No text hunt.** No report cited a zoomed frame. The zooms of spots 01 and 02 were made later, to answer requests. The cause is a protocol bug: the reply of `observe` still ended with «Теперь вызови next_request», a line of the earlier protocols, and it sent the eyes past the zooms. The report of spot-02 held no text, and the brain placed an Argentine street in Spain.
- **Rounds ended early.** The final guess came at 13 to 38 s of 90, after 0, 1 and 2 asks. One round of three ran the control check.
- **Every answer was marked `unsure`**, 7 of 7, plain descriptions of a balcony or a kerb among them, and the brain's rule told it not to rest a version on an unsure answer. The eyes also described small things from the start frames instead of zooming on them.

The first point is a broken protocol in the sense of the pilot rule, so the fixes were followed by a second pilot.

**Fixes between the pilots.** The pilot rule allows changes to prompts and to protocol bugs. Fix 4 is more than that: it adds a server reply.

1. The reply of `observe` names the next step of the report protocol: the text hunt, then the report.
2. Eyes prompt. The text hunt is a required step: 3 zooms, on text first, otherwise on road signs, poles and cars. The report should hold 3 to 4 lines per section where there is something to describe; the limits of the amendment are unchanged. `sure` means clearly seen and `unsure` means guessing. Small things are zoomed before they are described. The request header no longer tells the eyes to answer fast.
3. Brain prompt. Do not end early: keep asking while more than 30 s are left, and after «не разобрать» ask for a zoom on a named object or change the topic (rule 7). An unsure answer is weak evidence, not none (rule 5). The control check names the place and the topic, not the clue itself (rule 6).
4. **Control reminder (server).** A `final_guess` that comes before any control ask, with more than 30 s left and the eyes alive, is refused once with a reminder, and its point is kept as a fallback pin. A repeated `final_guess` is accepted. The report of the measured run states how many rounds got the reminder.
5. The round record gained the number of zooms made before the report.

Not changed: the guard's word list, which is frozen. In pilot 1 it masked «панамах» (hats, taken for Panama) in one report line.

**Pilot 2.** All three rounds ended with a final guess, at 36 to 55 s. Every report cites zoomed frames and has 20 or 21 lines, and the eyes used 6 or 7 of their 8 zooms. The brain sent 2, 3 and 2 asks and ran the control check in every round, once after the server's reminder. Of 11 answered requests 4 were marked `unsure`. Spot-02 moved from 10,020 km to 16 km, but no text was read there in either pilot: the brain went by the look of the street and called its answer a guess.

No third pilot was run. The prompts of v3-90 are frozen at hash `e59b2fac7ca1`.

### Part C: the live run (v3-90)

**Reading under the rule fixed in Part C: all six bars pass, so spike 3 supports building Stage 2.** Three of the six pass at their limit, and Detective is still a much weaker guesser than the single agent: a median error of 140 km against 5.8 km. What the run shows is narrower than "Detective works": the dialogue now runs, and what the two roles write about the scene is mostly true.

**Run.** One run on 2026-11-21, from 17:06 to 17:35 (+03), from commit `9d55152`.

- 84 rounds, none with an infra error, none run again. Prompt hash `e59b2fac7ca1`, tool schema hash `d7dc442807ab`, data set hash `8599d87ad828`: the prompts of pilot 2. The baselines are the existing runs and were not played again.
- 14.0 M tokens, 83% of them cached input: 3.8 M for the brain and 10.2 M for the eyes. A median round takes 163 thousand.
- Another job loaded the machine during the run (load average 6 to 17 on 8 cores). The latest final guess came at 60 s, so the 90 s limit was not close.
- Judges: 56 findings calls and 28 eyes calls on `claude-opus-5-5`, every spot judged, no verdict missing. One smoke call per judge was made before the run, on a round of pilot 2.
- Spending against the cap: 6 pilot rounds of 9, 84 measured rounds, 56 and 28 judge calls, 2 smoke calls.
- Aggregates: `detective3-90.json`, `judge3-90.json`, `judge-eyes3-90.json`, `whatif3-90.json` and `leak3-90.json` in `docs/evals/results/detective/`. The round records and the judges' sheets are not committed.

**Bars.** Intervals are Wilson 95%, except for bar 5.

| Bar                | Limit                                                          | v3-90                                                   | Result             |
| ------------------ | -------------------------------------------------------------- | ------------------------------------------------------- | ------------------ |
| 1. Finish          | at least 90% of rounds end with a final guess inside 90 s      | 84/84 = 100% (95.6–100%)                                | pass               |
| 2. Dialogue        | median number of answered asks at least 2                      | 2: one ask in 34 rounds, two in 44, three in 6          | pass, at the limit |
| 3. Eyes statements | at least 80% judged correct                                    | 1,779/1,905 = 93.4% (92.2–94.4%)                        | pass               |
| 4. Copied texts    | at least 90% judged correct                                    | 175/193 = 90.7% (85.7–94.0%)                            | pass, at the limit |
| 5. Findings        | error of `seen` claims at most 5 points above the single agent | 2.3% against 2.9%: −0.6 points (bootstrap −3.2 to +2.0) | pass               |
| 6. Accuracy        | median error at most 750 km; at most 25% beyond 2,000 km       | 140.5 km; 18/84 = 21.4% (14.0–31.3%)                    | pass               |

Bar 2 passes through the control reminder that the pilot added. In 37 rounds the brain sent a final guess before any control ask and the server sent it back once; in 22 of them it had sent no ask at all. Without those asks the median would be 1.

**Accuracy.** The three last rows are existing runs.

| Arm                                         | Median error | Within 25 km  | Within 750 km              | Beyond 2,000 km            |
| ------------------------------------------- | ------------ | ------------- | -------------------------- | -------------------------- |
| **v3-90**, live report protocol             | 140.5 km     | 30/84 = 35.7% | 56/84 = 66.7% (56.1–75.8%) | 18/84 = 21.4% (14.0–31.3%) |
| Part B ceiling: sonnet reports, brain `low` | 121 km       | 34/84 = 40.5% | 64/84 = 76.2%              | 13/84 = 15.5%              |
| `detective2-90`, spike 2                    | 479 km       | 24/84 = 28.6% | 43/84 = 51.2%              | 39/84 = 46.4%              |
| `candidate-90`, single agent                | 5.8 km       | 57/84 = 67.9% | 80/84 = 95.2%              | 2/84 = 2.4%                |

- **By the brain's confidence.** `country`: 33 rounds, median 3.7 km, 30 within 750 km, 3 beyond 2,000 km. `region`: 14 rounds, 45.9 km, 12 within 750 km, 1 beyond 2,000 km. `guess`: 37 rounds, 1,058 km, 14 within 750 km, 14 beyond 2,000 km.
- **By text.** The eyes copied at least one text in 64 rounds: median 43.9 km, 49 within 750 km, 11 beyond 2,000 km. In the 20 rounds without text: median 1,058 km, 7 within 750 km, 7 beyond 2,000 km.
- **By spot** (median of the three passes). Against `detective2-90`: closer on 21 of 28 spots, further on 3, 4 ties; the median of the spot medians is 91.6 km against 397 km. Against the single agent: closer on 10 spots, further on 18; 91.6 km against 4.9 km.
- Nine spots have a median error above 750 km: spot-01 (Australia, 1,058 km), spot-02 (Argentina, 9,988 km), spot-05 and spot-06 (Georgia, 1,491 and 2,021 km), spot-08 (India, 1,236 km), spot-14 (New Zealand, 17,209 km), spot-15 (Puerto Rico, 5,935 km), spot-17 (USA, 3,735 km) and spot-27 (Japan, 968 km). The single agent has one, spot-14.

**What the eyes wrote (bars 3 and 4).** One opus run, 2,031 items, the four start frames of a spot at full size.

| Group                              | Correct | Wrong | Cannot tell | Correct of judged |
| ---------------------------------- | ------- | ----- | ----------- | ----------------- |
| Report lines without a copied text | 1,403   | 73    | 17          | 95.1%             |
| Report lines with a copied text    | 136     | 15    | 4           | 90.1%             |
| Answers to `describe` requests     | 201     | 35    | 3           | 85.2%             |
| Answers to `text` requests         | 39      | 3     | 3           | 92.9%             |
| Abstentions on `describe`          | 26      | 3     | 1           | 89.7%             |
| Abstentions on `text`              | 56      | 13    | 0           | 81.2%             |

- Bar 3 reads the first four rows, bar 4 the second and the fourth.
- The judge is strict. It marks «FREEHAND PIERCING» wrong three times because the line says the letters stand in an arc and they stand in a line, and a line that calls one text the only readable one because a second can be read. Among the 18 wrong copied texts are «NEPAL» for a sign that reads «NEPARU» and «1,5 m» for a sign that reads about 1,90.
- **The eyes' own confidence does not sort their answers.** Answers marked `sure` are correct in 127 of 146 (87.0%), answers marked `unsure` in 113 of 132 (85.6%).
- The strict match with the labelled sign text, reported without a bar: 16 of 45 answered `text` requests (35.6%, 23.2–50.2%). The labels hold a median of one text per spot and none for 8 spots, so a correct copy of another sign counts as a miss, as in spike 2.

**The brain's findings (bar 5).** Two opus runs with rubric v3, pooled: 140 findings of v3-90 and 89 of the single agent per run.

|                                                      | v3-90          | Single agent   |
| ---------------------------------------------------- | -------------- | -------------- |
| `seen` claims wrong                                  | 17/732 = 2.3%  | 23/782 = 2.9%  |
| `not_seen` claims wrong                              | 15/101 = 14.9% | 32/124 = 25.8% |
| All claims wrong                                     | 32/833 = 3.8%  | 55/906 = 6.1%  |
| Findings with a wrong `seen` claim                   | 17/256 = 6.6%  | 23/178 = 12.9% |
| Findings with any wrong claim (reading of rubric v2) | 32/257 = 12.5% | 51/178 = 28.7% |
| Stated rules: correct / wrong                        | 55 / 8         | 70 / 11        |

- The two runs agree on 221 of 229 findings (96.5%). Of the 280 judged v3-90 findings 17 hold no visual claim and 7 are unclear.
- By the reading of rubric v2 the share of v3-90 is 12.5%, under the 15% that this bar had before the amendment. In Part A `detective2-90` had 44.8% and the single agent 31.5%. The `seen` error of `detective2-90` was 17.3% by the keyword split of Part A.
- The findings of v3-90 restate what the eyes wrote, so their accuracy follows that of the report.

**Dialogue and the control check.**

- 140 asks, all answered, none timed out; an ask takes 5.3 s at the median (8.8 s at the 95th percentile). 383 requests, 3 per ask at the median: 269 `describe` and 114 `text`.
- `describe`: 239 answered (135 `sure`, 104 `unsure`), 30 abstained. `text`: 45 answered (13 `sure`, 32 `unsure`), 69 abstained, 54 of them as unreadable.
- Every round has a control ask. 37 came after the server's reminder; in 13 more rounds the brain marked its first ask as the control check by itself. After the control answer the final pin moved more than 100 km in 8 rounds: closer to the spot in 5, further in 3.
- **The brain stops early.** The report comes at 15.8 s (21.4 s at the 95th percentile), the first ask at 20.4 s (26.9 s), the final guess at 36.1 s (45.5 s; the latest at 59.9 s). At the median 54 s of the 90 are left unused.
- The report has 20 lines at the median (12 to 29) and copies a text in 63 rounds. The eyes zoomed 3 times before the report in 67 rounds and twice in 17; the server refused no zoom there. A round has 5 zooms at the median (3 to 8).

**Other reported numbers.**

- **What-ifs** (nothing played again). If the single agent's pin replaces Detective's in the 20 rounds without text: median 73.7 km, 66/84 = 78.6% within 750 km, 13/84 = 15.5% beyond 2,000 km. If it replaces it in the 37 rounds where the brain says `guess`: 13.1 km, 75/84 = 89.3%, 6/84 = 7.1%. Neither mix reaches the single agent alone.
- **Guard.** One request of the brain was refused for a place word («английском») and one for its question form. Six of the eyes' words were masked: «камерного» in a report, and «арабской», «косо», «тайский», «европейский» and «английские» in answers. «камерного» and «косо» are ordinary words, masked by mistake. The zoom-before-abstaining rule refused one answer.
- **Leak check.** In 5 of 84 rounds the eyes' own words name the spot's country. All five are rounds on the two Thai spots and name the script («тайское письмо»), which the eyes may do; one use stood without a script noun and was masked.
- The label-based detector of invented place names counts one, «NEPAL» on spot-12; it is the same misread sign as above.

**What this run does and does not show.**

- The report protocol removes what spikes 1 and 2 failed on. The eyes describe the scene before the brain asks, the brain's requests are topics instead of questions with an expected answer, and both the report and the findings hold up under a stricter judge than before.
- **Detective does not guess as well as the single agent, and no reading of this run says it does.** The single agent is one `claude-haiku-5-5` process that answers in 13.5 s with a median error of 5.8 km. Detective is two `claude-sonnet-5-5` processes that answer in 36 s with 140 km. A reason to build it has to come from what the player sees, not from the score.
- The brain's confidence is a usable signal: a round it calls `country` is within 750 km in 30 of 33 cases, a round it calls `guess` in 14 of 37.
- The rounds that go far are mostly rounds without text, and the brain leaves more than half of the budget unused. Both point at the same next step: more of the round spent on finding text.
- Limits of the evidence. One run. The 84 rounds are 28 spots played three times, so the intervals are too narrow. Both judges are a model, with no human check. The judges read the four start frames at full size and never see a zoomed frame. Bar 5 was re-anchored in the amendment, before the first paid call of this part. The pilot fixes include a server reply, and bar 2 passes through it.

### After the report: prompt changes that are not measured

The numbers above were measured with the prompts of hash `e59b2fac7ca1`. The prompts in `spikes/detective/report-prompts.ts` were changed after that run and have not been run on any spot. A result for them needs a new run on new spots, because prompts are not tuned on the eval set.

- **Goal.** The brain is told that only the distance between its point and the real place is scored.
- **Open list.** The list of clues is said to be incomplete, and the brain is told to invent its own topics and checks.
- **Driving side and sun.** Every report must carry two lines: «Сторона движения: …» first in `road` and «Солнце: …» first in `nature`, each with «не определить» when the frames do not show it. The brain is told how to read them. These are prompt rules: the server does not check that the lines are there.
- **Plates.** The measured brain prompt named number plates seven times, and both request examples were about plates; real Street View frames blur them. The examples are now about road markings and soil, and the prompt says that plates are often blurred.
- **Unknown compass.** 24 of the 28 spots of the set have no real heading, so their frame labels are not compass directions. For such a round (`compassKnown: false`) the eyes report the sun by frame number, and the brain is told not to judge the hemisphere by it. The prompt hash of a run is computed from the prompts of a round with a real compass.
