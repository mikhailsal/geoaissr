import { expect, test } from 'bun:test';
import type { DetectiveRoundRecord } from './records.ts';
import { whatIfs, type SingleRow } from './whatif.ts';

function round(
  spotId: string,
  errorKm: number,
  confidence: 'country' | 'guess',
  copied: boolean,
): DetectiveRoundRecord {
  const line = copied
    ? { section: 'texts', text: '«TAXI» — на крыше машины', frame: 1 }
    : { section: 'texts', text: 'надпись есть, не разобрать', frame: 1 };
  return {
    spotId,
    repeat: 1,
    errorKm,
    infraError: null,
    asks: [],
    final: { summary: 's', finding: 'f', confidence, clue: 'c' },
    reportRound: {
      report: { tSec: 20, lines: [line], maskedWords: [], unknownFrames: 0 },
      briefingAtSec: 21,
      formRejections: 0,
      earlyLookRefusals: 0,
      maskedInAnswers: [],
    },
  } as unknown as DetectiveRoundRecord;
}

const SINGLE: SingleRow[] = [
  { spotId: 's1', repeat: 1, errorKm: 5, infraError: null },
  { spotId: 's2', repeat: 1, errorKm: 10, infraError: null },
  { spotId: 's3', repeat: 1, errorKm: 3000, infraError: null },
  { spotId: 's4', repeat: 1, errorKm: 1, infraError: 'boom' },
];

test('a what-if replaces the Detective pin only where its rule fires', () => {
  const report = whatIfs(
    [
      round('s1', 9000, 'guess', false),
      round('s2', 40, 'country', true),
      round('s3', 100, 'guess', true),
      round('s4', 100, 'country', true),
    ],
    SINGLE,
  );
  // s4 has no usable single-agent round, so it is not paired.
  expect(report.pairs).toBe(3);
  expect(report.asPlayed.beyond2000Km.hits).toBe(1);
  expect(report.rules['noTextRead']?.replaced).toBe(1);
  expect(report.rules['noTextRead']?.beyond2000Km.hits).toBe(0);
  expect(report.rules['noTextRead']?.medianErrorKm).toBe(40);
  // The guess rule also swaps s3, where the single agent is far off.
  expect(report.rules['confidenceGuess']?.replaced).toBe(2);
  expect(report.rules['confidenceGuess']?.beyond2000Km.hits).toBe(1);
  expect(report.single.within750Km.hits).toBe(2);
});
