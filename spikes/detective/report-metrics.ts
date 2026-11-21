import { computeMedianAndIqr, quantile, wilsonInterval } from '../../scripts/eval-bots/metrics.ts';
import { haversineDistanceKm } from '../../shared/score.ts';
import { CONFIDENCE_LEVELS } from './ceiling-prompts.ts';
import type { DetectiveRoundRecord } from './records.ts';

/**
 * Numbers of the report protocol (docs/evals/detective-spike-3.md, Part C): the scene report,
 * the briefing, the brain's confidence, and bars 1, 2 and 6, which need no judge.
 */

const r1 = (v: number | null): number | null => (v === null ? null : Math.round(v * 10) / 10);
const r3 = (v: number): number => Math.round(v * 1000) / 1000;

function rate(hits: number, total: number) {
  return {
    hits,
    total,
    rate: total === 0 ? null : r3(hits / total),
    ci: wilsonInterval(hits, total),
  };
}

function nums(values: readonly (number | null | undefined)[]): number[] {
  return values.filter((v): v is number => typeof v === 'number');
}

function percentiles(values: readonly number[]) {
  return { p50: r1(quantile(values, 0.5)), p95: r1(quantile(values, 0.95)), n: values.length };
}

function countWords(words: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const w of words) out[w] = (out[w] ?? 0) + 1;
  return out;
}

/** A copied text: a line of the `texts` section that holds a «…» quote. */
export function isCopiedTextLine(line: { section: string; text: string }): boolean {
  return line.section === 'texts' && /«[^»]+»/u.test(line.text);
}

/** A round in which the eyes copied at least one text, in the report or in an answer. */
export function textRead(r: DetectiveRoundRecord): boolean {
  const inReport = (r.reportRound?.report?.lines ?? []).some(isCopiedTextLine);
  const inAnswers = r.asks.some((a) =>
    a.items.some((i) => i.kind === 'text' && i.status === 'answered'),
  );
  return inReport || inAnswers;
}

/** A round without a pin counts as the far side of the globe, as in compare.ts. */
const NO_PIN_KM = 20_000;

/** The accuracy numbers of bar 6 over a list of errors; null is a round without a pin. */
export function errorBands(errors: ReadonlyArray<number | null>) {
  return {
    rounds: errors.length,
    medianErrorKm: computeMedianAndIqr(errors.map((e) => e ?? NO_PIN_KM)).median,
    within750Km: rate(errors.filter((e) => e !== null && e <= 750).length, errors.length),
    beyond2000Km: rate(errors.filter((e) => e === null || e > 2000).length, errors.length),
  };
}

const accuracyOf = (records: readonly DetectiveRoundRecord[]) =>
  errorBands(records.map((r) => r.errorKm));

function byConfidence(records: readonly DetectiveRoundRecord[]) {
  const level = (r: DetectiveRoundRecord): string => r.final?.confidence ?? 'none';
  return Object.fromEntries(
    [...CONFIDENCE_LEVELS, 'none'].map((l) => [
      l,
      accuracyOf(records.filter((r) => level(r) === l)),
    ]),
  );
}

function reportStats(records: readonly DetectiveRoundRecord[]) {
  const reports = records.flatMap((r) => (r.reportRound?.report ? [r.reportRound.report] : []));
  return {
    filed: rate(reports.length, records.length),
    atSec: percentiles(reports.map((r) => r.tSec)),
    briefingAtSec: percentiles(nums(records.map((r) => r.reportRound?.briefingAtSec))),
    linesMedian: quantile(
      reports.map((r) => r.lines.length),
      0.5,
    ),
    copiedTextLinesMedian: quantile(
      reports.map((r) => r.lines.filter(isCopiedTextLine).length),
      0.5,
    ),
    looksBeforeMedian: quantile(nums(records.map((r) => r.reportRound?.looksBeforeReport)), 0.5),
    unknownFrames: reports.reduce((n, r) => n + r.unknownFrames, 0),
    maskedWords: countWords(reports.flatMap((r) => r.maskedWords)),
  };
}

/** The pin counts as moved by the control check when it ends this far from the point before. */
const CONTROL_MOVE_KM = 100;

/** How often the brain ran its control check, and how often its pin moved after it. */
function controlStats(records: readonly DetectiveRoundRecord[]) {
  let answered = 0;
  let pinMoved = 0;
  for (const r of records) {
    const ask = r.asks.find((a) => a.control === true && a.settledBy === 'answer');
    if (!ask) continue;
    answered += 1;
    if (
      ask.currentGuess &&
      r.pin &&
      haversineDistanceKm(ask.currentGuess, r.pin) > CONTROL_MOVE_KM
    ) {
      pinMoved += 1;
    }
  }
  return {
    asked: rate(
      records.filter((r) => r.asks.some((a) => a.control === true)).length,
      records.length,
    ),
    answered,
    pinMovedAfter: pinMoved,
  };
}

function describeStats(records: readonly DetectiveRoundRecord[]) {
  const items = records.flatMap((r) =>
    r.asks.flatMap((a) => a.items.filter((i) => i.kind === 'describe' || i.kind === 'text')),
  );
  const answered = items.filter((i) => i.status === 'answered');
  return {
    asked: items.length,
    answered: answered.length,
    unsure: answered.filter((i) => i.confidence === 'unsure').length,
    abstained: items.filter((i) => i.status === 'abstained').length,
    timeout: items.filter((i) => i.status === 'timeout').length,
  };
}

/** Bars 1, 2 and 6 of Part C; bars 3 to 5 come from the judges. */
function bars(records: readonly DetectiveRoundRecord[]) {
  const all = accuracyOf(records);
  const finish = rate(records.filter((r) => r.hasFinalGuess).length, records.length);
  const exchangesMedian = quantile(
    records.map((r) => r.exchanges),
    0.5,
  );
  return {
    bar1Finish: { ...finish, passed: (finish.rate ?? 0) >= 0.9 },
    bar2Dialogue: { exchangesMedian, passed: (exchangesMedian ?? 0) >= 2 },
    bar6Accuracy: {
      medianErrorKm: all.medianErrorKm,
      beyond2000Km: all.beyond2000Km,
      passed:
        all.medianErrorKm !== null &&
        all.medianErrorKm <= 750 &&
        (all.beyond2000Km.rate ?? 1) <= 0.25,
    },
  };
}

export function reportProtocolStats(records: readonly DetectiveRoundRecord[]) {
  return {
    report: reportStats(records),
    textRead: rate(records.filter(textRead).length, records.length),
    byConfidence: byConfidence(records),
    control: controlStats(records),
    requests: describeStats(records),
    formRejections: records.reduce((n, r) => n + (r.reportRound?.formRejections ?? 0), 0),
    earlyLookRefusals: records.reduce((n, r) => n + (r.reportRound?.earlyLookRefusals ?? 0), 0),
    maskedInAnswers: countWords(records.flatMap((r) => r.reportRound?.maskedInAnswers ?? [])),
    bars: bars(records),
  };
}
