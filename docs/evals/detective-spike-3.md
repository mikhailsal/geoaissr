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
