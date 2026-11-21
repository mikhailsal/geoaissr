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
