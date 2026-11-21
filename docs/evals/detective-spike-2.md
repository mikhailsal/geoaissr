# Detective spike 2: pre-registration and report

The first spike ([detective-spike.md](./detective-spike.md)) failed the gate. Its main finding was that the closed catalog is the bottleneck: even when the brain was fed the human labels, its median error was 899 km. The single agent's was 5.8 km. On 2026-11-21 the owner asked for a second, bounded spike that tests the recommendation of that report.

This file is committed before any paid round of spike 2 runs. The report is appended under it after the runs and does not change the pre-registration.

## Pre-registration

### What changes against spike 1

Spike 2 makes three changes. Everything else stays as in spike 1: the round protocol, broker, journal rules, clock, guard rejections, infra rule, data set and frame size.

1. **Brain-written questions** (plan, Open Question 1, option B). Flag: `--protocol choice`. The brain no longer asks catalog features. An `ask` holds 1–5 questions of two kinds:
   - `{"kind":"choice","question":…,"options":[…]}`. The brain writes the question (up to 120 characters) and 2–6 options (up to 60 characters each). The eyes answer with one option number, `none_of_these` (the thing is visible but no option fits), `not_visible` or `unreadable`. They cannot bring in a concept that the brain did not put on the table.
   - `{"kind":"text","target":…}`, the literal transcription request of spike 1. Its answer may hold any visible text (D-TRANSCRIBE).

   The place-name guard checks the question, every option and every text target. On top of spike 1's list it knows about 40 large cities and English country names and demonyms. A demonym next to a script noun («грузинское письмо», «арабская вязь», «японская кана») passes: this is the plan's script-name whitelist. Repeated options are refused. A refused ask does not count against the 5-question cap.

2. **Zoom before abstaining.** Flag: `--require-zoom`. The server refuses an `answer` that holds `not_visible` or `unreadable` when all three hold:
   - the eyes still have paid looks;
   - they have made no `look` since the request reached them;
   - more than 12 s remain before the ask times out.

   After one look in that request they may abstain. Refusals are counted (`zoomRefusals`).

3. **Stronger brain model** (plan, Open Question 5). Flag: `--brain-model claude-sonnet-5-5`. The eyes keep `claude-haiku-5-5`, the vision model of the Stage 1 single agent, so the eyes are as strong as the single agent they are compared with.

Fixed settings for every arm:

- harness `claude`, effort `low` for both roles;
- move limit 4, frame size 640, budget 90 s, concurrency 2 (at most 4 CLI processes);
- the committed 28-spot eval set (dataset hash `8599d87ad828`).

`--protocol catalog` without the new flags still runs spike 1 unchanged. It gives the same `promptHash` (`2486b60c4355`) and `toolSchemaHash` (`7058c794c8a8`).

### Arms

| Arm                  | Command (all add `--protocol choice --require-zoom --budget 90 --concurrency 2`) | Rounds                    | Use                                                      |
| -------------------- | -------------------------------------------------------------------------------- | ------------------------- | -------------------------------------------------------- |
| Pilot                | `--brain-model claude-sonnet-5-5 --limit 3`                                      | 3 (+ at most 2 re-pilots) | Protocol check only; not counted                         |
| **v2-90**            | `--brain-model claude-sonnet-5-5 --repeats 3 --label detective2-90`              | 84                        | Decides the bars                                         |
| v2-haiku-90          | `--brain-model claude-haiku-5-5 --label detective2-haiku-90`                     | 28                        | Reported, no bar: what the stronger brain adds           |
| Stage 1 single agent | existing run `candidate-90` (claude, haiku, low, move limit 4, 3 passes)         | 84                        | Baseline for accuracy, findings and tokens; no new run   |
| Spike 1              | existing run `detective-90` (catalog, haiku brain)                               | 84                        | Reported, no bar: what the protocol change adds, by spot |

There is no 60 s arm, because D-GATEBAR allows Detective only at 90 s or more. There is no labels arm either: brain-written questions have no labels.

The pilot rule and the infra rule are the same as in spike 1:

- **Pilot.** Re-pilot at most twice, and only if the pilot finishes fewer than 2 of 3 rounds or the protocol is broken. Pilot fixes may change prompts and protocol bugs. After the last pilot the prompts are frozen, and the report states the hashes of both measured arms. No tuning on the measured arms.
- **Infra errors.** A brain CLI that fails before its first tool call is an infra error. The run stops at the first one; the missing rounds are run again once with the same settings after the cause is fixed. With more than 4 infra errors in v2-90, the bars are inconclusive.

**Spending cap:** at most 9 pilot rounds, 84 + 28 measured rounds and 56 judge calls (28 per judge), plus 1 smoke call per judge on a pilot round.

### Bars (all read from v2-90)

Every rate carries a Wilson 95% interval. A bar passes on its point estimate.

1. **Finish:** at least 90% of rounds end with a final guess inside the 90 s budget.
2. **Exchanges:** the median number of exchanges per round is at least 3. An exchange is an `ask` settled by an answer.
3. **Eyes answers:** at least 80% of answered choice questions are judged correct. Answered means an option or `none_of_these`. The judge is a model; see "Eyes-answer rubric". `cannot_tell` verdicts are left out of the rate and counted. This replaces spike 1's agreement with labels, which brain-written questions do not have.
4. **Transcription:** at least 80% of answered transcription questions match the spot's `signText`. The rule is spike 1's strict one (`spikes/detective/scoring.ts`). The judge's view on the same answers is reported next to it.
5. **Unsupported findings, as written in the plan (D-REPEATS):** v2-90's unsupported share is at least 10 points below Stage 1's, and the Newcombe interval of the difference excludes 0. Spike 1 measured Stage 1 at 6/89 = 6.7%. Unless the Stage 1 share comes out above 10%, this bar cannot pass, because it would need a negative share. It is read as written and reported.
   - **5b, non-inferiority, proposed here:** v2-90's share is at most 5 points above Stage 1's, on the point estimate; the interval is reported. Whether 5b replaces 5 is the owner's decision.
6. **Accuracy (new, the main bar):** the median error of v2-90 is at most 750 km. That is about 3,000 of 5,000 points on the world map, against about 4,980 for the single agent's median round (`candidate-90`: 5.8 km). Spike 1 showed that the old bars can pass while the bot is useless as an opponent; this bar is what spike 1's report asked to be judged first.

**Reading.**

- Spike 2 supports building Stage 2 if bars 1–4, 5b and 6 pass. The report then gives both readings: under bar 5 as written the gate fails by construction.
- If bar 6 fails, Detective stays an experiment whatever the other bars say.

### Unsupported-finding rubric

This is spike 1's rubric and judge, unchanged (`spikes/detective/judge.ts`, `claude-sonnet-5-5`, one call per spot, blinded, shuffled with seed 20261121). The findings are v2-90's `ask.finding` values from the second ask on, and the `candidate-90` `look` findings.

### Eyes-answer rubric (model judge)

`spikes/detective/judge-eyes.ts`: one `claude-sonnet-5-5` call per spot, read-only access to the four full-resolution frames, and seed 20261122.

- **Input.** Every choice and transcription item of v2-90 on that spot that was answered or abstained, shuffled and numbered. Timed-out items are left out. An item shows the question, the options and the answer; a transcription item shows the request and the text. Round, role, time and cited frame numbers are not shown. Zoom frames are crops of the four frames, so every true answer can be checked in them.
- **Verdicts.**
  - `correct`: the chosen option fits the photos best. For `none_of_these`, no option fits. For an abstention, the thing really cannot be seen or read. For a transcription, the text is in the photos, allowing one or two wrong characters per word.
  - `wrong`: another option fits better, or an option fits though the answer says none does, or the thing is clearly visible or readable though the answer abstains, or the text is not in the photos.
  - `cannot_tell`: the photos do not let the judge decide.
- **Output.** The bar uses the answered choices. Abstentions and transcriptions are reported per group. The sheet and the key stay outside the repo for the owner's human review.

### Other reported numbers (no bars)

- Time to final p50 and p95. Asks sent per round. Question mix (choice and text). Guard rejections. Zoom refusals. Late and invalid answers. Corrections. Paid looks per round. Abstention and `none_of_these` shares.
- **ASK-CUTOFF.** p50 and p95 of an answered ask cycle. The zoom rule makes it longer than in spike 1.
- **Tokens.** The median per round by role and in total, against Stage 1's 41,820.
- **Accuracy.** For each arm: median error with its IQR, rounds within 25 km and within 750 km, and the median score in points. The comparisons below are paired by spot, using the median of each spot's passes:
  - v2-90 against `candidate-90`;
  - v2-90 against spike 1's `detective-90`;
  - v2-haiku-90 against v2-90.
- **Leak check.** There are no labels to compare with. Reported instead:
  - invented place names in transcriptions (spike 1's detector);
  - guard rejections;
  - examples of the questions and options the brain wrote.

## Gate report

**Verdict: spike 2 does not support building Stage 2.** Bars 1, 2, 3 and 6 pass. Bars 4, 5 and 5b fail. Bar 4 fails on label gaps rather than on reading, but bar 5b alone decides the reading: the brain's findings are far less supported than the single agent's. Detective stays an experiment.

The protocol change works: the median error falls from 3,484 km in spike 1 to 479 km. The gap to the single agent stays large:

- the single agent's median error is 5.8 km, and it is closer on 22 of 28 spots;
- Detective scores 2,520 points per round on average, against 4,632 for the single agent;
- Detective uses 5.6× the tokens.

The brain's journal also got worse: 37.5% of its findings are unsupported by the photos, against 18.9% in spike 1 and 7.9% for the single agent.

Both measured arms ran on 2026-11-21 from commit `5bba473`, with no code change between them. Both carry `promptHash` `78e1131b1ba2` and `toolSchemaHash` `88d5b0f36d0f`; the brain model is not part of either hash. Neither arm had an infra error, and both are complete.

The aggregate results are in `docs/evals/results/detective/`: `detective2-90.json`, `detective2-haiku-90.json`, `judge2-90.json`, `judge-eyes2-90.json` and `compare2-90.json`. The per-round files are not committed.

### Bars (v2-90, 84 rounds)

| #   | Bar                                           | Result                                        | 95% interval                                      | Verdict                         |
| --- | --------------------------------------------- | --------------------------------------------- | ------------------------------------------------- | ------------------------------- |
| 1   | ≥90% finish inside 90 s                       | 84/84 = 100%                                  | 95.6–100%                                         | **pass**                        |
| 2   | median exchanges ≥3                           | 4 (63/84 rounds have ≥3)                      | 64.8–83.0% for ≥3                                 | **pass**                        |
| 3   | ≥80% of answered choices judged correct       | 510/609 = 83.7% (17 `cannot_tell` left out)   | 80.6–86.5%                                        | **pass**                        |
| 4   | transcription match ≥80% of answered          | 57/78 = 73.1%                                 | 62.3–81.7%                                        | **fail**                        |
| 5   | unsupported findings ≥10 points below Stage 1 | Detective 75/200 = 37.5%; Stage 1 7/89 = 7.9% | difference −29.6 points (Newcombe −37.6 to −19.8) | **fail**: Detective is _higher_ |
| 5b  | unsupported share ≤5 points above Stage 1     | 29.6 points above                             | as in 5                                           | **fail**                        |
| 6   | median error ≤750 km                          | 478.6 km; 43/84 rounds within 750 km          | 40.7–61.6% within 750 km                          | **pass**, by one round          |

Bar 6 passes by the smallest possible margin. 43 of 84 rounds are within 750 km, so the median is the mean of the 42nd and 43rd errors (461 and 496 km). The 44th is 1,220 km. One more round past 750 km would put the median at about 840 km, and the bar would fail.

**Details behind the bars.**

- **Choices (bar 3).**
  - The brain wrote 788 choice questions. The eyes chose an option on 570, answered `none_of_these` on 56, and abstained on 162 (20.6%, against 50% on catalog features in spike 1). No question timed out, and no eyes process went down.
  - Judge (`claude-sonnet-5-5`, one call per spot, all 28 spots, 0 missing verdicts):
    - an option chosen: 465 correct, 90 wrong, 15 `cannot_tell` (83.8% of judged);
    - `none_of_these`: 45 correct, 9 wrong, 2 `cannot_tell` (83.3%);
    - abstentions on choices: 119 correct, 42 wrong, 1 `cannot_tell`. In 26% of the abstentions the thing asked about was visible.
  - The eyes are right about 5 times in 6. A finding usually restates several answers, so one wrong answer in it is common (see bar 5).
- **Transcriptions (bar 4).**
  - The brain asked 240 transcription questions. The eyes answered 78 and abstained on 162 (67.5%, against 78% in spike 1).
  - The zoom rule worked as a rule:
    - every one of the 84 rounds made at least one `look`, against 60 of 84 rounds with none in spike 1;
    - the median is 3 paid looks per round;
    - the server refused 5 abstentions that came before a look.
  - Most strict-rule misses are label gaps, not reading errors:
    - spot-10 has no labelled sign text, so its 6 answers («Dal lunedì al sabato…», «Domenica e festivi») count as misses;
    - spot-16's labelled plate is «KY 566 77», and the eyes read «КК 966 77» and other real text on the street («ТАКСИ 730 40 40», «д.35»);
    - on spot-03 the eyes read a car plate («CT68 TBW»), but only «KEEP CLEAR» is labelled;
    - «ซิน ซิน» against «ชิน ชิน», and «km 3 9» against «39».
  - The eyes judge, reading the photos rather than the labels, finds 75 of 78 answered transcriptions correct (96.2%). The strict bar is the pre-registered one and fails; the reading itself is good.
  - Abstentions are the weak side: in 57 of 162 transcription abstentions (35%) the judge could read the text the eyes said was not there, even after the zoom.
  - The invented-place detector counts 2 («PARIS», both on spot-22). The text is real: the hoarding in the third frame lists «PARIS, 45 AVENUE MONTAIGNE, 10/12 PLACE VENDOME…». The label holds only «BVLGARI DEPUIS 1884». No transcription invents a place name.
- **Unsupported findings (bars 5 and 5b).**
  - Judge: a model (`claude-sonnet-5-5`), not a person. It judged all 289 findings, and none was without a visual claim.
  - The share of unsupported findings doubled from spike 1 (18.9% → 37.5%), although 83.7% of the eyes' choices are judged correct. The brain records the eyes' answers as facts, and a finding combines several of them: with one answer in six wrong, a finding built on three answers holds a wrong one about 40% of the time. A brain-written question offers 2–6 descriptions, and the eyes pick the closest one even when none fits well: `none_of_these` was used on only 56 of 626 answered choices (8.9%). The judge's reasons are of that kind:
    - «no markings» where the frames show a double yellow line;
    - «desert» for a village street;
    - «no text visible» where «Vini» and «Dal lunedì al sabato» can be read;
    - «roof tanks» that are not in the photos.
  - The geographic rules stated in findings were wrong in 8 of 29 Detective findings that state one, against 3 of 13 for Stage 1. In spike 1, with the haiku brain, they were wrong in 57 of 128. The sonnet brain states fewer rules, and gets more of them right; what it gets wrong is the facts it was told.
  - The same 89 Stage 1 findings scored 6 unsupported in spike 1 and 7 here: the judge is not fully repeatable.
  - As in spike 1, the interval treats findings as independent and is optimistic. The blinding is partial.

### Accuracy

All arms are computed the same way. The score is the game's world-map score, and a round with no pin would score 0; there were none.

| Arm                                           | Median error | IQR          | Within 25 km | Within 750 km | Median score | Mean score | Time to final p50 / p95 |
| --------------------------------------------- | ------------ | ------------ | ------------ | ------------- | ------------ | ---------- | ----------------------- |
| Stage 1 single agent (`candidate-90`)         | 5.8 km       | 0.9–66 km    | 57/84        | 80/84         | 4,981        | 4,632      | 13.5 / 18.1 s           |
| **v2-90** (sonnet brain, haiku eyes)          | 479 km       | 15–8,764 km  | 24/84        | 43/84         | 3,628        | 2,520      | 47.6 / 61.3 s           |
| v2-haiku-90 (haiku brain, 1 pass)             | 1,621 km     | 131–8,502 km | 5/28         | 12/28         | 1,691        | 2,293      | 46.5 / 53.3 s           |
| Spike 1 `detective-90` (catalog, haiku brain) | 3,484 km     | 359–9,960 km | 12/84        | 28/84         | 491          | 1,753      | 25.0 / 33.8 s           |

**Paired by spot** (median of each spot's passes):

| Comparison                      | First arm closer | Second arm closer | Ties | Medians of spot medians | Median paired difference    |
| ------------------------------- | ---------------- | ----------------- | ---- | ----------------------- | --------------------------- |
| v2-90 vs `candidate-90`         | 6                | 22                | 0    | 397 km vs 4.9 km        | 374 km for the single agent |
| v2-90 vs spike 1 `detective-90` | 19               | 6                 | 3    | 397 km vs 3,494 km      | 222 km for v2-90            |
| v2-haiku-90 vs v2-90            | 13               | 13                | 2    | 1,621 km vs 397 km      | 0                           |

**What the numbers say.**

- **The protocol change drives the gain over spike 1, not the brain model.**
  - Brain-written choices and the zoom rule win 19 of 28 spots against the catalog.
  - The haiku brain ties the sonnet brain spot for spot (13 : 13).
  - The haiku arm has one pass, so this tie is noisy. The idea that a stronger brain closes the gap (plan, Open Question 5) has no support here.
- **Detective's errors are bimodal.**
  - Its spot median is within 25 km on 9 spots.
  - On 13 spots its median error is above 2,000 km. On 12 of those the single agent is within 750 km. Examples:
    - spot-01 (Sydney): single agent 0.6 km, Detective 14,883 km. The brain learnt "dense city, 7+ floors, deciduous trees, no text".
    - spot-24 (Sri Lanka): 4.3 km against 17,110 km. The brain guessed Latin America from "walls, palms, tile roofs".
    - spot-12 (Nepal): 0.3 km against 8,726 km. Detective reached 4.7 km in the one pass where the eyes read the handicraft sign.
  - Without text, the place signal is the overall look of a street. The brain cannot see it, and the eyes only answer the narrow questions they are asked.
- **As an opponent, Detective is about half as strong as the single agent:** 2,520 against 4,632 points per round on average.

### Cost and timing

- **Tokens.** The median per round is 232,469 (brain 92,658, eyes 143,406), against 41,820 for the Stage 1 single agent: **5.6×**. The haiku-brain arm uses 206,431 (4.9×). Spike 1 used 3.5×.
- **ASK-CUTOFF.** A full ask cycle takes p50 5.4 s and p95 10.3 s, from 284 answered asks. Spike 1 took 2.3 s and 6.9 s; the cycle is longer because of the zoom. Every ask was settled by an answer: 0 timeouts, 0 `eyes_down`, 1 late answer dropped, 0 invalid answers. If Detective is revisited, a cutoff of 20 s keeps about twice the p95.
- **Pace.** The brain now uses the budget: a median of 4 asks per round and a final guess at p50 47.6 s. Spike 1's brain stopped at 25 s.
- **Journal.** All 200 due asks carried a `finding`. There were 6 corrections.
- **Guard and option rules (v2-90).**
  - **Guard rejections: 41.**
    - 30 are real demonyms in question text (European ×16, American ×7, and 7 single cases).
    - 11 are false positives that cost the brain a turn: «лесом» ×4, «камере / камеры / камерой» ×4, «северной», «тамильское», «катаканы».
  - **Option rejections: 95.** The brain kept offering «не видно» or «другое» as options despite the prompt, and each such ask was refused.

### Runs and deviations

- **Paid rounds: 118, all two-CLI Detective rounds.** 2 pilots × 3 rounds, v2-90 84, v2-haiku-90 28.
- **Judge calls.**
  - Findings judge: 28 calls, about 0.53 M tokens.
  - Eyes judge: 28 calls, about 0.67 M tokens, plus 1 smoke call on one pilot-2 round.
  - The first launch of the eyes judge never started: a shell grouping error sent it to a path it could not write. It was started again with no paid call lost.
- **Wall time.** About 70 minutes, from the first pilot to the end of the judges. The estimate given to the owner was about 40 minutes. The round count was kept, but rounds now use the budget (p50 48 s, against 25 s in spike 1).
- **Re-pilot.**
  - Pilot 1 (`602d7c1`) finished 3 of 3 rounds, with 2, 5 and 2 exchanges. The protocol was broken in one respect: the brain wrote options such as «машин не видно» and «надписей нет», which let the eyes abstain without the zoom the rule requires. The guard also refused a bare «арабская» in a question about scripts.
  - The fix commit (`5bba473`) did three things:
    - it refuses options that repeat a built-in answer;
    - it lets a bare demonym adjective pass as an option of a question about scripts;
    - it changes the brain prompt to forbid such options and to keep asking while more than 30 s remain.
  - Pilot 2 finished 3 of 3, with 4, 4 and 3 exchanges. The prompts were frozen there.
- **Guard loophole from that fix.** The script-question exception let language names through as options in 3 questions, one each on spot-12 («английский / французский / итальянский…»), spot-13 («только английский») and spot-16 («только обычные русские», about letters). They ask about the letters on visible signs, not the place. They are reported, not removed.
- **Prompt hashes.** Both measured arms share `78e1131b1ba2` and `88d5b0f36d0f`. The dry run before pilot 1 had `d03047c71e32` and `8ac9448013f9`; the change is the pilot-1 fix.
- **Labels.** The eval labels are model-made and unreviewed. Bar 4 and the invented-place detector read the strict labelled sign text; their gaps are listed above.

### Recommendation

Do not build Stage 2 on this protocol.

- Brain-written choices and the zoom rule fixed what spike 1 found: the catalog bottleneck and the eyes that never zoomed. They removed most of the accuracy loss, but not enough.
- What remains is structural. A brain that cannot see depends on the eyes' answers to questions it chose. On scenes without text, those answers do not carry the place signal, and forced choices put wrong facts into the journal.
- A third spike would have to change that premise, for example by letting the eyes describe the scene freely. That reopens the leak question the closed protocol was built to avoid. This is the owner's decision, not a tuning step.

Under the plan's rule, Stage 1 ships alone.
